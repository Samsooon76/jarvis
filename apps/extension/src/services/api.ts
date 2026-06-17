// Barrel des services API : les implementations vivent dans ./api/*.
// Les imports existants (`from "../services/api"`) restent valides.

export type {
  ManagerDigest,
  ManagerDigestAnalysis,
  ManagerDigestHistoryEntry,
  ManagerDigestPeriod,
  PulseEventType,
  PulseNotification,
  PulseNotificationList,
  PulsePreferences,
  OrgUser,
  AppUserRole,
  RepCoaching,
  RepCoachingAnalysis,
  RepCoachingSourceDeal,
  RepCoachingStats,
  TeamCoachingCard,
  TeamCoachingJobSnapshot,
  TeamCoachingRunResult,
  ForecastAccuracyOverview,
  ForecastAccuracyRep,
  ForecastAccuracyCategory,
  ForecastCalibrationBucket,
  CloseWonDealAnalysis,
  CloseWonPortfolioAnalysis,
  WinAnalysisDealListItem,
  WinAnalysisOverview,
  WinAnalysisRun,
  WinBenchmark,
  WinBenchmarkComparison,
  WinBenchmarkGap,
  Playbook,
  PlaybookDetail,
  PlaybookPlay,
  PlaybookPlayCategory,
  PlaybookPlayInput,
  PlaybookPlayStatus,
  PlaybookStatus,
} from "@jarvis/shared";

export { registerCacheClearer, clearAnalyticsCacheByPrefix, clearApiResponseCaches } from "./api/cache";
export * from "./api/auth";
export * from "./api/hubspot";
export * from "./api/queue";
export * from "./api/leads";
export * from "./api/tasks";
export * from "./api/deals";
export * from "./api/forecast";
export * from "./api/closeLost";
export * from "./api/stats";
export * from "./api/manager";
export * from "./api/pulse";
export * from "./api/playbook";
export * from "./api/calls";
export * from "./api/mcp";
