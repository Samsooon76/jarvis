import type { ApiResponse, ProspectPriority, QueueData, QueueProspect } from "@jarvis/shared";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "https://jarvisapi-production-10cd.up.railway.app";

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
    id: "deepseek",
    label: "DeepSeek",
    model: "deepseek-v4-flash",
    description: "Rapide et peu couteux pour les analyses CRM structurees.",
    requiredEnv: "DEEPSEEK_API_KEY",
    docsUrl: "https://api-docs.deepseek.com/",
  },
  {
    id: "openai",
    label: "OpenAI",
    model: "gpt-5-nano",
    description: "Modele OpenAI tres rapide pour synthese, extraction et classification.",
    requiredEnv: "OPENAI_API_KEY",
    docsUrl: "https://developers.openai.com/api/docs/models/gpt-5-nano",
  },
  {
    id: "vertex-gemini",
    label: "Vertex Gemini",
    model: "gemini-3.1-flash-lite-preview",
    description: "Provider historique du projet, conserve comme option de fallback.",
    requiredEnv: "VERTEX_AI_API_KEY",
  },
];

export type HubSpotConnectionStatus = {
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
};

type HubSpotOwnerProspectsPayload = {
  orgId: string;
  hubspotOwnerId: string;
  hubspotDealCount: number | null;
  prospects: HubSpotOwnerProspect[];
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
  receivedAt: string;
  scheduledFor: string;
  processedAt: string | null;
};

type HubSpotLastUpdatesPayload = {
  orgId: string;
  updates: HubSpotLastUpdateItem[];
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
  type: "note" | "call" | "meeting" | "email" | "sms" | "deal";
  occurredAt: string | null;
  title: string;
  body: string | null;
  actorName: string | null;
  channel: "email" | "call" | "meeting" | "note" | "sms" | "deal";
};

export type DealChannelEngagement = {
  channel: "email" | "call" | "meeting" | "note" | "sms";
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

const getJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`);
  const payload = (await response.json()) as ApiResponse<T>;

  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error ?? "La reponse API HubSpot est invalide.");
  }

  return payload.data;
};

const postJson = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as ApiResponse<T>;

  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error ?? "La reponse API HubSpot est invalide.");
  }

  return payload.data;
};

const getPriority = (prospect: HubSpotOwnerProspect): ProspectPriority => {
  const amount = prospect.dealAmount ?? 0;
  const daysSinceContact = getDaysSince(prospect.lastContactAt ?? prospect.syncedAt);

  if (prospect.closeProbability >= 70 || amount >= 20_000 || daysSinceContact >= 21) {
    return "urgent";
  }

  if (prospect.closeProbability >= 40 || amount >= 8_000 || daysSinceContact >= 10) {
    return "important";
  }

  return "routine";
};

const getDaysSince = (value: string): number => {
  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
};

const getNextAction = (prospect: HubSpotOwnerProspect): string => {
  const daysSinceContact = getDaysSince(prospect.lastContactAt ?? prospect.syncedAt);
  const stage = `${prospect.dealStageLabel ?? ""} ${prospect.dealStage ?? ""}`.toLowerCase();

  if (prospect.closeProbability >= 70) {
    return "Faire avancer le deal vers la prochaine etape";
  }

  if (stage.includes("demo")) {
    return "Confirmer les enjeux avant la demo";
  }

  if (stage.includes("contract") || stage.includes("negotiation")) {
    return "Lever les derniers blocages contractuels";
  }

  if (daysSinceContact >= 14) {
    return "Relancer le prospect avec un angle business clair";
  }

  return "Verifier le prochain pas HubSpot";
};

const getReason = (prospect: HubSpotOwnerProspect): string => {
  const daysSinceContact = getDaysSince(prospect.lastContactAt ?? prospect.syncedAt);
  const amount = prospect.dealAmount ?? 0;
  const dealName = prospect.dealName ?? prospect.hubspotDealId ?? "deal HubSpot";

  if (daysSinceContact >= 14 && amount > 0) {
    return `${dealName}: aucun contact depuis ${daysSinceContact} jours sur une opportunite de ${formatAmount(amount)}.`;
  }

  if (prospect.closeProbability >= 70) {
    return `${dealName}: probabilite HubSpot elevee (${prospect.closeProbability}%) et prochaine etape a securiser.`;
  }

  return `${dealName}: deal HubSpot synchronise, a qualifier avec les signaux disponibles dans le CRM.`;
};

const formatAmount = (amount: number): string =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(amount);

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
  nextAction: getNextAction(prospect),
  reason: getReason(prospect),
  priority: getPriority(prospect),
  email: prospect.email,
  phone: null,
  dealName: prospect.dealName,
  hubspotDealId: prospect.hubspotDealId,
});

export const fetchHubSpotStatus = async (orgId: string): Promise<HubSpotConnectionStatus> =>
  getJson<HubSpotConnectionStatus>(`/api/hubspot/status?orgId=${encodeURIComponent(orgId)}`);

export const fetchHubSpotOwners = async (orgId: string): Promise<HubSpotOwnerOption[]> =>
  getJson<HubSpotOwnerOption[]>(`/api/hubspot/owners?orgId=${encodeURIComponent(orgId)}`);

export const fetchHubSpotLastUpdates = async (orgId: string, limit = 12): Promise<HubSpotLastUpdateItem[]> => {
  const payload = await getJson<HubSpotLastUpdatesPayload>(
    `/api/hubspot/last-updates?orgId=${encodeURIComponent(orgId)}&limit=${encodeURIComponent(String(limit))}`,
  );

  return payload.updates;
};

export const fetchHubSpotQueue = async (
  orgId: string,
  preferredHubSpotOwnerId: string | null,
  live: boolean,
): Promise<HubSpotQueueData> => {
  const [status, owners, lastUpdates] = await Promise.all([
    fetchHubSpotStatus(orgId),
    fetchHubSpotOwners(orgId),
    fetchHubSpotLastUpdates(orgId),
  ]);

  if (!status.connected) {
    throw new Error("HubSpot n'est pas connecte pour cette organisation.");
  }

  if (owners.length === 0) {
    throw new Error("Aucun owner HubSpot disponible pour cette organisation.");
  }

  const owner =
    owners.find((candidate) => candidate.ownerId === preferredHubSpotOwnerId) ??
    owners.find(
      (candidate) =>
        candidate.teamName?.toLowerCase().includes("sales ae") &&
        (candidate.prospectCount > 0 || candidate.syncedDealCount > 0),
    ) ??
    owners.find((candidate) => candidate.prospectCount > 0 || candidate.syncedDealCount > 0) ??
    owners.find((candidate) => candidate.teamName?.toLowerCase().includes("sales ae")) ??
    owners[0];

  if (!owner) {
    throw new Error("Aucun owner HubSpot exploitable.");
  }

  const ownerProspectsPayload = await getJson<HubSpotOwnerProspectsPayload>(
    `/api/hubspot/owner-prospects?orgId=${encodeURIComponent(orgId)}&hubspotOwnerId=${encodeURIComponent(owner.ownerId)}&live=${String(live)}`,
  );
  const prospects = ownerProspectsPayload.prospects
    .map(toQueueProspect)
    .sort((left, right) => right.dealAmount - left.dealAmount);

  return {
    userId: owner.ownerId,
    generatedAt: status.lastSyncedAt ?? owner.lastSyncedAt ?? new Date().toISOString(),
    prospects,
    hubspotPortalId: status.hubspotPortalId,
    owner,
    owners,
    hubspotDealCount: ownerProspectsPayload.hubspotDealCount ?? owner.syncedDealCount,
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

  return currentJob.result;
};

export const disconnectHubSpot = async (orgId: string): Promise<HubSpotDisconnectResult> =>
  postJson<HubSpotDisconnectResult>("/api/hubspot/disconnect", { orgId, purgeData: true });

export const fetchDealIntelligence = async (
  prospect: QueueProspect,
  orgId: string,
  aiProvider: AiProviderOption,
  refresh = false,
): Promise<DealIntelligenceResult> => {
  const searchParams = new URLSearchParams({
    orgId,
    llmProvider: aiProvider.id,
    llmModel: aiProvider.model,
    refresh: String(refresh),
  });

  if (prospect.hubspotDealId) {
    searchParams.set("hubspotDealId", prospect.hubspotDealId);
  }

  searchParams.set("closeProbability", String(prospect.closeProbability));
  searchParams.set("dealAmount", String(prospect.dealAmount));
  searchParams.set("dealStage", prospect.dealStage);
  searchParams.set("lastContactAt", prospect.lastContactAt);
  searchParams.set("nextAction", prospect.nextAction);

  return getJson<DealIntelligenceResult>(
    `/api/prospects/${encodeURIComponent(prospect.id)}/deal-intelligence?${searchParams.toString()}`,
  );
};

const buildDealAnalysisSearchParams = (
  prospect: QueueProspect,
  orgId: string,
  aiProvider: AiProviderOption,
  ownerName: string | undefined,
  refresh = false,
): URLSearchParams => {
  const searchParams = new URLSearchParams({
    orgId,
    llmProvider: aiProvider.id,
    llmModel: aiProvider.model,
    contactName: prospect.name,
    contactTitle: prospect.title,
    companyName: prospect.company,
    dealStage: prospect.dealStage,
    closeProbability: String(prospect.closeProbability),
    dealAmount: String(prospect.dealAmount),
    lastContactAt: prospect.lastContactAt,
    nextAction: prospect.nextAction,
    refresh: String(refresh),
  });

  if (prospect.hubspotDealId) {
    searchParams.set("hubspotDealId", prospect.hubspotDealId);
  }

  if (prospect.closeDate) {
    searchParams.set("closeDate", prospect.closeDate);
  }

  if (prospect.email) {
    searchParams.set("contactEmail", prospect.email);
  }

  if (prospect.phone) {
    searchParams.set("contactPhone", prospect.phone);
  }

  if (ownerName) {
    searchParams.set("ownerName", ownerName);
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
  const searchParams = new URLSearchParams({
    orgId,
    llmProvider: aiProvider.id,
    llmModel: aiProvider.model,
    contactName: prospect.name,
    contactTitle: prospect.title,
    companyName: prospect.company,
    dealStage: prospect.dealStage,
    closeProbability: String(prospect.closeProbability),
    dealAmount: String(prospect.dealAmount),
    lastContactAt: prospect.lastContactAt,
    nextAction: prospect.nextAction,
    refresh: String(refresh),
  });

  if (prospect.hubspotDealId) {
    searchParams.set("hubspotDealId", prospect.hubspotDealId);
  }

  if (prospect.closeDate) {
    searchParams.set("closeDate", prospect.closeDate);
  }

  if (prospect.email) {
    searchParams.set("contactEmail", prospect.email);
  }

  if (prospect.phone) {
    searchParams.set("contactPhone", prospect.phone);
  }

  if (ownerName) {
    searchParams.set("ownerName", ownerName);
  }

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
  const searchParams = new URLSearchParams({
    orgId,
    llmProvider: aiProvider.id,
    llmModel: aiProvider.model,
    contactName: prospect.name,
    contactTitle: prospect.title,
    companyName: prospect.company,
    dealStage: prospect.dealStage,
    closeProbability: String(prospect.closeProbability),
    dealAmount: String(prospect.dealAmount),
    lastContactAt: prospect.lastContactAt,
    nextAction: prospect.nextAction,
    refresh: String(refresh),
  });

  if (prospect.hubspotDealId) {
    searchParams.set("hubspotDealId", prospect.hubspotDealId);
  }

  if (prospect.closeDate) {
    searchParams.set("closeDate", prospect.closeDate);
  }

  if (prospect.email) {
    searchParams.set("contactEmail", prospect.email);
  }

  if (prospect.phone) {
    searchParams.set("contactPhone", prospect.phone);
  }

  if (ownerName) {
    searchParams.set("ownerName", ownerName);
  }

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
}: {
  orgId: string;
  scope: CloseLostScope;
  hubspotOwnerId: string | null;
  salesAeOwnerIds: string[];
  dateFrom: string;
  dateTo: string;
  aiProvider: AiProviderOption;
}): Promise<CloseLostOverviewResult> => {
  const searchParams = new URLSearchParams({
    orgId,
    scope,
    dateFrom,
    dateTo,
    llmProvider: aiProvider.id,
    llmModel: aiProvider.model,
  });

  if (hubspotOwnerId) {
    searchParams.set("hubspotOwnerId", hubspotOwnerId);
  }

  if (salesAeOwnerIds.length > 0) {
    searchParams.set("salesAeOwnerIds", salesAeOwnerIds.join(","));
  }

  return getJson<CloseLostOverviewResult>(`/api/close-lost-analysis/overview?${searchParams.toString()}`);
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
  });

export const fetchCloseLostAnalysisRun = async (runId: string): Promise<CloseLostAnalysisRun> =>
  getJson<CloseLostAnalysisRun>(`/api/close-lost-analysis/runs/${encodeURIComponent(runId)}`);

export const fetchCloseLostDealDetail = async (
  orgId: string,
  hubspotDealId: string,
  aiProvider: AiProviderOption,
): Promise<CloseLostDealDetailResult> => {
  const searchParams = new URLSearchParams({
    orgId,
    llmProvider: aiProvider.id,
    llmModel: aiProvider.model,
  });

  return getJson<CloseLostDealDetailResult>(
    `/api/close-lost-analysis/deals/${encodeURIComponent(hubspotDealId)}?${searchParams.toString()}`,
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
  });

export const fetchForecastOverview = async ({
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
}): Promise<ForecastOverviewResult> => {
  const searchParams = new URLSearchParams({
    orgId,
    scope,
    dateFrom,
    dateTo,
    llmProvider: aiProvider.id,
    llmModel: aiProvider.model,
  });

  if (hubspotOwnerId) {
    searchParams.set("hubspotOwnerId", hubspotOwnerId);
  }

  return getJson<ForecastOverviewResult>(`/api/forecast/overview?${searchParams.toString()}`);
};

export const analyzeForecastOpenDeals = async ({
  orgId,
  scope,
  hubspotOwnerId,
  dateFrom,
  dateTo,
  aiProvider,
  refresh,
  batchSize = 5,
  retryFailedCount = 2,
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
}): Promise<ForecastAnalyzeResult> =>
  postJson<ForecastAnalyzeResult>("/api/forecast/analyze-open-deals", {
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
  });

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
  });

export const fetchMonthlySalesTargets = async (orgId: string, year: number): Promise<MonthlySalesTarget[]> =>
  getJson<MonthlySalesTarget[]>(`/api/forecast/targets?orgId=${encodeURIComponent(orgId)}&year=${encodeURIComponent(String(year))}`);

export const saveMonthlySalesTargets = async (
  orgId: string,
  targets: MonthlySalesTargetInput[],
): Promise<MonthlySalesTarget[]> =>
  postJson<MonthlySalesTarget[]>("/api/forecast/targets", {
    orgId,
    targets,
  });
