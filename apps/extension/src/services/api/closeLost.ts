import { apiPath, getJson, postJson } from "./client";
import {
  ANALYTICS_DETAIL_CACHE_TTL_MS,
  ANALYTICS_OVERVIEW_CACHE_TTL_MS,
  clearAnalyticsCacheByPrefix,
  getCachedJson,
} from "./cache";
import type { AiProviderOption } from "./auth";

export type CloseLostScope = "sales_ae" | "owner";
export type CloseLostAnalysisStatus = "fresh" | "stale" | "missing";

export type CloseLostRiskSignal = {
  title: string;
  severity: "low" | "medium" | "high";
  detail: string;
};

export type CloseLostHealthDimension = {
  label: string;
  score: number;
  status: "weak" | "average" | "strong";
  detail: string;
};

export type CloseLostReactivationAction = {
  title: string;
  timing: string;
  rationale: string;
};

export type CloseLostDealAnalysis = {
  summary: string;
  primaryLossReason: string;
  secondaryLossReason: string | null;
  lossReasonCategory:
    | "pricing"
    | "timing"
    | "competition"
    | "product_gap"
    | "budget"
    | "authority"
    | "no_decision"
    | "other";
  competitorName: string | null;
  whatHappened: string[];
  healthBeforeLoss: CloseLostHealthDimension[];
  riskSignals: CloseLostRiskSignal[];
  reactivationScore: number;
  reactivationRationale: string;
  playbook: CloseLostReactivationAction[];
  evidence: string[];
  confidence: "low" | "medium" | "high";
};

export type CloseLostPortfolioFactor = {
  title: string;
  impact: "low" | "medium" | "high";
  dealShare: number;
  rationale: string;
};

export type CloseLostPortfolioRecommendation = {
  title: string;
  rationale: string;
  priority: "low" | "medium" | "high";
};

export type CloseLostPortfolioAnalysis = {
  keyInsight: string;
  executiveSummary: string;
  topFactors: CloseLostPortfolioFactor[];
  recurringPatterns: string[];
  recommendations: CloseLostPortfolioRecommendation[];
  confidence: "low" | "medium" | "high";
};

export type CloseLostRunLog = {
  at: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
};

export type CloseLostAnalysisRun = {
  id: string;
  orgId: string;
  scope: CloseLostScope;
  hubspotOwnerId: string | null;
  salesAeOwnerIds: string[];
  provider: string;
  model: string;
  dateFrom: string;
  dateTo: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  currentStep: string;
  logs: CloseLostRunLog[];
  dealCount: number;
  analyzedCount: number;
  reusedCount: number;
  failedCount: number;
  result: CloseLostPortfolioAnalysis | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CloseLostDealListItem = {
  hubspotDealId: string;
  dealName: string | null;
  companyName: string;
  contactName: string | null;
  ownerName: string | null;
  ownerHubSpotId: string | null;
  amount: number;
  stage: string;
  closedAt: string | null;
  syncedAt: string;
  analysisStatus: CloseLostAnalysisStatus;
  analyzedAt: string | null;
  primaryLossReason: string | null;
  lossReasonCategory: CloseLostDealAnalysis["lossReasonCategory"] | null;
  competitorName: string | null;
  reactivationScore: number | null;
  confidence: CloseLostDealAnalysis["confidence"] | null;
};

export type CloseLostMetric = {
  id: "lostDeals" | "lostValue" | "averageLoss" | "analyzedDeals" | "reactivationScore";
  label: string;
  value: number;
  unit: "count" | "currency" | "score";
  caption: string;
};

export type CloseLostBreakdownRow = {
  id: string;
  label: string;
  dealCount: number;
  lostValue: number;
  share: number;
};

export type CloseLostOverviewResult = {
  orgId: string;
  scope: CloseLostScope;
  hubspotOwnerId: string | null;
  salesAeOwnerIds: string[];
  dateFrom: string;
  dateTo: string;
  provider: string;
  model: string;
  generatedAt: string;
  lastRun: CloseLostAnalysisRun | null;
  portfolio: CloseLostPortfolioAnalysis | null;
  metrics: CloseLostMetric[];
  deals: CloseLostDealListItem[];
  lossReasons: CloseLostBreakdownRow[];
  competitors: CloseLostBreakdownRow[];
  stageBreakdown: CloseLostBreakdownRow[];
  recommendations: CloseLostPortfolioRecommendation[];
  needsAnalysisCount: number;
};

export type CloseLostDealDetailResult = {
  orgId: string;
  provider: string;
  model: string;
  deal: CloseLostDealListItem & {
    companyDomain: string | null;
    companyIndustry: string | null;
    contactEmail: string | null;
    closeProbability: number;
    createdAt: string | null;
    updatedAt: string | null;
  };
  analysis: CloseLostDealAnalysis | null;
  analysisStatus: CloseLostAnalysisStatus;
  generatedAt: string | null;
  sourceSyncedAt: string | null;
};

export const fetchCloseLostOverview = async ({
  orgId,
  scope,
  hubspotOwnerId,
  salesAeOwnerIds,
  dateFrom,
  dateTo,
  aiProvider,
  forceRefresh = false,
}: {
  orgId: string;
  scope: CloseLostScope;
  hubspotOwnerId: string | null;
  salesAeOwnerIds: string[];
  dateFrom: string;
  dateTo: string;
  aiProvider: AiProviderOption;
  forceRefresh?: boolean;
}): Promise<CloseLostOverviewResult> => {
  const path = apiPath("/api/close-lost-analysis/overview", {
    orgId,
    scope,
    dateFrom,
    dateTo,
    llmProvider: aiProvider.id,
    llmModel: aiProvider.model,
    hubspotOwnerId,
    salesAeOwnerIds: salesAeOwnerIds.length > 0 ? salesAeOwnerIds.join(",") : null,
  });

  return getCachedJson<CloseLostOverviewResult>(
    `close-lost-overview:${path}`,
    path,
    ANALYTICS_OVERVIEW_CACHE_TTL_MS,
    forceRefresh,
  );
};

export const startCloseLostAnalysisRun = async ({
  orgId,
  scope,
  hubspotOwnerId,
  salesAeOwnerIds,
  dateFrom,
  dateTo,
  aiProvider,
  refresh,
}: {
  orgId: string;
  scope: CloseLostScope;
  hubspotOwnerId: string | null;
  salesAeOwnerIds: string[];
  dateFrom: string;
  dateTo: string;
  aiProvider: AiProviderOption;
  refresh: boolean;
}): Promise<CloseLostAnalysisRun> =>
  postJson<CloseLostAnalysisRun>("/api/close-lost-analysis/runs", {
    orgId,
    scope,
    hubspotOwnerId,
    salesAeOwnerIds,
    dateFrom,
    dateTo,
    llmProvider: aiProvider.id,
    llmModel: aiProvider.model,
    refresh,
  }).finally(() => clearAnalyticsCacheByPrefix(`close-lost-`));

export const fetchCloseLostAnalysisRun = async (runId: string): Promise<CloseLostAnalysisRun> =>
  getJson<CloseLostAnalysisRun>(`/api/close-lost-analysis/runs/${encodeURIComponent(runId)}`);

export const fetchCloseLostDealDetail = async (
  orgId: string,
  hubspotDealId: string,
  aiProvider: AiProviderOption,
  forceRefresh = false,
): Promise<CloseLostDealDetailResult> => {
  const path = apiPath(`/api/close-lost-analysis/deals/${encodeURIComponent(hubspotDealId)}`, {
    orgId,
    llmProvider: aiProvider.id,
    llmModel: aiProvider.model,
  });

  return getCachedJson<CloseLostDealDetailResult>(
    `close-lost-detail:${path}`,
    path,
    ANALYTICS_DETAIL_CACHE_TTL_MS,
    forceRefresh,
  );
};

export const analyzeCloseLostDeal = async (
  orgId: string,
  hubspotDealId: string,
  aiProvider: AiProviderOption,
  refresh: boolean,
): Promise<CloseLostDealDetailResult> =>
  postJson<CloseLostDealDetailResult>(`/api/close-lost-analysis/deals/${encodeURIComponent(hubspotDealId)}/analyze`, {
    orgId,
    llmProvider: aiProvider.id,
    llmModel: aiProvider.model,
    refresh,
  }).finally(() => {
    clearAnalyticsCacheByPrefix(`close-lost-detail:/api/close-lost-analysis/deals/${encodeURIComponent(hubspotDealId)}`);
    clearAnalyticsCacheByPrefix(`close-lost-`);
  });
