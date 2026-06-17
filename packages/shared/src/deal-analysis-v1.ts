// DealAnalysisV1 — contrat JSON unifie pour les analyses deal Jarvis.
// 11 blocs ordonnes : identifiers → metadata → overview → stakeholders → signals
// → MEDDICC → activity → forecast → action_plan → lifecycle → data_quality.

export type DealAnalysisConfidence = "low" | "medium" | "high";

export type DealAnalysisSeverity = "low" | "medium" | "high";

export type DealAnalysisPriority = "low" | "medium" | "high";

export type DealAnalysisFieldStatus = "confirmed" | "partial" | "assumed" | "unclear" | "missing";

export type DealLifecycleStatus = "open" | "won" | "lost";

export type DealAnalysisType = "deal_full" | "close_lost" | "close_won";

// --- 1. identifiers ---------------------------------------------------------

export type DealAnalysisIdentifiers = {
  hubspotDealId: string;
  orgId: string;
  hubspotOwnerId: string | null;
  primaryContactId: string | null;
  primaryCompanyId: string | null;
  prospectId: string | null;
};

// --- 2. metadata / cache ----------------------------------------------------

export type DealAnalysisCacheMeta = {
  inputHash: string;
  sourceSyncedAt: string | null;
  analysisType: DealAnalysisType;
  lifecycleStatus: DealLifecycleStatus;
};

export type DealAnalysisMetadata = {
  generatedAt: string;
  lastUpdated: string;
  modelUsed: string;
  provider: string;
  analysisVersion: "1.0";
  cache: DealAnalysisCacheMeta;
  confidence: DealAnalysisConfidence;
};

// --- 3. company / deal overview ---------------------------------------------

export type DealAnalysisCompany = {
  name: string | null;
  industry: string | null;
  size: string | null;
  country: string | null;
  currentTools: string[];
  crmUrl: string | null;
};

export type DealAnalysisOverview = {
  summary: string;
  stage: string | null;
  pipeline: string | null;
  amount: number | null;
  currency: string;
  expectedCloseDate: string | null;
  closingProbability: number | null;
  confidenceLevel: DealAnalysisConfidence;
  dealHealth: "strong" | "medium" | "at_risk" | "blocked" | "unknown";
  executiveSummary: string;
  whyNow: string | null;
  mainObjective: string | null;
  businessImpact: string | null;
  urgencyLevel: DealAnalysisSeverity;
  strategicImportance: string | null;
};

// --- 4. stakeholders --------------------------------------------------------

export type DealAnalysisBuyerRole =
  | "decision_maker"
  | "champion"
  | "blocker"
  | "influencer"
  | "user"
  | "economic_buyer"
  | "unknown";

export type DealAnalysisSentiment = "positive" | "neutral" | "negative" | "unknown";

export type DealAnalysisStakeholder = {
  name: string;
  role: string | null;
  influenceLevel: DealAnalysisSeverity;
  sentiment: DealAnalysisSentiment;
  buyerRole: DealAnalysisBuyerRole;
  mainConcerns: string[];
  evidence: DealAnalysisEvidenceRef[];
};

export type DealAnalysisMultiThreading = {
  status: "single_threaded" | "partial" | "multi_threaded" | "unknown";
  contactedRoles: string[];
  missingRoles: string[];
  evidence: DealAnalysisEvidenceRef[];
};

// --- 5. signals[] -----------------------------------------------------------

export type DealAnalysisSignalKind = "pain" | "risk" | "objection" | "opportunity";

export type DealAnalysisSignalStatus = "active" | "resolved" | "handled" | "monitoring" | "unclear";

export type DealAnalysisObjectionType =
  | "price"
  | "product"
  | "timing"
  | "trust"
  | "competitor"
  | "technical"
  | "security"
  | "other";

export type DealAnalysisEvidenceActivityType =
  | "call"
  | "email"
  | "note"
  | "meeting"
  | "sms"
  | "communication"
  | "task"
  | "deal"
  | "crm_field"
  | "transcript";

export type DealAnalysisEvidenceRef = {
  activityId: string | null;
  activityType: DealAnalysisEvidenceActivityType;
  occurredAt: string | null;
  title: string | null;
  quote: string;
  confidence: DealAnalysisConfidence;
};

export type DealAnalysisSignal = {
  id: string;
  kind: DealAnalysisSignalKind;
  title: string;
  severity: DealAnalysisSeverity;
  status: DealAnalysisSignalStatus;
  objectionType: DealAnalysisObjectionType | null;
  businessImpact: string | null;
  responseGiven: string | null;
  remainingConcern: string | null;
  evidence: DealAnalysisEvidenceRef[];
  lastUpdated: string | null;
};

// --- 6. qualification MEDDICC -----------------------------------------------

export type DealAnalysisMeddiccCriterionId =
  | "metrics"
  | "economicBuyer"
  | "decisionCriteria"
  | "decisionProcess"
  | "paperProcess"
  | "identifyPain"
  | "champion"
  | "competition";

export type DealAnalysisMeddiccCriterion = {
  id: DealAnalysisMeddiccCriterionId;
  label: string;
  status: DealAnalysisFieldStatus;
  score: number;
  evidence: DealAnalysisEvidenceRef[];
  gap: string | null;
};

export type DealAnalysisDecisionProcess = {
  status: "clear" | "partial" | "unclear";
  decisionMakers: string[];
  champions: string[];
  blockers: string[];
  influencers: string[];
  approvalSteps: string[];
  legalProcurementRequired: boolean;
  technicalValidationRequired: boolean;
  legalStatus: "approved" | "in_review" | "blocked" | "unknown";
  purchaseProcess: "clear" | "to_confirm" | "blocked" | "unknown";
  timeline: string | null;
  evidence: DealAnalysisEvidenceRef[];
};

export type DealAnalysisBudget = {
  status: DealAnalysisFieldStatus;
  amount: number | null;
  currency: string;
  budgetOwner: string | null;
  pricingSensitivity: DealAnalysisSeverity | "unknown";
  evidence: DealAnalysisEvidenceRef[];
};

export type DealAnalysisCompetition = {
  status: "none" | "suspected" | "confirmed" | "unknown";
  competitors: string[];
  currentSolution: string | null;
  competitiveRisks: string[];
  positioningAngle: string | null;
  evidence: DealAnalysisEvidenceRef[];
};

export type DealAnalysisProductFit = {
  fitScore: number | null;
  strongFitReasons: string[];
  weakFitReasons: string[];
  missingFeatures: string[];
  technicalConstraints: string[];
  integrationRequirements: string[];
  securityCompliance: string[];
  evidence: DealAnalysisEvidenceRef[];
};

export type DealAnalysisQualification = {
  meddicc: DealAnalysisMeddiccCriterion[];
  decisionProcess: DealAnalysisDecisionProcess;
  budget: DealAnalysisBudget;
  competition: DealAnalysisCompetition;
  productFit: DealAnalysisProductFit;
  multiThreading: DealAnalysisMultiThreading;
  confidence: DealAnalysisConfidence;
};

// --- 7. activity_signals ----------------------------------------------------

export type DealAnalysisEngagementTrend = "increasing" | "stable" | "decreasing" | "unknown";

export type DealAnalysisBenchmarkGap = {
  stage: string;
  metric: "calls" | "emails" | "meetings" | "touchpoints" | "days_in_stage";
  actual: number;
  benchmark: number;
  severity: DealAnalysisSeverity;
};

export type DealAnalysisActivitySignals = {
  lastTouchAt: string | null;
  daysSinceLastTouch: number | null;
  touchpointCount30d: number | null;
  callsCountByStage: Record<string, number>;
  emailsCountByStage: Record<string, number>;
  meetingsCountByStage: Record<string, number>;
  benchmarkGaps: DealAnalysisBenchmarkGap[];
  engagementTrend: DealAnalysisEngagementTrend;
  stageAgeDays: number | null;
};

// --- 8. forecast ------------------------------------------------------------

export type DealAnalysisForecastCategory = "commit" | "best_case" | "pipeline" | "at_risk" | "slipping" | "lost_risk";

export type DealAnalysisDealMomentum = "increasing" | "stable" | "decreasing" | "unknown";

export type DealAnalysisForecast = {
  forecastCategory: DealAnalysisForecastCategory;
  probability: number | null;
  mainPositiveSignals: string[];
  mainNegativeSignals: string[];
  dealMomentum: DealAnalysisDealMomentum;
  riskOfSlippage: DealAnalysisSeverity;
  reasoningSummary: string;
  confidence: DealAnalysisConfidence;
};

// --- 9. action_plan ---------------------------------------------------------

export type DealAnalysisActionOwner = "sales_rep" | "prospect" | "customer_success" | "product" | "legal" | "other";

export type DealAnalysisActionStatus = "pending" | "in_progress" | "completed" | "overdue";

export type DealAnalysisNextStep = {
  action: string;
  owner: DealAnalysisActionOwner;
  dueDate: string | null;
  priority: DealAnalysisPriority;
  status: DealAnalysisActionStatus;
  createCrmTask: boolean;
  evidence: DealAnalysisEvidenceRef[];
};

export type DealAnalysisMutualAction = {
  title: string;
  ownerName: string | null;
  dueDate: string | null;
  status: DealAnalysisActionStatus;
  priority: DealAnalysisPriority;
  rationale: string;
};

export type DealAnalysisDeadline = {
  title: string;
  date: string | null;
  timeWindow: string | null;
  ownerName: string | null;
  description: string;
};

export type DealAnalysisSalesStrategy = {
  recommendedAction: string;
  managerAdvice: string | null;
  bestAngle: string | null;
  whatToAvoid: string[];
  suggestedMessage: string | null;
  talkingPoints: string[];
};

export type DealAnalysisActionPlan = {
  nextSteps: DealAnalysisNextStep[];
  mutualActionPlan: DealAnalysisMutualAction[];
  upcomingDeadlines: DealAnalysisDeadline[];
  salesStrategy: DealAnalysisSalesStrategy;
};

// --- 10. lifecycle extensions -----------------------------------------------

export type DealAnalysisLossReasonCategory =
  | "pricing"
  | "timing"
  | "competition"
  | "product_gap"
  | "budget"
  | "authority"
  | "no_decision"
  | "other";

export type DealAnalysisReactivationAction = {
  title: string;
  timing: string;
  rationale: string;
};

export type DealAnalysisOpenExtension = {
  kind: "open";
};

export type DealAnalysisClosedLostExtension = {
  kind: "lost";
  primaryLossReason: string;
  secondaryLossReason: string | null;
  lossReasonCategory: DealAnalysisLossReasonCategory;
  whatHappened: string[];
  reactivationScore: number | null;
  reactivationRationale: string | null;
  reactivationPlaybook: DealAnalysisReactivationAction[];
};

export type DealAnalysisWinFactorCategory =
  | "champion"
  | "timing"
  | "product_fit"
  | "pricing"
  | "process"
  | "relationship"
  | "other";

export type DealAnalysisKeyMoment = {
  date: string | null;
  moment: string;
  stage: string | null;
  impact: "positive" | "neutral" | "negative";
  evidence: DealAnalysisEvidenceRef[];
};

export type DealAnalysisReplicablePlay = {
  play: string;
  when: string;
};

export type DealAnalysisClosedWonExtension = {
  kind: "won";
  primaryWinFactor: string;
  winFactorCategory: DealAnalysisWinFactorCategory;
  keyMoments: DealAnalysisKeyMoment[];
  replicablePlays: DealAnalysisReplicablePlay[];
};

export type DealAnalysisLifecycleExtension =
  | DealAnalysisOpenExtension
  | DealAnalysisClosedLostExtension
  | DealAnalysisClosedWonExtension;

// --- 11. data_quality -------------------------------------------------------

export type DealAnalysisDataQuality = {
  missingInformation: string[];
  uncertainAssumptions: string[];
  fieldsRequiringHumanReview: string[];
};

// --- root -------------------------------------------------------------------

export type DealAnalysisTimelineEvent = {
  date: string | null;
  event: string;
  impact: "positive" | "neutral" | "negative";
  evidence: DealAnalysisEvidenceRef[];
};

export type DealAnalysisTimeline = {
  firstContactDate: string | null;
  lastInteractionDate: string | null;
  keyEvents: DealAnalysisTimelineEvent[];
};

export type DealAnalysisV1 = {
  identifiers: DealAnalysisIdentifiers;
  metadata: DealAnalysisMetadata;
  company: DealAnalysisCompany;
  dealOverview: DealAnalysisOverview;
  stakeholders: DealAnalysisStakeholder[];
  signals: DealAnalysisSignal[];
  qualification: DealAnalysisQualification;
  activitySignals: DealAnalysisActivitySignals;
  forecast: DealAnalysisForecast;
  actionPlan: DealAnalysisActionPlan;
  lifecycle: DealAnalysisLifecycleExtension;
  timeline: DealAnalysisTimeline;
  dataQuality: DealAnalysisDataQuality;
};