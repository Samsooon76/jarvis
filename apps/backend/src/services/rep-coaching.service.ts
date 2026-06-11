import { createHash } from "node:crypto";
import type {
  RepCoaching,
  RepCoachingEvidenceSource,
  RepCoachingStats,
  RepCoachingFunnelStage,
  RepCoachingSourceDeal,
  TeamCoachingCard,
  TeamCoachingRunResult,
} from "@jarvis/shared";
import { getSupabaseAdmin } from "../db/client.js";
import { createLlmProvider } from "./llm/provider.factory.js";
import { resolveLlmProviderPreference } from "./llm/provider-preference.service.js";
import type { RepCoachingAnalysis } from "./llm/llm.provider.js";

// Coaching IA par commercial, en 2 niveaux:
// 1. Stats deterministes (SQL, cout 0), toujours recalculees a la lecture.
// 2. Synthese LLM (1 appel max par sales), cache 7 jours par input_hash:
//    si les stats arrondies n'ont pas change, aucun appel.
// Aucune ré-analyse de deal: les patterns de pertes viennent des analyses
// close-lost deja en cache, les verdicts du cache forecast_synthesis.

const COACHING_PERIOD_DAYS = 90;
const COACHING_CACHE_TTL_DAYS = 7;
// En dessous de ce volume de deals fermes, la synthese LLM n'est pas generee
// (stats seules, message "donnees insuffisantes" cote UI).
const MIN_CLOSED_DEALS_FOR_LLM = 10;
const TEAM_RUN_CONCURRENCY = 5;

type SalesUserRow = {
  id: string;
  name: string | null;
  role: "sales" | "manager" | "admin";
  hubspot_owner_id: string | null;
};

type CoachingDealRow = {
  hubspot_deal_id: string;
  hubspot_owner_id: string | null;
  deal_name: string | null;
  amount: number | string | null;
  deal_stage: string | null;
  deal_stage_label: string | null;
  deal_lifecycle_status: "pending" | "won" | "lost" | null;
  is_closed_deal: boolean | null;
  hubspot_created_at: string | null;
  closed_at: string | null;
};

type CloseLostAnalysisRow = {
  hubspot_deal_id: string;
  analysis: {
    lossReasonCategory?: string;
    riskSignals?: Array<{ title?: string }>;
    evidenceSources?: RepCoachingEvidenceSource[];
  } | null;
};

type CallObjectionRow = {
  ai_objections: string[] | null;
};

type KpiRow = {
  user_id: string;
  calls_made: number;
  emails_sent: number;
  meetings_booked: number;
  deals_moved: number;
};

type ForecastVerdictSourceRow = {
  analysis: {
    deals?: Array<{ category?: string }>;
  } | null;
};

type RepCoachingAnalysisRow = {
  id: string;
  target_user_id: string;
  analysis: RepCoachingAnalysis;
  provider: string;
  model: string;
  input_hash: string;
  generated_at: string;
  expires_at: string;
};

type CoachingTarget = {
  userId: string;
  name: string;
  hubspotOwnerId: string | null;
};

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

export const getRepCoachingDateRange = (): { dateFrom: string; dateTo: string } => {
  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - COACHING_PERIOD_DAYS);

  return { dateFrom: toIsoDate(from), dateTo: toIsoDate(now) };
};

const parseAmount = (value: number | string | null): number => {
  const parsed = typeof value === "string" ? Number(value) : value;

  return Number.isFinite(parsed) ? Number(parsed) : 0;
};

const getDealStageText = (deal: CoachingDealRow): string =>
  (deal.deal_stage_label ?? deal.deal_stage ?? "").toLowerCase();

const isLostDeal = (deal: CoachingDealRow): boolean =>
  deal.deal_lifecycle_status === "lost" || getDealStageText(deal).includes("lost") || getDealStageText(deal).includes("perdu");

const isWonDeal = (deal: CoachingDealRow): boolean =>
  !isLostDeal(deal) && (deal.deal_lifecycle_status === "won" || deal.is_closed_deal === true);

const getDealStatus = (deal: CoachingDealRow): RepCoachingSourceDeal["status"] => {
  if (isLostDeal(deal)) {
    return "lost";
  }

  if (isWonDeal(deal)) {
    return "won";
  }

  return "open";
};

const toSourceDeal = (
  deal: CoachingDealRow,
  evidenceSources: RepCoachingEvidenceSource[] = [],
): RepCoachingSourceDeal => ({
  hubspotDealId: deal.hubspot_deal_id,
  dealName: deal.deal_name?.trim() || `Deal ${deal.hubspot_deal_id}`,
  amount: Math.round(parseAmount(deal.amount)),
  stage: deal.deal_stage_label ?? deal.deal_stage ?? "Stage inconnu",
  status: getDealStatus(deal),
  closedAt: deal.closed_at,
  evidenceSources,
});

const isClosedInRange = (deal: CoachingDealRow, dateFrom: string, dateTo: string): boolean => {
  if (!deal.closed_at) {
    return false;
  }

  const closedDate = deal.closed_at.slice(0, 10);

  return closedDate >= dateFrom && closedDate <= dateTo;
};

const median = (values: number[]): number | null => {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
};

const countBy = <T>(items: T[], getKey: (item: T) => string | null): Array<{ key: string; count: number }> => {
  const counts = new Map<string, number>();

  for (const item of items) {
    const key = getKey(item)?.trim();

    if (key) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count);
};

const loadOrgSalesUsers = async (orgId: string): Promise<SalesUserRow[]> => {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("id, name, role, hubspot_owner_id")
    .eq("org_id", orgId)
    .eq("role", "sales");

  if (error) {
    throw new Error(`Impossible de charger les commerciaux pour le coaching: ${error.message}`);
  }

  return (data ?? []) as SalesUserRow[];
};

const loadCoachingTarget = async (orgId: string, targetUserId: string): Promise<CoachingTarget> => {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("id, name, role, hubspot_owner_id")
    .eq("org_id", orgId)
    .eq("id", targetUserId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le commercial cible: ${error.message}`);
  }

  const user = data as SalesUserRow | null;

  if (!user) {
    throw new Error("Commercial introuvable dans cette organisation.");
  }

  return {
    userId: user.id,
    name: user.name?.trim() || "Commercial",
    hubspotOwnerId: user.hubspot_owner_id,
  };
};

const loadOrgDeals = async (orgId: string): Promise<CoachingDealRow[]> => {
  const { data, error } = await getSupabaseAdmin()
    .from("hubspot_deals")
    .select(
      "hubspot_deal_id, hubspot_owner_id, deal_name, amount, deal_stage, deal_stage_label, deal_lifecycle_status, is_closed_deal, hubspot_created_at, closed_at",
    )
    .eq("org_id", orgId)
    .limit(10000);

  if (error) {
    throw new Error(`Impossible de charger les deals pour le coaching: ${error.message}`);
  }

  return (data ?? []) as CoachingDealRow[];
};

const loadCloseLostAnalyses = async (orgId: string, hubspotDealIds: string[]): Promise<CloseLostAnalysisRow[]> => {
  if (hubspotDealIds.length === 0) {
    return [];
  }

  const { data, error } = await getSupabaseAdmin()
    .from("close_lost_deal_analyses")
    .select("hubspot_deal_id, analysis")
    .eq("org_id", orgId)
    .in("hubspot_deal_id", hubspotDealIds)
    .order("generated_at", { ascending: false });

  if (error) {
    // Table absente ou non migree: le coaching reste utilisable sans patterns de pertes.
    return [];
  }

  // Une seule analyse (la plus recente) par deal.
  const latestByDealId = new Map<string, CloseLostAnalysisRow>();

  for (const row of (data ?? []) as CloseLostAnalysisRow[]) {
    if (!latestByDealId.has(row.hubspot_deal_id)) {
      latestByDealId.set(row.hubspot_deal_id, row);
    }
  }

  return Array.from(latestByDealId.values());
};

const loadObjections = async (
  orgId: string,
  userId: string,
  dateFrom: string,
  dateTo: string,
): Promise<Array<{ objection: string; count: number }>> => {
  const { data, error } = await getSupabaseAdmin()
    .from("calls")
    .select("ai_objections")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .gte("started_at", `${dateFrom}T00:00:00Z`)
    .lte("started_at", `${dateTo}T23:59:59Z`)
    .limit(2000);

  if (error) {
    return [];
  }

  const objections = ((data ?? []) as CallObjectionRow[]).flatMap((row) => row.ai_objections ?? []);

  return countBy(objections, (objection) => objection)
    .slice(0, 5)
    .map(({ key, count }) => ({ objection: key, count }));
};

const loadKpiRows = async (orgId: string, dateFrom: string, dateTo: string): Promise<KpiRow[]> => {
  const { data, error } = await getSupabaseAdmin()
    .from("daily_kpis")
    .select("user_id, calls_made, emails_sent, meetings_booked, deals_moved")
    .eq("org_id", orgId)
    .gte("date", dateFrom)
    .lte("date", dateTo);

  if (error) {
    throw new Error(`Impossible de charger les KPIs pour le coaching: ${error.message}`);
  }

  return (data ?? []) as KpiRow[];
};

const loadForecastVerdicts = async (
  orgId: string,
  hubspotOwnerId: string | null,
): Promise<Array<{ category: string; count: number }>> => {
  if (!hubspotOwnerId) {
    return [];
  }

  const { data, error } = await getSupabaseAdmin()
    .from("forecast_synthesis")
    .select("analysis")
    .eq("org_id", orgId)
    .eq("scope", "owner")
    .eq("hubspot_owner_id", hubspotOwnerId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return [];
  }

  const deals = (data as ForecastVerdictSourceRow | null)?.analysis?.deals ?? [];

  return countBy(deals, (deal) => deal.category ?? null).map(({ key, count }) => ({ category: key, count }));
};

const buildFunnel = (deals: CoachingDealRow[]): RepCoachingFunnelStage[] => {
  const byStage = new Map<string, RepCoachingFunnelStage>();

  for (const deal of deals) {
    const stage = deal.deal_stage_label ?? deal.deal_stage ?? "Stage inconnu";
    const entry = byStage.get(stage) ?? {
      stage,
      openCount: 0,
      openAmount: 0,
      lostCount: 0,
      wonCount: 0,
      sourceDeals: [],
    };

    if (isLostDeal(deal)) {
      entry.lostCount += 1;
    } else if (isWonDeal(deal)) {
      entry.wonCount += 1;
    } else {
      entry.openCount += 1;
      entry.openAmount += parseAmount(deal.amount);
    }

    entry.sourceDeals.push(toSourceDeal(deal));
    byStage.set(stage, entry);
  }

  return Array.from(byStage.values())
    .map((entry) => ({
      ...entry,
      openAmount: Math.round(entry.openAmount),
      sourceDeals: entry.sourceDeals.sort((left, right) => right.amount - left.amount).slice(0, 8),
    }))
    .sort((left, right) => right.openCount + right.lostCount + right.wonCount - (left.openCount + left.lostCount + left.wonCount));
};

const computeWinRate = (wonCount: number, lostCount: number): number | null =>
  wonCount + lostCount > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 100) : null;

// Stats deterministes (cout LLM 0), toujours fraiches.
export const computeRepStats = async (
  orgId: string,
  target: CoachingTarget,
  dateFrom: string,
  dateTo: string,
  preloaded?: { orgDeals?: CoachingDealRow[]; kpiRows?: KpiRow[] },
): Promise<RepCoachingStats> => {
  const orgDeals = preloaded?.orgDeals ?? (await loadOrgDeals(orgId));
  const repDeals = target.hubspotOwnerId
    ? orgDeals.filter((deal) => deal.hubspot_owner_id === target.hubspotOwnerId)
    : [];

  const closedInRange = repDeals.filter((deal) => isClosedInRange(deal, dateFrom, dateTo));
  const wonDeals = closedInRange.filter(isWonDeal);
  const lostDeals = closedInRange.filter(isLostDeal);
  const openDeals = repDeals.filter((deal) => !isWonDeal(deal) && !isLostDeal(deal));

  const avgWonAmount =
    wonDeals.length > 0
      ? Math.round(wonDeals.reduce((sum, deal) => sum + parseAmount(deal.amount), 0) / wonDeals.length)
      : null;

  const cycleDays = wonDeals
    .filter((deal) => deal.hubspot_created_at && deal.closed_at)
    .map((deal) =>
      Math.max(0, Math.round((new Date(deal.closed_at as string).getTime() - new Date(deal.hubspot_created_at as string).getTime()) / 86_400_000)),
    );
  const avgSalesCycleDays = cycleDays.length > 0 ? Math.round(cycleDays.reduce((sum, days) => sum + days, 0) / cycleDays.length) : null;

  const [closeLostRows, topObjections, kpiRows, forecastVerdicts] = await Promise.all([
    loadCloseLostAnalyses(
      orgId,
      lostDeals.map((deal) => deal.hubspot_deal_id),
    ),
    loadObjections(orgId, target.userId, dateFrom, dateTo),
    preloaded?.kpiRows ? Promise.resolve(preloaded.kpiRows) : loadKpiRows(orgId, dateFrom, dateTo),
    loadForecastVerdicts(orgId, target.hubspotOwnerId),
  ]);

  const lostDealsById = new Map(lostDeals.map((deal) => [deal.hubspot_deal_id, deal]));
  const closeLostByDealId = new Map(closeLostRows.map((row) => [row.hubspot_deal_id, row]));
  const lossReasons = countBy(closeLostRows, (row) => row.analysis?.lossReasonCategory ?? null).map(({ key, count }) => ({
    category: key,
    count,
    sourceDeals: closeLostRows
      .filter((row) => row.analysis?.lossReasonCategory === key)
      .map((row) => lostDealsById.get(row.hubspot_deal_id))
      .filter((deal): deal is CoachingDealRow => Boolean(deal))
      .map((deal) => toSourceDeal(deal, closeLostByDealId.get(deal.hubspot_deal_id)?.analysis?.evidenceSources ?? []))
      .slice(0, 8),
  }));
  const topRiskSignals = countBy(
    closeLostRows.flatMap((row) => row.analysis?.riskSignals ?? []),
    (signal) => signal.title ?? null,
  )
    .slice(0, 5)
    .map(({ key, count }) => ({
      title: key,
      count,
      sourceDeals: closeLostRows
        .filter((row) => (row.analysis?.riskSignals ?? []).some((signal) => signal.title === key))
        .map((row) => lostDealsById.get(row.hubspot_deal_id))
        .filter((deal): deal is CoachingDealRow => Boolean(deal))
        .map((deal) => toSourceDeal(deal, closeLostByDealId.get(deal.hubspot_deal_id)?.analysis?.evidenceSources ?? []))
        .slice(0, 8),
    }));

  const sumKpis = (rows: KpiRow[]) =>
    rows.reduce(
      (sum, row) => ({
        callsMade: sum.callsMade + row.calls_made,
        emailsSent: sum.emailsSent + row.emails_sent,
        meetingsBooked: sum.meetingsBooked + row.meetings_booked,
        dealsMoved: sum.dealsMoved + row.deals_moved,
      }),
      { callsMade: 0, emailsSent: 0, meetingsBooked: 0, dealsMoved: 0 },
    );

  const activity = sumKpis(kpiRows.filter((row) => row.user_id === target.userId));

  // Benchmark anonyme: mediane des totaux par utilisateur sur la periode.
  const kpisByUser = new Map<string, KpiRow[]>();

  for (const row of kpiRows) {
    kpisByUser.set(row.user_id, [...(kpisByUser.get(row.user_id) ?? []), row]);
  }

  const userTotals = Array.from(kpisByUser.values()).map(sumKpis);

  // Mediane du win rate par owner (sur les deals fermes de la periode).
  const ownerIds = Array.from(
    new Set(orgDeals.map((deal) => deal.hubspot_owner_id).filter((value): value is string => Boolean(value))),
  );
  const ownerWinRates = ownerIds
    .map((ownerId) => {
      const ownerClosed = orgDeals.filter(
        (deal) => deal.hubspot_owner_id === ownerId && isClosedInRange(deal, dateFrom, dateTo),
      );

      return computeWinRate(ownerClosed.filter(isWonDeal).length, ownerClosed.filter(isLostDeal).length);
    })
    .filter((value): value is number => value !== null);

  return {
    dateFrom,
    dateTo,
    closedWonCount: wonDeals.length,
    closedLostCount: lostDeals.length,
    closedCount: closedInRange.length,
    winRate: computeWinRate(wonDeals.length, lostDeals.length),
    avgWonAmount,
    avgSalesCycleDays,
    openDealCount: openDeals.length,
    openPipelineAmount: Math.round(openDeals.reduce((sum, deal) => sum + parseAmount(deal.amount), 0)),
    funnel: buildFunnel(repDeals),
    lossReasons,
    topRiskSignals,
    topObjections,
    activity,
    teamMedian: {
      winRate: median(ownerWinRates),
      callsMade: median(userTotals.map((totals) => totals.callsMade)) ?? 0,
      emailsSent: median(userTotals.map((totals) => totals.emailsSent)) ?? 0,
      meetingsBooked: median(userTotals.map((totals) => totals.meetingsBooked)) ?? 0,
    },
    forecastVerdicts,
  };
};

// Resumes compacts pour le prompt (valeurs deja arrondies -> hash stable).
const buildStatsSummary = (stats: RepCoachingStats): string =>
  [
    `deals fermes=${stats.closedCount} (gagnes=${stats.closedWonCount}, perdus=${stats.closedLostCount})`,
    `win rate=${stats.winRate ?? "n/a"}%`,
    `panier moyen gagne=${stats.avgWonAmount ?? "n/a"}`,
    `cycle de vente moyen=${stats.avgSalesCycleDays ?? "n/a"} jours`,
    `deals ouverts=${stats.openDealCount} (pipe=${stats.openPipelineAmount})`,
    `activite: appels=${stats.activity.callsMade}, emails=${stats.activity.emailsSent}, meetings=${stats.activity.meetingsBooked}, deals bouges=${stats.activity.dealsMoved}`,
    `funnel: ${stats.funnel
      .map((stage) => `${stage.stage} (ouverts=${stage.openCount}, gagnes=${stage.wonCount}, perdus=${stage.lostCount})`)
      .join("; ")}`,
    stats.topObjections.length > 0
      ? `objections frequentes: ${stats.topObjections.map((entry) => `${entry.objection} (${entry.count})`).join("; ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

const buildLossPatternsSummary = (stats: RepCoachingStats): string =>
  [
    stats.lossReasons.length > 0
      ? `raisons de perte: ${stats.lossReasons.map((entry) => `${entry.category} (${entry.count})`).join("; ")}`
      : "",
    stats.topRiskSignals.length > 0
      ? `signaux de risque recurrents: ${stats.topRiskSignals.map((entry) => `${entry.title} (${entry.count})`).join("; ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

const buildForecastVerdictsSummary = (stats: RepCoachingStats): string =>
  stats.forecastVerdicts.length > 0
    ? stats.forecastVerdicts.map((entry) => `${entry.category}=${entry.count}`).join(" | ")
    : "";

const buildTeamBenchmarkSummary = (stats: RepCoachingStats): string =>
  [
    `win rate median equipe=${stats.teamMedian.winRate ?? "n/a"}%`,
    `appels medians=${stats.teamMedian.callsMade}`,
    `emails medians=${stats.teamMedian.emailsSent}`,
    `meetings medians=${stats.teamMedian.meetingsBooked}`,
  ].join(" | ");

const buildCoachingInputHash = (summaries: {
  statsSummary: string;
  lossPatternsSummary: string;
  forecastVerdictsSummary: string;
  teamBenchmarkSummary: string;
}): string =>
  createHash("sha256")
    .update(
      [
        summaries.statsSummary,
        summaries.lossPatternsSummary,
        summaries.forecastVerdictsSummary,
        summaries.teamBenchmarkSummary,
      ].join("\n--\n"),
    )
    .digest("hex");

const loadCachedCoachingAnalysis = async (params: {
  orgId: string;
  targetUserId: string;
  provider: string;
  model: string;
  inputHash: string;
}): Promise<RepCoachingAnalysisRow | null> => {
  const { data, error } = await getSupabaseAdmin()
    .from("rep_coaching_analyses")
    .select("id, target_user_id, analysis, provider, model, input_hash, generated_at, expires_at")
    .eq("org_id", params.orgId)
    .eq("target_user_id", params.targetUserId)
    .eq("provider", params.provider)
    .eq("model", params.model)
    .eq("input_hash", params.inputHash)
    .gt("expires_at", new Date().toISOString())
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le coaching en cache: ${error.message}`);
  }

  return (data as RepCoachingAnalysisRow | null) ?? null;
};

const persistCoachingAnalysis = async (params: {
  orgId: string;
  targetUserId: string;
  dateFrom: string;
  dateTo: string;
  stats: RepCoachingStats;
  analysis: RepCoachingAnalysis;
  provider: string;
  model: string;
  inputHash: string;
  generatedAt: string;
}): Promise<void> => {
  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + COACHING_CACHE_TTL_DAYS);

  const { error } = await getSupabaseAdmin()
    .from("rep_coaching_analyses")
    .upsert(
      {
        org_id: params.orgId,
        target_user_id: params.targetUserId,
        date_from: params.dateFrom,
        date_to: params.dateTo,
        stats: params.stats,
        analysis: params.analysis,
        provider: params.provider,
        model: params.model,
        input_hash: params.inputHash,
        generated_at: params.generatedAt,
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: "org_id,target_user_id,provider,model,input_hash" },
    );

  if (error) {
    throw new Error(`Impossible de sauvegarder le coaching: ${error.message}`);
  }
};

export const getRepCoaching = async (
  orgId: string,
  targetUserId: string,
  options: { refresh?: boolean } = {},
): Promise<RepCoaching> => {
  const target = await loadCoachingTarget(orgId, targetUserId);
  const { dateFrom, dateTo } = getRepCoachingDateRange();
  const stats = await computeRepStats(orgId, target, dateFrom, dateTo);

  const base = {
    userId: target.userId,
    repName: target.name,
    stats,
  };

  // Volume insuffisant: stats seules, pas de synthese LLM.
  if (stats.closedCount < MIN_CLOSED_DEALS_FOR_LLM) {
    return {
      ...base,
      status: "insufficient_data",
      analysis: null,
      generatedAt: null,
      provider: null,
      model: null,
      cached: false,
    };
  }

  const summaries = {
    statsSummary: buildStatsSummary(stats),
    lossPatternsSummary: buildLossPatternsSummary(stats),
    forecastVerdictsSummary: buildForecastVerdictsSummary(stats),
    teamBenchmarkSummary: buildTeamBenchmarkSummary(stats),
  };
  const inputHash = buildCoachingInputHash(summaries);
  const preference = await resolveLlmProviderPreference(orgId);
  const provider = createLlmProvider({ provider: preference.provider, model: preference.model });

  if (!options.refresh) {
    const cached = await loadCachedCoachingAnalysis({
      orgId,
      targetUserId: target.userId,
      provider: provider.providerName,
      model: provider.modelName,
      inputHash,
    });

    if (cached) {
      return {
        ...base,
        status: "ready",
        analysis: cached.analysis,
        generatedAt: cached.generated_at,
        provider: cached.provider,
        model: cached.model,
        cached: true,
      };
    }
  }

  const analysis = await provider.analyzeRepCoaching({
    repName: target.name,
    ...summaries,
    dateFrom,
    dateTo,
  });

  const generatedAt = new Date().toISOString();

  await persistCoachingAnalysis({
    orgId,
    targetUserId: target.userId,
    dateFrom,
    dateTo,
    stats,
    analysis,
    provider: provider.providerName,
    model: provider.modelName,
    inputHash,
    generatedAt,
  });

  return {
    ...base,
    status: "ready",
    analysis,
    generatedAt,
    provider: provider.providerName,
    model: provider.modelName,
    cached: false,
  };
};

// Vignettes equipe: derniere synthese en cache par sales, JAMAIS de LLM ici
// (statut "pending" si aucune synthese n'existe encore).
export const listTeamCoaching = async (orgId: string): Promise<TeamCoachingCard[]> => {
  const salesUsers = await loadOrgSalesUsers(orgId);

  if (salesUsers.length === 0) {
    return [];
  }

  const { dateFrom, dateTo } = getRepCoachingDateRange();
  const [orgDeals, analysesResult] = await Promise.all([
    loadOrgDeals(orgId),
    getSupabaseAdmin()
      .from("rep_coaching_analyses")
      .select("id, target_user_id, analysis, provider, model, input_hash, generated_at, expires_at")
      .eq("org_id", orgId)
      .in(
        "target_user_id",
        salesUsers.map((user) => user.id),
      )
      .order("generated_at", { ascending: false }),
  ]);

  if (analysesResult.error) {
    throw new Error(`Impossible de charger les syntheses coaching: ${analysesResult.error.message}`);
  }

  const latestByUserId = new Map<string, RepCoachingAnalysisRow>();

  for (const row of (analysesResult.data ?? []) as RepCoachingAnalysisRow[]) {
    if (!latestByUserId.has(row.target_user_id)) {
      latestByUserId.set(row.target_user_id, row);
    }
  }

  return salesUsers.map((user) => {
    const repDeals = user.hubspot_owner_id
      ? orgDeals.filter((deal) => deal.hubspot_owner_id === user.hubspot_owner_id)
      : [];
    const closedInRange = repDeals.filter((deal) => isClosedInRange(deal, dateFrom, dateTo));
    const wonCount = closedInRange.filter(isWonDeal).length;
    const lostCount = closedInRange.filter(isLostDeal).length;
    const cached = latestByUserId.get(user.id) ?? null;

    return {
      userId: user.id,
      repName: user.name?.trim() || "Commercial",
      status: cached ? "ready" : "pending",
      headline: cached?.analysis.headline ?? null,
      trend: cached?.analysis.trend ?? null,
      confidence: cached?.analysis.confidence ?? null,
      winRate: computeWinRate(wonCount, lostCount),
      closedWonCount: wonCount,
      closedLostCount: lostCount,
      openDealCount: repDeals.filter((deal) => !isWonDeal(deal) && !isLostDeal(deal)).length,
      generatedAt: cached?.generated_at ?? null,
    };
  });
};

// Analyse d'equipe: boucle sur les sales par paquets (max 5 concurrents); les
// appels LLM individuels restent proteges par le rate-limiter des providers.
export const runTeamCoaching = async (
  orgId: string,
  onProgress?: (event: { progress: number; step: string; message?: string; level?: "info" | "success" | "warning" | "error" }) => Promise<void>,
): Promise<TeamCoachingRunResult> => {
  const salesUsers = await loadOrgSalesUsers(orgId);
  const result: TeamCoachingRunResult = { processed: 0, reused: 0, skipped: 0, failed: 0 };

  if (salesUsers.length === 0) {
    return result;
  }

  let completedCount = 0;

  for (let index = 0; index < salesUsers.length; index += TEAM_RUN_CONCURRENCY) {
    const chunk = salesUsers.slice(index, index + TEAM_RUN_CONCURRENCY);

    await Promise.all(
      chunk.map(async (user) => {
        try {
          const coaching = await getRepCoaching(orgId, user.id);

          if (coaching.status === "insufficient_data") {
            result.skipped += 1;
          } else if (coaching.cached) {
            result.reused += 1;
          } else {
            result.processed += 1;
          }
        } catch {
          result.failed += 1;
        }

        completedCount += 1;
        await onProgress?.({
          progress: Math.round((completedCount / salesUsers.length) * 100),
          step: `Coaching equipe: ${completedCount}/${salesUsers.length} commerciaux`,
          message: `${user.name?.trim() || user.id} traite.`,
        });
      }),
    );
  }

  return result;
};
