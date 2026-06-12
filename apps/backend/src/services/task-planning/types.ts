export const SALES_ACTIVITY_EVENT_TYPES = [
  "call.received",
  "call.completed",
  "email.received",
  "email.sent",
  "sms.received",
  "sms.sent",
  "meeting.completed",
  "note.created",
  "deal.created",
  "deal.updated",
  "deal.stage_changed",
  "deal.amount_changed",
  "deal.probability_changed",
  "deal.close_date_changed",
  "deal.owner_changed",
  "deal.pipeline_changed",
  "deal.won",
  "deal.lost",
] as const;

export type SalesActivityEventType = (typeof SALES_ACTIVITY_EVENT_TYPES)[number];
export type SalesActivityChannel = "call" | "email" | "sms" | "meeting" | "note" | "deal";
export type SalesActivityDirection = "inbound" | "outbound" | "system";
export type SalesTaskType = "respond_to_client" | "follow_up" | "post_call_next_step" | "deal_review" | "crm_update";
export type SalesTaskStatus = "pending" | "snoozed" | "skipped" | "done" | "canceled";

export type NormalizedSalesActivityEventInput = {
  orgId: string;
  eventType: SalesActivityEventType;
  userId?: string | null;
  prospectId?: string | null;
  hubspotContactId?: string | null;
  hubspotDealId?: string | null;
  hubspotOwnerId?: string | null;
  externalEventId?: string | null;
  source?: string | null;
  occurredAt?: string | null;
  payload?: Record<string, unknown> | null;
};

export type SalesActivityEvent = {
  id: string;
  orgId: string;
  userId: string | null;
  prospectId: string | null;
  eventType: SalesActivityEventType;
  channel: SalesActivityChannel;
  direction: SalesActivityDirection | null;
  occurredAt: string;
  hubspotContactId: string | null;
  hubspotDealId: string | null;
  source: string;
  externalEventId: string | null;
  duplicate: boolean;
};

export type SalesTaskProspectSummary = {
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
};

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
  prospect: SalesTaskProspectSummary | null;
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

export type TaskPlanningResult = {
  created: number;
  updated: number;
  canceled: number;
  recalculated: number;
  skippedReason: string | null;
  tasks: SalesTaskListItem[];
};

export type AcceptedSalesActivityEvent = {
  event: SalesActivityEvent;
  planning: TaskPlanningResult;
};

export type SalesTaskActionResult = {
  task: SalesTaskListItem;
};

export type EventTypeMeta = {
  channel: SalesActivityChannel;
  direction: SalesActivityDirection;
};

export type ProspectRow = {
  id: string;
  org_id: string;
  owner_user_id: string | null;
  hubspot_contact_id: string;
  hubspot_deal_id: string | null;
  name: string;
  company: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  deal_stage: string | null;
  deal_amount: number | string | null;
  close_probability: number;
  last_contact_at: string | null;
  next_action: string | null;
  next_action_at: string | null;
  ai_summary: string | null;
  snoozed_until: string | null;
  skipped_at: string | null;
  raw_data: unknown;
  synced_at: string;
};

export type UserRow = {
  id: string;
  org_id: string | null;
  hubspot_owner_id: string | null;
};

export type ActivityEventRow = {
  id: string;
  org_id: string;
  user_id: string | null;
  prospect_id: string | null;
  source: string;
  external_event_id: string | null;
  event_type: SalesActivityEventType;
  channel: SalesActivityChannel;
  direction: SalesActivityDirection | null;
  occurred_at: string;
  hubspot_contact_id: string | null;
  hubspot_deal_id: string | null;
};

export type SalesTaskRow = {
  id: string;
  org_id: string;
  user_id: string | null;
  prospect_id: string | null;
  source_event_id: string | null;
  task_key: string;
  task_type: SalesTaskType;
  title: string;
  context: string | null;
  reason: string;
  scheduled_at: string;
  estimated_duration_minutes: number | string;
  priority_score: number | string;
  status: SalesTaskStatus;
  snoozed_until: string | null;
  completed_at: string | null;
  skipped_at: string | null;
  canceled_at: string | null;
  hubspot_contact_id: string | null;
  hubspot_deal_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskPriorityInput = {
  taskType: SalesTaskType;
  scheduledAt: string;
  status: SalesTaskStatus;
  dealAmount: number | null;
  closeProbability: number | null;
  closeDate: string | null;
  lastContactAt: string | null;
  hasIncomingClientResponse: boolean;
  snoozedUntil?: string | null;
};

export type TaskPlanProspectSnapshot = {
  id: string;
  name: string;
  company: string | null;
  dealAmount: number | null;
  closeProbability: number;
  closeDate: string | null;
  lastContactAt: string | null;
  hubspotContactId: string | null;
  hubspotDealId: string | null;
};

export type TaskPlanEventSnapshot = {
  id: string | null;
  eventType: SalesActivityEventType;
  occurredAt: string;
};

export type SalesTaskUpsertPlan = {
  taskKey: string;
  taskType: SalesTaskType;
  title: string;
  context: string | null;
  reason: string;
  scheduledAt: string;
  estimatedDurationMinutes: number;
  priorityScore: number;
};

export type SalesTaskCancelPlan = {
  taskKey: string;
  reason: string;
};

export type SalesTaskPlan = {
  upserts: SalesTaskUpsertPlan[];
  cancellations: SalesTaskCancelPlan[];
};
