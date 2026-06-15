import type { AskJarvisRequest } from "@jarvis/shared";
import { getHubSpotAccessToken } from "../hubspot-auth.service.js";
import { buildHistoryText } from "../deal-intelligence/shared.js";
import { loadDealHistoryForAnalysis, resolveDealTarget } from "../deal-intelligence/data-access.js";
import { getUserQueue } from "../prospects/queue.service.js";
import type { DealIntelligenceContext } from "../deal-intelligence/types.js";

export type AskJarvisContext = {
  summary: string;
  sources: string[];
  contextBlock: string;
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
    `Stage: ${prospect?.deal_stage ?? "inconnu"}`,
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
    blocks.push("Aucun contexte deal ou queue fourni. Reponds prudemment et demande les identifiants manquants si necessaire.");
    sources.add("generic");
    summaries.push("Contexte minimal");
  }

  return {
    summary: summaries.join(" + "),
    sources: [...sources],
    contextBlock: blocks.join("\n\n"),
  };
};