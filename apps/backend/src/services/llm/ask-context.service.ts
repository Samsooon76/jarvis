import type { AskJarvisRequest } from "@jarvis/shared";
import { getHubSpotAccessToken } from "../hubspot-auth.service.js";
import { buildHistoryText } from "../deal-intelligence/shared.js";
import { loadDealHistoryForAnalysis, resolveDealTarget } from "../deal-intelligence/data-access.js";
import { getForecastOverview } from "../forecast.service.js";
import { getUserQueue } from "../prospects/queue.service.js";
import type { DealIntelligenceContext } from "../deal-intelligence/types.js";

export type AskJarvisContext = {
  summary: string;
  sources: string[];
  contextBlock: string;
};

const readProspectDealStageLabel = (rawData: unknown): string | null => {
  if (!rawData || typeof rawData !== "object") {
    return null;
  }

  const dealStageLabel = (rawData as { dealStageLabel?: unknown }).dealStageLabel;

  return typeof dealStageLabel === "string" && dealStageLabel.trim() ? dealStageLabel.trim() : null;
};

const readStageFromDealContext = (dealContext: string | null | undefined): string | null => {
  if (!dealContext) {
    return null;
  }

  const match = dealContext.match(/^Stage:\s*(.+)$/m);

  return match?.[1]?.trim() ?? null;
};

const formatCurrency = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "inconnu";
  }

  return `${Math.round(value).toLocaleString("fr-FR")} EUR`;
};

const buildDealContext = async (
  request: AskJarvisRequest,
  dealContext: DealIntelligenceContext,
): Promise<{ block: string; sources: string[]; summary: string }> => {
  const target = await resolveDealTarget(request.prospectId?.trim() || "mcp-ask", dealContext);
  const accessToken = await getHubSpotAccessToken(target.orgId);
  const dealHistory = await loadDealHistoryForAnalysis(target.orgId, accessToken, target.hubspotDealId);
  const historyText = buildHistoryText(dealHistory.timeline);
  const prospect = target.prospect;

  const contactLabel =
    prospect?.name ??
    (dealHistory.contactNames.length > 0 ? dealHistory.contactNames.join(", ") : "inconnu");

  const block = [
    "=== Deal ===",
    `Prospect: ${contactLabel}`,
    `Entreprise: ${prospect?.company ?? dealHistory.companyName ?? "inconnue"}`,
    `Deal: ${dealHistory.dealName ?? "inconnu"}`,
    `Stage: ${
      readProspectDealStageLabel(prospect?.raw_data) ??
      readStageFromDealContext(dealHistory.dealContext) ??
      prospect?.deal_stage ??
      "inconnu"
    }`,
    `Montant: ${formatCurrency(prospect?.deal_amount ?? null)}`,
    `Probabilite: ${prospect?.close_probability ?? "inconnue"}%`,
    `Dernier contact: ${prospect?.last_contact_at ?? "inconnu"}`,
    `Prochaine action: ${prospect?.next_action ?? "aucune"}`,
    dealHistory.dealContext ? `Contexte deal: ${dealHistory.dealContext}` : null,
    dealHistory.companyContext ? `Contexte entreprise: ${dealHistory.companyContext}` : null,
    "",
    "=== Historique CRM ===",
    historyText || "Aucun historique disponible.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  return {
    block,
    sources: ["prospect", "hubspot_history"],
    summary: `Deal ${dealHistory.dealName ?? prospect?.name ?? target.hubspotDealId}`,
  };
};

const buildForecastContext = async (orgId: string): Promise<{ block: string; sources: string[]; summary: string }> => {
  const overview = await getForecastOverview({
    orgId,
    scope: "all",
  });

  const topDeals = overview.deals
    .filter((deal) => deal.forecastBucket === "openForecast")
    .slice(0, 8)
    .map(
      (deal, index) =>
        [
          `${index + 1}. ${deal.dealName ?? "Deal"} (${deal.companyName})`,
          `   Montant: ${formatCurrency(deal.amount)} | Stage: ${deal.stage}`,
          `   Prob IA: ${deal.aiProbability ?? "n/a"}% | Sante: ${deal.dealHealth ?? "inconnue"}`,
          deal.suggestedMove ? `   Action: ${deal.suggestedMove}` : null,
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n"),
    );

  const topRisks = overview.risks
    .slice(0, 5)
    .map((risk) => `- ${risk.title} (${risk.severity}, ${risk.dealCount} deals, ${formatCurrency(risk.amount)})`);

  const block = [
    "=== Forecast pipeline ===",
    `Periode: ${overview.dateFrom} -> ${overview.dateTo}`,
    `Deals ouverts: ${overview.openDealCount} | Analyses IA: ${overview.analyzedDealCount}`,
    `Landing: ${formatCurrency(overview.landingAmount)} | Forecast: ${formatCurrency(overview.forecastAmount)}`,
    `Objectif: ${overview.objectiveAmount === null ? "non defini" : formatCurrency(overview.objectiveAmount)}`,
    `Ecart objectif: ${overview.gapToObjective === null ? "n/a" : formatCurrency(overview.gapToObjective)}`,
    overview.synthesis?.headline ? `Synthese IA: ${overview.synthesis.headline}` : null,
    "",
    "Top deals ouverts:",
    topDeals.length > 0 ? topDeals.join("\n") : "Aucun deal ouvert dans le perimetre.",
    "",
    "Risques pipeline:",
    topRisks.length > 0 ? topRisks.join("\n") : "Aucun risque majeur detecte.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  return {
    block,
    sources: ["forecast_overview"],
    summary: `Forecast ${overview.openDealCount} deals ouverts`,
  };
};

const buildQueueContext = async (userId: string): Promise<{ block: string; sources: string[]; summary: string }> => {
  const { payload } = await getUserQueue(userId);
  const topProspects = payload.prospects.slice(0, 8);

  const block = [
    "=== Morning queue ===",
    `Commercial: ${payload.userId}`,
    `Generee le: ${payload.generatedAt}`,
    `Nombre de prospects: ${payload.prospects.length}`,
    "",
    ...topProspects.map(
      (prospect, index) =>
        [
          `${index + 1}. ${prospect.name} (${prospect.company})`,
          `   Stage: ${prospect.dealStage} | Probabilite: ${prospect.closeProbability}% | Priorite: ${prospect.priority}`,
          `   Action: ${prospect.nextAction}`,
        ].join("\n"),
    ),
  ].join("\n");

  return {
    block,
    sources: ["morning_queue"],
    summary: `Queue de ${payload.prospects.length} prospects`,
  };
};

export const buildAskJarvisContext = async (request: AskJarvisRequest): Promise<AskJarvisContext> => {
  const blocks: string[] = [];
  const sources = new Set<string>();
  const summaries: string[] = [];

  blocks.push(`Organisation: ${request.orgId}`);

  const hasDealScope = Boolean(request.prospectId?.trim() || request.hubspotDealId?.trim());

  if (hasDealScope) {
    const dealContext = await buildDealContext(request, {
      orgId: request.orgId,
      hubspotDealId: request.hubspotDealId ?? null,
    });
    blocks.push(dealContext.block);
    dealContext.sources.forEach((source) => sources.add(source));
    summaries.push(dealContext.summary);
  }

  if (request.includeQueue && request.userId?.trim()) {
    const queueContext = await buildQueueContext(request.userId.trim());
    blocks.push(queueContext.block);
    queueContext.sources.forEach((source) => sources.add(source));
    summaries.push(queueContext.summary);
  }

  if (!hasDealScope && !(request.includeQueue && request.userId?.trim())) {
    try {
      const forecastContext = await buildForecastContext(request.orgId);
      blocks.push(forecastContext.block);
      forecastContext.sources.forEach((source) => sources.add(source));
      summaries.push(forecastContext.summary);
    } catch {
      blocks.push("Forecast indisponible (HubSpot non connecte ou perimetre vide).");
      sources.add("generic");
      summaries.push("Contexte minimal");
    }
  }

  return {
    summary: summaries.join(" + "),
    sources: [...sources],
    contextBlock: blocks.join("\n\n"),
  };
};