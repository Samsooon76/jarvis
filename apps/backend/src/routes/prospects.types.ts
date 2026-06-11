import type { FollowUpTaskRecommendation } from "../services/llm/llm.provider.js";
import type { FollowUpTaskDebugInfo } from "../services/prospects/follow-up-task.service.js";

export type FollowUpTaskParams = {
  id: string;
};

export type FollowUpTaskBody = {
  dryRun?: boolean;
  objective?: string | null;
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

export type DealIntelligenceQuery = {
  orgId?: string;
  hubspotDealId?: string;
  llmProvider?: string;
  llmModel?: string;
  contactName?: string;
  contactTitle?: string;
  contactEmail?: string;
  contactPhone?: string;
  companyName?: string;
  ownerName?: string;
  closeDate?: string;
  closeProbability?: string;
  dealAmount?: string;
  dealStage?: string;
  lastContactAt?: string;
  nextAction?: string;
  refresh?: string;
};

export type DealActivityDebugQuery = {
  orgId?: string;
  hubspotDealId?: string;
};

export type DealAnalysisRunParams = {
  id: string;
};

export type DealAnalysisJobParams = {
  jobId: string;
};

export type DealAnalysisRunBody = {
  orgId?: string | null;
  hubspotDealId?: string | null;
  llmProvider?: string | null;
  llmModel?: string | null;
  refresh?: boolean;
};

export type ProspectParams = {
  id: string;
};

export type ProspectActionBody = {
  userId?: string | null;
  reason?: string | null;
  snoozedUntil?: string | null;
};

export type ProspectDetail = {
  id: string;
  orgId: string;
  ownerUserId: string | null;
  name: string;
  company: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  dealStage: string | null;
  dealAmount: number | null;
  closeProbability: number;
  lastContactAt: string | null;
  nextAction: string | null;
  aiSummary: string | null;
  aiPriorityScore: number;
  snoozedUntil: string | null;
  skippedAt: string | null;
  hubspotContactId: string;
  hubspotDealId: string | null;
  syncedAt: string;
  updatedAt: string;
};

export type ProspectActionResult = {
  prospectId: string;
  action: "snooze" | "skip";
  snoozedUntil: string | null;
  skippedAt: string | null;
};

export type FollowUpTaskResult = {
  prospectId: string;
  created: boolean;
  dryRun: boolean;
  recommendation: FollowUpTaskRecommendation;
  hubspotTaskId: string | null;
  localActionId: string | null;
  localActionPersisted: boolean;
  debug: FollowUpTaskDebugInfo;
};

