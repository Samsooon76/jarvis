export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type JsonObject = {
  [key: string]: JsonValue;
};

export type ProspectPriority = "urgent" | "important" | "routine";

export type QueueProspect = {
  id: string;
  name: string;
  title: string;
  company: string;
  dealAmount: number;
  dealStage: string;
  closeProbability: number;
  closeDate: string | null;
  lastContactAt: string;
  nextAction: string;
  reason: string;
  priority: ProspectPriority;
  email?: string | null;
  phone?: string | null;
  dealName?: string | null;
  hubspotDealId?: string | null;
};

export type QueueData = {
  userId: string;
  generatedAt: string;
  prospects: QueueProspect[];
};

export type CallSentiment = "positive" | "neutral" | "negative";

export type CallRiskLevel = "low" | "medium" | "high";

export type CallAnalysisConfidence = "low" | "medium" | "high";

export type CallAiActionItem = {
  title: string;
  owner: "sales" | "customer" | "manager" | "unknown";
  dueInDays: number | null;
  priority: "low" | "medium" | "high";
};

export type CallAiAnalysis = {
  summary: string;
  sentiment: CallSentiment;
  objections: string[];
  nextSteps: CallAiActionItem[];
  risks: string[];
  opportunities: string[];
  coachingTips: string[];
  customerSignals: string[];
  closeProbabilityDelta: number;
  riskLevel: CallRiskLevel;
  confidence: CallAnalysisConfidence;
};

export type CallDirection = "inbound" | "outbound";

export type CallPeriod = "7d" | "30d" | "90d" | "all";

export type CallAnalysisListItem = {
  callId: string;
  orgId: string;
  userId: string | null;
  prospectId: string | null;
  contactName: string | null;
  companyName: string | null;
  ownerName: string | null;
  direction: CallDirection;
  status: string | null;
  startedAt: string | null;
  durationSeconds: number | null;
  // Nombre d'entrees HubSpot fusionnees dans cette carte (Onoff + Modjo loggent le meme appel).
  mergedCallCount: number;
  sourceKind: "transcript" | "notes" | "summary" | null;
  analyzedAt: string | null;
  provider: string | null;
  model: string | null;
  summary: string | null;
  sentiment: CallSentiment | null;
  riskLevel: CallRiskLevel | null;
  confidence: CallAnalysisConfidence | null;
};

export type CallAnalysisDetail = CallAnalysisListItem & {
  analysis: CallAiAnalysis | null;
  // Contenu source complet (transcript ou notes HubSpot nettoyees du HTML).
  sourceText: string | null;
  cached: boolean;
};

export type CallInsightSummary = {
  orgId: string;
  generatedAt: string;
  // Volumes calcules sur la table calls (periode demandee), independants des analyses.
  totalCalls: number;
  connectedCalls: number;
  averageDurationSeconds: number;
  totalAnalyzed: number;
  sentiment: Record<CallSentiment, number>;
  riskLevel: Record<CallRiskLevel, number>;
  topObjections: Array<{ label: string; count: number }>;
  topCoachingTips: Array<{ label: string; count: number }>;
};

export type PulseEventType =
  | "deal_created"
  | "probability"
  | "amount"
  | "stage"
  | "close_date"
  | "owner"
  | "pipeline"
  | "playbook_suggestion";

export type PulseNotification = {
  id: string;
  eventType: PulseEventType;
  hubspotDealId: string;
  dealName: string | null;
  title: string;
  message: string;
  previousValue: string | null;
  newValue: string | null;
  occurredAt: string;
  readAt: string | null;
  createdAt: string;
};

export type PulseNotificationList = {
  notifications: PulseNotification[];
  unreadCount: number;
};

export type PulseEventPreferences = Record<PulseEventType, boolean>;

export type PulsePreferences = {
  pulseEnabled: boolean;
  events: PulseEventPreferences;
};

export type AppUserRole = "sales" | "manager" | "admin";

export type OrgUser = {
  id: string;
  name: string;
  email: string;
  role: AppUserRole;
  hubspotOwnerId: string | null;
  authUserId: string | null;
  createdAt: string;
};

export type ManagerDigestPeriod = "daily" | "weekly";

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

export type ManagerDigest = {
  id: string | null;
  period: ManagerDigestPeriod;
  dateFrom: string;
  dateTo: string;
  generatedAt: string;
  provider: string;
  model: string;
  // true quand la derniere synthese forecast utilisee comme source est perimee.
  stale: boolean;
  movementCount: number;
  movements: string[];
  digest: ManagerDigestAnalysis;
};

export type ManagerDigestHistoryEntry = {
  id: string;
  period: ManagerDigestPeriod;
  dateFrom: string;
  dateTo: string;
  generatedAt: string;
  headline: string;
};

export type RepCoachingTrend = "improving" | "stable" | "declining";

export type RepCoachingEvidenceSource = {
  activityId: string;
  type: "deal" | "note" | "call" | "meeting" | "email" | "sms" | "communication" | "task";
  channel: string | null;
  occurredAt: string | null;
  title: string;
  quote: string;
};

export type RepCoachingSourceDeal = {
  hubspotDealId: string;
  dealName: string;
  amount: number;
  stage: string;
  status: "open" | "won" | "lost";
  closedAt: string | null;
  evidenceSources: RepCoachingEvidenceSource[];
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
  trend: RepCoachingTrend;
  confidence: "low" | "medium" | "high";
};

export type RepCoachingFunnelStage = {
  stage: string;
  openCount: number;
  openAmount: number;
  lostCount: number;
  wonCount: number;
  sourceDeals: RepCoachingSourceDeal[];
};

export type RepCoachingStats = {
  dateFrom: string;
  dateTo: string;
  closedWonCount: number;
  closedLostCount: number;
  closedCount: number;
  winRate: number | null;
  avgWonAmount: number | null;
  avgSalesCycleDays: number | null;
  openDealCount: number;
  openPipelineAmount: number;
  funnel: RepCoachingFunnelStage[];
  lossReasons: Array<{ category: string; count: number; sourceDeals: RepCoachingSourceDeal[] }>;
  topRiskSignals: Array<{ title: string; count: number; sourceDeals: RepCoachingSourceDeal[] }>;
  topObjections: Array<{ objection: string; count: number }>;
  activity: {
    callsMade: number;
    emailsSent: number;
    meetingsBooked: number;
    dealsMoved: number;
  };
  teamMedian: {
    winRate: number | null;
    callsMade: number;
    emailsSent: number;
    meetingsBooked: number;
  };
  forecastVerdicts: Array<{ category: string; count: number }>;
};

export type RepCoachingStatus = "ready" | "insufficient_data";

export type RepCoaching = {
  userId: string;
  repName: string;
  status: RepCoachingStatus;
  stats: RepCoachingStats;
  analysis: RepCoachingAnalysis | null;
  generatedAt: string | null;
  provider: string | null;
  model: string | null;
  cached: boolean;
};

export type TeamCoachingCardStatus = "ready" | "pending";

export type TeamCoachingCard = {
  userId: string;
  repName: string;
  status: TeamCoachingCardStatus;
  headline: string | null;
  trend: RepCoachingTrend | null;
  confidence: "low" | "medium" | "high" | null;
  winRate: number | null;
  closedWonCount: number;
  closedLostCount: number;
  openDealCount: number;
  generatedAt: string | null;
};

export type TeamCoachingRunResult = {
  processed: number;
  reused: number;
  skipped: number;
  failed: number;
};

export type TeamCoachingJobLog = {
  at: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
};

export type TeamCoachingJobSnapshot = {
  jobId: string;
  orgId: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  currentStep: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  logs: TeamCoachingJobLog[];
  result: TeamCoachingRunResult | null;
  error: string | null;
};

export type ForecastAccuracySource = "crm" | "ai";

export type ForecastAccuracyRep = {
  userId: string | null;
  repName: string;
  resolvedCount: number;
  wonCount: number;
  // Montant classe "commit" par l'IA (snapshot de reference ~J-30) vs signe reel.
  committedAmount: number;
  realizedFromCommitAmount: number;
  realizedAmount: number;
  commitAccuracy: number | null;
  // Biais en %: positif = sur-commit, negatif = sous-commit.
  biasPct: number | null;
  // Part des deals dont la close date a glisse au moins une fois.
  slippageRate: number | null;
  slippedDealCount: number;
  trackedDealCount: number;
  // < 10 deals resolus: pourcentage non significatif.
  lowConfidence: boolean;
};

export type ForecastAccuracyCategory = {
  category: "commit" | "bestCase" | "atRisk" | "slipping";
  resolvedCount: number;
  wonCount: number;
  closeRate: number | null;
};

export type ForecastCalibrationBucket = {
  // Borne basse du bucket de probabilite (0, 10, ..., 90).
  bucket: number;
  dealCount: number;
  observedWinRate: number | null;
};

export type ForecastAccuracyOverview = {
  dateFrom: string;
  dateTo: string;
  snapshotCount: number;
  resolvedDealCount: number;
  overallCommitAccuracy: number | null;
  overallBiasPct: number | null;
  lowConfidence: boolean;
  reps: ForecastAccuracyRep[];
  categories: ForecastAccuracyCategory[];
  calibration: {
    crm: ForecastCalibrationBucket[];
    ai: ForecastCalibrationBucket[];
  };
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
  recommendations: Array<{ title: string; rationale: string; priority: "low" | "medium" | "high" }>;
  confidence: "low" | "medium" | "high";
};

export type WinAnalysisRunLog = {
  at: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
};

export type WinAnalysisRun = {
  id: string;
  orgId: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  currentStep: string;
  logs: WinAnalysisRunLog[];
  dealCount: number;
  analyzedCount: number;
  reusedCount: number;
  failedCount: number;
  dateFrom: string;
  dateTo: string;
  result: CloseWonPortfolioAnalysis | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type WinAnalysisDealListItem = {
  hubspotDealId: string;
  dealName: string | null;
  companyName: string;
  ownerName: string | null;
  amount: number;
  closedAt: string | null;
  analyzed: boolean;
  primaryWinFactor: string | null;
  winFactorCategory: CloseWonFactorCategory | null;
  confidence: "low" | "medium" | "high" | null;
};

export type WinBenchmarkMetrics = {
  avgCalls: number | null;
  avgEmails: number | null;
  avgTouchpoints: number | null;
  avgCycleDays: number | null;
  medianAmount: number | null;
};

export type WinBenchmark = {
  segment: string;
  dateFrom: string;
  dateTo: string;
  sampleSize: number;
  metrics: WinBenchmarkMetrics;
  computedAt: string;
};

export type WinBenchmarkGap = {
  metric: "calls" | "emails" | "touchpoints" | "cycleDays";
  label: string;
  actual: number;
  benchmark: number;
};

export type WinBenchmarkComparison = {
  hubspotDealId: string;
  segment: string;
  sampleSize: number;
  // false quand le benchmark n'a pas assez de wins (<10) pour etre fiable.
  reliable: boolean;
  gaps: WinBenchmarkGap[];
};

export type PlaybookPlayCategory =
  | "qualification"
  | "discovery"
  | "demo"
  | "objection_handling"
  | "negotiation"
  | "closing"
  | "follow_up";

export const PLAYBOOK_PLAY_CATEGORIES: PlaybookPlayCategory[] = [
  "qualification",
  "discovery",
  "demo",
  "objection_handling",
  "negotiation",
  "closing",
  "follow_up",
];

export type PlaybookPlayStatus = "draft" | "active" | "archived";

export type PlaybookPlaySource = "manual" | "ai_suggested";

export type PlaybookEvidenceKind = "call" | "deal" | "analysis";

export type PlaybookPlayEvidence = {
  id: string;
  kind: PlaybookEvidenceKind;
  refId: string;
  note: string | null;
  createdAt: string;
};

export type PlaybookPlay = {
  id: string;
  playbookId: string;
  category: PlaybookPlayCategory;
  title: string;
  // "Quand le prospect dit/fait X" — le declencheur du play.
  triggerDescription: string;
  recommendedResponse: string;
  status: PlaybookPlayStatus;
  source: PlaybookPlaySource;
  position: number;
  version: number;
  evidence: PlaybookPlayEvidence[];
  createdAt: string;
  updatedAt: string;
};

export type PlaybookStatus = "active" | "archived";

export type PlaybookOverviewStage = {
  category: PlaybookPlayCategory;
  objective: string;
  exitCriteria: string;
  playIds: string[];
};

export type PlaybookOverviewSnapshot = {
  playId: string;
  version: number;
};

export type PlaybookOverview = {
  doctrine: string;
  idealSequence: string[];
  stages: PlaybookOverviewStage[];
  principles: string[];
  gaps: string[];
  confidence: "low" | "medium" | "high";
  synthesizedAt: string;
  sourceSnapshot: PlaybookOverviewSnapshot[];
};

export type Playbook = {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  overview: PlaybookOverview | null;
  overviewIsStale: boolean;
  status: PlaybookStatus;
  createdBy: string | null;
  playCount: number;
  activePlayCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PlaybookDetail = Playbook & {
  plays: PlaybookPlay[];
};

export type PlaybookOverviewResult = {
  playbook: PlaybookDetail;
  overview: PlaybookOverview;
};

export const isPlaybookOverviewStale = (
  overview: PlaybookOverview | null,
  plays: PlaybookPlay[],
): boolean => {
  if (!overview) {
    return true;
  }

  const activePlays = plays.filter((play) => play.status === "active");
  const sourcePlays = activePlays.length > 0 ? activePlays : plays.filter((play) => play.status !== "archived");
  const currentSnapshot = sourcePlays
    .map((play) => ({ playId: play.id, version: play.version }))
    .sort((left, right) => left.playId.localeCompare(right.playId));
  const storedSnapshot = [...overview.sourceSnapshot].sort((left, right) => left.playId.localeCompare(right.playId));

  if (currentSnapshot.length !== storedSnapshot.length) {
    return true;
  }

  return currentSnapshot.some(
    (entry, index) =>
      entry.playId !== storedSnapshot[index]?.playId || entry.version !== storedSnapshot[index]?.version,
  );
};

export type PlaybookPlayInput = {
  category: PlaybookPlayCategory;
  title: string;
  triggerDescription: string;
  recommendedResponse: string;
  status?: PlaybookPlayStatus;
  evidence?: Array<{ kind: PlaybookEvidenceKind; refId: string; note?: string | null }>;
};

export type PlaybookDistributionContext = {
  orgId: string;
  playbookId: string | null;
  prospectId: string | null;
  hubspotDealId: string | null;
  dealStage: string | null;
  dealName: string | null;
  prospectName: string | null;
  company: string | null;
  matchedText: string;
};

export type DistributedPlaybookPlay = PlaybookPlay & {
  relevanceScore: number;
  matchReasons: string[];
};

export type PlaybookDistribution = {
  generatedAt: string;
  context: PlaybookDistributionContext;
  plays: DistributedPlaybookPlay[];
};

export type PlaybookSuggestionKind = "new_play" | "update_play" | "retire_play";

export type PlaybookSuggestionStatus = "pending" | "accepted" | "rejected";

export type PlaybookSuggestion = {
  id: string;
  orgId: string;
  playbookId: string;
  kind: PlaybookSuggestionKind;
  category: PlaybookPlayCategory;
  title: string;
  triggerDescription: string;
  recommendedResponse: string;
  payload: JsonObject;
  rationale: string;
  evidence: Array<{ title: string; sourceId: string; quote?: string | null }>;
  status: PlaybookSuggestionStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
};

export type PlaybookSuggestionGenerationResult = {
  generatedCount: number;
  suggestions: PlaybookSuggestion[];
};

export type PlaybookBootstrapResult = {
  playbook: PlaybookDetail;
  analyzedDealCount: number;
  reusedAnalysisCount: number;
  generatedPlayCount: number;
  confidence: "low" | "medium" | "high";
};

export type PlaybookBootstrapReadiness = {
  wonDealCount: number;
  minDealCount: number;
  recommendedDealCount: number;
  canBootstrap: boolean;
  hasPlaybook: boolean;
  playbookIsEmpty: boolean;
  playCount: number;
  activePlayCount: number;
  draftPlayCount: number;
  replacesDrafts: boolean;
  teamOwnerCount: number;
  teamDealCount: number;
  teamOwnerNames: string[];
  blockingReason: string | null;
};

export type PlaybookDriftRunResult = {
  playbookId: string;
  scannedPlayCount: number;
  evidenceCount: number;
  candidateCount: number;
  generatedCount: number;
  skippedCooldownCount: number;
  suggestions: PlaybookSuggestion[];
};

export type PlaybookAdherencePlayResult = {
  playId: string;
  title: string;
  category: PlaybookPlayCategory;
  triggerMatched: boolean;
  responseMatched: boolean;
  triggerKeywords: string[];
  responseKeywords: string[];
  evidenceSnippets: string[];
  status: "matched" | "missing_opportunity" | "no_signal";
};

export type PlaybookAdherenceResult = {
  id: string | null;
  orgId: string;
  playbookId: string;
  callId: string;
  score: number;
  scannedPlayCount: number;
  matchedPlayCount: number;
  missingOpportunityCount: number;
  matchedPlays: PlaybookAdherencePlayResult[];
  missingOpportunities: PlaybookAdherencePlayResult[];
  generatedAt: string;
};

export type PlaybookSuggestionList = {
  suggestions: PlaybookSuggestion[];
};

export type PlaybookSuggestionResolution = {
  suggestion: PlaybookSuggestion;
};

export type PlaybookSuggestionListResponse = ApiResponse<PlaybookSuggestionList>;

export type PlaybookSuggestionResponse = ApiResponse<PlaybookSuggestion>;

export type PlaybookSuggestionResolutionResponse = ApiResponse<PlaybookSuggestionResolution>;

export type WinAnalysisOverview = {
  orgId: string;
  dateFrom: string;
  dateTo: string;
  generatedAt: string;
  wonDealCount: number;
  wonValue: number;
  averageWin: number;
  analyzedCount: number;
  needsAnalysisCount: number;
  deals: WinAnalysisDealListItem[];
  winFactors: Array<{ id: string; label: string; dealCount: number; wonValue: number; share: number }>;
  lastRun: WinAnalysisRun | null;
  portfolio: CloseWonPortfolioAnalysis | null;
  benchmarks: WinBenchmark[];
};

export type AskJarvisRequest = {
  question: string;
  orgId: string;
  prospectId?: string | null;
  hubspotDealId?: string | null;
  userId?: string | null;
  includeQueue?: boolean;
  llmProvider?: string | null;
  llmModel?: string | null;
};

export type AskJarvisResult = {
  answer: string;
  confidence: "low" | "medium" | "high";
  sources: string[];
  contextSummary: string;
  provider: string;
  model: string;
  generatedAt: string;
};

export type OrganizationMcpKeyStatus = "active" | "revoked";

export type OrganizationMcpKey = {
  id: string;
  label: string;
  tokenPrefix: string;
  createdByUserId: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  status: OrganizationMcpKeyStatus;
};

export type CreateOrganizationMcpKeyResult = {
  key: OrganizationMcpKey;
  token: string;
};

export type McpSetupInfo = {
  mcpHttpUrl: string;
  orgId: string;
};

export type {
  DealAnalysisV1,
  DealAnalysisActionPlan,
  DealAnalysisActivitySignals,
  DealAnalysisBenchmarkGap,
  DealAnalysisCacheMeta,
  DealAnalysisClosedLostExtension,
  DealAnalysisClosedWonExtension,
  DealAnalysisCompany,
  DealAnalysisConfidence,
  DealAnalysisDataQuality,
  DealAnalysisEvidenceRef,
  DealAnalysisForecast,
  DealAnalysisIdentifiers,
  DealAnalysisLifecycleExtension,
  DealAnalysisMeddiccCriterion,
  DealAnalysisMeddiccCriterionId,
  DealAnalysisMetadata,
  DealAnalysisOverview,
  DealAnalysisPriority,
  DealAnalysisQualification,
  DealAnalysisSeverity,
  DealAnalysisSignal,
  DealAnalysisStakeholder,
  DealAnalysisTimeline,
  DealAnalysisType,
  DealLifecycleStatus,
} from "./deal-analysis-v1.js";
