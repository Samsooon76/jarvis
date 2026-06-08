import { getSupabaseAdmin } from "../db/client.js";
import { getHubSpotAccessToken } from "./hubspot-auth.service.js";
import { hubSpotService } from "./hubspot.service.js";

// Propriete custom HubSpot qui porte la probabilite de closing saisie manuellement.
export const CLOSING_PROBABILITY_PROPERTY = "probabilite_de__closing";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const BACKFILL_CONCURRENCY = 5;

export type ProbabilityTimelinePoint = {
  date: string;
  averageProbability: number;
  dealCount: number;
};

export type AggregatedProbabilityTimeline = {
  points: ProbabilityTimelinePoint[];
  dealCount: number;
  pointCount: number;
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

type AggregatedTimelineOptions = {
  scope: "all" | "owner";
  hubspotOwnerId: string | null;
  includeClosed: boolean;
  dateFrom: string | null;
  dateTo: string | null;
};

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

// Derniere valeur connue a l'instant t (fonction en escalier).
const valueAsOf = (series: Array<{ t: number; p: number }> | undefined, time: number): number | null => {
  if (!series || series.length === 0) {
    return null;
  }

  let value: number | null = null;

  for (const point of series) {
    if (point.t <= time) {
      value = point.p;
    } else {
      break;
    }
  }

  return value;
};

// Courbe agregee: probabilite moyenne (escalier porte) des deals du scope, au fil du temps.
export const getAggregatedProbabilityTimeline = async (
  orgId: string,
  options: AggregatedTimelineOptions,
): Promise<AggregatedProbabilityTimeline> => {
  const deals = await loadDealsForOrg(orgId, {
    hubspotOwnerId: options.scope === "owner" ? options.hubspotOwnerId : null,
    includeClosed: options.includeClosed,
  });

  if (deals.length === 0) {
    return { points: [], dealCount: 0, pointCount: 0 };
  }

  const dealIds = deals.map((deal) => deal.hubspot_deal_id);
  const historyByDeal = await loadHistoryForDeals(orgId, dealIds);

  const now = Date.now();
  const requestedStart = toTime(options.dateFrom);
  const requestedEnd = toTime(options.dateTo);

  // Borne basse par defaut: plus ancien point d'historique connu.
  let earliest = Number.POSITIVE_INFINITY;
  for (const series of historyByDeal.values()) {
    if (series.length > 0 && series[0].t < earliest) {
      earliest = series[0].t;
    }
  }

  if (!Number.isFinite(earliest)) {
    return { points: [], dealCount: deals.length, pointCount: 0 };
  }

  const start = requestedStart ?? earliest;
  const end = Math.min(requestedEnd ?? now, now);

  if (start > end) {
    return { points: [], dealCount: deals.length, pointCount: 0 };
  }

  const dealMeta = deals.map((deal) => ({
    id: deal.hubspot_deal_id,
    createdAt: toTime(deal.hubspot_created_at),
    closedAt: deal.deal_lifecycle_status === "pending" ? null : toTime(deal.closed_at),
  }));

  const points: ProbabilityTimelinePoint[] = [];
  // Echantillonnage hebdomadaire + point final exact sur la borne haute.
  for (let cursor = start; cursor <= end; cursor += WEEK_MS) {
    const bucketTime = cursor + WEEK_MS > end ? end : cursor;
    let sum = 0;
    let count = 0;

    for (const deal of dealMeta) {
      if (deal.createdAt !== null && deal.createdAt > bucketTime) {
        continue;
      }

      if (deal.closedAt !== null && deal.closedAt < bucketTime) {
        continue;
      }

      const value = valueAsOf(historyByDeal.get(deal.id), bucketTime);

      if (value === null) {
        continue;
      }

      sum += value;
      count += 1;
    }

    if (count > 0) {
      points.push({
        date: new Date(bucketTime).toISOString(),
        averageProbability: Math.round(sum / count),
        dealCount: count,
      });
    }

    if (bucketTime === end) {
      break;
    }
  }

  return { points, dealCount: deals.length, pointCount: points.length };
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
