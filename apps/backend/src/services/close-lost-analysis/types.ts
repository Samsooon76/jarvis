import type { CloseLostDealAnalysis, CloseLostPortfolioAnalysis } from "../llm/llm.provider.js";

export type CloseLostScope = "sales_ae" | "owner";
export type CloseLostRunStatus = "queued" | "running" | "completed" | "failed";
export type CloseLostAnalysisStatus = "fresh" | "stale" | "missing";

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
  status: CloseLostRunStatus;
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
  recommendations: CloseLostPortfolioAnalysis["recommendations"];
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

export type CloseLostRunOptions = {
  orgId: string;
  scope: CloseLostScope;
  hubspotOwnerId?: string | null;
  salesAeOwnerIds?: string[];
  dateFrom: string;
  dateTo: string;
  llmProvider?: string | null;
  llmModel?: string | null;
  refresh?: boolean;
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
  hubspot_created_at: string | null;
  closed_at: string | null;
  hubspot_updated_at: string | null;
  properties: unknown;
  synced_at: string;
};

export type HubSpotContactRow = {
  hubspot_contact_id: string;
  email: string | null;
  name: string;
  phone: string | null;
  title: string | null;
  company_name: string | null;
  properties: unknown;
};

export type HubSpotCompanyRow = {
  hubspot_company_id: string;
  name: string | null;
  domain: string | null;
  industry: string | null;
  country: string | null;
  properties: unknown;
};

export type OwnerUserRow = {
  hubspot_owner_id: string | null;
  name: string;
};

export type CloseLostAnalysisRow = {
  id: string;
  org_id: string;
  hubspot_deal_id: string;
  provider: string;
  model: string;
  input_hash: string;
  analysis: CloseLostDealAnalysis;
  source_synced_at: string | null;
  generated_at: string;
};

export type CloseLostAnalysisRunRow = {
  id: string;
  org_id: string;
  scope: CloseLostScope;
  hubspot_owner_id: string | null;
  sales_ae_owner_ids?: string[] | null;
  provider: string;
  model: string;
  date_from: string;
  date_to: string;
  status: CloseLostRunStatus;
  progress: number;
  current_step: string;
  logs: unknown;
  deal_count: number;
  analyzed_count: number;
  reused_count: number;
  failed_count: number;
  result: CloseLostPortfolioAnalysis | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CloseLostDealContext = {
  row: HubSpotDealRow;
  contact: HubSpotContactRow | null;
  company: HubSpotCompanyRow | null;
  ownerName: string | null;
};
