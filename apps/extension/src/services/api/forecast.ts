import { apiPath, getJson, postJson } from "./client";
import {
  ANALYTICS_OVERVIEW_CACHE_TTL_MS,
  clearAnalyticsCacheByPrefix,
  getCachedJson,
  pollDelayMs,
  POLL_TIMEOUT_MS,
  wait,
} from "./cache";
import type { AiProviderOption } from "./auth";
import type { DealIntelligenceAnalysis, DealIntelligenceResult } from "./deals";

export type ForecastScope = "all" | "owner";
export type ForecastAnalysisStatus = "fresh" | "stale" | "missing" | "closed_won";
export type ForecastDealBucket = "signedPaymentPending" | "paymentReceived" | "openForecast";

export type ForecastDeal = {
  hubspotDealId: string;
  dealName: string | null;
  companyName: string;
  contactName: string | null;
  ownerName: string | null;
  ownerHubSpotId: string | null;
  amount: number;
  stage: string;
  closeDate: string | null;
  syncedAt: string;
  forecastBucket: ForecastDealBucket;
  aiProbability: number | null;
  crmProbability: number;
  forecastAmount: number;
  impactAmount: number;
  analysisStatus: ForecastAnalysisStatus;
  analyzedAt: string | null;
  confidence: DealIntelligenceAnalysis["confidence"] | null;
  dealHealth: DealIntelligenceAnalysis["dealHealth"] | null;
  summary: string | null;
  detailedAnalysis: string[];
  whyNow: string | null;
  suggestedMove: string | null;
  risks: string[];
  positiveSignals: string[];
  evidence: string[];
  missingData: string[];
};

export type ForecastScenario = {
  id: "commit" | "likely" | "upside";
  label: string;
  amount: number;
  probability: number;
};

export type ForecastRisk = {
  title: string;
  severity: "low" | "medium" | "high";
  dealCount: number;
  amount: number;
};

export type ForecastLever = {
  title: string;
  dealCount: number;
  amount: number;
};

export type ForecastReliabilityDimension = {
  id: "dataCompleteness" | "recentAnalysis" | "aiConfidence" | "stageCoverage";
  label: string;
  score: number;
};

export type ForecastMonthlyProjection = {
  month: string;
  label: string;
  dealCount: number;
  signedDealCount: number;
  signedPaymentPendingDealCount: number;
  paymentReceivedDealCount: number;
  openDealCount: number;
  wonDealCount: number;
  analyzedDealCount: number;
  missingAnalysisCount: number;
  signedAmount: number;
  signedPaymentPendingAmount: number;
  paymentReceivedAmount: number;
  openPipelineAmount: number;
  openForecastAmount: number;
  landingAmount: number;
  pipelineAmount: number;
  commitAmount: number;
  forecastAmount: number;
  objectiveAmount: number | null;
  gapToObjective: number | null;
  confidenceScore: number;
};

export type ForecastSynthesisCategory = "commit" | "bestCase" | "atRisk" | "slipping";

export type ForecastSynthesisStatus = "fresh" | "stale";

export type ForecastSynthesisAction = {
  title: string;
  rationale: string;
  priority: "low" | "medium" | "high";
  relatedDealIds: string[];
};

export type ForecastSynthesisDeal = {
  hubspotDealId: string;
  dealName: string | null;
  companyName: string;
  ownerName: string | null;
  amount: number;
  forecastAmount: number;
  aiProbability: number | null;
  crmProbability: number;
  stage: string;
  closeDate: string | null;
  dealHealth: DealIntelligenceAnalysis["dealHealth"] | null;
  category: ForecastSynthesisCategory;
  reason: string;
  recommendedAction: string | null;
};

export type ForecastSynthesisCategorySummary = {
  category: ForecastSynthesisCategory;
  label: string;
  dealCount: number;
  amount: number;
  weightedAmount: number;
};

export type ForecastSynthesis = {
  generatedAt: string;
  provider: string;
  model: string;
  status: ForecastSynthesisStatus;
  headline: string;
  confidence: "low" | "medium" | "high";
  analyzedDealCount: number;
  objectiveAmount: number | null;
  gapToObjective: number | null;
  projectedCloseAmount: number;
  categories: ForecastSynthesisCategorySummary[];
  deals: ForecastSynthesisDeal[];
  actionPlan: ForecastSynthesisAction[];
};

export type ForecastOverviewResult = {
  orgId: string;
  scope: ForecastScope;
  hubspotOwnerId: string | null;
  dateFrom: string;
  dateTo: string;
  provider: string;
  model: string;
  generatedAt: string;
  lastAnalyzedAt: string | null;
  openDealCount: number;
  wonDealCount: number;
  signedDealCount: number;
  signedPaymentPendingDealCount: number;
  paymentReceivedDealCount: number;
  analyzedDealCount: number;
  staleDealCount: number;
  missingAnalysisCount: number;
  signedAmount: number;
  signedPaymentPendingAmount: number;
  paymentReceivedAmount: number;
  openPipelineAmount: number;
  openForecastAmount: number;
  landingAmount: number;
  pipelineAmount: number;
  forecastAmount: number;
  objectiveAmount: number | null;
  gapToObjective: number | null;
  confidenceScore: number;
  scenarios: ForecastScenario[];
  risks: ForecastRisk[];
  levers: ForecastLever[];
  reliability: ForecastReliabilityDimension[];
  monthlyProjection: ForecastMonthlyProjection[];
  deals: ForecastDeal[];
  synthesis: ForecastSynthesis | null;
};

export type ForecastGenerateSynthesisResult = {
  orgId: string;
  provider: string;
  model: string;
  synthesis: ForecastSynthesis | null;
  overview: ForecastOverviewResult;
};

export type ForecastAnalyzeResult = {
  orgId: string;
  provider: string;
  model: string;
  requestedCount: number;
  batchSize: number;
  analyzedCount: number;
  reusedCount: number;
  failedCount: number;
  errors: Array<{
    hubspotDealId: string;
    message: string;
  }>;
  overview: ForecastOverviewResult;
};

export type ForecastAnalyzeJobLog = {
  at: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
};

export type ForecastAnalyzeJobStatus = {
  jobId: string;
  orgId: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  currentStep: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  logs: ForecastAnalyzeJobLog[];
  result: ForecastAnalyzeResult | null;
  error: string | null;
};

export type ForecastAnalyzeDealResult = {
  orgId: string;
  provider: string;
  model: string;
  hubspotDealId: string;
  cached: boolean;
  analysis: DealIntelligenceResult;
  overview: ForecastOverviewResult;
};

export type MonthlySalesTarget = {
  id: string;
  orgId: string;
  hubspotOwnerId: string;
  ownerName: string;
  targetMonth: string;
  objectiveAmount: number;
  createdAt: string;
  updatedAt: string;
};

export type MonthlySalesTargetInput = {
  hubspotOwnerId: string;
  ownerName: string;
  targetMonth: string;
  objectiveAmount: number;
};

export const fetchForecastOverview = async ({
  orgId,
  scope,
  hubspotOwnerId,
  dateFrom,
  dateTo,
  aiProvider,
  forceRefresh = false,
}: {
  orgId: string;
  scope: ForecastScope;
  hubspotOwnerId: string | null;
  dateFrom: string;
  dateTo: string;
  aiProvider: AiProviderOption;
  forceRefresh?: boolean;
}): Promise<ForecastOverviewResult> => {
  const path = apiPath("/api/forecast/overview", {
    orgId,
    scope,
    dateFrom,
    dateTo,
    llmProvider: aiProvider.id,
    llmModel: aiProvider.model,
    hubspotOwnerId,
  });

  return getCachedJson<ForecastOverviewResult>(
    `forecast-overview:${path}`,
    path,
    ANALYTICS_OVERVIEW_CACHE_TTL_MS,
    forceRefresh,
  );
};

const fetchForecastAnalyzeJob = async (jobId: string): Promise<ForecastAnalyzeJobStatus> =>
  getJson<ForecastAnalyzeJobStatus>(`/api/forecast/analyze-open-deals/jobs/${encodeURIComponent(jobId)}`);

export const startAndPollForecastOpenDealsAnalysis = async ({
  orgId,
  scope,
  hubspotOwnerId,
  dateFrom,
  dateTo,
  aiProvider,
  refresh,
  batchSize = 5,
  retryFailedCount = 2,
  onProgress,
}: {
  orgId: string;
  scope: ForecastScope;
  hubspotOwnerId: string | null;
  dateFrom: string;
  dateTo: string;
  aiProvider: AiProviderOption;
  refresh: boolean;
  batchSize?: number;
  retryFailedCount?: number;
  onProgress?: (status: ForecastAnalyzeJobStatus) => void;
}): Promise<ForecastAnalyzeResult> => {
  clearAnalyticsCacheByPrefix(`forecast-`);
  const startedJob = await postJson<ForecastAnalyzeJobStatus>("/api/forecast/analyze-open-deals", {
    orgId,
    scope,
    hubspotOwnerId,
    dateFrom,
    dateTo,
    llmProvider: aiProvider.id,
    llmModel: aiProvider.model,
    refresh,
    batchSize,
    retryFailedCount,
    async: true,
  });
  onProgress?.(startedJob);

  let currentJob = startedJob;
  let attempt = 0;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (currentJob.status !== "completed" && currentJob.status !== "failed") {
    if (Date.now() > deadline) {
      throw new Error("Delai d'attente depasse pendant l'analyse forecast. Veuillez reessayer.");
    }
    await wait(pollDelayMs(attempt));
    attempt += 1;
    currentJob = await fetchForecastAnalyzeJob(startedJob.jobId);
    onProgress?.(currentJob);
  }

  if (currentJob.status === "failed") {
    throw new Error(currentJob.error ?? "Erreur inconnue pendant l'analyse forecast.");
  }

  if (!currentJob.result) {
    throw new Error("L'analyse forecast est terminee mais aucun resultat n'a ete renvoye.");
  }

  clearAnalyticsCacheByPrefix(`forecast-`);

  return currentJob.result;
};

export const analyzeForecastDeal = async ({
  orgId,
  scope,
  hubspotOwnerId,
  dateFrom,
  dateTo,
  hubspotDealId,
  aiProvider,
  refresh,
}: {
  orgId: string;
  scope: ForecastScope;
  hubspotOwnerId: string | null;
  dateFrom: string;
  dateTo: string;
  hubspotDealId: string;
  aiProvider: AiProviderOption;
  refresh: boolean;
}): Promise<ForecastAnalyzeDealResult> =>
  postJson<ForecastAnalyzeDealResult>(`/api/forecast/deals/${encodeURIComponent(hubspotDealId)}/analyze`, {
    orgId,
    scope,
    hubspotOwnerId,
    dateFrom,
    dateTo,
    llmProvider: aiProvider.id,
    llmModel: aiProvider.model,
    refresh,
  }).finally(() => clearAnalyticsCacheByPrefix(`forecast-`));

export const generateForecastSynthesis = async ({
  orgId,
  scope,
  hubspotOwnerId,
  dateFrom,
  dateTo,
  aiProvider,
}: {
  orgId: string;
  scope: ForecastScope;
  hubspotOwnerId: string | null;
  dateFrom: string;
  dateTo: string;
  aiProvider: AiProviderOption;
}): Promise<ForecastGenerateSynthesisResult> =>
  postJson<ForecastGenerateSynthesisResult>("/api/forecast/synthesis", {
    orgId,
    scope,
    hubspotOwnerId,
    dateFrom,
    dateTo,
    llmProvider: aiProvider.id,
    llmModel: aiProvider.model,
  }).finally(() => clearAnalyticsCacheByPrefix(`forecast-`));

export const fetchMonthlySalesTargets = async (orgId: string, year: number): Promise<MonthlySalesTarget[]> =>
  getJson<MonthlySalesTarget[]>(apiPath("/api/forecast/targets", { orgId, year }));

export const saveMonthlySalesTargets = async (
  orgId: string,
  targets: MonthlySalesTargetInput[],
): Promise<MonthlySalesTarget[]> =>
  postJson<MonthlySalesTarget[]>("/api/forecast/targets", {
    orgId,
    targets,
  });
