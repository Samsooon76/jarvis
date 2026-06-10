export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
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

export type PulseEventType = "probability" | "amount" | "stage" | "close_date" | "owner" | "pipeline";

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
  lossReasons: Array<{ category: string; count: number }>;
  topRiskSignals: Array<{ title: string; count: number }>;
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
