import type {
  CloseWonDealAnalysis,
  ForecastAccuracyOverview,
  ManagerDigest,
  ManagerDigestHistoryEntry,
  ManagerDigestPeriod,
  RepCoaching,
  TeamCoachingCard,
  TeamCoachingJobSnapshot,
  WinAnalysisDealListItem,
  WinAnalysisOverview,
  WinAnalysisRun,
  WinBenchmark,
  WinBenchmarkComparison,
} from "@jarvis/shared";
import { apiPath, getJson, postJson, type ApiRequestOptions } from "./client";
import { ANALYTICS_OVERVIEW_CACHE_TTL_MS, clearAnalyticsCacheByPrefix, getCachedJson } from "./cache";

// --- Digest manager ---------------------------------------------------------

export const fetchManagerDigest = async (
  period: ManagerDigestPeriod,
  { forceRefresh = false, ...options }: ApiRequestOptions & { forceRefresh?: boolean } = {},
): Promise<ManagerDigest> =>
  getCachedJson<ManagerDigest>(
    `manager-digest:${period}`,
    apiPath("/api/digest", { period }),
    ANALYTICS_OVERVIEW_CACHE_TTL_MS,
    forceRefresh,
    options,
  );

export const fetchManagerDigestHistory = async (
  limit?: number,
  options: ApiRequestOptions = {},
): Promise<ManagerDigestHistoryEntry[]> =>
  getJson<ManagerDigestHistoryEntry[]>(apiPath("/api/digest/history", { limit }), options);

// --- Forecast vs realite ------------------------------------------------------

export const fetchForecastAccuracy = async (
  { periodDays, forceRefresh = false, ...options }: ApiRequestOptions & { periodDays?: number; forceRefresh?: boolean } = {},
): Promise<ForecastAccuracyOverview> =>
  getCachedJson<ForecastAccuracyOverview>(
    `forecast-accuracy:${periodDays ?? "default"}`,
    apiPath("/api/forecast-accuracy/overview", { periodDays }),
    ANALYTICS_OVERVIEW_CACHE_TTL_MS,
    forceRefresh,
    options,
  );

export const fetchRepAccuracy = async (
  userId: string,
  { periodDays, ...options }: ApiRequestOptions & { periodDays?: number } = {},
): Promise<ForecastAccuracyOverview> =>
  getJson<ForecastAccuracyOverview>(
    apiPath(`/api/forecast-accuracy/rep/${encodeURIComponent(userId)}`, { periodDays }),
    options,
  );

// --- Win Analysis -------------------------------------------------------------

export const fetchWinAnalysisOverview = async (
  orgId: string,
  { forceRefresh = false, ...options }: ApiRequestOptions & { forceRefresh?: boolean } = {},
): Promise<WinAnalysisOverview> =>
  getCachedJson<WinAnalysisOverview>(
    `win-analysis:${orgId}`,
    apiPath("/api/win-analysis/overview", { orgId }),
    ANALYTICS_OVERVIEW_CACHE_TTL_MS,
    forceRefresh,
    options,
  );

export const startWinAnalysisRun = async (orgId: string): Promise<WinAnalysisRun> => {
  clearAnalyticsCacheByPrefix("win-analysis:");

  return postJson<WinAnalysisRun>("/api/win-analysis/run", { orgId });
};

export const fetchWinAnalysisRun = async (runId: string): Promise<WinAnalysisRun> =>
  getJson<WinAnalysisRun>(`/api/win-analysis/run/${encodeURIComponent(runId)}`);

export const fetchWinAnalysisDealDetail = async (
  orgId: string,
  dealId: string,
  options: ApiRequestOptions = {},
): Promise<{ deal: WinAnalysisDealListItem; analysis: CloseWonDealAnalysis | null; generatedAt: string | null }> =>
  getJson<{ deal: WinAnalysisDealListItem; analysis: CloseWonDealAnalysis | null; generatedAt: string | null }>(
    apiPath(`/api/win-analysis/deal/${encodeURIComponent(dealId)}`, { orgId }),
    options,
  );

export const fetchWinBenchmarks = async (orgId: string, options: ApiRequestOptions = {}): Promise<WinBenchmark[]> =>
  getJson<WinBenchmark[]>(apiPath("/api/win-analysis/benchmark", { orgId }), options);

export const fetchWinBenchmarkGaps = async (
  orgId: string,
  dealId: string,
  options: ApiRequestOptions = {},
): Promise<WinBenchmarkComparison> =>
  getJson<WinBenchmarkComparison>(apiPath(`/api/win-analysis/gaps/${encodeURIComponent(dealId)}`, { orgId }), options);

// --- Coaching IA ------------------------------------------------------------

export const fetchTeamCoaching = async (
  { forceRefresh = false, ...options }: ApiRequestOptions & { forceRefresh?: boolean } = {},
): Promise<TeamCoachingCard[]> =>
  getCachedJson<TeamCoachingCard[]>(
    "coaching-team",
    "/api/coaching/team",
    ANALYTICS_OVERVIEW_CACHE_TTL_MS,
    forceRefresh,
    options,
  );

export const fetchRepCoaching = async (
  userId: string,
  { refresh = false, ...options }: ApiRequestOptions & { refresh?: boolean } = {},
): Promise<RepCoaching> =>
  getJson<RepCoaching>(
    apiPath(`/api/coaching/rep/${encodeURIComponent(userId)}`, { refresh: refresh ? "true" : undefined }),
    options,
  );

export const startTeamCoachingRun = async (): Promise<TeamCoachingJobSnapshot> => {
  clearAnalyticsCacheByPrefix("coaching-");

  return postJson<TeamCoachingJobSnapshot>("/api/coaching/team/run", {});
};

export const fetchTeamCoachingJob = async (jobId: string): Promise<TeamCoachingJobSnapshot> =>
  getJson<TeamCoachingJobSnapshot>(`/api/coaching/team/jobs/${encodeURIComponent(jobId)}`);
