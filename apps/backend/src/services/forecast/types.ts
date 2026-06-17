import type { DealIntelligenceResult } from "../deal-intelligence.service.js";
import type {
  DealIntelligenceAnalysis,
  ForecastSynthesisAction,
  ForecastSynthesisCategory,
} from "../llm/llm.provider.js";

export type ForecastScope = "all" | "owner";
export type ForecastAnalysisStatus = "fresh" | "stale" | "missing" | "closed_won";
export type ForecastDealBucket = "signedPaymentPending" | "paymentReceived" | "openForecast";
export type ForecastDealStatus = ForecastDealBucket | "closedLost" | "excluded";
export type ForecastRiskSeverity = "low" | "medium" | "high";

export type ForecastOverviewOptions = {
  orgId: string;
  scope?: ForecastScope;
  hubspotOwnerId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  llmProvider?: string | null;
  llmModel?: string | null;
};

export type AnalyzeForecastOptions = ForecastOverviewOptions & {
  refresh?: boolean;
  limit?: number | null;
  batchSize?: number | null;
  retryFailedCount?: number | null;
  onProgress?: (event: ForecastAnalyzeProgressEvent) => void;
};

export type ForecastAnalyzeProgressEvent = {
  progress: number;
  step: string;
  level?: "info" | "success" | "warning" | "error";
  message?: string;
};

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
  severity: ForecastRiskSeverity;
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

export type ForecastSynthesisStatus = "fresh" | "stale";

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
  /** Deja signe + montant des deals classes "commit" par l'IA : ce que l'IA pense closer sur la periode. */
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

export type ForecastAnalyzeDealResult = {
  orgId: string;
  provider: string;
  model: string;
  hubspotDealId: string;
  cached: boolean;
  analysis: DealIntelligenceResult;
  overview: ForecastOverviewResult;
};

export type HubSpotDealRow = {
  hubspot_deal_id: string;
  hubspot_owner_id: string | null;
  primary_contact_id: string | null;
  primary_company_id: string | null;
  deal_name: string | null;
  amount: number | string | null;
  pipeline_label: string | null;
  deal_stage: string | null;
  deal_stage_label: string | null;
  deal_lifecycle_status: "pending" | "won" | "lost" | null;
  is_closed_deal: boolean | null;
  close_probability: number | string | null;
  closed_at: string | null;
  hubspot_updated_at: string | null;
  properties: unknown;
  synced_at: string;
};

export type HubSpotContactRow = {
  hubspot_contact_id: string;
  name: string;
  company_name: string | null;
};

export type HubSpotCompanyRow = {
  hubspot_company_id: string;
  name: string | null;
};

export type OwnerUserRow = {
  hubspot_owner_id: string | null;
  name: string;
};

export type DealAiAnalysisRow = {
  hubspot_deal_id: string;
  analysis: DealIntelligenceAnalysis;
  close_won_probability: number;
  generated_at: string;
  expires_at: string;
};

export type DealAiAnalysisMetadataRow = {
  hubspot_deal_id: string;
  generated_at: string;
  expires_at: string;
};

export type ForecastDealContext = {
  row: HubSpotDealRow;
  contact: HubSpotContactRow | null;
  company: HubSpotCompanyRow | null;
  ownerName: string | null;
};

export type ForecastDealStatusInput = {
  deal_stage: string | null;
  deal_stage_label: string | null;
  deal_lifecycle_status: "pending" | "won" | "lost" | null;
  is_closed_deal: boolean | null;
};

export type ForecastDealSummary = {
  signedDeals: ForecastDeal[];
  signedPaymentPendingDeals: ForecastDeal[];
  paymentReceivedDeals: ForecastDeal[];
  openDeals: ForecastDeal[];
  signedAmount: number;
  signedPaymentPendingAmount: number;
  paymentReceivedAmount: number;
  openPipelineAmount: number;
  openForecastAmount: number;
  landingAmount: number;
  pipelineAmount: number;
};

export type ForecastSynthesisRow = {
  analysis: ForecastSynthesis;
  input_hash: string;
  generated_at: string;
};
