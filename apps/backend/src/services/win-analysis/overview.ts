import type { WinAnalysisDealListItem, WinAnalysisOverview } from "@jarvis/shared";
import { getWinBenchmarks } from "./benchmark.js";
import { loadLastCompletedRun, loadLatestWinAnalyses, loadWonDealContexts } from "./data-access.js";
import {
  getDefaultDateRange,
  MIN_BENCHMARK_SAMPLE_SIZE,
  parseNumber,
  resolveProvider,
  WIN_FACTOR_LABELS,
} from "./shared.js";

// --- Vue d'ensemble -----------------------------------------------------------

export const getWinAnalysisOverview = async (options: {
  orgId: string;
  dateFrom?: string | null;
  dateTo?: string | null;
}): Promise<WinAnalysisOverview> => {
  const { dateFrom, dateTo } = getDefaultDateRange(options.dateFrom, options.dateTo);
  const provider = await resolveProvider(options.orgId);
  const contexts = await loadWonDealContexts(options.orgId, dateFrom, dateTo);
  const [analyses, lastRun, benchmarks] = await Promise.all([
    loadLatestWinAnalyses(
      options.orgId,
      contexts.map((context) => context.row.hubspot_deal_id),
      provider.providerName,
      provider.modelName,
    ),
    loadLastCompletedRun(options.orgId),
    getWinBenchmarks(options.orgId),
  ]);

  const deals: WinAnalysisDealListItem[] = contexts.map((context) => {
    const analysis = analyses.get(context.row.hubspot_deal_id)?.analysis ?? null;

    return {
      hubspotDealId: context.row.hubspot_deal_id,
      dealName: context.row.deal_name,
      companyName: context.companyName ?? context.row.deal_name ?? "Entreprise inconnue",
      ownerName: context.ownerName,
      amount: parseNumber(context.row.amount) ?? 0,
      closedAt: context.row.closed_at,
      analyzed: analysis !== null,
      primaryWinFactor: analysis?.primaryWinFactor ?? null,
      winFactorCategory: analysis?.winFactorCategory ?? null,
      confidence: analysis?.confidence ?? null,
    };
  });

  const wonValue = deals.reduce((sum, deal) => sum + deal.amount, 0);
  const analyzedCount = deals.filter((deal) => deal.analyzed).length;

  const factorRows = new Map<string, { dealCount: number; wonValue: number }>();

  for (const deal of deals) {
    const key = deal.winFactorCategory ?? "non_analyse";
    const entry = factorRows.get(key) ?? { dealCount: 0, wonValue: 0 };
    entry.dealCount += 1;
    entry.wonValue += deal.amount;
    factorRows.set(key, entry);
  }

  return {
    orgId: options.orgId,
    dateFrom,
    dateTo,
    generatedAt: new Date().toISOString(),
    wonDealCount: deals.length,
    wonValue,
    averageWin: deals.length > 0 ? Math.round(wonValue / deals.length) : 0,
    analyzedCount,
    needsAnalysisCount: deals.length - analyzedCount,
    deals,
    winFactors: Array.from(factorRows.entries())
      .map(([id, entry]) => ({
        id,
        label: WIN_FACTOR_LABELS[id] ?? "Non analyse",
        dealCount: entry.dealCount,
        wonValue: entry.wonValue,
        share: wonValue > 0 ? Math.round((entry.wonValue / wonValue) * 100) : 0,
      }))
      .sort((left, right) => right.wonValue - left.wonValue),
    lastRun,
    portfolio: lastRun?.result ?? null,
    benchmarks: benchmarks.filter((benchmark) => benchmark.segment === "all" || benchmark.sampleSize >= MIN_BENCHMARK_SAMPLE_SIZE),
  };
};
