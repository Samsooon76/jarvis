import { apiPath, getJson, postJson, type ApiRequestOptions } from "./client";
import type { ForecastScope } from "./forecast";

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

export const fetchProbabilityTimeline = async ({
  orgId,
  scope,
  hubspotOwnerId,
  dateFrom,
  dateTo,
}: {
  orgId: string;
  scope: ForecastScope;
  hubspotOwnerId: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}): Promise<DealAgeProbabilityTimeline> =>
  getJson<DealAgeProbabilityTimeline>(
    apiPath("/api/probability/timeline", {
      orgId,
      scope,
      hubspotOwnerId,
      dateFrom: dateFrom ?? undefined,
      dateTo: dateTo ?? undefined,
    }),
  );

export const fetchDealProbabilityTimeline = async (
  orgId: string,
  hubspotDealId: string,
  options?: ApiRequestOptions,
): Promise<DealProbabilityTimeline> =>
  getJson<DealProbabilityTimeline>(
    apiPath(`/api/probability/deals/${encodeURIComponent(hubspotDealId)}`, { orgId }),
    options,
  );

export const backfillProbabilityHistory = async (
  orgId: string,
): Promise<{ dealsProcessed: number; pointsInserted: number }> =>
  postJson<{ dealsProcessed: number; pointsInserted: number }>("/api/probability/backfill", { orgId });

export type SalesActivityType = "call" | "sms" | "meeting";

export type SalesActivityByType = Record<SalesActivityType, number>;

export type SalesActivityOutcomeStats = {
  dealCount: number;
  total: number;
  byType: SalesActivityByType;
  avgPerDeal: number;
};

export type SalesActivityStats = {
  won: SalesActivityOutcomeStats;
  lost: SalesActivityOutcomeStats;
};

export const fetchSalesActivityStats = async ({
  orgId,
  scope,
  hubspotOwnerId,
  dateFrom,
  dateTo,
}: {
  orgId: string;
  scope: ForecastScope;
  hubspotOwnerId: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}): Promise<SalesActivityStats> =>
  getJson<SalesActivityStats>(
    apiPath("/api/activities/stats", {
      orgId,
      scope,
      hubspotOwnerId,
      dateFrom: dateFrom ?? undefined,
      dateTo: dateTo ?? undefined,
    }),
  );

export const backfillSalesActivities = async ({
  orgId,
  dateFrom,
  dateTo,
}: {
  orgId: string;
  dateFrom?: string | null;
  dateTo?: string | null;
}): Promise<{ dealsProcessed: number; activitiesUpserted: number }> =>
  postJson<{ dealsProcessed: number; activitiesUpserted: number }>("/api/activities/backfill", {
    orgId,
    dateFrom: dateFrom ?? undefined,
    dateTo: dateTo ?? undefined,
  });
