import type {
  NormalizedSalesActivityEventInput,
  ProspectRow,
  SalesActivityEventType,
  SalesTaskCancelPlan,
  SalesTaskPlan,
  SalesTaskType,
  SalesTaskUpsertPlan,
  TaskPlanEventSnapshot,
  TaskPlanProspectSnapshot,
} from "./types.js";
import {
  addDays,
  addMinutes,
  assertUuid,
  clamp,
  getDaysUntil,
  getProspectCloseDate,
  isRecord,
  isSalesActivityEventType,
  readFirstNumber,
  readFirstString,
  toNumber,
} from "./shared.js";
import { getEstimatedSalesTaskDurationMinutes, normalizeWorkSlot } from "./scheduling.js";
import { scoreSalesTask } from "./scoring.js";

export const buildTaskKey = (prospectId: string, taskType: SalesTaskType): string => `${prospectId}:${taskType}`;

export const isIncomingClientResponse = (eventType: SalesActivityEventType): boolean =>
  eventType === "call.received" || eventType === "email.received" || eventType === "sms.received";

export const isOutboundMessage = (eventType: SalesActivityEventType): boolean =>
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

export const getPlanningProspectSnapshot = (prospect: ProspectRow, payload: Record<string, unknown>): TaskPlanProspectSnapshot => ({
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
