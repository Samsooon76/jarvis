import { getSupabaseAdmin } from "../db/client.js";
import { getHubSpotAccessToken } from "./hubspot-auth.service.js";
import { hubSpotService } from "./hubspot.service.js";

// Propriete custom HubSpot qui porte la probabilite de closing saisie manuellement.
export const CLOSING_PROBABILITY_PROPERTY = "probabilite_de__closing";

const DAY_MS = 24 * 60 * 60 * 1000;
const BACKFILL_CONCURRENCY = 5;

export type DealAgeProbabilityPoint = {
  ageDays: number;
  averageProbability: number;
  dealCount: number;
};

export type DealAgeProbabilityTimeline = {
  won: DealAgeProbabilityPoint[];
  lost: DealAgeProbabilityPoint[];
  wonDealCount: number;
  lostDealCount: number;
  wonAvgDurationDays: number | null;
  lostAvgDurationDays: number | null;
  maxAgeDays: number;
  capped: boolean;
};

export type DealProbabilityPoint = {
  date: string;
  probability: number;
  daysSinceCreation: number | null;
};

export type DealProbabilityTimeline = {
  hubspotDealId: string;
  dealName: string | null;
  createdAt: string | null;
  closedAt: string | null;
  ageDays: number | null;
  currentProbability: number | null;
  points: DealProbabilityPoint[];
};

type DealAgeTimelineOptions = {
  scope: "all" | "owner";
  hubspotOwnerId: string | null;
  // Filtre optionnel sur la date de cloture du deal.
  closedFrom: string | null;
  closedTo: string | null;
};

const MAX_AGE_DAYS = 365;

type DealRow = {
  hubspot_deal_id: string;
  hubspot_owner_id: string | null;
  deal_name: string | null;
  close_probability: number | null;
  deal_lifecycle_status: string | null;
  hubspot_created_at: string | null;
  closed_at: string | null;
};

type HistoryRow = {
  hubspot_deal_id: string;
  probability: number;
  recorded_at: string;
};

const clampProbability = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const parseProbabilityValue = (value: string | null): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number(value.trim().replace("%", ""));

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return clampProbability(parsed);
};

const toTime = (value: string | null): number | null => {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();

  return Number.isNaN(time) ? null : time;
};

// Enregistre un point d'historique (idempotent grace a la contrainte unique).
export const recordDealProbabilityPoint = async (input: {
  orgId: string;
  hubspotDealId: string;
  hubspotOwnerId: string | null;
  probability: number;
  recordedAt: string;
  source: "hubspot" | "webhook";
}): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("deal_probability_history").upsert(
    {
      org_id: input.orgId,
      hubspot_deal_id: input.hubspotDealId,
      hubspot_owner_id: input.hubspotOwnerId,
      probability: clampProbability(input.probability),
      recorded_at: input.recordedAt,
      source: input.source,
    },
    {
      onConflict: "org_id,hubspot_deal_id,recorded_at",
      ignoreDuplicates: true,
    },
  );

  if (error) {
    throw new Error(`Impossible d'enregistrer le point de probabilite: ${error.message}`);
  }
};

const loadDealsForOrg = async (
  orgId: string,
  options: { hubspotOwnerId: string | null; includeClosed: boolean },
): Promise<DealRow[]> => {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("hubspot_deals")
    .select(
      "hubspot_deal_id, hubspot_owner_id, deal_name, close_probability, deal_lifecycle_status, hubspot_created_at, closed_at",
    )
    .eq("org_id", orgId);

  if (options.hubspotOwnerId) {
    query = query.eq("hubspot_owner_id", options.hubspotOwnerId);
  }

  if (!options.includeClosed) {
    query = query.eq("deal_lifecycle_status", "pending");
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Impossible de charger les deals pour l'historique de probabilite: ${error.message}`);
  }

  return (data ?? []) as DealRow[];
};

// Backfill: lit l'historique complet de la propriete custom depuis HubSpot pour
// chaque deal de l'organisation et le persiste dans deal_probability_history.
export const backfillOrgProbabilityHistory = async (
  orgId: string,
): Promise<{ dealsProcessed: number; pointsInserted: number }> => {
  const accessToken = await getHubSpotAccessToken(orgId);
  const deals = await loadDealsForOrg(orgId, { hubspotOwnerId: null, includeClosed: true });
  let pointsInserted = 0;

  for (let index = 0; index < deals.length; index += BACKFILL_CONCURRENCY) {
    const batch = deals.slice(index, index + BACKFILL_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (deal) => {
        const history = await hubSpotService.fetchDealPropertyHistory(
          accessToken,
          deal.hubspot_deal_id,
          CLOSING_PROBABILITY_PROPERTY,
        );

        const rows = history
          .map((entry) => {
            const probability = parseProbabilityValue(entry.value);

            return probability === null
              ? null
              : {
                  org_id: orgId,
                  hubspot_deal_id: deal.hubspot_deal_id,
                  hubspot_owner_id: deal.hubspot_owner_id,
                  probability,
                  recorded_at: new Date(entry.timestamp).toISOString(),
                  source: "hubspot" as const,
                };
          })
          .filter((row): row is NonNullable<typeof row> => row !== null);

        if (rows.length === 0) {
          return 0;
        }

        const supabase = getSupabaseAdmin();
        const { error } = await supabase
          .from("deal_probability_history")
          .upsert(rows, { onConflict: "org_id,hubspot_deal_id,recorded_at", ignoreDuplicates: true });

        if (error) {
          throw new Error(`Impossible de persister l'historique de probabilite: ${error.message}`);
        }

        return rows.length;
      }),
    );

    pointsInserted += batchResults.reduce((sum, count) => sum + count, 0);
  }

  return { dealsProcessed: deals.length, pointsInserted };
};

const loadHistoryForDeals = async (orgId: string, dealIds: string[]): Promise<Map<string, Array<{ t: number; p: number }>>> => {
  const historyByDeal = new Map<string, Array<{ t: number; p: number }>>();

  if (dealIds.length === 0) {
    return historyByDeal;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("deal_probability_history")
    .select("hubspot_deal_id, probability, recorded_at")
    .eq("org_id", orgId)
    .in("hubspot_deal_id", dealIds)
    .order("recorded_at", { ascending: true });

  if (error) {
    throw new Error(`Impossible de charger l'historique de probabilite: ${error.message}`);
  }

  for (const row of (data ?? []) as HistoryRow[]) {
    const time = toTime(row.recorded_at);

    if (time === null) {
      continue;
    }

    const series = historyByDeal.get(row.hubspot_deal_id) ?? [];
    series.push({ t: time, p: row.probability });
    historyByDeal.set(row.hubspot_deal_id, series);
  }

  return historyByDeal;
};

// Derniere valeur connue jusqu'a un seuil (fonction en escalier), sur une serie triee.
const lastValueUpTo = (series: Array<{ key: number; p: number }>, threshold: number): number | null => {
  let value: number | null = null;

  for (const point of series) {
    if (point.key <= threshold) {
      value = point.p;
    } else {
      break;
    }
  }

  return value;
};

type ClosedDealRow = Pick<
  DealRow,
  "hubspot_deal_id" | "hubspot_owner_id" | "deal_lifecycle_status" | "hubspot_created_at" | "closed_at"
>;

type DealAgeSeries = {
  outcome: "won" | "lost";
  totalAgeDays: number;
  series: Array<{ key: number; p: number }>;
};

const getTerminalProbability = (outcome: "won" | "lost"): number => (outcome === "won" ? 100 : 0);

const median = (values: number[]): number | null => {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
};

// Courbe temporelle par age du deal (J+0, J+1...), segmentee gagnes vs perdus.
// Chaque deal contribue des J+0; apres cloture, son verdict reel prend le relais.
export const getDealAgeProbabilityTimeline = async (
  orgId: string,
  options: DealAgeTimelineOptions,
): Promise<DealAgeProbabilityTimeline> => {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("hubspot_deals")
    .select("hubspot_deal_id, hubspot_owner_id, deal_lifecycle_status, hubspot_created_at, closed_at")
    .eq("org_id", orgId)
    .in("deal_lifecycle_status", ["won", "lost"]);

  if (options.scope === "owner" && options.hubspotOwnerId) {
    query = query.eq("hubspot_owner_id", options.hubspotOwnerId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Impossible de charger les deals clotures: ${error.message}`);
  }

  const closedFrom = toTime(options.closedFrom);
  const closedTo = toTime(options.closedTo);
  const deals = ((data ?? []) as ClosedDealRow[]).filter((deal) => {
    const closed = toTime(deal.closed_at);

    if (closed === null) {
      return false;
    }

    if (closedFrom !== null && (closed === null || closed < closedFrom)) {
      return false;
    }

    // Borne haute inclusive sur la journee.
    if (closedTo !== null && (closed === null || closed > closedTo + DAY_MS)) {
      return false;
    }

    return true;
  });

  const empty: DealAgeProbabilityTimeline = {
    won: [],
    lost: [],
    wonDealCount: 0,
    lostDealCount: 0,
    wonAvgDurationDays: null,
    lostAvgDurationDays: null,
    maxAgeDays: 0,
    capped: false,
  };

  if (deals.length === 0) {
    return empty;
  }

  const historyByDeal = await loadHistoryForDeals(
    orgId,
    deals.map((deal) => deal.hubspot_deal_id),
  );

  const dealAges: DealAgeSeries[] = [];

  for (const deal of deals) {
    const created = toTime(deal.hubspot_created_at);
    const closed = toTime(deal.closed_at);

    if (created === null || closed === null) {
      continue;
    }

    const rawSeries = historyByDeal.get(deal.hubspot_deal_id) ?? [];
    const outcome = deal.deal_lifecycle_status === "won" ? "won" : "lost";
    const totalAgeDays = Math.max(0, Math.floor((closed - created) / DAY_MS));

    const historySeries = rawSeries
      .filter((point) => point.t <= closed)
      .map((point) => ({
        key: Math.max(0, Math.floor((point.t - created) / DAY_MS)),
        p: point.p,
      }));

    if (historySeries.length === 0) {
      continue;
    }

    const firstKnownProbability = historySeries[0]?.p ?? getTerminalProbability(outcome);
    const series = [{ key: 0, p: firstKnownProbability }, ...historySeries, { key: totalAgeDays, p: getTerminalProbability(outcome) }];

    series.sort((left, right) => left.key - right.key);

    dealAges.push({
      outcome,
      totalAgeDays,
      series,
    });
  }

  if (dealAges.length === 0) {
    return empty;
  }

  const averageDuration = (outcome: "won" | "lost"): number | null => {
    const durations = dealAges.filter((deal) => deal.outcome === outcome).map((deal) => deal.totalAgeDays);

    return durations.length > 0 ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null;
  };
  const wonAvgDurationDays = averageDuration("won");
  const lostAvgDurationDays = averageDuration("lost");
  const averageDurations = [wonAvgDurationDays, lostAvgDurationDays].filter((value): value is number => value !== null);
  const maxDurationDays = Math.max(...dealAges.map((deal) => deal.totalAgeDays));
  const axisMaxDays = Math.max(1, Math.min(Math.max(...averageDurations, 1), MAX_AGE_DAYS));
  const capped = maxDurationDays > axisMaxDays;

  const buildPoints = (outcome: "won" | "lost"): DealAgeProbabilityPoint[] => {
    const subset = dealAges.filter((deal) => deal.outcome === outcome);
    const points: DealAgeProbabilityPoint[] = [];

    for (let ageDays = 0; ageDays <= axisMaxDays; ageDays += 1) {
      const values: number[] = [];

      for (const deal of subset) {
        const value = lastValueUpTo(deal.series, ageDays);

        if (value === null) {
          continue;
        }

        values.push(value);
      }

      const probability = median(values);

      if (probability !== null) {
        points.push({
          ageDays,
          averageProbability: probability,
          dealCount: values.length,
        });
      }
    }

    return points;
  };

  return {
    won: buildPoints("won"),
    lost: buildPoints("lost"),
    wonDealCount: dealAges.filter((deal) => deal.outcome === "won").length,
    lostDealCount: dealAges.filter((deal) => deal.outcome === "lost").length,
    wonAvgDurationDays,
    lostAvgDurationDays,
    maxAgeDays: axisMaxDays,
    capped,
  };
};

// Courbe d'un deal precis: trajectoire de sa probabilite sur sa vie.
export const getDealProbabilityTimeline = async (
  orgId: string,
  hubspotDealId: string,
): Promise<DealProbabilityTimeline> => {
  const supabase = getSupabaseAdmin();
  const { data: dealData, error: dealError } = await supabase
    .from("hubspot_deals")
    .select("hubspot_deal_id, deal_name, close_probability, hubspot_created_at, closed_at")
    .eq("org_id", orgId)
    .eq("hubspot_deal_id", hubspotDealId)
    .maybeSingle();

  if (dealError) {
    throw new Error(`Impossible de charger le deal pour l'historique de probabilite: ${dealError.message}`);
  }

  const deal = dealData as Pick<
    DealRow,
    "hubspot_deal_id" | "deal_name" | "close_probability" | "hubspot_created_at" | "closed_at"
  > | null;

  const { data: historyData, error: historyError } = await supabase
    .from("deal_probability_history")
    .select("hubspot_deal_id, probability, recorded_at")
    .eq("org_id", orgId)
    .eq("hubspot_deal_id", hubspotDealId)
    .order("recorded_at", { ascending: true });

  if (historyError) {
    throw new Error(`Impossible de charger l'historique de probabilite du deal: ${historyError.message}`);
  }

  const createdTime = toTime(deal?.hubspot_created_at ?? null);
  const points: DealProbabilityPoint[] = ((historyData ?? []) as HistoryRow[]).map((row) => {
    const recordedTime = toTime(row.recorded_at);

    return {
      date: row.recorded_at,
      probability: row.probability,
      daysSinceCreation:
        createdTime !== null && recordedTime !== null ? Math.max(0, Math.floor((recordedTime - createdTime) / DAY_MS)) : null,
    };
  });

  const ageReference = deal?.closed_at ? toTime(deal.closed_at) : Date.now();
  const ageDays =
    createdTime !== null && ageReference !== null ? Math.max(0, Math.floor((ageReference - createdTime) / DAY_MS)) : null;

  return {
    hubspotDealId,
    dealName: deal?.deal_name ?? null,
    createdAt: deal?.hubspot_created_at ?? null,
    closedAt: deal?.closed_at ?? null,
    ageDays,
    currentProbability: deal?.close_probability ?? null,
    points,
  };
};
