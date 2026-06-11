import { getObjectiveAmountForForecast } from "../sales-targets.service.js";
import type { ForecastOverviewOptions, ForecastOverviewResult } from "./types.js";
import { getDefaultDateRange, getProvider } from "./shared.js";
import { loadLatestDealIntelligence, loadOpenDealContexts } from "./data-access.js";
import {
  averageScore,
  buildForecastDeal,
  buildLevers,
  buildMonthlyProjection,
  buildReliability,
  buildRisks,
  buildScenarios,
  summarizeForecastDeals,
} from "./metrics.js";
import { loadStoredForecastSynthesis } from "./synthesis.js";

export const getForecastOverview = async (options: ForecastOverviewOptions): Promise<ForecastOverviewResult> => {
  const { dateFrom, dateTo } = getDefaultDateRange(options.dateFrom, options.dateTo);
  const scope = options.scope === "owner" ? "owner" : "all";
  const provider = getProvider(options.llmProvider, options.llmModel);
  const contexts = await loadOpenDealContexts({
    orgId: options.orgId,
    scope,
    hubspotOwnerId: options.hubspotOwnerId ?? null,
    dateFrom,
    dateTo,
  });
  const latestAnalyses = await loadLatestDealIntelligence(
    options.orgId,
    contexts.map((context) => context.row.hubspot_deal_id),
    provider.providerName,
    provider.modelName,
  );
  const deals = contexts
    .map((context) => buildForecastDeal(context, latestAnalyses.get(context.row.hubspot_deal_id) ?? null))
    .sort((left, right) => right.impactAmount - left.impactAmount);
  const summary = summarizeForecastDeals(deals);
  const reliability = buildReliability(summary.openDeals);
  const freshDeals = summary.openDeals.filter((deal) => deal.analysisStatus === "fresh");
  const staleDeals = summary.openDeals.filter((deal) => deal.analysisStatus === "stale");
  const missingDeals = summary.openDeals.filter((deal) => deal.analysisStatus === "missing");
  const lastAnalyzedAt = freshDeals
    .map((deal) => deal.analyzedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
  const objectiveAmount = await getObjectiveAmountForForecast({
    orgId: options.orgId,
    scope,
    hubspotOwnerId: options.hubspotOwnerId ?? null,
    dateFrom,
    dateTo,
  });
  const monthlyProjection = await buildMonthlyProjection({
    orgId: options.orgId,
    scope,
    hubspotOwnerId: scope === "owner" ? options.hubspotOwnerId ?? null : null,
    dateFrom,
    dateTo,
    deals,
  });
  const synthesis = await loadStoredForecastSynthesis({
    orgId: options.orgId,
    scope,
    hubspotOwnerId: scope === "owner" ? options.hubspotOwnerId ?? "" : "",
    dateFrom,
    dateTo,
    provider: provider.providerName,
    model: provider.modelName,
    freshOpenDeals: freshDeals,
    objectiveAmount,
  });

  return {
    orgId: options.orgId,
    scope,
    hubspotOwnerId: scope === "owner" ? options.hubspotOwnerId ?? null : null,
    dateFrom,
    dateTo,
    provider: provider.providerName,
    model: provider.modelName,
    generatedAt: new Date().toISOString(),
    lastAnalyzedAt,
    openDealCount: summary.openDeals.length,
    wonDealCount: summary.signedDeals.length,
    signedDealCount: summary.signedDeals.length,
    signedPaymentPendingDealCount: summary.signedPaymentPendingDeals.length,
    paymentReceivedDealCount: summary.paymentReceivedDeals.length,
    analyzedDealCount: freshDeals.length,
    staleDealCount: staleDeals.length,
    missingAnalysisCount: missingDeals.length,
    signedAmount: summary.signedAmount,
    signedPaymentPendingAmount: summary.signedPaymentPendingAmount,
    paymentReceivedAmount: summary.paymentReceivedAmount,
    openPipelineAmount: summary.openPipelineAmount,
    openForecastAmount: summary.openForecastAmount,
    landingAmount: summary.landingAmount,
    pipelineAmount: summary.pipelineAmount,
    forecastAmount: summary.landingAmount,
    objectiveAmount,
    gapToObjective: objectiveAmount === null ? null : summary.landingAmount - objectiveAmount,
    confidenceScore: averageScore(reliability),
    scenarios: buildScenarios(deals),
    risks: buildRisks(freshDeals),
    levers: buildLevers(freshDeals),
    reliability,
    monthlyProjection,
    deals,
    synthesis,
  };
};
