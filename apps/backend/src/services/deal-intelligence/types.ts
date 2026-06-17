import type {
  DealActivityPlanAnalysis,
  DealIntelligenceAnalysis,
  DealQualificationAnalysis,
} from "../llm/llm.provider.js";

export type DealIntelligenceContext = {
  orgId?: string | null;
  hubspotDealId?: string | null;
  llmProvider?: string | null;
  llmModel?: string | null;
  contactName?: string | null;
  contactTitle?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  companyName?: string | null;
  ownerName?: string | null;
  closeDate?: string | null;
  currentCloseProbability?: number | null;
  dealAmount?: number | null;
  dealStage?: string | null;
  lastContactAt?: string | null;
  nextAction?: string | null;
  refresh?: boolean;
};

export type ProspectRow = {
  id: string;
  org_id: string;
  owner_user_id: string | null;
  hubspot_contact_id: string;
  hubspot_deal_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  deal_stage: string | null;
  deal_amount: number | null;
  close_probability: number;
  last_contact_at: string | null;
  next_action: string | null;
  next_action_at: string | null;
  raw_data: unknown;
  synced_at: string;
};

export type DealAiAnalysisRow = {
  id: string;
  analysis: DealIntelligenceAnalysis;
  analysis_type?: string;
  provider: string;
  model: string;
  input_hash: string;
  generated_at: string;
  expires_at: string;
};

export type DealAiAnalysisType =
  | "deal_intelligence"
  | "deal_qualification"
  | "deal_activity_plan"
  | "deal_analysis_v1";

export type DealAiAnalysisCacheRow<TAnalysis> = Omit<DealAiAnalysisRow, "analysis"> & {
  analysis: TAnalysis;
};

export type SupabaseErrorLike = {
  code?: string;
  message?: string;
};

export type ResolvedDealTarget = {
  prospect: ProspectRow | null;
  orgId: string;
  hubspotContactId: string | null;
  hubspotDealId: string;
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

export type DealAnalysisBundleResult = {
  page: DealAnalysisPageResult;
  qualification: DealQualificationResult;
  activityPlan: DealActivityPlanResult;
};

export type DealActivityPlanCacheContext = {
  recentActivities: DealRecentActivity[];
  channelEngagement: DealChannelEngagement[];
};

// Le payload cache du plan d'activite embarque le contexte CRM (activites recentes,
// engagement par canal) pour eviter de re-fetcher l'historique HubSpot sur cache hit.
export type DealActivityPlanCachePayload = DealActivityPlanAnalysis & {
  cachedContext?: DealActivityPlanCacheContext;
};

export type JsonRecord = Record<string, unknown>;

export type HubSpotDealSnapshotRow = {
  hubspot_owner_id: string | null;
  primary_contact_id: string | null;
  primary_company_id: string | null;
  deal_name: string | null;
  amount: number | string | null;
  deal_stage: string | null;
  deal_stage_label?: string | null;
  pipeline_label?: string | null;
  deal_lifecycle_status?: "pending" | "won" | "lost" | null;
  is_closed_deal?: boolean | null;
  close_probability: number | string | null;
  closed_at: string | null;
  hubspot_created_at: string | null;
  hubspot_updated_at: string | null;
  properties: unknown;
  synced_at: string;
};

export type HubSpotContactSnapshotRow = {
  email: string | null;
  name: string;
  phone: string | null;
  title: string | null;
  company_name: string | null;
  properties: unknown;
};

export type HubSpotCompanySnapshotRow = {
  name: string | null;
  domain: string | null;
  industry: string | null;
  country: string | null;
  properties: unknown;
};

export type OwnerUserSnapshotRow = {
  name: string;
};

export type ActionSnapshotRow = {
  title: string;
  description: string | null;
  due_at: string | null;
  status: string;
  ai_generated: boolean;
};
