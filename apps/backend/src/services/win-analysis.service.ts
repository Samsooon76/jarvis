import { createHash } from "node:crypto";
import type {
  CloseWonDealAnalysis as SharedCloseWonDealAnalysis,
  WinAnalysisDealListItem,
  WinAnalysisOverview,
  WinAnalysisRun,
  WinAnalysisRunLog,
  WinBenchmark,
  WinBenchmarkComparison,
  WinBenchmarkGap,
  WinBenchmarkMetrics,
} from "@jarvis/shared";
import { getSupabaseAdmin } from "../db/client.js";
import { formatHubSpotTimelineForPrompt } from "./hubspot-history-formatting.service.js";
import { hubSpotService } from "./hubspot.service.js";
import { getHubSpotAccessToken } from "./hubspot-auth.service.js";
import { createLlmProvider } from "./llm/provider.factory.js";
import { resolveLlmProviderPreference } from "./llm/provider-preference.service.js";
import type { CloseWonDealAnalysis, CloseWonPortfolioAnalysis, LlmProvider } from "./llm/llm.provider.js";

// Boucle Win Analysis: miroir du close-lost pour les deals GAGNES.
// - Benchmark quantitatif: pur SQL/TS, 0 LLM, recalcul lazy (TTL 7 jours).
// - Analyse qualitative: 1 appel LLM par deal gagne, cachee dans deal_ai_analyses
//   (analysis_type='close_won', TTL 30 jours - un deal gagne ne change plus).
// - Comparaison deal ouvert vs benchmark: diff numerique en TS, 0 LLM.

const CLOSE_WON_ANALYSIS_TYPE = "close_won";
const CLOSE_WON_ANALYSIS_TTL_DAYS = 30;
// Borne du plan: 30 derniers deals gagnes max par run.
const MAX_DEALS_PER_RUN = 30;
const RUN_LOG_LIMIT = 100;
const CLOSE_WON_ANALYSIS_CONCURRENCY = 5;
const BENCHMARK_PERIOD_MONTHS = 12;
const BENCHMARK_TTL_DAYS = 7;
// Biais de survivant: en dessous de 10 wins, le benchmark n'alimente ni le
// scoring queue ni les prompts.
export const MIN_BENCHMARK_SAMPLE_SIZE = 10;

type HubSpotDealRow = {
  hubspot_deal_id: string;
  hubspot_owner_id: string | null;
  primary_contact_id: string | null;
  primary_company_id: string | null;
  deal_name: string | null;
  amount: number | string | null;
  pipeline_label: string | null;
  deal_stage: string | null;
  deal_stage_label: string | null;
  deal_lifecycle_status: "pending" | "won" | "lost" | null;
  is_closed_deal: boolean | null;
  hubspot_created_at: string | null;
  closed_at: string | null;
  hubspot_updated_at: string | null;
  synced_at: string;
};

type DealContext = {
  row: HubSpotDealRow;
  companyName: string | null;
  ownerName: string | null;
};

type CloseWonAnalysisRow = {
  hubspot_deal_id: string;
  input_hash: string;
  analysis: CloseWonDealAnalysis;
  generated_at: string;
  expires_at: string;
};

type WinRunRow = {
  id: string;
  org_id: string;
  provider: string;
  model: string;
  date_from: string;
  date_to: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  current_step: string;
  logs: unknown;
  deal_count: number;
  analyzed_count: number;
  reused_count: number;
  failed_count: number;
  result: CloseWonPortfolioAnalysis | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

type BenchmarkRow = {
  segment: string;
  date_from: string;
  date_to: string;
  sample_size: number;
  benchmark: WinBenchmarkMetrics;
  computed_at: string;
};

type ActivityCountRow = {
  hubspot_deal_id: string | null;
  channel: "call" | "email" | "sms" | "deal";
};

const WIN_FACTOR_LABELS: Record<string, string> = {
  champion: "Champion interne",
  timing: "Timing",
  product_fit: "Fit produit",
  pricing: "Pricing",
  process: "Process de vente",
  relationship: "Relation",
  other: "Autre",
};

const parseNumber = (value: number | string | null): number | null => {
  const parsed = typeof value === "string" ? Number(value) : value;

  return parsed !== null && Number.isFinite(parsed) ? Number(parsed) : null;
};

const normalizeStageText = (value: string | null | undefined): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const isLostDeal = (row: HubSpotDealRow): boolean => {
  if (row.deal_lifecycle_status === "lost") {
    return true;
  }

  const stage = normalizeStageText(`${row.deal_stage_label ?? ""} ${row.deal_stage ?? ""}`);

  return stage.includes("lost") || stage.includes("perdu");
};

const isWonDeal = (row: HubSpotDealRow): boolean =>
  !isLostDeal(row) && (row.deal_lifecycle_status === "won" || row.is_closed_deal === true);

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

const getDefaultDateRange = (dateFrom?: string | null, dateTo?: string | null): { dateFrom: string; dateTo: string } => {
  const now = new Date();
  const from = new Date(now);
  from.setUTCMonth(from.getUTCMonth() - BENCHMARK_PERIOD_MONTHS);

  return {
    dateFrom: dateFrom?.slice(0, 10) || toIsoDate(from),
    dateTo: dateTo?.slice(0, 10) || toIsoDate(now),
  };
};

const normalizeLogs = (value: unknown): WinAnalysisRunLog[] =>
  Array.isArray(value)
    ? (value as WinAnalysisRunLog[]).filter(
        (item) => item && typeof item.at === "string" && typeof item.message === "string",
      )
    : [];

const mapRunRow = (row: WinRunRow): WinAnalysisRun => ({
  id: row.id,
  orgId: row.org_id,
  status: row.status,
  progress: row.progress,
  currentStep: row.current_step,
  logs: normalizeLogs(row.logs),
  dealCount: row.deal_count,
  analyzedCount: row.analyzed_count,
  reusedCount: row.reused_count,
  failedCount: row.failed_count,
  dateFrom: row.date_from.slice(0, 10),
  dateTo: row.date_to.slice(0, 10),
  result: row.result,
  error: row.error,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
});

const resolveProvider = async (orgId: string): Promise<LlmProvider> => {
  const preference = await resolveLlmProviderPreference(orgId);

  return createLlmProvider({ provider: preference.provider, model: preference.model });
};

// --- Chargement des deals gagnes ---------------------------------------------

const loadWonDealContexts = async (
  orgId: string,
  dateFrom: string,
  dateTo: string,
  hubspotDealId?: string | null,
): Promise<DealContext[]> => {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("hubspot_deals")
    .select(
      "hubspot_deal_id, hubspot_owner_id, primary_contact_id, primary_company_id, deal_name, amount, pipeline_label, deal_stage, deal_stage_label, deal_lifecycle_status, is_closed_deal, hubspot_created_at, closed_at, hubspot_updated_at, synced_at",
    )
    .eq("org_id", orgId)
    .order("closed_at", { ascending: false })
    .limit(500);

  if (hubspotDealId) {
    query = query.eq("hubspot_deal_id", hubspotDealId);
  } else {
    query = query
      .not("closed_at", "is", null)
      .gte("closed_at", `${dateFrom}T00:00:00.000Z`)
      .lte("closed_at", `${dateTo}T23:59:59.999Z`);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Impossible de charger les deals gagnes: ${error.message}`);
  }

  const deals = ((data ?? []) as HubSpotDealRow[]).filter(isWonDeal).slice(0, hubspotDealId ? 1 : MAX_DEALS_PER_RUN);
  const companyIds = Array.from(
    new Set(deals.map((deal) => deal.primary_company_id).filter((value): value is string => Boolean(value))),
  );
  const ownerIds = Array.from(
    new Set(deals.map((deal) => deal.hubspot_owner_id).filter((value): value is string => Boolean(value))),
  );

  const [companiesResult, ownersResult] = await Promise.all([
    companyIds.length > 0
      ? supabase.from("hubspot_companies").select("hubspot_company_id, name").eq("org_id", orgId).in("hubspot_company_id", companyIds)
      : Promise.resolve({ data: [], error: null }),
    ownerIds.length > 0
      ? supabase.from("users").select("hubspot_owner_id, name").eq("org_id", orgId).in("hubspot_owner_id", ownerIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const companyNameById = new Map(
    ((companiesResult.data ?? []) as Array<{ hubspot_company_id: string; name: string | null }>).map((company) => [
      company.hubspot_company_id,
      company.name,
    ]),
  );
  const ownerNameById = new Map(
    ((ownersResult.data ?? []) as Array<{ hubspot_owner_id: string | null; name: string }>)
      .filter((owner) => owner.hubspot_owner_id)
      .map((owner) => [owner.hubspot_owner_id as string, owner.name]),
  );

  return deals.map((row) => ({
    row,
    companyName: row.primary_company_id ? companyNameById.get(row.primary_company_id) ?? null : null,
    ownerName: row.hubspot_owner_id ? ownerNameById.get(row.hubspot_owner_id) ?? null : null,
  }));
};

// --- Cache des analyses close won (deal_ai_analyses) -------------------------

const loadLatestWinAnalyses = async (
  orgId: string,
  hubspotDealIds: string[],
  provider: string,
  model: string,
): Promise<Map<string, CloseWonAnalysisRow>> => {
  if (hubspotDealIds.length === 0) {
    return new Map();
  }

  const { data, error } = await getSupabaseAdmin()
    .from("deal_ai_analyses")
    .select("hubspot_deal_id, input_hash, analysis, generated_at, expires_at")
    .eq("org_id", orgId)
    .eq("analysis_type", CLOSE_WON_ANALYSIS_TYPE)
    .eq("provider", provider)
    .eq("model", model)
    .in("hubspot_deal_id", hubspotDealIds)
    .order("generated_at", { ascending: false });

  if (error) {
    throw new Error(`Impossible de charger le cache close won: ${error.message}`);
  }

  const latestByDealId = new Map<string, CloseWonAnalysisRow>();

  for (const row of (data ?? []) as CloseWonAnalysisRow[]) {
    if (!latestByDealId.has(row.hubspot_deal_id)) {
      latestByDealId.set(row.hubspot_deal_id, row);
    }
  }

  return latestByDealId;
};

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

const analyzeWonDealContext = async (
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

// --- Benchmark quantitatif (0 LLM) -------------------------------------------

const loadActivityCounts = async (
  orgId: string,
  hubspotDealIds: string[],
): Promise<Map<string, { calls: number; emails: number; touchpoints: number }>> => {
  if (hubspotDealIds.length === 0) {
    return new Map();
  }

  const { data, error } = await getSupabaseAdmin()
    .from("activity_events")
    .select("hubspot_deal_id, channel")
    .eq("org_id", orgId)
    .in("hubspot_deal_id", hubspotDealIds)
    .limit(50000);

  if (error) {
    // activity_events absent ou vide: benchmark sans dimension activite.
    return new Map();
  }

  const counts = new Map<string, { calls: number; emails: number; touchpoints: number }>();

  for (const row of (data ?? []) as ActivityCountRow[]) {
    if (!row.hubspot_deal_id) {
      continue;
    }

    const entry = counts.get(row.hubspot_deal_id) ?? { calls: 0, emails: 0, touchpoints: 0 };
    entry.touchpoints += 1;

    if (row.channel === "call") {
      entry.calls += 1;
    } else if (row.channel === "email") {
      entry.emails += 1;
    }

    counts.set(row.hubspot_deal_id, entry);
  }

  return counts;
};

const average = (values: number[]): number | null =>
  values.length > 0 ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null;

const median = (values: number[]): number | null => {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
};

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

// --- Runs d'analyse qualitative ----------------------------------------------

const appendRunLog = (logs: WinAnalysisRunLog[], level: WinAnalysisRunLog["level"], message: string): WinAnalysisRunLog[] =>
  [...logs, { at: new Date().toISOString(), level, message }].slice(-RUN_LOG_LIMIT);

const updateRun = async (runId: string, updates: Record<string, unknown>): Promise<void> => {
  const { error } = await getSupabaseAdmin().from("close_won_analysis_runs").update(updates).eq("id", runId);

  if (error) {
    throw new Error(`Impossible de mettre a jour le run close won: ${error.message}`);
  }
};

const loadRun = async (runId: string): Promise<WinAnalysisRun & { provider: string; model: string }> => {
  const { data, error } = await getSupabaseAdmin().from("close_won_analysis_runs").select("*").eq("id", runId).maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le run close won: ${error.message}`);
  }

  if (!data) {
    throw new Error("Run close won introuvable.");
  }

  const row = data as WinRunRow;

  return { ...mapRunRow(row), provider: row.provider, model: row.model };
};

export const getWinAnalysisRun = async (runId: string): Promise<WinAnalysisRun> => loadRun(runId);

export const createWinAnalysisRun = async (options: {
  orgId: string;
  dateFrom?: string | null;
  dateTo?: string | null;
}): Promise<WinAnalysisRun> => {
  const provider = await resolveProvider(options.orgId);
  const { dateFrom, dateTo } = getDefaultDateRange(options.dateFrom, options.dateTo);
  const { data, error } = await getSupabaseAdmin()
    .from("close_won_analysis_runs")
    .insert({
      org_id: options.orgId,
      scope: "sales_ae",
      provider: provider.providerName,
      model: provider.modelName,
      date_from: dateFrom,
      date_to: dateTo,
      status: "queued",
      progress: 0,
      current_step: "Queued",
      logs: appendRunLog([], "info", "Run close won cree."),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Impossible de creer le run close won: ${error.message}`);
  }

  return mapRunRow(data as WinRunRow);
};

const buildPortfolioDealsSummary = (deals: Array<{ context: DealContext; analysis: CloseWonDealAnalysis }>): string =>
  deals
    .map(({ context, analysis }) =>
      [
        `Deal: ${context.row.deal_name ?? context.row.hubspot_deal_id}`,
        `Entreprise: ${context.companyName ?? "inconnue"}`,
        `Montant: ${parseNumber(context.row.amount) ?? 0}`,
        `Owner: ${context.ownerName ?? "inconnu"}`,
        `Facteur: ${analysis.primaryWinFactor}`,
        `Categorie: ${analysis.winFactorCategory}`,
        `Moments cles: ${analysis.keyMoments.map((moment) => moment.moment).join("; ") || "n/a"}`,
        `Resume: ${analysis.summary}`,
      ].join(" | "),
    )
    .join("\n");

export const executeWinAnalysisRun = async (runId: string): Promise<void> => {
  const run = await loadRun(runId);
  const provider = createLlmProvider({ provider: run.provider, model: run.model });
  let logs = appendRunLog(run.logs, "info", "Chargement des deals gagnes depuis Supabase.");
  let analyzedCount = 0;
  let reusedCount = 0;
  let failedCount = 0;

  await updateRun(run.id, { status: "running", progress: 5, current_step: "Chargement des deals gagnes", logs });

  try {
    const contexts = await loadWonDealContexts(run.orgId, run.dateFrom, run.dateTo);
    const cachedAnalyses = await loadLatestWinAnalyses(
      run.orgId,
      contexts.map((context) => context.row.hubspot_deal_id),
      provider.providerName,
      provider.modelName,
    );
    const analyzedDeals: Array<{ context: DealContext; analysis: CloseWonDealAnalysis }> = [];

    logs = appendRunLog(logs, "info", `${contexts.length} deal(s) gagne(s) a traiter (30 max par run).`);
    await updateRun(run.id, { progress: 10, current_step: "Analyse des deals gagnes", logs, deal_count: contexts.length });

    let nextContextIndex = 0;
    let processedCount = 0;

    const processNextContext = async (): Promise<void> => {
      while (nextContextIndex < contexts.length) {
        const index = nextContextIndex;
        nextContextIndex += 1;
        const context = contexts[index];

        if (!context) {
          continue;
        }

        try {
          const result = await analyzeWonDealContext(
            run.orgId,
            context,
            provider,
            cachedAnalyses.get(context.row.hubspot_deal_id) ?? null,
          );
          analyzedCount += result.cached ? 0 : 1;
          reusedCount += result.cached ? 1 : 0;
          analyzedDeals.push({ context, analysis: result.analysis });
        } catch (error) {
          failedCount += 1;
          logs = appendRunLog(
            logs,
            "warning",
            `Analyse echouee pour ${context.row.deal_name ?? context.row.hubspot_deal_id}: ${
              error instanceof Error ? error.message : "erreur inconnue"
            }`,
          );
        }

        processedCount += 1;
        await updateRun(run.id, {
          progress: 10 + Math.round((processedCount / Math.max(contexts.length, 1)) * 70),
          current_step: `Analyse des deals ${processedCount}/${contexts.length}`,
          logs,
          analyzed_count: analyzedCount,
          reused_count: reusedCount,
          failed_count: failedCount,
        });
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CLOSE_WON_ANALYSIS_CONCURRENCY, Math.max(contexts.length, 1)) }, () =>
        processNextContext(),
      ),
    );

    logs = appendRunLog(logs, "info", "Generation de la synthese des patterns de victoire.");
    await updateRun(run.id, { progress: 86, current_step: "Synthese des patterns", logs });

    const totalWonValue = contexts.reduce((sum, context) => sum + (parseNumber(context.row.amount) ?? 0), 0);
    const portfolio =
      analyzedDeals.length > 0
        ? await provider.analyzeCloseWonPortfolio({
            dealsSummary: buildPortfolioDealsSummary(analyzedDeals),
            dateFrom: run.dateFrom,
            dateTo: run.dateTo,
            scopeLabel: "Tous les Sales AE",
            wonDealCount: contexts.length,
            totalWonValue,
            analyzedDealCount: analyzedDeals.length,
          })
        : null;

    // Le benchmark quantitatif est rafraichi en fin de run (0 LLM).
    try {
      await computeWinBenchmarks(run.orgId);
      logs = appendRunLog(logs, "info", "Benchmark quantitatif des wins recalcule.");
    } catch (benchmarkError) {
      logs = appendRunLog(
        logs,
        "warning",
        `Benchmark wins non recalcule: ${benchmarkError instanceof Error ? benchmarkError.message : "erreur inconnue"}`,
      );
    }

    logs = appendRunLog(logs, "success", "Run close won termine.");
    await updateRun(run.id, {
      status: "completed",
      progress: 100,
      current_step: "Termine",
      logs,
      deal_count: contexts.length,
      analyzed_count: analyzedCount,
      reused_count: reusedCount,
      failed_count: failedCount,
      result: portfolio,
      error: null,
      finished_at: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue pendant le run close won.";
    logs = appendRunLog(logs, "error", message);
    await updateRun(run.id, {
      status: "failed",
      current_step: "Erreur",
      logs,
      analyzed_count: analyzedCount,
      reused_count: reusedCount,
      failed_count: failedCount,
      error: message,
      finished_at: new Date().toISOString(),
    });

    throw error;
  }
};

// --- Vue d'ensemble -----------------------------------------------------------

const loadLastCompletedRun = async (orgId: string): Promise<WinAnalysisRun | null> => {
  const { data, error } = await getSupabaseAdmin()
    .from("close_won_analysis_runs")
    .select("*")
    .eq("org_id", orgId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le dernier run close won: ${error.message}`);
  }

  return data ? mapRunRow(data as WinRunRow) : null;
};

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
