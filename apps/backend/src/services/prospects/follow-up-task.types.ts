import type { FollowUpTaskRecommendation } from "../llm/llm.provider.js";

export type ProspectRow = {
  id: string;
  org_id: string;
  owner_user_id: string | null;
  hubspot_contact_id: string;
  hubspot_deal_id: string | null;
  name: string;
  company: string | null;
  deal_stage: string | null;
  last_contact_at: string | null;
  next_action: string | null;
  next_action_at: string | null;
  raw_data: unknown;
};

export type UserRow = {
  hubspot_owner_id: string | null;
};

export type ActionInsertRow = {
  id: string;
};

export type ProspectRawData = {
  hubspotOwnerId?: string | null;
  dealOwnerHubSpotId?: string | null;
  contactOwnerHubSpotId?: string | null;
};

export type FollowUpTaskAnalysisRow = {
  recommendation: FollowUpTaskRecommendation;
  provider: string;
  model: string;
  input_hash: string;
  expires_at: string;
};

export type FollowUpTaskRequestContext = {
  orgId?: string | null;
  hubspotOwnerId?: string | null;
  hubspotContactId?: string | null;
  hubspotDealId?: string | null;
  contactName?: string | null;
  company?: string | null;
  dealName?: string | null;
  dealStage?: string | null;
  lastContactAt?: string | null;
  nextAction?: string | null;
};

export type FollowUpTaskDebugStep = {
  step: string;
  status: "ok" | "skipped" | "error";
  detail: string;
};

export type FollowUpTaskDebugInfo = {
  llmProvider: string;
  prospectResolution: "local-id" | "hubspot-identifiers" | "live-context";
  resolvedProspectId: string | null;
  orgId: string | null;
  hubspotContactId: string | null;
  hubspotDealId: string | null;
  timelineItemCount: number;
  historyLength: number;
  createdHubspotTask: boolean;
  persistedLocalAction: boolean;
  steps: FollowUpTaskDebugStep[];
};

export type FollowUpTaskExecutionResult = {
  prospectId: string;
  created: boolean;
  recommendation: FollowUpTaskRecommendation;
  hubspotTaskId: string | null;
  localActionId: string | null;
  localActionPersisted: boolean;
  debug: FollowUpTaskDebugInfo;
};

export type AutoFollowUpSyncSummary = {
  analyzedCount: number;
  createdCount: number;
  skippedCount: number;
  failedCount: number;
};

export type FollowUpTaskPreviewResult = {
  prospectId: string;
  recommendation: FollowUpTaskRecommendation;
  debug: FollowUpTaskDebugInfo;
};

export type ResolvedFollowUpTarget = {
  prospect: ProspectRow | null;
  orgId: string;
  hubspotContactId: string;
  hubspotDealId: string;
  company: string | null;
  dealName: string | null;
  dealStage: string | null;
  lastContactAt: string | null;
  nextAction: string | null;
  ownerHubSpotId: string | null;
};

export type FollowUpAnalysisResult = {
  accessToken: string;
  recommendation: FollowUpTaskRecommendation;
  resolvedTarget: ResolvedFollowUpTarget;
  debug: FollowUpTaskDebugInfo;
};

