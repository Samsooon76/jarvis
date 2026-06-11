import { createHash } from "node:crypto";
import type { CloseWonDealAnalysis as SharedCloseWonDealAnalysis, WinAnalysisDealListItem } from "@jarvis/shared";
import { getSupabaseAdmin } from "../../db/client.js";
import { formatHubSpotTimelineForPrompt } from "../hubspot-history-formatting.service.js";
import { hubSpotService } from "../hubspot.service.js";
import { getHubSpotAccessToken } from "../hubspot-auth.service.js";
import type { CloseWonDealAnalysis, LlmProvider } from "../llm/llm.provider.js";
import { loadLatestWinAnalyses, loadWonDealContexts } from "./data-access.js";
import { CLOSE_WON_ANALYSIS_TTL_DAYS, CLOSE_WON_ANALYSIS_TYPE, parseNumber, resolveProvider } from "./shared.js";
import type { CloseWonAnalysisRow, DealContext } from "./types.js";

const buildWinInputHash = (context: DealContext, historyText: string): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        hubspotDealId: context.row.hubspot_deal_id,
        closedAt: context.row.closed_at,
        amount: context.row.amount,
        historyText,
      }),
    )
    .digest("hex");

export const analyzeWonDealContext = async (
  orgId: string,
  context: DealContext,
  provider: LlmProvider,
  cachedRow: CloseWonAnalysisRow | null,
): Promise<{ analysis: CloseWonDealAnalysis; cached: boolean }> => {
  const accessToken = await getHubSpotAccessToken(orgId);
  const history = await hubSpotService.fetchDealHistory(accessToken, context.row.hubspot_deal_id);
  const historyText = formatHubSpotTimelineForPrompt(history.timeline);
  const inputHash = buildWinInputHash(context, historyText);

  // Un deal gagne ne change plus: meme hash -> reutilisation directe du cache.
  if (cachedRow && cachedRow.input_hash === inputHash) {
    return { analysis: cachedRow.analysis, cached: true };
  }

  const analysis = await provider.analyzeCloseWonDeal({
    history: historyText || "Aucun historique HubSpot exploitable.",
    companyName: history.companyName ?? context.companyName,
    dealName: history.dealName ?? context.row.deal_name,
    companyContext: history.companyContext,
    dealContext: history.dealContext,
    dealStage: context.row.deal_stage_label ?? context.row.deal_stage,
    dealAmount: parseNumber(context.row.amount),
    closedAt: context.row.closed_at,
    ownerName: context.ownerName,
    contactNames: history.contactNames,
    today: new Date().toISOString(),
  });

  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + CLOSE_WON_ANALYSIS_TTL_DAYS);

  const { error } = await getSupabaseAdmin()
    .from("deal_ai_analyses")
    .upsert(
      {
        org_id: orgId,
        hubspot_deal_id: context.row.hubspot_deal_id,
        analysis_type: CLOSE_WON_ANALYSIS_TYPE,
        provider: provider.providerName,
        model: provider.modelName,
        input_hash: inputHash,
        analysis,
        close_won_probability: 100,
        generated_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: "org_id,hubspot_deal_id,provider,model,input_hash" },
    );

  if (error) {
    throw new Error(`Impossible de sauvegarder l'analyse close won: ${error.message}`);
  }

  return { analysis, cached: false };
};

export const getWinAnalysisDealDetail = async (
  orgId: string,
  hubspotDealId: string,
): Promise<{ deal: WinAnalysisDealListItem; analysis: SharedCloseWonDealAnalysis | null; generatedAt: string | null }> => {
  const provider = await resolveProvider(orgId);
  const contexts = await loadWonDealContexts(orgId, "1970-01-01", "2999-12-31", hubspotDealId);
  const context = contexts[0];

  if (!context) {
    throw new Error("Deal gagne introuvable dans Supabase.");
  }

  const analyses = await loadLatestWinAnalyses(orgId, [hubspotDealId], provider.providerName, provider.modelName);
  const row = analyses.get(hubspotDealId) ?? null;

  return {
    deal: {
      hubspotDealId,
      dealName: context.row.deal_name,
      companyName: context.companyName ?? context.row.deal_name ?? "Entreprise inconnue",
      ownerName: context.ownerName,
      amount: parseNumber(context.row.amount) ?? 0,
      closedAt: context.row.closed_at,
      analyzed: row !== null,
      primaryWinFactor: row?.analysis.primaryWinFactor ?? null,
      winFactorCategory: row?.analysis.winFactorCategory ?? null,
      confidence: row?.analysis.confidence ?? null,
    },
    analysis: row?.analysis ?? null,
    generatedAt: row?.generated_at ?? null,
  };
};

export const analyzeWinDeal = async (
  orgId: string,
  hubspotDealId: string,
  refresh = false,
): Promise<{ deal: WinAnalysisDealListItem; analysis: SharedCloseWonDealAnalysis | null; generatedAt: string | null }> => {
  const provider = await resolveProvider(orgId);
  const contexts = await loadWonDealContexts(orgId, "1970-01-01", "2999-12-31", hubspotDealId);
  const context = contexts.find((candidate) => candidate.row.hubspot_deal_id === hubspotDealId) ?? null;

  if (!context) {
    throw new Error("Deal gagne introuvable dans Supabase.");
  }

  const cachedAnalyses = refresh
    ? new Map<string, CloseWonAnalysisRow>()
    : await loadLatestWinAnalyses(orgId, [hubspotDealId], provider.providerName, provider.modelName);

  await analyzeWonDealContext(orgId, context, provider, cachedAnalyses.get(hubspotDealId) ?? null);

  return getWinAnalysisDealDetail(orgId, hubspotDealId);
};
