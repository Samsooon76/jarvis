import type {
  ForecastAccuracyCategory,
  ForecastAccuracyOverview,
  ForecastAccuracyRep,
  ForecastAccuracySource,
  ForecastCalibrationBucket,
} from "@jarvis/shared";
import { getSupabaseAdmin } from "../db/client.js";

// Forecast vs realite: calculs 100% deterministes sur les snapshots quotidiens.
// Aucun appel LLM dans ce service.

const DEFAULT_PERIOD_DAYS = 90;
const MAX_PERIOD_DAYS = 540;
// En dessous de ce volume, les pourcentages sont signales comme non significatifs.
const MIN_RESOLVED_DEALS = 10;
// Snapshot de reference pour juger une prevision: le plus proche de J-30 avant la cloture.
const REFERENCE_DAYS_BEFORE_CLOSE = 30;

type SnapshotRow = {
  snapshot_date: string;
  hubspot_deal_id: string;
  owner_user_id: string | null;
  amount: number | string | null;
  close_date: string | null;
  crm_probability: number | null;
  ai_probability: number | null;
  ai_category: "commit" | "bestCase" | "atRisk" | "slipping" | null;
  outcome: "won" | "lost" | null;
  final_amount: number | string | null;
  closed_at: string | null;
};

type UserNameRow = {
  id: string;
  name: string | null;
};

type DealHistory = {
  hubspotDealId: string;
  snapshots: SnapshotRow[];
  ownerUserId: string | null;
  outcome: "won" | "lost" | null;
  finalAmount: number;
  closedAt: string | null;
  referenceSnapshot: SnapshotRow;
  hasSlipped: boolean;
};

const parseAmount = (value: number | string | null): number => {
  const parsed = typeof value === "string" ? Number(value) : value;

  return parsed !== null && Number.isFinite(parsed) ? Number(parsed) : 0;
};

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

const resolvePeriod = (periodDays?: number): { dateFrom: string; dateTo: string } => {
  const days = Math.min(Math.max(periodDays ?? DEFAULT_PERIOD_DAYS, 7), MAX_PERIOD_DAYS);
  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - days);

  return { dateFrom: toIsoDate(from), dateTo: toIsoDate(now) };
};

const loadSnapshots = async (orgId: string, dateFrom: string): Promise<SnapshotRow[]> => {
  const { data, error } = await getSupabaseAdmin()
    .from("forecast_snapshots")
    .select(
      "snapshot_date, hubspot_deal_id, owner_user_id, amount, close_date, crm_probability, ai_probability, ai_category, outcome, final_amount, closed_at",
    )
    .eq("org_id", orgId)
    .gte("snapshot_date", dateFrom)
    .order("snapshot_date", { ascending: true })
    .limit(100000);

  if (error) {
    throw new Error(`Impossible de charger les snapshots forecast: ${error.message}`);
  }

  return (data ?? []) as SnapshotRow[];
};

const loadUserNames = async (orgId: string, userIds: string[]): Promise<Map<string, string>> => {
  if (userIds.length === 0) {
    return new Map();
  }

  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("id, name")
    .eq("org_id", orgId)
    .in("id", userIds);

  if (error) {
    throw new Error(`Impossible de charger les noms des commerciaux: ${error.message}`);
  }

  return new Map(((data ?? []) as UserNameRow[]).map((user) => [user.id, user.name?.trim() || "Commercial"]));
};

// Snapshot de reference: pour un deal resolu, le plus proche de (closed_at - 30j);
// pour un deal encore ouvert, le dernier en date.
const pickReferenceSnapshot = (snapshots: SnapshotRow[], closedAt: string | null): SnapshotRow => {
  if (!closedAt) {
    return snapshots[snapshots.length - 1];
  }

  const targetTime = new Date(closedAt).getTime() - REFERENCE_DAYS_BEFORE_CLOSE * 86_400_000;

  return snapshots.reduce((best, snapshot) => {
    const bestDelta = Math.abs(new Date(best.snapshot_date).getTime() - targetTime);
    const delta = Math.abs(new Date(snapshot.snapshot_date).getTime() - targetTime);

    return delta < bestDelta ? snapshot : best;
  });
};

const buildDealHistories = (snapshots: SnapshotRow[]): DealHistory[] => {
  const byDeal = new Map<string, SnapshotRow[]>();

  for (const snapshot of snapshots) {
    byDeal.set(snapshot.hubspot_deal_id, [...(byDeal.get(snapshot.hubspot_deal_id) ?? []), snapshot]);
  }

  return Array.from(byDeal.entries()).map(([hubspotDealId, dealSnapshots]) => {
    const latest = dealSnapshots[dealSnapshots.length - 1];
    const resolved = dealSnapshots.find((snapshot) => snapshot.outcome !== null) ?? null;
    const closeDates = new Set(dealSnapshots.map((snapshot) => snapshot.close_date).filter(Boolean));

    return {
      hubspotDealId,
      snapshots: dealSnapshots,
      ownerUserId: latest.owner_user_id,
      outcome: resolved?.outcome ?? null,
      finalAmount: parseAmount(resolved?.final_amount ?? null),
      closedAt: resolved?.closed_at ?? null,
      referenceSnapshot: pickReferenceSnapshot(dealSnapshots, resolved?.closed_at ?? null),
      // Glissement: au moins 2 close dates distinctes observees sur la periode.
      hasSlipped: closeDates.size >= 2,
    };
  });
};

const percentage = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? Math.round((numerator / denominator) * 100) : null;

const buildRepAccuracy = (
  userId: string | null,
  repName: string,
  deals: DealHistory[],
): ForecastAccuracyRep => {
  const resolvedDeals = deals.filter((deal) => deal.outcome !== null);
  const wonDeals = resolvedDeals.filter((deal) => deal.outcome === "won");
  const commitDeals = resolvedDeals.filter((deal) => deal.referenceSnapshot.ai_category === "commit");
  const committedAmount = Math.round(commitDeals.reduce((sum, deal) => sum + parseAmount(deal.referenceSnapshot.amount), 0));
  const realizedFromCommitAmount = Math.round(
    commitDeals.filter((deal) => deal.outcome === "won").reduce((sum, deal) => sum + deal.finalAmount, 0),
  );
  const realizedAmount = Math.round(wonDeals.reduce((sum, deal) => sum + deal.finalAmount, 0));
  const trackedDeals = deals.filter((deal) => deal.snapshots.length >= 2);
  const slippedDeals = trackedDeals.filter((deal) => deal.hasSlipped);

  return {
    userId,
    repName,
    resolvedCount: resolvedDeals.length,
    wonCount: wonDeals.length,
    committedAmount,
    realizedFromCommitAmount,
    realizedAmount,
    commitAccuracy: percentage(realizedFromCommitAmount, committedAmount),
    // Positif = sur-commit (a promis plus que realise), negatif = sous-commit.
    biasPct: realizedAmount > 0 ? Math.round(((committedAmount - realizedAmount) / realizedAmount) * 100) : null,
    slippageRate: percentage(slippedDeals.length, trackedDeals.length),
    slippedDealCount: slippedDeals.length,
    trackedDealCount: trackedDeals.length,
    lowConfidence: resolvedDeals.length < MIN_RESOLVED_DEALS,
  };
};

const buildCategoryStats = (deals: DealHistory[]): ForecastAccuracyCategory[] => {
  const categories: ForecastAccuracyCategory["category"][] = ["commit", "bestCase", "atRisk", "slipping"];
  const resolvedDeals = deals.filter((deal) => deal.outcome !== null);

  return categories.map((category) => {
    const categoryDeals = resolvedDeals.filter((deal) => deal.referenceSnapshot.ai_category === category);
    const wonCount = categoryDeals.filter((deal) => deal.outcome === "won").length;

    return {
      category,
      resolvedCount: categoryDeals.length,
      wonCount,
      closeRate: percentage(wonCount, categoryDeals.length),
    };
  });
};

// Courbe de calibration: les deals annonces a X% closent-ils a ~X%?
const buildCalibrationCurve = (deals: DealHistory[], source: ForecastAccuracySource): ForecastCalibrationBucket[] => {
  const resolvedDeals = deals.filter((deal) => deal.outcome !== null);
  const buckets = new Map<number, { total: number; won: number }>();

  for (const deal of resolvedDeals) {
    const probability =
      source === "crm" ? deal.referenceSnapshot.crm_probability : deal.referenceSnapshot.ai_probability;

    if (probability === null || !Number.isFinite(probability)) {
      continue;
    }

    const bucket = Math.min(90, Math.floor(Math.max(0, probability) / 10) * 10);
    const entry = buckets.get(bucket) ?? { total: 0, won: 0 };
    entry.total += 1;

    if (deal.outcome === "won") {
      entry.won += 1;
    }

    buckets.set(bucket, entry);
  }

  return Array.from(buckets.entries())
    .map(([bucket, entry]) => ({
      bucket,
      dealCount: entry.total,
      observedWinRate: percentage(entry.won, entry.total),
    }))
    .sort((left, right) => left.bucket - right.bucket);
};

const buildOverview = async (
  orgId: string,
  deals: DealHistory[],
  dateFrom: string,
  dateTo: string,
  snapshotCount: number,
): Promise<ForecastAccuracyOverview> => {
  const ownerIds = Array.from(
    new Set(deals.map((deal) => deal.ownerUserId).filter((value): value is string => Boolean(value))),
  );
  const namesByUserId = await loadUserNames(orgId, ownerIds);

  const dealsByOwner = new Map<string | null, DealHistory[]>();

  for (const deal of deals) {
    dealsByOwner.set(deal.ownerUserId, [...(dealsByOwner.get(deal.ownerUserId) ?? []), deal]);
  }

  const reps = Array.from(dealsByOwner.entries())
    .map(([userId, ownerDeals]) =>
      buildRepAccuracy(userId, userId ? namesByUserId.get(userId) ?? "Commercial" : "Sans owner", ownerDeals),
    )
    .filter((rep) => rep.resolvedCount > 0 || rep.trackedDealCount > 0)
    .sort((left, right) => right.resolvedCount - left.resolvedCount);

  const overall = buildRepAccuracy(null, "Organisation", deals);

  return {
    dateFrom,
    dateTo,
    snapshotCount,
    resolvedDealCount: overall.resolvedCount,
    overallCommitAccuracy: overall.commitAccuracy,
    overallBiasPct: overall.biasPct,
    lowConfidence: overall.lowConfidence,
    reps,
    categories: buildCategoryStats(deals),
    calibration: {
      crm: buildCalibrationCurve(deals, "crm"),
      ai: buildCalibrationCurve(deals, "ai"),
    },
  };
};

export const getAccuracyOverview = async (orgId: string, periodDays?: number): Promise<ForecastAccuracyOverview> => {
  const { dateFrom, dateTo } = resolvePeriod(periodDays);
  const snapshots = await loadSnapshots(orgId, dateFrom);
  const deals = buildDealHistories(snapshots);

  return buildOverview(orgId, deals, dateFrom, dateTo, snapshots.length);
};

export const getRepAccuracy = async (
  orgId: string,
  targetUserId: string,
  periodDays?: number,
): Promise<ForecastAccuracyOverview> => {
  const { dateFrom, dateTo } = resolvePeriod(periodDays);
  const snapshots = await loadSnapshots(orgId, dateFrom);
  const deals = buildDealHistories(snapshots).filter((deal) => deal.ownerUserId === targetUserId);

  return buildOverview(orgId, deals, dateFrom, dateTo, deals.reduce((sum, deal) => sum + deal.snapshots.length, 0));
};

export const getCalibrationCurve = async (
  orgId: string,
  source: ForecastAccuracySource,
  periodDays?: number,
): Promise<ForecastCalibrationBucket[]> => {
  const { dateFrom } = resolvePeriod(periodDays);
  const snapshots = await loadSnapshots(orgId, dateFrom);

  return buildCalibrationCurve(buildDealHistories(snapshots), source);
};
