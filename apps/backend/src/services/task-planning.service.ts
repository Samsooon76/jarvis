import { getSupabaseAdmin } from "../db/client.js";
import { scoreProspect } from "./scoring.service.js";
import type { AuthContext } from "./app-auth.service.js";

export const SALES_ACTIVITY_EVENT_TYPES = [
  "call.received",
  "call.completed",
  "email.received",
  "email.sent",
  "sms.received",
  "sms.sent",
  "deal.updated",
] as const;

export type SalesActivityEventType = (typeof SALES_ACTIVITY_EVENT_TYPES)[number];
export type SalesActivityChannel = "call" | "email" | "sms" | "deal";
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

const isSupabaseSchemaUnavailableError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";

  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST205" ||
    message.includes("sales_tasks") && (message.includes("could not find") || message.includes("does not exist"))
  );
};

const buildEmptySalesTasksTodayPayload = (userId: string, orgId: string, generatedAt = new Date().toISOString()): SalesTasksTodayPayload => ({
  userId,
  orgId,
  generatedAt,
  tasks: [],
  nowTask: null,
  nextTask: null,
  counts: {
    pending: 0,
    snoozed: 0,
    skipped: 0,
    done: 0,
  },
});

export type AcceptedSalesActivityEvent = {
  event: SalesActivityEvent;
  planning: TaskPlanningResult;
};

export type SalesTaskActionResult = {
  task: SalesTaskListItem;
};

type EventTypeMeta = {
  channel: SalesActivityChannel;
  direction: SalesActivityDirection;
};

type ProspectRow = {
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

type UserRow = {
  id: string;
  org_id: string | null;
  hubspot_owner_id: string | null;
};

type ActivityEventRow = {
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

type SalesTaskRow = {
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

const EVENT_TYPE_META = {
  "call.received": { channel: "call", direction: "inbound" },
  "call.completed": { channel: "call", direction: "outbound" },
  "email.received": { channel: "email", direction: "inbound" },
  "email.sent": { channel: "email", direction: "outbound" },
  "sms.received": { channel: "sms", direction: "inbound" },
  "sms.sent": { channel: "sms", direction: "outbound" },
  "deal.updated": { channel: "deal", direction: "system" },
} as const satisfies Record<SalesActivityEventType, EventTypeMeta>;

const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

const MS_PER_DAY = 86_400_000;
const ACTIVE_TASK_STATUSES: SalesTaskStatus[] = ["pending", "snoozed"];
const WORKDAY_START_HOUR = 9;
const WORKDAY_START_MINUTE = 30;
const LUNCH_START_HOUR = 12;
const LUNCH_START_MINUTE = 30;
const LUNCH_END_HOUR = 14;
const WORKDAY_END_HOUR = 18;

const ESTIMATED_TASK_DURATION_MINUTES = {
  respond_to_client: 20,
  follow_up: 15,
  post_call_next_step: 30,
  deal_review: 40,
  crm_update: 20,
} as const satisfies Record<SalesTaskType, number>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const isSalesActivityEventType = (value: string | null): value is SalesActivityEventType =>
  SALES_ACTIVITY_EVENT_TYPES.some((eventType) => eventType === value);

const readString = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
};

const readNumber = (record: Record<string, unknown>, key: string): number | null => {
  const value = record[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const readFirstString = (record: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = readString(record, key);

    if (value) {
      return value;
    }
  }

  return null;
};

const readFirstNumber = (record: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const value = readNumber(record, key);

    if (value !== null) {
      return value;
    }
  }

  return null;
};

const assertUuid = (value: string, fieldName: string): void => {
  if (!UUID_V4_LIKE_PATTERN.test(value)) {
    throw new Error(`${fieldName} doit etre un UUID Jarvis valide.`);
  }
};

const normalizeIsoDate = (value: string | null | undefined, fallback: Date): string => {
  if (!value) {
    return fallback.toISOString();
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error("occurredAt doit etre une date ISO valide.");
  }

  return parsed.toISOString();
};

const sanitizeSource = (source: string | null | undefined): string =>
  (source?.trim() || "generic_webhook").slice(0, 80);

const toNumber = (value: number | string | null): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const roundScore = (value: number): number => Math.round(value * 100) / 100;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const getDaysUntil = (value: string | null, now: Date): number | null => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.ceil((timestamp - now.getTime()) / MS_PER_DAY);
};

const getDaysSince = (value: string | null, now: Date): number | null => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.max(0, Math.floor((now.getTime() - timestamp) / MS_PER_DAY));
};

const addMinutes = (date: Date, minutes: number): Date => new Date(date.getTime() + minutes * 60_000);

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);

  return next;
};

const setTime = (date: Date, hour: number, minute = 0): Date => {
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);

  return next;
};

const getWorkdayStart = (date: Date): Date => setTime(date, WORKDAY_START_HOUR, WORKDAY_START_MINUTE);
const getLunchStart = (date: Date): Date => setTime(date, LUNCH_START_HOUR, LUNCH_START_MINUTE);
const getLunchEnd = (date: Date): Date => setTime(date, LUNCH_END_HOUR);
const getWorkdayEnd = (date: Date): Date => setTime(date, WORKDAY_END_HOUR);

const isWeekend = (date: Date): boolean => date.getDay() === 0 || date.getDay() === 6;

const moveToNextWorkdayMorning = (date: Date): Date => {
  const next = addDays(date, 1);
  const morning = getWorkdayStart(next);

  while (isWeekend(morning)) {
    morning.setDate(morning.getDate() + 1);
  }

  return morning;
};

export const getEstimatedSalesTaskDurationMinutes = (taskType: SalesTaskType): number =>
  ESTIMATED_TASK_DURATION_MINUTES[taskType];

export const normalizeWorkSlot = (target: Date, now: Date, durationMinutes = 20): Date => {
  const minimumStart = addMinutes(now, 5);
  const next = new Date(Math.max(target.getTime(), minimumStart.getTime()));
  const durationMs = Math.max(5, durationMinutes) * 60_000;

  while (isWeekend(next)) {
    next.setDate(next.getDate() + 1);
    next.setHours(WORKDAY_START_HOUR, WORKDAY_START_MINUTE, 0, 0);
  }

  const workdayStart = getWorkdayStart(next);
  const lunchStart = getLunchStart(next);
  const lunchEnd = getLunchEnd(next);
  const workdayEnd = getWorkdayEnd(next);

  if (next < workdayStart) {
    return workdayStart;
  }

  if (next >= lunchStart && next < lunchEnd) {
    return lunchEnd;
  }

  if (next.getTime() < lunchStart.getTime() && next.getTime() + durationMs > lunchStart.getTime()) {
    return lunchEnd;
  }

  if (next.getTime() + durationMs > workdayEnd.getTime()) {
    return moveToNextWorkdayMorning(next);
  }

  return next;
};

const intervalsOverlap = (
  leftStart: Date,
  leftDurationMinutes: number,
  rightStart: Date,
  rightDurationMinutes: number,
): boolean => {
  const leftEnd = addMinutes(leftStart, leftDurationMinutes).getTime();
  const rightEnd = addMinutes(rightStart, rightDurationMinutes).getTime();

  return leftStart.getTime() < rightEnd && rightStart.getTime() < leftEnd;
};

const getExistingTaskDurationMinutes = (task: Pick<SalesTaskRow, "estimated_duration_minutes">): number =>
  Math.max(5, toNumber(task.estimated_duration_minutes) ?? 20);

const findNextAvailableWorkSlot = ({
  durationMinutes,
  existingTasks,
  now,
  preferredAt,
}: {
  durationMinutes: number;
  existingTasks: SalesTaskRow[];
  now: Date;
  preferredAt: Date;
}): Date => {
  let candidate = normalizeWorkSlot(preferredAt, now, durationMinutes);
  const sortedTasks = existingTasks
    .map((task) => ({
      start: new Date(task.scheduled_at),
      durationMinutes: getExistingTaskDurationMinutes(task),
    }))
    .filter((task) => !Number.isNaN(task.start.getTime()))
    .sort((left, right) => left.start.getTime() - right.start.getTime());

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const overlap = sortedTasks.find((task) =>
      intervalsOverlap(candidate, durationMinutes, normalizeWorkSlot(task.start, now, task.durationMinutes), task.durationMinutes),
    );

    if (!overlap) {
      return candidate;
    }

    candidate = normalizeWorkSlot(addMinutes(overlap.start, overlap.durationMinutes + 5), now, durationMinutes);
  }

  return candidate;
};

const readRawString = (rawData: unknown, key: string): string | null => {
  if (!isRecord(rawData)) {
    return null;
  }

  return readString(rawData, key);
};

const getProspectDealName = (rawData: unknown): string | null => readRawString(rawData, "dealName");

const getProspectCloseDate = (rawData: unknown, payload: Record<string, unknown> = {}): string | null =>
  readFirstString(payload, ["closeDate", "closedAt", "dealCloseDate"]) ??
  readRawString(rawData, "closedAt") ??
  readRawString(rawData, "closeDate");

const buildTaskKey = (prospectId: string, taskType: SalesTaskType): string => `${prospectId}:${taskType}`;

const isIncomingClientResponse = (eventType: SalesActivityEventType): boolean =>
  eventType === "call.received" || eventType === "email.received" || eventType === "sms.received";

const isOutboundMessage = (eventType: SalesActivityEventType): boolean =>
  eventType === "email.sent" || eventType === "sms.sent";

const getTaskContext = (prospect: TaskPlanProspectSnapshot): string | null => {
  const parts = [prospect.company, prospect.name].filter((value): value is string => Boolean(value?.trim()));

  return parts.length > 0 ? parts.join(" - ") : null;
};

const getDealReviewNeeded = (prospect: TaskPlanProspectSnapshot, now: Date): boolean => {
  const closeDays = getDaysUntil(prospect.closeDate, now);
  const amount = prospect.dealAmount ?? 0;

  return amount >= 10_000 || prospect.closeProbability >= 60 || (closeDays !== null && closeDays >= 0 && closeDays <= 14);
};

const getPlanningProspectSnapshot = (prospect: ProspectRow, payload: Record<string, unknown>): TaskPlanProspectSnapshot => ({
  id: prospect.id,
  name: prospect.name,
  company: prospect.company,
  dealAmount: readFirstNumber(payload, ["dealAmount", "amount"]) ?? toNumber(prospect.deal_amount),
  closeProbability: Math.round(
    clamp(readFirstNumber(payload, ["closeProbability", "probability"]) ?? prospect.close_probability, 0, 100),
  ),
  closeDate: getProspectCloseDate(prospect.raw_data, payload),
  lastContactAt: prospect.last_contact_at,
  hubspotContactId: prospect.hubspot_contact_id,
  hubspotDealId: prospect.hubspot_deal_id,
});

export const scoreSalesTask = (input: TaskPriorityInput, now: Date = new Date()): number => {
  if (input.status === "skipped" || input.status === "done" || input.status === "canceled") {
    return 0;
  }

  const scheduledTimestamp = new Date(input.scheduledAt).getTime();
  const minutesUntil = Number.isNaN(scheduledTimestamp)
    ? 24 * 60
    : Math.floor((scheduledTimestamp - now.getTime()) / 60_000);
  const closeDays = getDaysUntil(input.closeDate, now);
  const daysSinceLastContact = getDaysSince(input.lastContactAt, now);
  const amountScore = Math.min(20, (input.dealAmount ?? 0) / 2_500);
  const probabilityScore = Math.min(25, (input.closeProbability ?? 0) * 0.25);
  const scheduleScore =
    minutesUntil <= 0
      ? 35
      : minutesUntil <= 30
        ? 30
        : minutesUntil <= 120
          ? 22
          : minutesUntil <= 8 * 60
            ? 14
            : 6;
  const closeDateScore =
    closeDays === null
      ? 0
      : closeDays < 0
        ? -8
        : closeDays <= 3
          ? 22
          : closeDays <= 14
            ? 14
            : 0;
  const staleInteractionScore =
    daysSinceLastContact === null ? 8 : daysSinceLastContact >= 14 ? 18 : daysSinceLastContact >= 7 ? 10 : 0;
  const incomingScore = input.hasIncomingClientResponse ? 42 : 0;
  const taskTypeScore =
    input.taskType === "respond_to_client"
      ? 12
      : input.taskType === "deal_review"
        ? 8
        : input.taskType === "post_call_next_step"
          ? 6
          : 0;
  const snoozePenalty =
    input.status === "snoozed" && input.snoozedUntil && new Date(input.snoozedUntil).getTime() > now.getTime()
      ? 45
      : input.status === "snoozed"
        ? 20
        : 0;

  return roundScore(
    clamp(
      amountScore +
        probabilityScore +
        scheduleScore +
        closeDateScore +
        staleInteractionScore +
        incomingScore +
        taskTypeScore -
        snoozePenalty,
      0,
      100,
    ),
  );
};

export const buildSalesTaskPlanForEvent = ({
  event,
  now = new Date(),
  prospect,
}: {
  event: TaskPlanEventSnapshot;
  now?: Date;
  prospect: TaskPlanProspectSnapshot;
}): SalesTaskPlan => {
  const occurredAt = new Date(event.occurredAt);
  const baseDate = Number.isNaN(occurredAt.getTime()) ? now : occurredAt;
  const context = getTaskContext(prospect);
  const upserts: SalesTaskUpsertPlan[] = [];
  const cancellations: SalesTaskCancelPlan[] = [];
  const makePriority = (taskType: SalesTaskType, scheduledAt: string, hasIncomingClientResponse: boolean): number =>
    scoreSalesTask(
      {
        taskType,
        scheduledAt,
        status: "pending",
        dealAmount: prospect.dealAmount,
        closeProbability: prospect.closeProbability,
        closeDate: prospect.closeDate,
        lastContactAt: prospect.lastContactAt,
        hasIncomingClientResponse,
      },
      now,
    );

  if (isIncomingClientResponse(event.eventType)) {
    const taskType: SalesTaskType = "respond_to_client";
    const estimatedDurationMinutes = getEstimatedSalesTaskDurationMinutes(taskType);
    const scheduledAt = normalizeWorkSlot(addMinutes(baseDate, 10), now, estimatedDurationMinutes).toISOString();

    cancellations.push({
      taskKey: buildTaskKey(prospect.id, "follow_up"),
      reason: "Relance annulee car le client a repondu.",
    });
    upserts.push({
      taskKey: buildTaskKey(prospect.id, taskType),
      taskType,
      title: "Repondre au client",
      context,
      reason: "Reponse entrante client detectee.",
      scheduledAt,
      estimatedDurationMinutes,
      priorityScore: makePriority(taskType, scheduledAt, true),
    });
  }

  if (isOutboundMessage(event.eventType)) {
    const taskType: SalesTaskType = "follow_up";
    const estimatedDurationMinutes = getEstimatedSalesTaskDurationMinutes(taskType);
    const delayDays = event.eventType === "sms.sent" ? 1 : 2;
    const scheduledAt = normalizeWorkSlot(addDays(baseDate, delayDays), now, estimatedDurationMinutes).toISOString();

    cancellations.push({
      taskKey: buildTaskKey(prospect.id, "respond_to_client"),
      reason: "Reponse commerciale envoyee, la tache de reponse est closee.",
    });
    upserts.push({
      taskKey: buildTaskKey(prospect.id, taskType),
      taskType,
      title: "Relancer le prospect",
      context,
      reason: event.eventType === "sms.sent" ? "Relance planifiee apres SMS envoye." : "Relance planifiee apres email envoye.",
      scheduledAt,
      estimatedDurationMinutes,
      priorityScore: makePriority(taskType, scheduledAt, false),
    });
  }

  if (event.eventType === "call.completed") {
    const taskType: SalesTaskType = "post_call_next_step";
    const estimatedDurationMinutes = getEstimatedSalesTaskDurationMinutes(taskType);
    const scheduledAt = normalizeWorkSlot(addMinutes(baseDate, 30), now, estimatedDurationMinutes).toISOString();

    cancellations.push({
      taskKey: buildTaskKey(prospect.id, "respond_to_client"),
      reason: "Appel termine, le prochain pas remplace la reponse directe.",
    });
    upserts.push({
      taskKey: buildTaskKey(prospect.id, taskType),
      taskType,
      title: "Definir le prochain pas apres l'appel",
      context,
      reason: "Call termine: verrouiller le prochain pas pendant que le contexte est frais.",
      scheduledAt,
      estimatedDurationMinutes,
      priorityScore: makePriority(taskType, scheduledAt, false),
    });
  }

  if (event.eventType === "deal.updated" && getDealReviewNeeded(prospect, now)) {
    const taskType: SalesTaskType = "deal_review";
    const estimatedDurationMinutes = getEstimatedSalesTaskDurationMinutes(taskType);
    const scheduledAt = normalizeWorkSlot(addMinutes(baseDate, 45), now, estimatedDurationMinutes).toISOString();

    upserts.push({
      taskKey: buildTaskKey(prospect.id, taskType),
      taskType,
      title: "Revoir le deal prioritaire",
      context,
      reason: "Deal important ou proche d'echeance mis a jour.",
      scheduledAt,
      estimatedDurationMinutes,
      priorityScore: makePriority(taskType, scheduledAt, false),
    });
  }

  return {
    upserts,
    cancellations,
  };
};

export const parseNormalizedSalesActivityEvent = (body: unknown): NormalizedSalesActivityEventInput => {
  if (!isRecord(body)) {
    throw new Error("Le body doit etre un objet JSON.");
  }

  const orgId = readFirstString(body, ["orgId", "org_id"]);

  if (!orgId) {
    throw new Error("Le champ orgId est obligatoire.");
  }

  assertUuid(orgId, "orgId");

  const eventTypeValue = readFirstString(body, ["eventType", "event_type", "type"]);

  if (!isSalesActivityEventType(eventTypeValue)) {
    throw new Error("eventType doit etre un evenement normalise supporte.");
  }

  const userId = readFirstString(body, ["userId", "user_id"]);
  const prospectId = readFirstString(body, ["prospectId", "prospect_id"]);

  if (userId) {
    assertUuid(userId, "userId");
  }

  if (prospectId) {
    assertUuid(prospectId, "prospectId");
  }

  const payloadValue = body.payload;
  const payload = isRecord(payloadValue) ? payloadValue : {};

  return {
    orgId,
    eventType: eventTypeValue,
    userId,
    prospectId,
    hubspotContactId: readFirstString(body, ["hubspotContactId", "hubspot_contact_id", "contactId", "contact_id"]),
    hubspotDealId: readFirstString(body, ["hubspotDealId", "hubspot_deal_id", "dealId", "deal_id"]),
    hubspotOwnerId:
      readFirstString(body, ["hubspotOwnerId", "hubspot_owner_id", "ownerId", "owner_id"]) ??
      readFirstString(payload, ["hubspotOwnerId", "hubspot_owner_id", "ownerId", "owner_id"]),
    externalEventId: readFirstString(body, ["externalEventId", "external_event_id", "eventId", "event_id"]),
    source: readFirstString(body, ["source", "provider"]),
    occurredAt: readFirstString(body, ["occurredAt", "occurred_at", "timestamp"]),
    payload,
  };
};

const mapActivityEventRow = (row: ActivityEventRow, duplicate: boolean): SalesActivityEvent => ({
  id: row.id,
  orgId: row.org_id,
  userId: row.user_id,
  prospectId: row.prospect_id,
  eventType: row.event_type,
  channel: row.channel,
  direction: row.direction,
  occurredAt: row.occurred_at,
  hubspotContactId: row.hubspot_contact_id,
  hubspotDealId: row.hubspot_deal_id,
  source: row.source,
  externalEventId: row.external_event_id,
  duplicate,
});

const mapSalesTaskRow = (
  row: SalesTaskRow,
  prospectById: Map<string, SalesTaskProspectSummary> = new Map(),
): SalesTaskListItem => ({
  id: row.id,
  orgId: row.org_id,
  userId: row.user_id,
  prospectId: row.prospect_id,
  sourceEventId: row.source_event_id,
  taskKey: row.task_key,
  taskType: row.task_type,
  title: row.title,
  context: row.context,
  reason: row.reason,
  scheduledAt: row.scheduled_at,
  estimatedDurationMinutes: Math.max(5, toNumber(row.estimated_duration_minutes) ?? 20),
  priorityScore: toNumber(row.priority_score) ?? 0,
  status: row.status,
  snoozedUntil: row.snoozed_until,
  completedAt: row.completed_at,
  skippedAt: row.skipped_at,
  canceledAt: row.canceled_at,
  hubspotContactId: row.hubspot_contact_id,
  hubspotDealId: row.hubspot_deal_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  prospect: row.prospect_id ? prospectById.get(row.prospect_id) ?? null : null,
});

const getProspectSummary = (prospect: ProspectRow): SalesTaskProspectSummary => ({
  id: prospect.id,
  name: prospect.name,
  company: prospect.company,
  email: prospect.email,
  phone: prospect.phone,
  title: prospect.title,
  dealName: getProspectDealName(prospect.raw_data),
  dealStage: prospect.deal_stage,
  dealAmount: toNumber(prospect.deal_amount),
  closeProbability: prospect.close_probability,
});

const loadProspectById = async (orgId: string, prospectId: string): Promise<ProspectRow | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("prospects")
    .select(
      "id, org_id, owner_user_id, hubspot_contact_id, hubspot_deal_id, name, company, title, email, phone, deal_stage, deal_amount, close_probability, last_contact_at, next_action, next_action_at, ai_summary, snoozed_until, skipped_at, raw_data, synced_at",
    )
    .eq("org_id", orgId)
    .eq("id", prospectId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le prospect: ${error.message}`);
  }

  return data as ProspectRow | null;
};

const loadProspectByHubSpotDealId = async (orgId: string, hubspotDealId: string): Promise<ProspectRow | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("prospects")
    .select(
      "id, org_id, owner_user_id, hubspot_contact_id, hubspot_deal_id, name, company, title, email, phone, deal_stage, deal_amount, close_probability, last_contact_at, next_action, next_action_at, ai_summary, snoozed_until, skipped_at, raw_data, synced_at",
    )
    .eq("org_id", orgId)
    .eq("hubspot_deal_id", hubspotDealId)
    .order("ai_priority_score", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Impossible de charger le prospect par deal HubSpot: ${error.message}`);
  }

  return ((data ?? []) as ProspectRow[])[0] ?? null;
};

const loadProspectByHubSpotContactId = async (orgId: string, hubspotContactId: string): Promise<ProspectRow | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("prospects")
    .select(
      "id, org_id, owner_user_id, hubspot_contact_id, hubspot_deal_id, name, company, title, email, phone, deal_stage, deal_amount, close_probability, last_contact_at, next_action, next_action_at, ai_summary, snoozed_until, skipped_at, raw_data, synced_at",
    )
    .eq("org_id", orgId)
    .eq("hubspot_contact_id", hubspotContactId)
    .order("ai_priority_score", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Impossible de charger le prospect par contact HubSpot: ${error.message}`);
  }

  return ((data ?? []) as ProspectRow[])[0] ?? null;
};

const resolveProspect = async (input: NormalizedSalesActivityEventInput): Promise<ProspectRow | null> => {
  if (input.prospectId) {
    return loadProspectById(input.orgId, input.prospectId);
  }

  if (input.hubspotDealId) {
    const prospect = await loadProspectByHubSpotDealId(input.orgId, input.hubspotDealId);

    if (prospect) {
      return prospect;
    }
  }

  if (input.hubspotContactId) {
    return loadProspectByHubSpotContactId(input.orgId, input.hubspotContactId);
  }

  return null;
};

const loadUserRecordById = async (userId: string): Promise<UserRow | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("users").select("id, org_id, hubspot_owner_id").eq("id", userId).maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le commercial: ${error.message}`);
  }

  return data as UserRow | null;
};

const loadUserById = async (orgId: string, userId: string): Promise<UserRow | null> => {
  const user = await loadUserRecordById(userId);

  if (user && user.org_id !== orgId) {
    throw new Error("Le commercial ne fait pas partie de cette organisation.");
  }

  return user;
};

const loadUserByHubSpotOwnerId = async (orgId: string, hubspotOwnerId: string): Promise<UserRow | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("users")
    .select("id, org_id, hubspot_owner_id")
    .eq("org_id", orgId)
    .eq("hubspot_owner_id", hubspotOwnerId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le commercial HubSpot: ${error.message}`);
  }

  return data as UserRow | null;
};

const resolveUserId = async (
  input: NormalizedSalesActivityEventInput,
  prospect: ProspectRow | null,
): Promise<string | null> => {
  if (input.userId) {
    const user = await loadUserById(input.orgId, input.userId);

    if (!user) {
      throw new Error("Commercial introuvable.");
    }

    return user.id;
  }

  if (prospect?.owner_user_id) {
    return prospect.owner_user_id;
  }

  if (input.hubspotOwnerId) {
    const user = await loadUserByHubSpotOwnerId(input.orgId, input.hubspotOwnerId);

    return user?.id ?? null;
  }

  return null;
};

const insertActivityEvent = async (
  input: NormalizedSalesActivityEventInput,
  prospect: ProspectRow | null,
  userId: string | null,
): Promise<SalesActivityEvent> => {
  const supabase = getSupabaseAdmin();
  const source = sanitizeSource(input.source);
  const payload = input.payload ?? {};

  if (input.externalEventId) {
    const { data: existing, error: existingError } = await supabase
      .from("activity_events")
      .select(
        "id, org_id, user_id, prospect_id, source, external_event_id, event_type, channel, direction, occurred_at, hubspot_contact_id, hubspot_deal_id",
      )
      .eq("org_id", input.orgId)
      .eq("source", source)
      .eq("external_event_id", input.externalEventId)
      .maybeSingle();

    if (existingError) {
      throw new Error(`Impossible de verifier l'evenement existant: ${existingError.message}`);
    }

    if (existing) {
      return mapActivityEventRow(existing as ActivityEventRow, true);
    }
  }

  const meta = EVENT_TYPE_META[input.eventType];
  const { data, error } = await supabase
    .from("activity_events")
    .insert({
      org_id: input.orgId,
      user_id: userId,
      prospect_id: prospect?.id ?? null,
      source,
      external_event_id: input.externalEventId ?? null,
      event_type: input.eventType,
      channel: meta.channel,
      direction: meta.direction,
      occurred_at: normalizeIsoDate(input.occurredAt, new Date()),
      hubspot_contact_id: input.hubspotContactId ?? prospect?.hubspot_contact_id ?? null,
      hubspot_deal_id: input.hubspotDealId ?? prospect?.hubspot_deal_id ?? null,
      payload,
    })
    .select(
      "id, org_id, user_id, prospect_id, source, external_event_id, event_type, channel, direction, occurred_at, hubspot_contact_id, hubspot_deal_id",
    )
    .single();

  if (error) {
    throw new Error(`Impossible de persister l'evenement: ${error.message}`);
  }

  return mapActivityEventRow(data as ActivityEventRow, false);
};

const updateProspectFromEvent = async (
  event: SalesActivityEvent,
  prospect: ProspectRow | null,
  payload: Record<string, unknown>,
): Promise<void> => {
  if (!prospect || event.duplicate) {
    return;
  }

  const updates: Record<string, unknown> = {};
  const currentDealAmount = toNumber(prospect.deal_amount);
  const nextDealAmount = event.eventType === "deal.updated" ? readFirstNumber(payload, ["dealAmount", "amount"]) : null;
  const nextCloseProbability =
    event.eventType === "deal.updated" ? readFirstNumber(payload, ["closeProbability", "probability"]) : null;
  const nextDealStage = event.eventType === "deal.updated" ? readFirstString(payload, ["dealStage", "stage"]) : null;
  const nextLastContactAt =
    event.eventType === "deal.updated"
      ? prospect.last_contact_at
      : event.eventType === "call.completed" || isIncomingClientResponse(event.eventType) || isOutboundMessage(event.eventType)
        ? event.occurredAt
        : prospect.last_contact_at;

  if (nextDealAmount !== null) {
    updates.deal_amount = nextDealAmount;
  }

  if (nextCloseProbability !== null) {
    updates.close_probability = Math.round(clamp(nextCloseProbability, 0, 100));
  }

  if (nextDealStage) {
    updates.deal_stage = nextDealStage;
  }

  if (nextLastContactAt && nextLastContactAt !== prospect.last_contact_at) {
    updates.last_contact_at = nextLastContactAt;
  }

  if (isIncomingClientResponse(event.eventType)) {
    updates.next_action = "Repondre au client";
    updates.next_action_at = normalizeWorkSlot(
      addMinutes(new Date(event.occurredAt), 10),
      new Date(),
      getEstimatedSalesTaskDurationMinutes("respond_to_client"),
    ).toISOString();
    updates.snoozed_until = null;
    updates.skipped_at = null;
  }

  if (event.eventType === "call.completed") {
    updates.next_action = "Definir le prochain pas apres l'appel";
    updates.next_action_at = normalizeWorkSlot(
      addMinutes(new Date(event.occurredAt), 30),
      new Date(),
      getEstimatedSalesTaskDurationMinutes("post_call_next_step"),
    ).toISOString();
  }

  if (Object.keys(updates).length === 0) {
    return;
  }

  const score = scoreProspect({
    dealAmount: nextDealAmount ?? currentDealAmount,
    closeProbability: nextCloseProbability ?? prospect.close_probability,
    dealStage: nextDealStage ?? prospect.deal_stage,
    lastContactAt: nextLastContactAt,
    closeDate: getProspectCloseDate(prospect.raw_data, payload),
    snoozedUntil: updates.snoozed_until === null ? null : prospect.snoozed_until,
    skippedAt: updates.skipped_at === null ? null : prospect.skipped_at,
    aiSummary: prospect.ai_summary,
    nextAction: typeof updates.next_action === "string" ? updates.next_action : prospect.next_action,
    dealName: getProspectDealName(prospect.raw_data) ?? prospect.hubspot_deal_id,
  });

  updates.ai_priority_score = score.ai_priority_score;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("prospects").update(updates).eq("id", prospect.id);

  if (error) {
    throw new Error(`Impossible de mettre a jour le prospect: ${error.message}`);
  }
};

const loadOpenTasksByProspect = async (prospectId: string): Promise<SalesTaskRow[]> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("sales_tasks")
    .select(
      "id, org_id, user_id, prospect_id, source_event_id, task_key, task_type, title, context, reason, scheduled_at, estimated_duration_minutes, priority_score, status, snoozed_until, completed_at, skipped_at, canceled_at, hubspot_contact_id, hubspot_deal_id, created_at, updated_at",
    )
    .eq("prospect_id", prospectId)
    .in("status", ACTIVE_TASK_STATUSES);

  if (error) {
    throw new Error(`Impossible de charger les taches actives: ${error.message}`);
  }

  return (data ?? []) as SalesTaskRow[];
};

const loadOpenTasksByUser = async (userId: string, excludedTaskKey: string): Promise<SalesTaskRow[]> => {
  const supabase = getSupabaseAdmin();
  const now = new Date();
  const startOfToday = setTime(now, 0);
  const horizon = addDays(startOfToday, 14);
  const { data, error } = await supabase
    .from("sales_tasks")
    .select(
      "id, org_id, user_id, prospect_id, source_event_id, task_key, task_type, title, context, reason, scheduled_at, estimated_duration_minutes, priority_score, status, snoozed_until, completed_at, skipped_at, canceled_at, hubspot_contact_id, hubspot_deal_id, created_at, updated_at",
    )
    .eq("user_id", userId)
    .neq("task_key", excludedTaskKey)
    .in("status", ACTIVE_TASK_STATUSES)
    .gte("scheduled_at", startOfToday.toISOString())
    .lt("scheduled_at", horizon.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(500);

  if (error) {
    throw new Error(`Impossible de charger les taches du commercial: ${error.message}`);
  }

  return (data ?? []) as SalesTaskRow[];
};

const upsertPlannedTask = async ({
  event,
  plan,
  prospect,
  userId,
}: {
  event: SalesActivityEvent;
  plan: SalesTaskUpsertPlan;
  prospect: ProspectRow;
  userId: string;
}): Promise<"created" | "updated"> => {
  const supabase = getSupabaseAdmin();
  const { data: existing, error: existingError } = await supabase
    .from("sales_tasks")
    .select("id")
    .eq("org_id", event.orgId)
    .eq("task_key", plan.taskKey)
    .in("status", ACTIVE_TASK_STATUSES)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Impossible de verifier la tache existante: ${existingError.message}`);
  }

  const now = new Date();
  const scheduledAt = findNextAvailableWorkSlot({
    durationMinutes: plan.estimatedDurationMinutes,
    existingTasks: await loadOpenTasksByUser(userId, plan.taskKey),
    now,
    preferredAt: new Date(plan.scheduledAt),
  }).toISOString();
  const priorityScore = scoreSalesTask(
    {
      taskType: plan.taskType,
      scheduledAt,
      status: "pending",
      dealAmount: toNumber(prospect.deal_amount),
      closeProbability: prospect.close_probability,
      closeDate: getProspectCloseDate(prospect.raw_data),
      lastContactAt: prospect.last_contact_at,
      hasIncomingClientResponse: plan.taskType === "respond_to_client",
    },
    now,
  );

  const row = {
    org_id: event.orgId,
    user_id: userId,
    prospect_id: prospect.id,
    source_event_id: event.id,
    task_key: plan.taskKey,
    task_type: plan.taskType,
    title: plan.title,
    context: plan.context,
    reason: plan.reason,
    scheduled_at: scheduledAt,
    estimated_duration_minutes: plan.estimatedDurationMinutes,
    priority_score: priorityScore,
    status: "pending" as const,
    snoozed_until: null,
    hubspot_contact_id: event.hubspotContactId ?? prospect.hubspot_contact_id,
    hubspot_deal_id: event.hubspotDealId ?? prospect.hubspot_deal_id,
    metadata: {
      planner: "deterministic_v1",
      eventType: event.eventType,
      eventId: event.id,
      preferredScheduledAt: plan.scheduledAt,
    },
    last_recalculated_at: now.toISOString(),
  };

  if (existing) {
    const { error } = await supabase.from("sales_tasks").update(row).eq("id", (existing as { id: string }).id);

    if (error) {
      throw new Error(`Impossible de mettre a jour la tache: ${error.message}`);
    }

    return "updated";
  }

  const { error } = await supabase.from("sales_tasks").insert(row);

  if (error) {
    throw new Error(`Impossible de creer la tache: ${error.message}`);
  }

  return "created";
};

const cancelPlannedTask = async (
  orgId: string,
  cancellation: SalesTaskCancelPlan,
): Promise<number> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("sales_tasks")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
      reason: cancellation.reason,
      last_recalculated_at: new Date().toISOString(),
    })
    .eq("org_id", orgId)
    .eq("task_key", cancellation.taskKey)
    .in("status", ACTIVE_TASK_STATUSES)
    .select("id");

  if (error) {
    throw new Error(`Impossible d'annuler la tache: ${error.message}`);
  }

  return (data ?? []).length;
};

const recalculateOpenTasks = async (prospect: ProspectRow): Promise<number> => {
  const openTasks = await loadOpenTasksByProspect(prospect.id);
  const now = new Date();
  const closeDate = getProspectCloseDate(prospect.raw_data);
  const supabase = getSupabaseAdmin();
  let recalculated = 0;

  for (const task of openTasks) {
    const estimatedDurationMinutes = getExistingTaskDurationMinutes(task);
    const scheduledAt =
      task.status === "snoozed" && task.snoozed_until
        ? normalizeWorkSlot(new Date(task.snoozed_until), now, estimatedDurationMinutes).toISOString()
        : task.scheduled_at;
    const priorityScore = scoreSalesTask(
      {
        taskType: task.task_type,
        scheduledAt,
        status: task.status,
        dealAmount: toNumber(prospect.deal_amount),
        closeProbability: prospect.close_probability,
        closeDate,
        lastContactAt: prospect.last_contact_at,
        hasIncomingClientResponse: task.task_type === "respond_to_client",
        snoozedUntil: task.snoozed_until,
      },
      now,
    );

    const { error } = await supabase
      .from("sales_tasks")
      .update({
        priority_score: priorityScore,
        scheduled_at: scheduledAt,
        estimated_duration_minutes: estimatedDurationMinutes,
        last_recalculated_at: now.toISOString(),
      })
      .eq("id", task.id);

    if (error) {
      throw new Error(`Impossible de recalculer une tache: ${error.message}`);
    }

    recalculated += 1;
  }

  return recalculated;
};

const loadProspectSummaries = async (prospectIds: string[]): Promise<Map<string, SalesTaskProspectSummary>> => {
  const uniqueProspectIds = Array.from(new Set(prospectIds));

  if (uniqueProspectIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("prospects")
    .select(
      "id, org_id, owner_user_id, hubspot_contact_id, hubspot_deal_id, name, company, title, email, phone, deal_stage, deal_amount, close_probability, last_contact_at, next_action, next_action_at, ai_summary, snoozed_until, skipped_at, raw_data, synced_at",
    )
    .in("id", uniqueProspectIds);

  if (error) {
    throw new Error(`Impossible de charger les prospects des taches: ${error.message}`);
  }

  return new Map(((data ?? []) as ProspectRow[]).map((prospect) => [prospect.id, getProspectSummary(prospect)]));
};

const loadTasksByIds = async (taskIds: string[]): Promise<SalesTaskListItem[]> => {
  const uniqueTaskIds = Array.from(new Set(taskIds));

  if (uniqueTaskIds.length === 0) {
    return [];
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("sales_tasks")
    .select(
      "id, org_id, user_id, prospect_id, source_event_id, task_key, task_type, title, context, reason, scheduled_at, estimated_duration_minutes, priority_score, status, snoozed_until, completed_at, skipped_at, canceled_at, hubspot_contact_id, hubspot_deal_id, created_at, updated_at",
    )
    .in("id", uniqueTaskIds);

  if (error) {
    throw new Error(`Impossible de charger les taches: ${error.message}`);
  }

  const rows = (data ?? []) as SalesTaskRow[];
  const prospectById = await loadProspectSummaries(rows.map((row) => row.prospect_id).filter((id): id is string => Boolean(id)));

  return rows.map((row) => mapSalesTaskRow(row, prospectById));
};

const loadTasksForEventUser = async (userId: string | null): Promise<SalesTaskListItem[]> => {
  if (!userId) {
    return [];
  }

  const payload = await getTodaySalesTasks(userId);

  return payload.tasks;
};

export const acceptNormalizedSalesActivityEvent = async (
  input: NormalizedSalesActivityEventInput,
): Promise<AcceptedSalesActivityEvent> => {
  const prospect = await resolveProspect(input);
  const userId = await resolveUserId(input, prospect);
  const event = await insertActivityEvent(input, prospect, userId);
  const emptyPlanning = {
    created: 0,
    updated: 0,
    canceled: 0,
    recalculated: 0,
    skippedReason: null,
    tasks: await loadTasksForEventUser(userId),
  } satisfies TaskPlanningResult;

  if (event.duplicate) {
    return {
      event,
      planning: {
        ...emptyPlanning,
        skippedReason: "Evenement deja traite.",
      },
    };
  }

  await updateProspectFromEvent(event, prospect, input.payload ?? {});

  const refreshedProspect = prospect ? await loadProspectById(prospect.org_id, prospect.id) : null;
  const effectiveProspect = refreshedProspect ?? prospect;

  if (!effectiveProspect) {
    return {
      event,
      planning: {
        ...emptyPlanning,
        skippedReason: "Aucun prospect Jarvis ne correspond a l'evenement.",
      },
    };
  }

  if (!userId) {
    return {
      event,
      planning: {
        ...emptyPlanning,
        skippedReason: "Aucun commercial Jarvis n'est rattache au prospect.",
      },
    };
  }

  const eventPlan = buildSalesTaskPlanForEvent({
    event: {
      id: event.id,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
    },
    prospect: getPlanningProspectSnapshot(effectiveProspect, input.payload ?? {}),
  });
  let created = 0;
  let updated = 0;
  let canceled = 0;

  for (const cancellation of eventPlan.cancellations) {
    canceled += await cancelPlannedTask(event.orgId, cancellation);
  }

  for (const taskPlan of eventPlan.upserts) {
    const result = await upsertPlannedTask({
      event,
      plan: taskPlan,
      prospect: effectiveProspect,
      userId,
    });

    if (result === "created") {
      created += 1;
    } else {
      updated += 1;
    }
  }

  const recalculated = await recalculateOpenTasks(effectiveProspect);

  return {
    event,
    planning: {
      created,
      updated,
      canceled,
      recalculated,
      skippedReason: eventPlan.upserts.length === 0 && eventPlan.cancellations.length === 0 ? "Aucune tache requise pour cet evenement." : null,
      tasks: await loadTasksForEventUser(userId),
    },
  };
};

const getTaskSortValue = (task: SalesTaskListItem): number => {
  const statusRank: Record<SalesTaskStatus, number> = {
    pending: 0,
    snoozed: 1,
    done: 2,
    skipped: 3,
    canceled: 4,
  };

  return statusRank[task.status] * 1_000_000_000_000 + new Date(task.scheduledAt).getTime() - task.priorityScore * 60_000;
};

const isTaskVisibleToday = (task: SalesTaskListItem, startOfToday: Date, endOfToday: Date): boolean => {
  const scheduledAt = new Date(task.scheduledAt).getTime();
  const scheduledBeforeTomorrow = !Number.isNaN(scheduledAt) && scheduledAt < endOfToday.getTime();
  const completedAt = task.completedAt ? new Date(task.completedAt).getTime() : null;
  const skippedAt = task.skippedAt ? new Date(task.skippedAt).getTime() : null;

  if (task.status === "pending") {
    return scheduledBeforeTomorrow;
  }

  if (task.status === "snoozed") {
    const snoozedUntil = task.snoozedUntil ? new Date(task.snoozedUntil).getTime() : null;

    return scheduledBeforeTomorrow || (snoozedUntil !== null && snoozedUntil < endOfToday.getTime());
  }

  if (task.status === "done") {
    return completedAt !== null && completedAt >= startOfToday.getTime();
  }

  if (task.status === "skipped") {
    return skippedAt !== null && skippedAt >= startOfToday.getTime();
  }

  return false;
};

export const getTodaySalesTasks = async (userId: string): Promise<SalesTasksTodayPayload> => {
  assertUuid(userId, "userId");

  const user = await loadUserRecordById(userId);

  if (!user?.org_id) {
    throw new Error("Commercial introuvable ou sans organisation.");
  }

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("sales_tasks")
    .select(
      "id, org_id, user_id, prospect_id, source_event_id, task_key, task_type, title, context, reason, scheduled_at, estimated_duration_minutes, priority_score, status, snoozed_until, completed_at, skipped_at, canceled_at, hubspot_contact_id, hubspot_deal_id, created_at, updated_at",
    )
    .eq("user_id", userId)
    .neq("status", "canceled")
    .lt("scheduled_at", endOfToday.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(500);

  if (error) {
    if (isSupabaseSchemaUnavailableError(error)) {
      return buildEmptySalesTasksTodayPayload(userId, user.org_id, now.toISOString());
    }

    throw new Error(`Impossible de charger les taches du jour: ${error.message}`);
  }

  const rows = (data ?? []) as SalesTaskRow[];
  const prospectById = await loadProspectSummaries(rows.map((row) => row.prospect_id).filter((id): id is string => Boolean(id)));
  const tasks = rows
    .map((row) => mapSalesTaskRow(row, prospectById))
    .filter((task) => isTaskVisibleToday(task, startOfToday, endOfToday))
    .sort((left, right) => getTaskSortValue(left) - getTaskSortValue(right));
  const openTasks = tasks.filter((task) => task.status === "pending" || task.status === "snoozed");
  const nowTask =
    openTasks.find((task) => new Date(task.scheduledAt).getTime() <= now.getTime()) ?? openTasks[0] ?? null;
  const nextTask = openTasks.find((task) => task.id !== nowTask?.id) ?? null;

  return {
    userId,
    orgId: user.org_id,
    generatedAt: now.toISOString(),
    tasks,
    nowTask,
    nextTask,
    counts: {
      pending: tasks.filter((task) => task.status === "pending").length,
      snoozed: tasks.filter((task) => task.status === "snoozed").length,
      skipped: tasks.filter((task) => task.status === "skipped").length,
      done: tasks.filter((task) => task.status === "done").length,
    },
  };
};

const loadTaskById = async (taskId: string): Promise<SalesTaskListItem | null> => {
  assertUuid(taskId, "taskId");

  const tasks = await loadTasksByIds([taskId]);

  return tasks[0] ?? null;
};

const assertTaskActionAccess = (task: SalesTaskListItem, auth: AuthContext): void => {
  if (auth.orgId && task.orgId !== auth.orgId) {
    throw new Error("Cette session n'a pas acces a cette tache.");
  }

  if (auth.role === "sales" && (!auth.appUserId || task.userId !== auth.appUserId)) {
    throw new Error("Un commercial ne peut modifier que ses propres taches.");
  }
};

export const completeSalesTask = async (taskId: string, auth: AuthContext): Promise<SalesTaskActionResult> => {
  const currentTask = await loadTaskById(taskId);

  if (!currentTask) {
    throw new Error("Tache introuvable.");
  }

  assertTaskActionAccess(currentTask, auth);

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("sales_tasks")
    .update({
      status: "done",
      completed_at: now,
      snoozed_until: null,
      priority_score: 0,
      last_recalculated_at: now,
    })
    .eq("id", taskId)
    .in("status", ACTIVE_TASK_STATUSES);

  if (error) {
    throw new Error(`Impossible de terminer la tache: ${error.message}`);
  }

  const task = await loadTaskById(taskId);

  if (!task) {
    throw new Error("Tache introuvable.");
  }

  return { task };
};

export const snoozeSalesTask = async (
  taskId: string,
  snoozedUntil: string,
  auth: AuthContext,
  reason?: string | null,
): Promise<SalesTaskActionResult> => {
  assertUuid(taskId, "taskId");
  const snoozeDate = new Date(snoozedUntil);

  if (Number.isNaN(snoozeDate.getTime())) {
    throw new Error("snoozedUntil doit etre une date ISO valide.");
  }

  const currentTask = await loadTaskById(taskId);

  if (!currentTask) {
    throw new Error("Tache introuvable.");
  }

  assertTaskActionAccess(currentTask, auth);

  const nowDate = new Date();
  const scheduledAt = normalizeWorkSlot(
    snoozeDate,
    nowDate,
    currentTask.estimatedDurationMinutes,
  ).toISOString();
  const priorityScore = scoreSalesTask({
    taskType: currentTask.taskType,
    scheduledAt,
    status: "snoozed",
    dealAmount: currentTask.prospect?.dealAmount ?? null,
    closeProbability: currentTask.prospect?.closeProbability ?? null,
    closeDate: null,
    lastContactAt: null,
    hasIncomingClientResponse: currentTask.taskType === "respond_to_client",
    snoozedUntil: scheduledAt,
  });
  const now = nowDate.toISOString();
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("sales_tasks")
    .update({
      status: "snoozed",
      scheduled_at: scheduledAt,
      snoozed_until: scheduledAt,
      estimated_duration_minutes: currentTask.estimatedDurationMinutes,
      priority_score: priorityScore,
      reason: reason?.trim() ? `${currentTask.reason} Snooze: ${reason.trim()}` : currentTask.reason,
      last_recalculated_at: now,
    })
    .eq("id", taskId)
    .in("status", ACTIVE_TASK_STATUSES);

  if (error) {
    throw new Error(`Impossible de snoozer la tache: ${error.message}`);
  }

  const task = await loadTaskById(taskId);

  if (!task) {
    throw new Error("Tache introuvable.");
  }

  return { task };
};

export const skipSalesTask = async (
  taskId: string,
  auth: AuthContext,
  reason?: string | null,
): Promise<SalesTaskActionResult> => {
  assertUuid(taskId, "taskId");

  const currentTask = await loadTaskById(taskId);

  if (!currentTask) {
    throw new Error("Tache introuvable.");
  }

  assertTaskActionAccess(currentTask, auth);

  const now = new Date().toISOString();
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("sales_tasks")
    .update({
      status: "skipped",
      skipped_at: now,
      priority_score: 0,
      reason: reason?.trim() ? `${currentTask.reason} Skip: ${reason.trim()}` : currentTask.reason,
      last_recalculated_at: now,
    })
    .eq("id", taskId)
    .in("status", ACTIVE_TASK_STATUSES);

  if (error) {
    throw new Error(`Impossible d'ignorer la tache: ${error.message}`);
  }

  const task = await loadTaskById(taskId);

  if (!task) {
    throw new Error("Tache introuvable.");
  }

  return { task };
};
