import type {
  WinBenchmark,
  WinBenchmarkComparison,
  WinBenchmarkGap,
  WinBenchmarkMetrics,
} from "@jarvis/shared";
import { getSupabaseAdmin } from "../../db/client.js";
import { loadActivityCounts } from "./data-access.js";
import {
  average,
  BENCHMARK_TTL_DAYS,
  getDefaultDateRange,
  isWonDeal,
  median,
  MIN_BENCHMARK_SAMPLE_SIZE,
  parseNumber,
} from "./shared.js";
import type { BenchmarkRow, HubSpotDealRow } from "./types.js";

// --- Benchmark quantitatif (0 LLM) -------------------------------------------

const buildBenchmarkMetrics = (
  deals: HubSpotDealRow[],
  activityCounts: Map<string, { calls: number; emails: number; touchpoints: number }>,
): WinBenchmarkMetrics => {
  const dealsWithActivity = deals.filter((deal) => activityCounts.has(deal.hubspot_deal_id));
  const cycleDays = deals
    .filter((deal) => deal.hubspot_created_at && deal.closed_at)
    .map((deal) =>
      Math.max(
        0,
        Math.round(
          (new Date(deal.closed_at as string).getTime() - new Date(deal.hubspot_created_at as string).getTime()) / 86_400_000,
        ),
      ),
    );

  return {
    avgCalls: average(dealsWithActivity.map((deal) => activityCounts.get(deal.hubspot_deal_id)?.calls ?? 0)),
    avgEmails: average(dealsWithActivity.map((deal) => activityCounts.get(deal.hubspot_deal_id)?.emails ?? 0)),
    avgTouchpoints: average(dealsWithActivity.map((deal) => activityCounts.get(deal.hubspot_deal_id)?.touchpoints ?? 0)),
    avgCycleDays: average(cycleDays),
    medianAmount: median(deals.map((deal) => parseNumber(deal.amount) ?? 0).filter((amount) => amount > 0)),
  };
};

// Agregation SQL/TS des wins sur 12 mois, par segment ('all' + par pipeline).
export const computeWinBenchmarks = async (orgId: string): Promise<WinBenchmark[]> => {
  const { dateFrom, dateTo } = getDefaultDateRange();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("hubspot_deals")
    .select(
      "hubspot_deal_id, hubspot_owner_id, primary_contact_id, primary_company_id, deal_name, amount, pipeline_label, deal_stage, deal_stage_label, deal_lifecycle_status, is_closed_deal, hubspot_created_at, closed_at, hubspot_updated_at, synced_at",
    )
    .eq("org_id", orgId)
    .not("closed_at", "is", null)
    .gte("closed_at", `${dateFrom}T00:00:00.000Z`)
    .limit(2000);

  if (error) {
    throw new Error(`Impossible de charger les deals pour le benchmark wins: ${error.message}`);
  }

  const wonDeals = ((data ?? []) as HubSpotDealRow[]).filter(isWonDeal);
  const activityCounts = await loadActivityCounts(
    orgId,
    wonDeals.map((deal) => deal.hubspot_deal_id),
  );

  const segments = new Map<string, HubSpotDealRow[]>([["all", wonDeals]]);

  for (const deal of wonDeals) {
    const pipeline = deal.pipeline_label?.trim();

    if (pipeline) {
      segments.set(pipeline, [...(segments.get(pipeline) ?? []), deal]);
    }
  }

  const benchmarks: WinBenchmark[] = [];

  for (const [segment, segmentDeals] of segments) {
    const benchmark: WinBenchmark = {
      segment,
      dateFrom,
      dateTo,
      sampleSize: segmentDeals.length,
      metrics: buildBenchmarkMetrics(segmentDeals, activityCounts),
      computedAt: new Date().toISOString(),
    };

    const { error: upsertError } = await supabase.from("win_pattern_benchmarks").upsert(
      {
        org_id: orgId,
        segment,
        date_from: dateFrom,
        date_to: dateTo,
        sample_size: benchmark.sampleSize,
        benchmark: benchmark.metrics,
        computed_at: benchmark.computedAt,
      },
      { onConflict: "org_id,segment" },
    );

    if (upsertError) {
      throw new Error(`Impossible de sauvegarder le benchmark wins: ${upsertError.message}`);
    }

    benchmarks.push(benchmark);
  }

  return benchmarks;
};

const mapBenchmarkRow = (row: BenchmarkRow): WinBenchmark => ({
  segment: row.segment,
  dateFrom: row.date_from.slice(0, 10),
  dateTo: row.date_to.slice(0, 10),
  sampleSize: row.sample_size,
  metrics: row.benchmark,
  computedAt: row.computed_at,
});

// Lecture du benchmark avec recalcul lazy (TTL 7 jours): pas de scheduler dedie,
// le premier acces de la semaine paie ~3 requetes SQL, cout LLM 0.
export const getWinBenchmarks = async (orgId: string): Promise<WinBenchmark[]> => {
  const { data, error } = await getSupabaseAdmin()
    .from("win_pattern_benchmarks")
    .select("segment, date_from, date_to, sample_size, benchmark, computed_at")
    .eq("org_id", orgId);

  if (error) {
    throw new Error(`Impossible de charger les benchmarks wins: ${error.message}`);
  }

  const rows = (data ?? []) as BenchmarkRow[];
  const staleCutoff = Date.now() - BENCHMARK_TTL_DAYS * 86_400_000;
  const allSegment = rows.find((row) => row.segment === "all");

  if (!allSegment || new Date(allSegment.computed_at).getTime() < staleCutoff) {
    return computeWinBenchmarks(orgId);
  }

  return rows.map(mapBenchmarkRow);
};

const pickBenchmarkForDeal = (benchmarks: WinBenchmark[], pipelineLabel: string | null): WinBenchmark | null => {
  const pipelineBenchmark = pipelineLabel
    ? benchmarks.find((benchmark) => benchmark.segment === pipelineLabel && benchmark.sampleSize >= MIN_BENCHMARK_SAMPLE_SIZE)
    : null;

  return pipelineBenchmark ?? benchmarks.find((benchmark) => benchmark.segment === "all") ?? null;
};

// Comparaison deal ouvert vs pattern gagnant: diff numerique pure, 0 LLM.
export const compareDealToBenchmark = async (orgId: string, hubspotDealId: string): Promise<WinBenchmarkComparison> => {
  const supabase = getSupabaseAdmin();
  const [{ data: dealData, error: dealError }, benchmarks, activityCounts] = await Promise.all([
    supabase
      .from("hubspot_deals")
      .select("hubspot_deal_id, pipeline_label, hubspot_created_at")
      .eq("org_id", orgId)
      .eq("hubspot_deal_id", hubspotDealId)
      .maybeSingle(),
    getWinBenchmarks(orgId),
    loadActivityCounts(orgId, [hubspotDealId]),
  ]);

  if (dealError) {
    throw new Error(`Impossible de charger le deal pour la comparaison wins: ${dealError.message}`);
  }

  const deal = dealData as { hubspot_deal_id: string; pipeline_label: string | null; hubspot_created_at: string | null } | null;

  if (!deal) {
    throw new Error("Deal introuvable dans Supabase.");
  }

  const benchmark = pickBenchmarkForDeal(benchmarks, deal.pipeline_label);
  const counts = activityCounts.get(hubspotDealId) ?? { calls: 0, emails: 0, touchpoints: 0 };
  const ageDays = deal.hubspot_created_at
    ? Math.max(0, Math.round((Date.now() - new Date(deal.hubspot_created_at).getTime()) / 86_400_000))
    : null;

  if (!benchmark || benchmark.sampleSize < MIN_BENCHMARK_SAMPLE_SIZE) {
    return {
      hubspotDealId,
      segment: benchmark?.segment ?? "all",
      sampleSize: benchmark?.sampleSize ?? 0,
      reliable: false,
      gaps: [],
    };
  }

  const gaps: WinBenchmarkGap[] = [];
  const pushGap = (metric: WinBenchmarkGap["metric"], label: string, actual: number, target: number | null): void => {
    if (target !== null && actual < target) {
      gaps.push({ metric, label, actual, benchmark: target });
    }
  };

  pushGap("calls", "Appels", counts.calls, benchmark.metrics.avgCalls);
  pushGap("emails", "Emails", counts.emails, benchmark.metrics.avgEmails);
  pushGap("touchpoints", "Touchpoints", counts.touchpoints, benchmark.metrics.avgTouchpoints);

  if (ageDays !== null && benchmark.metrics.avgCycleDays !== null && ageDays > benchmark.metrics.avgCycleDays) {
    gaps.push({ metric: "cycleDays", label: "Jours dans le cycle", actual: ageDays, benchmark: benchmark.metrics.avgCycleDays });
  }

  return {
    hubspotDealId,
    segment: benchmark.segment,
    sampleSize: benchmark.sampleSize,
    reliable: true,
    gaps,
  };
};

// Nombre de gaps d'activite vs le benchmark 'all' pour un lot de deals ouverts
// (batch pour le scoring de la Morning Queue). Best-effort, 0 LLM: map vide si
// le benchmark n'est pas significatif ou indisponible.
export const computeWinActivityGapCounts = async (
  orgId: string,
  hubspotDealIds: string[],
): Promise<Map<string, number>> => {
  if (hubspotDealIds.length === 0) {
    return new Map();
  }

  try {
    const benchmarks = await getWinBenchmarks(orgId);
    const benchmark = benchmarks.find((entry) => entry.segment === "all");

    if (!benchmark || benchmark.sampleSize < MIN_BENCHMARK_SAMPLE_SIZE) {
      return new Map();
    }

    const activityCounts = await loadActivityCounts(orgId, hubspotDealIds);
    const gapCounts = new Map<string, number>();

    for (const hubspotDealId of hubspotDealIds) {
      const counts = activityCounts.get(hubspotDealId) ?? { calls: 0, emails: 0, touchpoints: 0 };
      let gapCount = 0;

      if (benchmark.metrics.avgCalls !== null && counts.calls < benchmark.metrics.avgCalls) {
        gapCount += 1;
      }

      if (benchmark.metrics.avgEmails !== null && counts.emails < benchmark.metrics.avgEmails) {
        gapCount += 1;
      }

      if (benchmark.metrics.avgTouchpoints !== null && counts.touchpoints < benchmark.metrics.avgTouchpoints) {
        gapCount += 1;
      }

      gapCounts.set(hubspotDealId, gapCount);
    }

    return gapCounts;
  } catch {
    return new Map();
  }
};

// Resume 2-3 lignes pour enrichir les prompts existants (forecast, taches).
// Renvoie null si le benchmark n'est pas significatif (biais de survivant).
export const buildWinBenchmarkSummaryForPrompt = async (orgId: string): Promise<string | null> => {
  try {
    const benchmarks = await getWinBenchmarks(orgId);
    const benchmark = benchmarks.find((entry) => entry.segment === "all");

    if (!benchmark || benchmark.sampleSize < MIN_BENCHMARK_SAMPLE_SIZE) {
      return null;
    }

    const { metrics } = benchmark;
    const lines = [
      `Sur ${benchmark.sampleSize} deals gagnes (12 derniers mois): cycle moyen ${metrics.avgCycleDays ?? "n/a"} jours, panier median ${metrics.medianAmount ?? "n/a"}.`,
    ];

    if (metrics.avgTouchpoints !== null) {
      lines.push(
        `Activite moyenne d'un deal gagnant: ${metrics.avgCalls ?? 0} appels, ${metrics.avgEmails ?? 0} emails (${metrics.avgTouchpoints} touchpoints au total).`,
      );
    }

    return lines.join("\n");
  } catch {
    // Best-effort: l'absence de benchmark ne doit jamais bloquer un prompt.
    return null;
  }
};
