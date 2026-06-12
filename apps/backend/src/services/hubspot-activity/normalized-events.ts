import { acceptNormalizedSalesActivityEvent } from "../task-planning.service.js";
import type { NormalizedSalesActivityEventInput, SalesActivityEventType } from "../task-planning/types.js";
import type { HubSpotActivitySnapshot } from "../hubspot.service.js";
import {
  normalizeActivityTableType,
  normalizeCallDirection,
  normalizeCallStatus,
  normalizeWebhookDate,
  parseManualProbability,
  parseWebhookAmount,
  parseWebhookProbability,
  readActivityMetadata,
} from "./shared.js";
import type { DealLifecycleStatus, HubSpotWebhookEventRow } from "./types.js";

const DEAL_PROPERTY_EVENT_TYPES: Record<string, SalesActivityEventType> = {
  amount: "deal.amount_changed",
  closedate: "deal.close_date_changed",
  dealstage: "deal.stage_changed",
  hs_deal_stage_probability: "deal.probability_changed",
  probabilite_de__closing: "deal.probability_changed",
  hubspot_owner_id: "deal.owner_changed",
  pipeline: "deal.pipeline_changed",
};

const normalizeActivityDirection = (value: string | null): "inbound" | "outbound" | null => {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized.includes("inbound") || normalized.includes("incoming")) {
    return "inbound";
  }

  if (normalized.includes("outbound") || normalized.includes("outgoing")) {
    return "outbound";
  }

  return null;
};

export const acceptNormalizedDealWebhookEvent = async ({
  event,
  hubspotDealId,
  lifecycleStatus,
}: {
  event: HubSpotWebhookEventRow;
  hubspotDealId: string;
  lifecycleStatus: DealLifecycleStatus | null;
}): Promise<void> => {
  if (!event.org_id) {
    return;
  }

  const eventType =
    lifecycleStatus === "won"
      ? "deal.won"
      : lifecycleStatus === "lost"
        ? "deal.lost"
        : event.subscription_type === "object.creation" || event.subscription_type === "deal.creation"
          ? "deal.created"
          : event.property_name
            ? DEAL_PROPERTY_EVENT_TYPES[event.property_name] ?? "deal.updated"
            : "deal.updated";

  const closeProbability =
    lifecycleStatus === "won"
      ? 100
      : lifecycleStatus === "lost"
        ? 0
        : event.property_name === "hs_deal_stage_probability"
          ? parseWebhookProbability(event.property_value)
          : event.property_name === "probabilite_de__closing"
            ? parseManualProbability(event.property_value)
            : null;

  await acceptNormalizedSalesActivityEvent({
    orgId: event.org_id,
    eventType,
    hubspotDealId,
    hubspotOwnerId: event.property_name === "hubspot_owner_id" ? event.property_value : null,
    externalEventId: event.id,
    source: "hubspot_webhook",
    occurredAt: normalizeWebhookDate(event.occurred_at) ?? event.occurred_at,
    payload: {
      hubspotWebhookEventId: event.id,
      subscriptionType: event.subscription_type,
      objectTypeId: event.object_type_id,
      propertyName: event.property_name,
      propertyValue: event.property_value,
      amount: event.property_name === "amount" ? parseWebhookAmount(event.property_value) : null,
      closeProbability,
      closeDate: event.property_name === "closedate" ? normalizeWebhookDate(event.property_value) : null,
      dealStage: event.property_name === "dealstage" ? event.property_value : null,
      pipeline: event.property_name === "pipeline" ? event.property_value : null,
      lifecycleStatus,
    },
  });
};

const resolveActivityEventType = (activity: HubSpotActivitySnapshot): SalesActivityEventType | null => {
  const tableType = normalizeActivityTableType(activity);
  const direction = normalizeActivityDirection(
    readActivityMetadata(activity, "direction") ??
      activity.properties.hs_call_direction ??
      activity.properties.hs_email_direction ??
      null,
  );

  if (tableType === "call") {
    const status = normalizeCallStatus(activity);

    if (status !== "completed") {
      return null;
    }

    return normalizeCallDirection(activity.properties.hs_call_direction ?? null) === "inbound"
      ? "call.received"
      : "call.completed";
  }

  if (tableType === "email") {
    return direction === "inbound" ? "email.received" : "email.sent";
  }

  if (tableType === "sms") {
    return direction === "inbound" ? "sms.received" : "sms.sent";
  }

  if (tableType === "meeting") {
    return "meeting.completed";
  }

  if (tableType === "note") {
    return "note.created";
  }

  return null;
};

export const acceptNormalizedActivityEvents = async ({
  orgId,
  activity,
  impactedDealIds,
  sourceEventId,
}: {
  orgId: string;
  activity: HubSpotActivitySnapshot;
  impactedDealIds: string[];
  sourceEventId: string | null;
}): Promise<void> => {
  const eventType = resolveActivityEventType(activity);

  if (!eventType) {
    return;
  }

  const hubspotOwnerId = readActivityMetadata(activity, "ownerId");
  const contactId = activity.associatedContactIds[0] ?? null;
  const basePayload = {
    hubspotActivityId: activity.id,
    hubspotActivityType: activity.activityType,
    hubspotActivityChannel: activity.channel,
    title: activity.title,
    status: readActivityMetadata(activity, "status") ?? activity.properties.hs_call_status ?? activity.properties.hs_email_status ?? null,
    sourceWebhookEventId: sourceEventId,
  };

  const targets = impactedDealIds.length > 0 ? impactedDealIds : [null];

  await Promise.all(
    targets.map((hubspotDealId) =>
      acceptNormalizedSalesActivityEvent({
        orgId,
        eventType,
        hubspotDealId,
        hubspotContactId: contactId,
        hubspotOwnerId,
        externalEventId: `activity:${activity.id}:${hubspotDealId ?? "no-deal"}`,
        source: "hubspot_activity",
        occurredAt: activity.occurredAt,
        payload: basePayload,
      } satisfies NormalizedSalesActivityEventInput),
    ),
  );
};
