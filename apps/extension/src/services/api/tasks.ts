import type { QueueProspect } from "@jarvis/shared";
import { apiPath, getJson, postJson, type ApiRequestOptions } from "./client";
import {
  clearAnalyticsCacheByPrefix,
  getCachedJson,
  HUBSPOT_TASKS_CACHE_PREFIX,
  HUBSPOT_TASKS_CACHE_TTL_MS,
} from "./cache";

export type HubSpotTaskPriority = "low" | "medium" | "high";

export type HubSpotTaskStatus = "not_started" | "in_progress" | "waiting" | "completed" | "deferred" | "unknown";

export type HubSpotTaskListItem = {
  id: string;
  title: string;
  body: string | null;
  status: HubSpotTaskStatus;
  priority: HubSpotTaskPriority | null;
  dueAt: string | null;
  ownerHubSpotId: string | null;
  taskType: string | null;
  contactName: string | null;
  contactEmail: string | null;
  companyName: string | null;
  dealName: string | null;
  createdAt: string | null;
  associatedContactIds: string[];
  associatedCompanyIds: string[];
  associatedDealIds: string[];
};

export type SalesTaskStatus = "pending" | "snoozed" | "skipped" | "done" | "canceled";

export type SalesTaskType = "respond_to_client" | "follow_up" | "post_call_next_step" | "deal_review" | "crm_update";

export type SalesTaskListItem = {
  id: string;
  orgId: string;
  userId: string | null;
  prospectId: string | null;
  sourceEventId: string | null;
  taskKey: string;
  taskType: SalesTaskType;
  title: string;
  context: string | null;
  reason: string;
  scheduledAt: string;
  estimatedDurationMinutes: number;
  priorityScore: number;
  status: SalesTaskStatus;
  snoozedUntil: string | null;
  completedAt: string | null;
  skippedAt: string | null;
  canceledAt: string | null;
  hubspotContactId: string | null;
  hubspotDealId: string | null;
  createdAt: string;
  updatedAt: string;
  prospect: {
    id: string;
    name: string;
    company: string | null;
    email: string | null;
    phone: string | null;
    title: string | null;
    dealName: string | null;
    dealStage: string | null;
    dealAmount: number | null;
    closeProbability: number;
  } | null;
};

export type SalesTasksTodayPayload = {
  userId: string;
  orgId: string;
  generatedAt: string;
  tasks: SalesTaskListItem[];
  nowTask: SalesTaskListItem | null;
  nextTask: SalesTaskListItem | null;
  counts: {
    pending: number;
    snoozed: number;
    skipped: number;
    done: number;
  };
};

type SalesTaskActionResult = {
  task: SalesTaskListItem;
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
  priority: HubSpotTaskPriority;
  shouldReschedule: boolean;
  suggestedDueInDays: number | null;
  suggestedAction: string;
  rationale: string;
  outreachAngle: string | null;
  evidence: string[];
  missingData: string[];
  confidence: "low" | "medium" | "high";
};

export type TaskAnalyzerApplyResult = {
  orgId: string;
  hubspotTaskId: string;
  action: "completed" | "rescheduled" | "consolidated";
  completedTask: HubSpotTaskListItem | null;
  completedTaskIds?: string[];
  createdTask: HubSpotTaskListItem | null;
  retainedTask?: HubSpotTaskListItem | null;
  analysis: TaskAnalysis;
  message: string;
};

type HubSpotTasksPayload = {
  orgId: string;
  hubspotOwnerId: string;
  tasks: HubSpotTaskListItem[];
};

export type FollowUpTaskResult = {
  prospectId: string;
  created: boolean;
  dryRun: boolean;
  recommendation: {
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
  hubspotTaskId: string | null;
  localActionId: string | null;
  localActionPersisted: boolean;
};

export const fetchHubSpotTasks = async (
  orgId: string,
  hubspotOwnerId: string,
  limit = 500,
  options: ApiRequestOptions = {},
  forceRefresh = false,
): Promise<HubSpotTaskListItem[]> => {
  const path = apiPath("/api/hubspot/tasks", { orgId, hubspotOwnerId, limit, includeCompleted: false });
  const payload = await getCachedJson<HubSpotTasksPayload>(
    `${HUBSPOT_TASKS_CACHE_PREFIX}${path}`,
    path,
    HUBSPOT_TASKS_CACHE_TTL_MS,
    forceRefresh,
    options,
  );

  return payload.tasks;
};

export const fetchSalesTasksToday = async (
  userId: string,
  options: ApiRequestOptions = {},
): Promise<SalesTasksTodayPayload> =>
  getJson<SalesTasksTodayPayload>(`/api/tasks/today/${encodeURIComponent(userId)}`, options);

export const completeSalesTask = async (taskId: string): Promise<SalesTaskListItem> => {
  const result = await postJson<SalesTaskActionResult>(`/api/tasks/${encodeURIComponent(taskId)}/complete`, {});

  return result.task;
};

export const snoozeSalesTask = async (taskId: string, snoozedUntil: string): Promise<SalesTaskListItem> => {
  const result = await postJson<SalesTaskActionResult>(`/api/tasks/${encodeURIComponent(taskId)}/snooze`, {
    snoozedUntil,
  });

  return result.task;
};

export const skipSalesTask = async (taskId: string): Promise<SalesTaskListItem> => {
  const result = await postJson<SalesTaskActionResult>(`/api/tasks/${encodeURIComponent(taskId)}/skip`, {});

  return result.task;
};

export const updateHubSpotTaskPriority = async (
  orgId: string,
  taskId: string,
  priority: HubSpotTaskPriority | null,
): Promise<HubSpotTaskListItem> =>
  postJson<HubSpotTaskListItem>(`/api/hubspot/tasks/${encodeURIComponent(taskId)}/priority`, {
    orgId,
    priority,
  }).finally(() => clearAnalyticsCacheByPrefix(HUBSPOT_TASKS_CACHE_PREFIX));

export const analyzeAndApplyHubSpotTask = async (
  orgId: string,
  taskId: string,
  refresh = false,
): Promise<TaskAnalyzerApplyResult> =>
  postJson<TaskAnalyzerApplyResult>(`/api/tasks/${encodeURIComponent(taskId)}/analyze-and-apply`, {
    orgId,
    refresh,
  }).finally(() => clearAnalyticsCacheByPrefix(HUBSPOT_TASKS_CACHE_PREFIX));

export const createFollowUpTask = async (prospect: QueueProspect, orgId: string): Promise<FollowUpTaskResult> =>
  postJson<FollowUpTaskResult>(`/api/prospects/${encodeURIComponent(prospect.id)}/follow-up-task`, {
    orgId,
    hubspotDealId: prospect.hubspotDealId ?? null,
    contactName: prospect.name,
    company: prospect.company,
    dealStage: prospect.dealStage,
    lastContactAt: prospect.lastContactAt,
    nextAction: prospect.nextAction,
  }).finally(() => clearAnalyticsCacheByPrefix(HUBSPOT_TASKS_CACHE_PREFIX));
