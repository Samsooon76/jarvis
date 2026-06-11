import { hubSpotService } from "../hubspot.service.js";
import { getHubSpotAccessToken } from "../hubspot-auth.service.js";
import type { LlmProvider } from "../llm/llm.provider.js";
import {
  loadCloseLostDealContexts,
  loadExactCachedAnalysis,
  loadLastCompletedRun,
  loadLatestAnalyses,
  persistDealAnalysis,
} from "./data-access.js";
import { buildBreakdown, buildDealListItem, buildMetrics, getLossReasonBreakdownLabel } from "./presentation.js";
import {
  buildAnalysisInputHash,
  buildEvidenceSources,
  buildHistoryText,
  getAnalysisStatus,
  getDefaultDateRange,
  getProvider,
  parseNumber,
} from "./shared.js";
import type {
  CloseLostAnalysisRow,
  CloseLostDealContext,
  CloseLostDealDetailResult,
  CloseLostOverviewResult,
  CloseLostRunOptions,
} from "./types.js";

export const getCloseLostOverview = async (
  options: Omit<CloseLostRunOptions, "dateFrom" | "dateTo"> & {
    dateFrom?: string | null;
    dateTo?: string | null;
  },
): Promise<CloseLostOverviewResult> => {
  const { dateFrom, dateTo } = getDefaultDateRange(options.dateFrom, options.dateTo);
  const provider = getProvider(options.llmProvider, options.llmModel);
  const contexts = await loadCloseLostDealContexts({
    orgId: options.orgId,
    scope: options.scope,
    hubspotOwnerId: options.hubspotOwnerId,
    salesAeOwnerIds: options.salesAeOwnerIds,
    dateFrom,
    dateTo,
  });
  const latestAnalyses = await loadLatestAnalyses(
    options.orgId,
    contexts.map((context) => context.row.hubspot_deal_id),
    provider.providerName,
    provider.modelName,
  );
  const deals = contexts.map((context) => buildDealListItem(context, latestAnalyses.get(context.row.hubspot_deal_id) ?? null));
  const lastRun = await loadLastCompletedRun(
    {
      orgId: options.orgId,
      scope: options.scope,
      hubspotOwnerId: options.hubspotOwnerId,
      dateFrom,
      dateTo,
    },
    provider.providerName,
    provider.modelName,
  );
  const portfolio = lastRun?.result ?? null;
  const lossReasons = buildBreakdown(deals, getLossReasonBreakdownLabel, "Non analyse");

  return {
    orgId: options.orgId,
    scope: options.scope,
    hubspotOwnerId: options.hubspotOwnerId ?? null,
    salesAeOwnerIds: options.salesAeOwnerIds ?? [],
    dateFrom,
    dateTo,
    provider: provider.providerName,
    model: provider.modelName,
    generatedAt: new Date().toISOString(),
    lastRun,
    portfolio,
    metrics: buildMetrics(deals),
    deals,
    lossReasons,
    competitors: buildBreakdown(deals, (deal) => deal.competitorName, "Aucun concurrent identifie"),
    stageBreakdown: buildBreakdown(deals, (deal) => deal.stage, "Stage inconnu"),
    recommendations: portfolio?.recommendations ?? [],
    needsAnalysisCount: deals.filter((deal) => deal.analysisStatus !== "fresh").length,
  };
};

export const analyzeContext = async (
  orgId: string,
  context: CloseLostDealContext,
  provider: LlmProvider,
  refresh: boolean,
): Promise<{ row: CloseLostAnalysisRow; cached: boolean }> => {
  const accessToken = await getHubSpotAccessToken(orgId);
  const history = await hubSpotService.fetchDealHistory(accessToken, context.row.hubspot_deal_id);
  const historyText = buildHistoryText(history.timeline);
  const sourceActivities = buildEvidenceSources(history.timeline);
  const inputHash = buildAnalysisInputHash(context, historyText);

  if (!refresh) {
    const cached = await loadExactCachedAnalysis(
      orgId,
      context.row.hubspot_deal_id,
      provider.providerName,
      provider.modelName,
      inputHash,
    );

    if (cached) {
      return {
        row: cached,
        cached: true,
      };
    }
  }

  const analysis = await provider.analyzeCloseLostDeal({
    history: historyText || "Aucun historique HubSpot exploitable.",
    sourceActivities,
    companyName: history.companyName ?? context.company?.name ?? context.contact?.company_name ?? null,
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

  return {
    row: await persistDealAnalysis(orgId, context, provider, inputHash, analysis),
    cached: false,
  };
};

export const getCloseLostDealDetail = async (
  orgId: string,
  hubspotDealId: string,
  llmProvider?: string | null,
  llmModel?: string | null,
): Promise<CloseLostDealDetailResult> => {
  const provider = getProvider(llmProvider, llmModel);
  const contexts = await loadCloseLostDealContexts({
    orgId,
    scope: "sales_ae",
    salesAeOwnerIds: [],
    dateFrom: "1970-01-01",
    dateTo: "2999-12-31",
    hubspotDealId,
  });
  const context = contexts.find((candidate) => candidate.row.hubspot_deal_id === hubspotDealId) ?? null;

  if (!context) {
    throw new Error("Deal close lost introuvable dans Supabase.");
  }

  const latestAnalyses = await loadLatestAnalyses(orgId, [hubspotDealId], provider.providerName, provider.modelName);
  const analysisRow = latestAnalyses.get(hubspotDealId) ?? null;
  const baseDeal = buildDealListItem(context, analysisRow);

  return {
    orgId,
    provider: provider.providerName,
    model: provider.modelName,
    deal: {
      ...baseDeal,
      companyDomain: context.company?.domain ?? null,
      companyIndustry: context.company?.industry ?? null,
      contactEmail: context.contact?.email ?? null,
      closeProbability: parseNumber(context.row.close_probability) ?? 0,
      createdAt: context.row.hubspot_created_at,
      updatedAt: context.row.hubspot_updated_at,
    },
    analysis: analysisRow?.analysis ?? null,
    analysisStatus: getAnalysisStatus(context.row, analysisRow),
    generatedAt: analysisRow?.generated_at ?? null,
    sourceSyncedAt: analysisRow?.source_synced_at ?? null,
  };
};

export const analyzeCloseLostDeal = async (
  orgId: string,
  hubspotDealId: string,
  llmProvider?: string | null,
  llmModel?: string | null,
  refresh = false,
): Promise<CloseLostDealDetailResult> => {
  const provider = getProvider(llmProvider, llmModel);
  const contexts = await loadCloseLostDealContexts({
    orgId,
    scope: "sales_ae",
    salesAeOwnerIds: [],
    dateFrom: "1970-01-01",
    dateTo: "2999-12-31",
    hubspotDealId,
  });
  const context = contexts.find((candidate) => candidate.row.hubspot_deal_id === hubspotDealId) ?? null;

  if (!context) {
    throw new Error("Deal close lost introuvable dans Supabase.");
  }

  await analyzeContext(orgId, context, provider, refresh);

  return getCloseLostDealDetail(orgId, hubspotDealId, provider.providerName, provider.modelName);
};
