import type { ProspectPriority, QueueData, QueueProspect } from "@jarvis/shared";
import { API_BASE_URL, apiPath, getJson, postJson, type ApiRequestOptions } from "./api/client";

const ANALYTICS_OVERVIEW_CACHE_TTL_MS = 60_000;
const ANALYTICS_DETAIL_CACHE_TTL_MS = 60_000;

type CachedApiEntry<T> = {
  expiresAt: number;
  promise: Promise<T>;
};

const analyticsGetCache = new Map<string, CachedApiEntry<unknown>>();

const getCachedJson = async <T>(cacheKey: string, path: string, ttlMs: number, forceRefresh = false): Promise<T> => {
  const now = Date.now();
  const cached = analyticsGetCache.get(cacheKey);

  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached.promise as Promise<T>;
  }

  const promise = getJson<T>(path).catch((error: unknown) => {
    analyticsGetCache.delete(cacheKey);
    throw error;
  });

  analyticsGetCache.set(cacheKey, {
    expiresAt: now + ttlMs,
    promise,
  });

  return promise;
};

const clearAnalyticsCache = (): void => {
  analyticsGetCache.clear();
};

export type AiProviderId = "deepseek" | "openai" | "vertex-gemini";

export type AiProviderOption = {
  id: AiProviderId;
  label: string;
  model: string;
  description: string;
  requiredEnv: string;
  docsUrl?: string;
};

export const aiProviderOptions: AiProviderOption[] = [
  {
    id: "openai",
    label: "OpenAI",
    model: "gpt-5-nano",
    description: "Modele OpenAI tres rapide pour synthese, extraction et classification.",
    requiredEnv: "OPENAI_API_KEY",
    docsUrl: "https://developers.openai.com/api/docs/models/gpt-5-nano",
  },
];

type HubSpotConnectionStatus = {
  orgId: string;
  connected: boolean;
  hubspotPortalId: string | null;
  prospectCount: number;
  syncedDealCount: number;
  hubspotDealCount: number | null;
  lastSyncedAt: string | null;
};

export type HubSpotOwnerOption = {
  ownerId: string;
  hubspotUserId: string | null;
  name: string;
  email: string;
  teamName: string | null;
  prospectCount: number;
  syncedDealCount: number;
  lastSyncedAt: string | null;
};

type HubSpotOwnerProspect = {
  id: string;
  dealName: string | null;
  contactName: string;
  email: string | null;
  company: string | null;
  title: string | null;
  dealStage: string | null;
  dealStageLabel: string | null;
  dealAmount: number | null;
  closeProbability: number;
  closedAt: string | null;
  dealLifecycleStatus: "pending" | "won" | "lost" | null;
  isClosedDeal: boolean | null;
  lastContactAt: string | null;
  hubspotDealId: string | null;
  syncedAt: string;
  nextAction: string;
  reason: string;
  priority: ProspectPriority;
};

type HubSpotOwnerProspectsPayload = {
  orgId: string;
  hubspotOwnerId: string;
  hubspotDealCount: number | null;
  prospects: HubSpotOwnerProspect[];
};

type HubSpotQueueDashboardPayload = HubSpotOwnerProspectsPayload & {
  status: HubSpotConnectionStatus;
  owner: HubSpotOwnerOption;
  owners: HubSpotOwnerOption[];
  lastUpdates: HubSpotLastUpdateItem[];
};

export type HubSpotLastUpdateItem = {
  id: string;
  orgId: string;
  hubspotDealId: string;
  dealName: string | null;
  companyName: string | null;
  amount: number | null;
  dealStage: string | null;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  reason: string | null;
  eventCount: number;
  nextAction: {
    title: string;
    rationale: string;
    dueInDays: number;
    priority: "low" | "medium" | "high";
  } | null;
  analysisProvider: string | null;
  analysisModel: string | null;
  errorMessage: string | null;
  receivedAt: string;
  scheduledFor: string;
  processedAt: string | null;
};

export type HubSpotTaskPriority = "low" | "medium" | "high";

export type HubSpotTaskStatus = "not_started" | "in_progress" | "waiting" | "completed" | "deferred" | "unknown";

export type HubSpotTaskListItem = {
  id: string;
  title: string;
  body: string | null;
  status: HubSpotTaskStatus;
  priority: HubSpotTaskPriority | null;
  dueAt: string | null;
  ownerHubSpotId: string | null;
  taskType: string | null;
  contactName: string | null;
  contactEmail: string | null;
  companyName: string | null;
  dealName: string | null;
  createdAt: string | null;
  associatedContactIds: string[];
  associatedCompanyIds: string[];
  associatedDealIds: string[];
};

export type TaskAnalysisType =
  | "cold_call"
  | "deal_follow_up"
  | "post_meeting_follow_up"
  | "no_show_recovery"
  | "admin_crm"
  | "renewal_or_upsell"
  | "obsolete"
  | "unknown";

export type TaskAnalysisRecommendation = "do_now" | "reschedule" | "keep_planned" | "skip" | "merge" | "clarify";

export type TaskAnalysis = {
  taskType: TaskAnalysisType;
  recommendation: TaskAnalysisRecommendation;
  priority: HubSpotTaskPriority;
  shouldReschedule: boolean;
  suggestedDueInDays: number | null;
  suggestedAction: string;
  rationale: string;
  outreachAngle: string | null;
  evidence: string[];
  missingData: string[];
  confidence: "low" | "medium" | "high";
};

export type TaskAnalyzerApplyResult = {
  orgId: string;
  hubspotTaskId: string;
  action: "completed" | "rescheduled";
  completedTask: HubSpotTaskListItem | null;
  createdTask: HubSpotTaskListItem | null;
  analysis: TaskAnalysis;
  message: string;
};

type HubSpotLastUpdatesPayload = {
  orgId: string;
  updates: HubSpotLastUpdateItem[];
};

type HubSpotTasksPayload = {
  orgId: string;
  hubspotOwnerId: string;
  tasks: HubSpotTaskListItem[];
};

export type HubSpotQueueData = QueueData & {
  hubspotPortalId: string | null;
  owner: HubSpotOwnerOption;
  owners: HubSpotOwnerOption[];
  hubspotDealCount: number | null;
  lastUpdates: HubSpotLastUpdateItem[];
};

export type HubSpotSyncResult = {
  orgId: string;
  syncedCount: number;
  crm: {
    contactCount: number;
    companyCount: number;
    dealCount: number;
  };
  autoFollowUp?: {
    analyzedCount: number;
    createdCount: number;
    skippedCount: number;
    failedCount: number;
  };
};

export type HubSpotSyncJobLog = {
  at: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
};

export type HubSpotSyncJobStatus = {
  jobId: string;
  orgId: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  currentStep: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  logs: HubSpotSyncJobLog[];
  result: HubSpotSyncResult | null;
  error: string | null;
};

export type HubSpotDisconnectResult = {
  orgId: string;
  disconnected: true;
  purgedProspectCount: number;
};

export type LlmProviderPreference = {
  provider: AiProviderId;
  model: string;
};

export const saveLlmProviderPreference = async (
  orgId: string,
  aiProvider: AiProviderOption,
): Promise<LlmProviderPreference> =>
  postJson<LlmProviderPreference>("/api/llm/provider-preference", {
    orgId,
    provider: aiProvider.id,
    model: aiProvider.model,
  });

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

export type ForecastScope = "all" | "owner";
export type ForecastAnalysisStatus = "fresh" | "stale" | "missing" | "closed_won";

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
  aiProbability: number | null;
  crmProbability: number;
  forecastAmount: number;
  impactAmount: number;
  analysisStatus: ForecastAnalysisStatus;
  analyzedAt: string | null;
  confidence: DealIntelligenceAnalysis["confidence"] | null;
  dealHealth: DealIntelligenceAnalysis["dealHealth"] | null;
  summary: string | null;
  suggestedMove: string | null;
  risks: string[];
  positiveSignals: string[];
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
  analyzedDealCount: number;
  staleDealCount: number;
  missingAnalysisCount: number;
  pipelineAmount: number;
  forecastAmount: number;
  objectiveAmount: number | null;
  gapToObjective: number | null;
  confidenceScore: number;
  scenarios: ForecastScenario[];
  risks: ForecastRisk[];
  levers: ForecastLever[];
  reliability: ForecastReliabilityDimension[];
  deals: ForecastDeal[];
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

export type FollowUpTaskResult = {
  prospectId: string;
  created: boolean;
  dryRun: boolean;
  recommendation: {
    shouldCreateTask: boolean;
    rationale: string;
    title: string;
    description: string;
    dueInDays: number;
    priority: "low" | "medium" | "high";
    outreachDraft: {
      channel: "email" | "sms";
      subject: string | null;
      body: string;
    } | null;
  };
  hubspotTaskId: string | null;
  localActionId: string | null;
  localActionPersisted: boolean;
};

const toQueueProspect = (prospect: HubSpotOwnerProspect): QueueProspect => ({
  id: prospect.id,
  name: prospect.contactName,
  title: prospect.title ?? "Titre non renseigne",
  company: prospect.company ?? prospect.dealName ?? prospect.contactName,
  dealAmount: prospect.dealAmount ?? 0,
  dealStage: prospect.dealStageLabel ?? prospect.dealStage ?? "Stage HubSpot non renseigne",
  closeProbability: prospect.closeProbability,
  closeDate: prospect.closedAt,
  lastContactAt: prospect.lastContactAt ?? prospect.syncedAt,
  nextAction: prospect.nextAction,
  reason: prospect.reason,
  priority: prospect.priority,
  email: prospect.email,
  phone: null,
  dealName: prospect.dealName,
  hubspotDealId: prospect.hubspotDealId,
});

export const fetchHubSpotLastUpdates = async (
  orgId: string,
  limit = 12,
  options: ApiRequestOptions = {},
): Promise<HubSpotLastUpdateItem[]> => {
  const payload = await getJson<HubSpotLastUpdatesPayload>(
    apiPath("/api/hubspot/last-updates", { orgId, limit }),
    options,
  );

  return payload.updates;
};

export const fetchHubSpotTasks = async (
  orgId: string,
  hubspotOwnerId: string,
  limit = 500,
  options: ApiRequestOptions = {},
): Promise<HubSpotTaskListItem[]> => {
  const payload = await getJson<HubSpotTasksPayload>(
    apiPath("/api/hubspot/tasks", { orgId, hubspotOwnerId, limit, includeCompleted: false }),
    options,
  );

  return payload.tasks;
};

export const updateHubSpotTaskPriority = async (
  orgId: string,
  taskId: string,
  priority: HubSpotTaskPriority | null,
): Promise<HubSpotTaskListItem> =>
  postJson<HubSpotTaskListItem>(`/api/hubspot/tasks/${encodeURIComponent(taskId)}/priority`, {
    orgId,
    priority,
  });

export const analyzeAndApplyHubSpotTask = async (
  orgId: string,
  taskId: string,
  refresh = false,
): Promise<TaskAnalyzerApplyResult> =>
  postJson<TaskAnalyzerApplyResult>(`/api/tasks/${encodeURIComponent(taskId)}/analyze-and-apply`, {
    orgId,
    refresh,
  });

export const fetchHubSpotQueue = async (
  orgId: string,
  preferredHubSpotOwnerId: string | null,
  live: boolean,
  options: ApiRequestOptions = {},
): Promise<HubSpotQueueData> => {
  const payload = await getJson<HubSpotQueueDashboardPayload>(
    apiPath("/api/hubspot/queue-dashboard", {
      orgId,
      hubspotOwnerId: preferredHubSpotOwnerId,
      live,
      limit: 12,
    }),
    options,
  );
  const { status, owner, owners, lastUpdates } = payload;

  if (!status.connected) {
    throw new Error("HubSpot n'est pas connecte pour cette organisation.");
  }

  if (owners.length === 0) {
    throw new Error("Aucun owner HubSpot disponible pour cette organisation.");
  }
  const prospects = payload.prospects.map(toQueueProspect);

  return {
    userId: owner.ownerId,
    generatedAt: status.lastSyncedAt ?? owner.lastSyncedAt ?? new Date().toISOString(),
    prospects,
    hubspotPortalId: status.hubspotPortalId,
    owner,
    owners,
    hubspotDealCount: payload.hubspotDealCount ?? owner.syncedDealCount,
    lastUpdates,
  };
};

export const buildHubSpotConnectUrl = (orgId: string, returnTo: string): string => {
  const redirectUrl = new URL(`${API_BASE_URL}/api/auth/hubspot/start`);
  redirectUrl.searchParams.set("orgId", orgId);
  redirectUrl.searchParams.set("returnTo", returnTo);

  return redirectUrl.toString();
};

export const syncHubSpotToSupabase = async (
  orgId: string,
  hubspotOwnerIds: string[] = [],
  onProgress?: (status: HubSpotSyncJobStatus) => void,
): Promise<HubSpotSyncResult> =>
  startAndPollHubSpotSync(orgId, hubspotOwnerIds, onProgress);

const wait = async (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });

const fetchHubSpotSyncJob = async (jobId: string): Promise<HubSpotSyncJobStatus> =>
  getJson<HubSpotSyncJobStatus>(`/api/sync/hubspot/jobs/${encodeURIComponent(jobId)}`);

const runHubSpotSyncInline = async (orgId: string, hubspotOwnerIds: string[]): Promise<HubSpotSyncResult> =>
  postJson<HubSpotSyncResult>("/api/sync/hubspot", {
    orgId,
    hubspotOwnerIds,
    async: false,
  });

const startAndPollHubSpotSync = async (
  orgId: string,
  hubspotOwnerIds: string[],
  onProgress?: (status: HubSpotSyncJobStatus) => void,
): Promise<HubSpotSyncResult> => {
  clearAnalyticsCache();
  const startedJob = await postJson<HubSpotSyncJobStatus>("/api/sync/hubspot", {
    orgId,
    hubspotOwnerIds,
    async: true,
  });
  onProgress?.(startedJob);

  let currentJob = startedJob;

  while (currentJob.status !== "completed" && currentJob.status !== "failed") {
    await wait(1000);
    try {
      currentJob = await fetchHubSpotSyncJob(startedJob.jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";

      if (!message.includes("Job de sync HubSpot introuvable")) {
        throw error;
      }

      const result = await runHubSpotSyncInline(orgId, hubspotOwnerIds);
      onProgress?.({
        ...startedJob,
        status: "completed",
        progress: 100,
        currentStep: "Sync terminee",
        updatedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        logs: [
          ...startedJob.logs,
          {
            at: new Date().toISOString(),
            level: "warning",
            message: "Polling async indisponible sur le backend. Sync relancee en mode direct.",
          },
        ],
        result,
        error: null,
      });

      clearAnalyticsCache();

      return result;
    }
    onProgress?.(currentJob);
  }

  if (currentJob.status === "failed") {
    throw new Error(currentJob.error ?? "Erreur inconnue pendant la sync HubSpot.");
  }

  if (!currentJob.result) {
    throw new Error("La sync HubSpot est terminee mais aucun resultat n'a ete renvoye.");
  }

  clearAnalyticsCache();

  return currentJob.result;
};

export const disconnectHubSpot = async (orgId: string): Promise<HubSpotDisconnectResult> =>
  postJson<HubSpotDisconnectResult>("/api/hubspot/disconnect", { orgId, purgeData: true }).finally(clearAnalyticsCache);

const buildDealAnalysisSearchParams = (
  prospect: QueueProspect,
  orgId: string,
  aiProvider: AiProviderOption,
  _ownerName: string | undefined,
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
  ownerName: string | undefined,
  refresh = false,
): Promise<DealAnalysisBundleResult> => {
  const searchParams = buildDealAnalysisSearchParams(prospect, orgId, aiProvider, ownerName, refresh);

  return getJson<DealAnalysisBundleResult>(
    `/api/prospects/${encodeURIComponent(prospect.id)}/deal-analysis-bundle?${searchParams.toString()}`,
  );
};

export const startDealAnalysisRun = async (
  prospect: QueueProspect,
  orgId: string,
  aiProvider: AiProviderOption,
  refresh = true,
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
  refresh = true,
  onProgress?: (status: DealAnalysisJobSnapshot) => void,
): Promise<DealAnalysisBundleResult> => {
  const startedJob = await startDealAnalysisRun(prospect, orgId, aiProvider, refresh);
  onProgress?.(startedJob);

  let currentJob = startedJob;

  while (currentJob.status !== "completed" && currentJob.status !== "failed") {
    await wait(1000);
    currentJob = await fetchDealAnalysisRun(startedJob.jobId);
    onProgress?.(currentJob);
  }

  if (currentJob.status === "failed") {
    throw new Error(currentJob.error ?? "Erreur inconnue pendant l'analyse du deal.");
  }

  if (!currentJob.result) {
    throw new Error("L'analyse du deal est terminee mais aucun resultat n'a ete renvoye.");
  }

  clearAnalyticsCache();

  return currentJob.result;
};

export const fetchDealAnalysisPage = async (
  prospect: QueueProspect,
  orgId: string,
  aiProvider: AiProviderOption,
  ownerName: string | undefined,
  refresh = false,
): Promise<DealAnalysisPageResult> => {
  const searchParams = buildDealAnalysisSearchParams(prospect, orgId, aiProvider, ownerName, refresh);

  return getJson<DealAnalysisPageResult>(
    `/api/prospects/${encodeURIComponent(prospect.id)}/deal-analysis-page?${searchParams.toString()}`,
  );
};

export const fetchDealQualification = async (
  prospect: QueueProspect,
  orgId: string,
  aiProvider: AiProviderOption,
  ownerName: string | undefined,
  refresh = false,
): Promise<DealQualificationResult> => {
  const searchParams = buildDealAnalysisSearchParams(prospect, orgId, aiProvider, ownerName, refresh);

  return getJson<DealQualificationResult>(
    `/api/prospects/${encodeURIComponent(prospect.id)}/deal-qualification?${searchParams.toString()}`,
  );
};

export const fetchDealActivityPlan = async (
  prospect: QueueProspect,
  orgId: string,
  aiProvider: AiProviderOption,
  ownerName: string | undefined,
  refresh = false,
): Promise<DealActivityPlanResult> => {
  const searchParams = buildDealAnalysisSearchParams(prospect, orgId, aiProvider, ownerName, refresh);

  return getJson<DealActivityPlanResult>(
    `/api/prospects/${encodeURIComponent(prospect.id)}/deal-activity-plan?${searchParams.toString()}`,
  );
};

export const createFollowUpTask = async (prospect: QueueProspect, orgId: string): Promise<FollowUpTaskResult> =>
  postJson<FollowUpTaskResult>(`/api/prospects/${encodeURIComponent(prospect.id)}/follow-up-task`, {
    orgId,
    hubspotDealId: prospect.hubspotDealId ?? null,
    contactName: prospect.name,
    company: prospect.company,
    dealStage: prospect.dealStage,
    lastContactAt: prospect.lastContactAt,
    nextAction: prospect.nextAction,
  });

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
  }).finally(clearAnalyticsCache);

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
  }).finally(clearAnalyticsCache);

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
  clearAnalyticsCache();
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

  while (currentJob.status !== "completed" && currentJob.status !== "failed") {
    await wait(1000);
    currentJob = await fetchForecastAnalyzeJob(startedJob.jobId);
    onProgress?.(currentJob);
  }

  if (currentJob.status === "failed") {
    throw new Error(currentJob.error ?? "Erreur inconnue pendant l'analyse forecast.");
  }

  if (!currentJob.result) {
    throw new Error("L'analyse forecast est terminee mais aucun resultat n'a ete renvoye.");
  }

  clearAnalyticsCache();

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
  }).finally(clearAnalyticsCache);

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
