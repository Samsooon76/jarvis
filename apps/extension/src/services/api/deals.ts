import type { QueueProspect } from "@jarvis/shared";
import { getJson, postJson } from "./client";
import { clearAnalyticsCacheByPrefix, pollDelayMs, POLL_TIMEOUT_MS, wait } from "./cache";
import type { AiProviderOption } from "./auth";

export type DealIntelligenceNextStep = {
  title: string;
  rationale: string;
  dueInDays: number;
  priority: "low" | "medium" | "high";
  createHubSpotTask: boolean;
};

export type DealIntelligenceAnalysis = {
  closeWonProbability: number;
  dealHealth: "strong" | "medium" | "at_risk" | "blocked" | "unknown";
  executiveSummary: string;
  detailedAnalysis: string[];
  whyNow: string;
  suggestedMove: string;
  nextSteps: DealIntelligenceNextStep[];
  risks: string[];
  positiveSignals: string[];
  missingData: string[];
  evidence: string[];
  confidence: "low" | "medium" | "high";
};

export type DealIntelligenceResult = {
  prospectId: string;
  orgId: string;
  hubspotDealId: string;
  cached: boolean;
  provider: string;
  model: string;
  generatedAt: string;
  expiresAt: string;
  analysis: DealIntelligenceAnalysis;
};

export type DealAnalysisMetric = {
  id: "dealValue" | "weightedValue" | "stageAge" | "engagementScore";
  label: string;
  value: number;
  unit: "currency" | "days" | "score";
  caption: string;
};

export type DealAnalysisHealthDimension = {
  id: "intent" | "momentum" | "competition";
  label: string;
  level: "low" | "medium" | "high";
  score: number;
  tone: "green" | "amber" | "red";
  rationale: string;
};

export type DealAnalysisTrendPoint = {
  date: string;
  label: string;
  probability: number;
};

export type DealAnalysisAction = {
  title: string;
  rationale: string;
  dueAt: string;
  priority: "low" | "medium" | "high";
  source: "ai" | "crm";
};

export type DealAnalysisSnapshot = {
  prospectId: string;
  orgId: string;
  hubspotDealId: string;
  hubspotContactId: string | null;
  dealName: string | null;
  companyName: string;
  contactName: string;
  contactTitle: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  ownerName: string | null;
  ownerHubSpotId: string | null;
  amount: number;
  weightedAmount: number;
  stage: string;
  closeProbability: number;
  forecastLabel: "best_case" | "commit" | "pipeline" | "at_risk";
  closeDate: string | null;
  stageEnteredAt: string | null;
  stageAgeDays: number;
  lastContactAt: string | null;
  syncedAt: string | null;
};

export type DealAnalysisPageResult = DealIntelligenceResult & {
  snapshot: DealAnalysisSnapshot;
  metrics: DealAnalysisMetric[];
  healthDimensions: DealAnalysisHealthDimension[];
  probabilityTrend: DealAnalysisTrendPoint[];
  primaryActions: DealAnalysisAction[];
  crmFacts: string[];
  lastSyncedAt: string | null;
};

export type DealAnalysisBundleResult = {
  page: DealAnalysisPageResult;
  qualification: DealQualificationResult;
  activityPlan: DealActivityPlanResult;
};

export type DealAnalysisJobStatus = "queued" | "running" | "completed" | "failed";

export type DealAnalysisJobSnapshot = {
  jobId: string;
  prospectId: string;
  orgId: string | null;
  hubspotDealId: string | null;
  status: DealAnalysisJobStatus;
  progress: number;
  currentStep: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  logs: Array<{
    at: string;
    level: "info" | "success" | "error";
    message: string;
  }>;
  result: DealAnalysisBundleResult | null;
  error: string | null;
};

export type DealQualificationStatus = "confirmed" | "partial" | "weak" | "missing";

export type DealQualificationInfluence = "low" | "medium" | "high";

export type DealQualificationSentiment = "positive" | "neutral" | "negative" | "unknown";

export type DealQualificationDealRole =
  | "champion"
  | "decision_maker"
  | "influencer"
  | "blocker"
  | "user"
  | "unknown";

export type MeddiccCriterionId =
  | "metrics"
  | "economicBuyer"
  | "decisionCriteria"
  | "decisionProcess"
  | "paperProcess"
  | "identifyPain"
  | "champion"
  | "competition";

export type BuyingCommitteeMember = {
  name: string;
  role: string;
  influence: DealQualificationInfluence;
  sentiment: DealQualificationSentiment;
  dealRole: DealQualificationDealRole;
  evidence: string;
};

export type MeddiccCriterion = {
  id: MeddiccCriterionId;
  label: string;
  status: DealQualificationStatus;
  score: number;
  evidence: string;
  gap: string | null;
};

export type DecisionProcess = {
  decisionCalendar: string | null;
  budgetStatus: "validated" | "to_confirm" | "blocked" | "unknown";
  purchaseProcess: "clear" | "to_confirm" | "blocked" | "unknown";
  legalStatus: "approved" | "in_review" | "blocked" | "unknown";
  nextGovernanceStep: string | null;
};

export type QualificationRisk = {
  title: string;
  severity: "low" | "medium" | "high";
  evidence: string;
};

export type QualificationInsight = {
  title: string;
  rationale: string;
};

export type DealQualificationAnalysis = {
  buyingCommittee: BuyingCommitteeMember[];
  meddicc: MeddiccCriterion[];
  decisionProcess: DecisionProcess;
  risks: QualificationRisk[];
  strengths: QualificationInsight[];
  missingForWin: QualificationInsight[];
  confidence: "low" | "medium" | "high";
};

export type DealQualificationResult = {
  prospectId: string;
  orgId: string;
  hubspotDealId: string;
  cached: boolean;
  provider: string;
  model: string;
  generatedAt: string;
  expiresAt: string;
  qualification: DealQualificationAnalysis;
};

export type DealRecentActivity = {
  id: string;
  type: "note" | "call" | "meeting" | "email" | "sms" | "communication" | "deal" | "task";
  occurredAt: string | null;
  title: string;
  body: string | null;
  actorName: string | null;
  channel: "email" | "call" | "meeting" | "note" | "sms" | "communication" | "deal" | "task";
};

export type DealChannelEngagement = {
  channel: "email" | "call" | "meeting" | "note" | "sms" | "communication" | "task";
  label: string;
  count: number;
  responseRate: number | null;
  caption: string;
};

export type ActivityPlanAction = {
  title: string;
  ownerName: string | null;
  dueDate: string | null;
  status: "todo" | "in_progress" | "planned" | "done";
  priority: "low" | "medium" | "high";
  rationale: string;
};

export type ActivityPlanDeadline = {
  title: string;
  date: string | null;
  timeWindow: string | null;
  ownerName: string | null;
  description: string;
};

export type ActivityPlanInsight = {
  title: string;
  detail: string;
};

export type ActivityPlanRecommendation = {
  priority: "low" | "medium" | "high";
  summary: string;
  nextBestAction: {
    title: string;
    rationale: string;
    dueInDays: number;
  };
};

export type DealActivityPlanAnalysis = {
  mutualActionPlan: ActivityPlanAction[];
  upcomingDeadlines: ActivityPlanDeadline[];
  notesAndInsights: ActivityPlanInsight[];
  recommendation: ActivityPlanRecommendation;
  confidence: "low" | "medium" | "high";
};

export type DealActivityPlanResult = {
  prospectId: string;
  orgId: string;
  hubspotDealId: string;
  cached: boolean;
  provider: string;
  model: string;
  generatedAt: string;
  expiresAt: string;
  recentActivities: DealRecentActivity[];
  channelEngagement: DealChannelEngagement[];
  activityPlan: DealActivityPlanAnalysis;
};

const buildDealAnalysisSearchParams = (
  prospect: QueueProspect,
  orgId: string,
  aiProvider: AiProviderOption,
  refresh = false,
): URLSearchParams => {
  const searchParams = new URLSearchParams({
    orgId,
    llmProvider: aiProvider.id,
    llmModel: aiProvider.model,
    refresh: String(refresh),
  });

  if (prospect.hubspotDealId) {
    searchParams.set("hubspotDealId", prospect.hubspotDealId);
  }

  return searchParams;
};

export const fetchDealAnalysisBundle = async (
  prospect: QueueProspect,
  orgId: string,
  aiProvider: AiProviderOption,
  refresh = false,
): Promise<DealAnalysisBundleResult> => {
  const searchParams = buildDealAnalysisSearchParams(prospect, orgId, aiProvider, refresh);

  return getJson<DealAnalysisBundleResult>(
    `/api/prospects/${encodeURIComponent(prospect.id)}/deal-analysis-bundle?${searchParams.toString()}`,
  );
};

export const startDealAnalysisRun = async (
  prospect: QueueProspect,
  orgId: string,
  aiProvider: AiProviderOption,
  refresh = false,
): Promise<DealAnalysisJobSnapshot> =>
  postJson<DealAnalysisJobSnapshot>(`/api/prospects/${encodeURIComponent(prospect.id)}/deal-analysis-runs`, {
    orgId,
    hubspotDealId: prospect.hubspotDealId ?? null,
    llmProvider: aiProvider.id,
    llmModel: aiProvider.model,
    refresh,
  });

export const fetchDealAnalysisRun = async (jobId: string): Promise<DealAnalysisJobSnapshot> =>
  getJson<DealAnalysisJobSnapshot>(`/api/prospects/deal-analysis-runs/${encodeURIComponent(jobId)}`);

export const startAndPollDealAnalysisRun = async (
  prospect: QueueProspect,
  orgId: string,
  aiProvider: AiProviderOption,
  refresh = false,
  onProgress?: (status: DealAnalysisJobSnapshot) => void,
): Promise<DealAnalysisBundleResult> => {
  const startedJob = await startDealAnalysisRun(prospect, orgId, aiProvider, refresh);
  onProgress?.(startedJob);

  let currentJob = startedJob;
  let attempt = 0;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (currentJob.status !== "completed" && currentJob.status !== "failed") {
    if (Date.now() > deadline) {
      throw new Error("Delai d'attente depasse pendant l'analyse du deal. Veuillez reessayer.");
    }
    await wait(pollDelayMs(attempt));
    attempt += 1;
    currentJob = await fetchDealAnalysisRun(startedJob.jobId);
    onProgress?.(currentJob);
  }

  if (currentJob.status === "failed") {
    throw new Error(currentJob.error ?? "Erreur inconnue pendant l'analyse du deal.");
  }

  if (!currentJob.result) {
    throw new Error("L'analyse du deal est terminee mais aucun resultat n'a ete renvoye.");
  }

  clearAnalyticsCacheByPrefix(`deal-analysis:${orgId}:${prospect.id}:`);

  return currentJob.result;
};

export const fetchDealAnalysisPage = async (
  prospect: QueueProspect,
  orgId: string,
  aiProvider: AiProviderOption,
  refresh = false,
): Promise<DealAnalysisPageResult> => {
  const searchParams = buildDealAnalysisSearchParams(prospect, orgId, aiProvider, refresh);

  return getJson<DealAnalysisPageResult>(
    `/api/prospects/${encodeURIComponent(prospect.id)}/deal-analysis-page?${searchParams.toString()}`,
  );
};

export const fetchDealQualification = async (
  prospect: QueueProspect,
  orgId: string,
  aiProvider: AiProviderOption,
  refresh = false,
): Promise<DealQualificationResult> => {
  const searchParams = buildDealAnalysisSearchParams(prospect, orgId, aiProvider, refresh);

  return getJson<DealQualificationResult>(
    `/api/prospects/${encodeURIComponent(prospect.id)}/deal-qualification?${searchParams.toString()}`,
  );
};

export const fetchDealActivityPlan = async (
  prospect: QueueProspect,
  orgId: string,
  aiProvider: AiProviderOption,
  refresh = false,
): Promise<DealActivityPlanResult> => {
  const searchParams = buildDealAnalysisSearchParams(prospect, orgId, aiProvider, refresh);

  return getJson<DealActivityPlanResult>(
    `/api/prospects/${encodeURIComponent(prospect.id)}/deal-activity-plan?${searchParams.toString()}`,
  );
};
