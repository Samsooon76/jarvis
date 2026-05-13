export type DealHistoryAnalysis = {
  summary: string;
  risks: string[];
  nextActions: string[];
  confidence: "low" | "medium" | "high";
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

export type DealFullAnalysis = {
  intelligence: DealIntelligenceAnalysis;
  qualification: DealQualificationAnalysis;
  activityPlan: DealActivityPlanAnalysis;
};

export type CloseLostSignalSeverity = "low" | "medium" | "high";

export type CloseLostReasonCategory =
  | "pricing"
  | "timing"
  | "competition"
  | "product_gap"
  | "budget"
  | "authority"
  | "no_decision"
  | "other";

export type CloseLostRiskSignal = {
  title: string;
  severity: CloseLostSignalSeverity;
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
  lossReasonCategory: CloseLostReasonCategory;
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

export type AnalyzeDealHistoryInput = {
  history: string;
  companyName?: string | null;
  dealName?: string | null;
  companyContext?: string | null;
  dealContext?: string | null;
  objective?: string | null;
};

export type FollowUpTaskRecommendation = {
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

export type RecommendFollowUpTaskInput = {
  history: string;
  companyName?: string | null;
  dealName?: string | null;
  companyContext?: string | null;
  dealContext?: string | null;
  dealStage?: string | null;
  objective?: string | null;
  today?: string | null;
  lastContactAt?: string | null;
  nextAction?: string | null;
  contactNames?: string[];
};

export type AnalyzeDealIntelligenceInput = RecommendFollowUpTaskInput & {
  currentCloseProbability?: number | null;
  dealAmount?: number | null;
};

export type AnalyzeDealQualificationInput = AnalyzeDealIntelligenceInput & {
  closeDate?: string | null;
  ownerName?: string | null;
};

export type AnalyzeDealActivityPlanInput = AnalyzeDealQualificationInput & {
  crmActivitySummary?: string | null;
  pendingActionsSummary?: string | null;
  channelEngagementSummary?: string | null;
};

export type AnalyzeCloseLostDealInput = {
  history: string;
  companyName?: string | null;
  dealName?: string | null;
  companyContext?: string | null;
  dealContext?: string | null;
  dealStage?: string | null;
  dealAmount?: number | null;
  closedAt?: string | null;
  ownerName?: string | null;
  contactNames?: string[];
  today?: string | null;
};

export type AnalyzeCloseLostPortfolioInput = {
  dealsSummary: string;
  dateFrom: string;
  dateTo: string;
  scopeLabel: string;
  lostDealCount: number;
  totalLostValue: number;
  analyzedDealCount: number;
};

export interface LlmProvider {
  readonly providerName: string;
  readonly modelName: string;
  analyzeDealHistory(input: AnalyzeDealHistoryInput): Promise<DealHistoryAnalysis>;
  analyzeDealIntelligence(input: AnalyzeDealIntelligenceInput): Promise<DealIntelligenceAnalysis>;
  analyzeDealFull(input: AnalyzeDealActivityPlanInput): Promise<DealFullAnalysis>;
  analyzeDealQualification(input: AnalyzeDealQualificationInput): Promise<DealQualificationAnalysis>;
  analyzeDealActivityPlan(input: AnalyzeDealActivityPlanInput): Promise<DealActivityPlanAnalysis>;
  analyzeCloseLostDeal(input: AnalyzeCloseLostDealInput): Promise<CloseLostDealAnalysis>;
  analyzeCloseLostPortfolio(input: AnalyzeCloseLostPortfolioInput): Promise<CloseLostPortfolioAnalysis>;
  recommendFollowUpTask(input: RecommendFollowUpTaskInput): Promise<FollowUpTaskRecommendation>;
}
