import type { DealAnalysisType, DealAnalysisV1, DealLifecycleStatus, PlaybookPlayCategory } from "@jarvis/shared";

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

export type CloseLostEvidenceSource = {
  activityId: string;
  type: "deal" | "note" | "call" | "meeting" | "email" | "sms" | "communication" | "task";
  channel: string | null;
  occurredAt: string | null;
  title: string;
  quote: string;
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
  evidenceSources: CloseLostEvidenceSource[];
  confidence: "low" | "medium" | "high";
};

export type CloseWonFactorCategory =
  | "champion"
  | "timing"
  | "product_fit"
  | "pricing"
  | "process"
  | "relationship"
  | "other";

export type CloseWonKeyMoment = {
  moment: string;
  stage: string | null;
  impact: string;
};

export type CloseWonReplicablePlay = {
  play: string;
  when: string;
};

export type CloseWonDealAnalysis = {
  summary: string;
  primaryWinFactor: string;
  winFactorCategory: CloseWonFactorCategory;
  keyMoments: CloseWonKeyMoment[];
  replicablePlays: CloseWonReplicablePlay[];
  confidence: "low" | "medium" | "high";
};

export type CloseWonPortfolioAnalysis = {
  keyInsight: string;
  executiveSummary: string;
  winningPatterns: string[];
  idealSequence: string[];
  recommendations: CloseLostPortfolioRecommendation[];
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

export type ForecastSynthesisCategory = "commit" | "bestCase" | "atRisk" | "slipping";

export type ForecastSynthesisDealVerdict = {
  hubspotDealId: string;
  category: ForecastSynthesisCategory;
  reason: string;
  recommendedAction: string | null;
};

export type ForecastSynthesisAction = {
  title: string;
  rationale: string;
  priority: "low" | "medium" | "high";
  relatedDealIds: string[];
};

export type ForecastSynthesisAnalysis = {
  headline: string;
  confidence: "low" | "medium" | "high";
  dealVerdicts: ForecastSynthesisDealVerdict[];
  actionPlan: ForecastSynthesisAction[];
};

export type ManagerDigestHighlightType = "win" | "risk" | "movement";

export type ManagerDigestHighlight = {
  type: ManagerDigestHighlightType;
  dealId: string | null;
  text: string;
};

export type ManagerDigestAtRiskDeal = {
  dealId: string;
  dealName: string;
  reason: string;
  suggestedAction: string;
};

export type ManagerDigestAssistDeal = {
  dealId: string;
  dealName: string;
  whyHelp: string;
  coachingHint: string;
};

export type ManagerDigestAnalysis = {
  headline: string;
  highlights: ManagerDigestHighlight[];
  atRiskDeals: ManagerDigestAtRiskDeal[];
  assistDeals: ManagerDigestAssistDeal[];
  teamPulse: string;
  confidence: "low" | "medium" | "high";
};

export type AnalyzeManagerDigestInput = {
  movementsSummary: string;
  atRiskSummary: string;
  kpisSummary: string;
  period: "daily" | "weekly";
  dateFrom: string;
  dateTo: string;
  teamScopeLabel: string;
  knownDealIds: string[];
};

export type RepCoachingStrength = {
  title: string;
  evidence: string;
};

export type RepCoachingWeakness = {
  title: string;
  evidence: string;
  stage: string | null;
};

export type RepCoachingLossPattern = {
  pattern: string;
  frequency: "rare" | "recurrent" | "systematic";
};

export type RepCoachingAction = {
  action: string;
  priority: "high" | "medium";
  expectedImpact: string;
};

export type RepCoachingAnalysis = {
  headline: string;
  strengths: RepCoachingStrength[];
  weaknesses: RepCoachingWeakness[];
  lossPatterns: RepCoachingLossPattern[];
  coachingActions: RepCoachingAction[];
  trend: "improving" | "stable" | "declining";
  confidence: "low" | "medium" | "high";
};

export type AnalyzeRepCoachingInput = {
  repName: string;
  statsSummary: string;
  lossPatternsSummary: string;
  forecastVerdictsSummary: string;
  teamBenchmarkSummary: string;
  dateFrom: string;
  dateTo: string;
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
  priority: "low" | "medium" | "high";
  shouldReschedule: boolean;
  suggestedDueInDays: number | null;
  suggestedAction: string;
  rationale: string;
  outreachAngle: string | null;
  evidence: string[];
  missingData: string[];
  confidence: "low" | "medium" | "high";
};

export type AnalyzeTaskInput = {
  taskTitle: string;
  taskBody?: string | null;
  taskStatus?: string | null;
  taskPriority?: string | null;
  taskType?: string | null;
  dueAt?: string | null;
  createdAt?: string | null;
  today?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  companyName?: string | null;
  dealName?: string | null;
  dealStage?: string | null;
  dealAmount?: number | null;
  closeProbability?: number | null;
  lastContactAt?: string | null;
  nextAction?: string | null;
  history?: string | null;
  winBenchmarkSummary?: string | null;
};

export type LeadContactRankingContactInput = {
  hubspotContactId: string;
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  lastActivityAt: string | null;
  lifecycleStage: string | null;
  leadStatus: string | null;
  deterministicScore: number;
  deterministicReason: string;
};

export type RankLeadContactsInput = {
  lead: {
    hubspotLeadId: string;
    name: string;
    companyName: string | null;
    pipelineLabel: string | null;
    phaseId: string | null;
    phaseLabel: string | null;
    lastActivityAt: string | null;
  };
  contacts: LeadContactRankingContactInput[];
  today?: string | null;
};

export type LeadContactRankingAnalysis = {
  contacts: Array<{
    hubspotContactId: string;
    aiScore: number;
    reason: string;
    recommendedAction: string;
    confidence: "low" | "medium" | "high";
  }>;
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

export type AnalyzeDealAnalysisV1Input = AnalyzeDealActivityPlanInput & {
  orgId: string;
  hubspotDealId: string;
  hubspotOwnerId?: string | null;
  primaryContactId?: string | null;
  primaryCompanyId?: string | null;
  prospectId?: string | null;
  pipeline?: string | null;
  lifecycleStatus: DealLifecycleStatus;
  companyIndustry?: string | null;
  activitySignalsSummary?: string | null;
  winBenchmarkSummary?: string | null;
  analysisType?: DealAnalysisType;
  inputHash?: string | null;
  sourceSyncedAt?: string | null;
  lightUserPrompt?: string | null;
};

export type AnalyzeCloseLostDealInput = {
  history: string;
  sourceActivities?: CloseLostEvidenceSource[];
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

export type AnalyzeCloseWonDealInput = AnalyzeCloseLostDealInput;

export type AnalyzeCloseWonPortfolioInput = {
  dealsSummary: string;
  dateFrom: string;
  dateTo: string;
  scopeLabel: string;
  wonDealCount: number;
  totalWonValue: number;
  analyzedDealCount: number;
};

export type PlaybookBootstrapPlay = {
  category: PlaybookPlayCategory;
  title: string;
  triggerDescription: string;
  recommendedResponse: string;
  sourceDealIds: string[];
};

export type PlaybookBootstrapAnalysis = {
  name: string;
  description: string;
  plays: PlaybookBootstrapPlay[];
  confidence: "low" | "medium" | "high";
};

export type AnalyzePlaybookBootstrapInput = {
  dealsSummary: string;
  portfolioSummary: string;
  analyzedDealCount: number;
  dateFrom: string;
  dateTo: string;
  knownDealIds: string[];
  keyInsight?: string;
  winningPatterns?: string[];
  idealSequence?: string[];
};

export type PlaybookOverviewAnalysis = {
  doctrine: string;
  idealSequence: string[];
  stages: Array<{
    category: PlaybookPlayCategory;
    objective: string;
    exitCriteria: string;
    playIds: string[];
  }>;
  principles: string[];
  gaps: string[];
  confidence: "low" | "medium" | "high";
};

export type AnalyzePlaybookOverviewInput = {
  playbookName: string;
  playbookDescription: string | null;
  playsSummary: string;
  playCount: number;
  activePlayCount: number;
  knownPlayIds: string[];
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

export type AnalyzeForecastSynthesisInput = {
  dealsSummary: string;
  knownDealIds: string[];
  dateFrom: string;
  dateTo: string;
  scopeLabel: string;
  openDealCount: number;
  totalOpenAmount: number;
  signedAmount: number;
  landingAmount: number;
  objectiveAmount: number | null;
  gapToObjective: number | null;
  today: string;
  // Boucle Win Analysis: 2-3 lignes de benchmark des deals gagnes (0 LLM),
  // injectees dans le prompt quand le benchmark est significatif.
  winBenchmarkSummary?: string | null;
};

export interface LlmProvider {
  readonly providerName: string;
  readonly modelName: string;
  analyzeDealHistory(input: AnalyzeDealHistoryInput): Promise<DealHistoryAnalysis>;
  analyzeDealIntelligence(input: AnalyzeDealIntelligenceInput): Promise<DealIntelligenceAnalysis>;
  analyzeDealFull(input: AnalyzeDealActivityPlanInput): Promise<DealFullAnalysis>;
  analyzeDealQualification(input: AnalyzeDealQualificationInput): Promise<DealQualificationAnalysis>;
  analyzeDealActivityPlan(input: AnalyzeDealActivityPlanInput): Promise<DealActivityPlanAnalysis>;
  analyzeDealAnalysisV1(input: AnalyzeDealAnalysisV1Input): Promise<DealAnalysisV1>;
  analyzeCloseLostDeal(input: AnalyzeCloseLostDealInput): Promise<CloseLostDealAnalysis>;
  analyzeCloseLostPortfolio(input: AnalyzeCloseLostPortfolioInput): Promise<CloseLostPortfolioAnalysis>;
  analyzeCloseWonDeal(input: AnalyzeCloseWonDealInput): Promise<CloseWonDealAnalysis>;
  analyzeCloseWonPortfolio(input: AnalyzeCloseWonPortfolioInput): Promise<CloseWonPortfolioAnalysis>;
  generatePlaybookBootstrap(input: AnalyzePlaybookBootstrapInput): Promise<PlaybookBootstrapAnalysis>;
  synthesizePlaybookOverview(input: AnalyzePlaybookOverviewInput): Promise<PlaybookOverviewAnalysis>;
  analyzeForecastSynthesis(input: AnalyzeForecastSynthesisInput): Promise<ForecastSynthesisAnalysis>;
  analyzeManagerDigest(input: AnalyzeManagerDigestInput): Promise<ManagerDigestAnalysis>;
  analyzeRepCoaching(input: AnalyzeRepCoachingInput): Promise<RepCoachingAnalysis>;
  recommendFollowUpTask(input: RecommendFollowUpTaskInput): Promise<FollowUpTaskRecommendation>;
  analyzeTask(input: AnalyzeTaskInput): Promise<TaskAnalysis>;
  rankLeadContacts(input: RankLeadContactsInput): Promise<LeadContactRankingAnalysis>;
}
