import {
  HUBSPOT_CALL_PROPERTIES,
  HUBSPOT_COMMUNICATION_PROPERTIES,
  HUBSPOT_EMAIL_PROPERTIES,
  HUBSPOT_MEETING_PROPERTIES,
  HUBSPOT_NOTE_PROPERTIES,
  fetchObjectById,
} from "./client.js";
import { resolveStageLabelById, type HubSpotDealStageDefinition } from "./pipelines.js";
import { parsePercentage, readProperty, toNullablePropertiesRecord } from "./shared.js";
import type {
  HubSpotActivityAssociations,
  HubSpotActivityRecord,
  HubSpotActivitySnapshot,
  HubSpotActivityType,
  HubSpotDealHistoryItem,
} from "./types.js";

export const normalizeCommunicationChannel = (channel: string | null): string | null => {
  if (!channel?.trim()) {
    return null;
  }

  return channel.trim().toUpperCase();
};

export const communicationTypeLabel = (channel: string | null): string => {
  const normalizedChannel = normalizeCommunicationChannel(channel);

  if (normalizedChannel === "SMS") {
    return "SMS";
  }

  if (normalizedChannel === "WHATS_APP" || normalizedChannel === "WHATSAPP") {
    return "WhatsApp";
  }

  if (normalizedChannel === "LINKEDIN_MESSAGE") {
    return "LinkedIn";
  }

  if (normalizedChannel === "FACEBOOK_MESSENGER") {
    return "Messenger";
  }

  return normalizedChannel ? normalizedChannel.replaceAll("_", " ") : "Message";
};

export const toHistoryItem = (
  type: HubSpotDealHistoryItem["type"],
  record: { id: string; properties: Record<string, string | null | undefined> },
  dealStageLookup?: Map<string, HubSpotDealStageDefinition>,
): HubSpotDealHistoryItem => {
  if (type === "deal") {
    const stageId = readProperty(record.properties, "dealstage");
    const rawProbability = readProperty(record.properties, "hs_deal_stage_probability");

    return {
      id: record.id,
      type,
      timestamp:
        readProperty(record.properties, "createdate") ??
        readProperty(record.properties, "hs_lastmodifieddate") ??
        readProperty(record.properties, "closedate"),
      title: readProperty(record.properties, "dealname") ?? `Deal ${record.id}`,
      body: "Creation du deal dans HubSpot.",
      metadata: {
        amount: readProperty(record.properties, "amount"),
        stage: dealStageLookup ? resolveStageLabelById(stageId, dealStageLookup) : stageId,
        ownerId: readProperty(record.properties, "hubspot_owner_id"),
        probability: rawProbability === null ? null : `${parsePercentage(rawProbability)}%`,
        createdAt: readProperty(record.properties, "createdate"),
        closedAt: readProperty(record.properties, "closedate"),
        lastModifiedAt: readProperty(record.properties, "hs_lastmodifieddate"),
      },
    };
  }

  if (type === "note") {
    return {
      id: record.id,
      type,
      timestamp: readProperty(record.properties, "hs_timestamp"),
      title: `Note ${record.id}`,
      body: readProperty(record.properties, "hs_note_body"),
      metadata: {
        ownerId: readProperty(record.properties, "hubspot_owner_id"),
      },
    };
  }

  if (type === "call") {
    return {
      id: record.id,
      type,
      timestamp: readProperty(record.properties, "hs_timestamp"),
      title: readProperty(record.properties, "hs_call_title") ?? `Call ${record.id}`,
      body: readProperty(record.properties, "hs_call_body"),
      metadata: {
        status: readProperty(record.properties, "hs_call_status"),
        disposition: readProperty(record.properties, "hs_call_disposition"),
        ownerId: readProperty(record.properties, "hubspot_owner_id"),
      },
    };
  }

  if (type === "meeting") {
    return {
      id: record.id,
      type,
      timestamp: readProperty(record.properties, "hs_timestamp") ?? readProperty(record.properties, "hs_meeting_start_time"),
      title: readProperty(record.properties, "hs_meeting_title") ?? `Meeting ${record.id}`,
      body: readProperty(record.properties, "hs_meeting_body"),
      metadata: {
        startTime: readProperty(record.properties, "hs_meeting_start_time"),
        endTime: readProperty(record.properties, "hs_meeting_end_time"),
        ownerId: readProperty(record.properties, "hubspot_owner_id"),
      },
    };
  }

  if (type === "sms" || type === "communication") {
    const channel = readProperty(record.properties, "hs_communication_channel_type");

    return {
      id: record.id,
      type,
      timestamp: readProperty(record.properties, "hs_timestamp"),
      title: communicationTypeLabel(channel),
      body: readProperty(record.properties, "hs_communication_body"),
      metadata: {
        channel,
        ownerId: readProperty(record.properties, "hubspot_owner_id"),
      },
    };
  }

  if (type === "task") {
    return {
      id: record.id,
      type,
      timestamp: readProperty(record.properties, "hs_timestamp"),
      title: readProperty(record.properties, "hs_task_subject") ?? `Task ${record.id}`,
      body: readProperty(record.properties, "hs_task_body"),
      metadata: {
        status: readProperty(record.properties, "hs_task_status"),
        priority: readProperty(record.properties, "hs_task_priority"),
        taskType: readProperty(record.properties, "hs_task_type"),
        ownerId: readProperty(record.properties, "hubspot_owner_id"),
      },
    };
  }

  return {
    id: record.id,
    type,
    timestamp: readProperty(record.properties, "hs_timestamp"),
    title: readProperty(record.properties, "hs_email_subject") ?? `Email ${record.id}`,
    body: readProperty(record.properties, "hs_email_text"),
    metadata: {
      status: readProperty(record.properties, "hs_email_status"),
      direction: readProperty(record.properties, "hs_email_direction"),
      ownerId: readProperty(record.properties, "hubspot_owner_id"),
    },
  };
};

export const activityFetchConfigByType: Record<HubSpotActivityType, { objectType: string; properties: string[] }> = {
  call: {
    objectType: "calls",
    properties: HUBSPOT_CALL_PROPERTIES,
  },
  communication: {
    objectType: "communications",
    properties: HUBSPOT_COMMUNICATION_PROPERTIES,
  },
  email: {
    objectType: "emails",
    properties: HUBSPOT_EMAIL_PROPERTIES,
  },
  note: {
    objectType: "notes",
    properties: HUBSPOT_NOTE_PROPERTIES,
  },
  meeting: {
    objectType: "meetings",
    properties: HUBSPOT_MEETING_PROPERTIES,
  },
};

export const readActivityAssociationIds = (
  associations: HubSpotActivityAssociations | undefined,
  key: keyof HubSpotActivityAssociations,
): string[] => associations?.[key]?.results.map((item) => item.id).filter(Boolean) ?? [];

export const communicationRecordToHistoryType = (
  record: { properties: Record<string, string | null | undefined> },
): "sms" | "communication" =>
  normalizeCommunicationChannel(readProperty(record.properties, "hs_communication_channel_type")) === "SMS"
    ? "sms"
    : "communication";

export const activityTypeToHistoryType = (
  activityType: HubSpotActivityType,
  record?: { properties: Record<string, string | null | undefined> },
): HubSpotDealHistoryItem["type"] => {
  if (activityType === "communication") {
    return record ? communicationRecordToHistoryType(record) : "communication";
  }

  return activityType;
};

export const toActivitySnapshot = (
  activityType: HubSpotActivityType,
  record: HubSpotActivityRecord,
): HubSpotActivitySnapshot => {
  const historyItem = toHistoryItem(activityTypeToHistoryType(activityType, record), record);
  const channel =
    activityType === "communication"
      ? readProperty(record.properties, "hs_communication_channel_type")
      : activityType;

  return {
    id: record.id,
    activityType,
    channel,
    occurredAt: historyItem.timestamp,
    title: historyItem.title,
    body: historyItem.body,
    metadata: historyItem.metadata,
    properties: toNullablePropertiesRecord(record.properties, activityFetchConfigByType[activityType].properties),
    associatedContactIds: readActivityAssociationIds(record.associations, "contacts"),
    associatedCompanyIds: readActivityAssociationIds(record.associations, "companies"),
    associatedDealIds: readActivityAssociationIds(record.associations, "deals"),
  };
};

export const fetchActivity = async (
  accessToken: string,
  activityType: HubSpotActivityType,
  activityId: string,
): Promise<HubSpotActivitySnapshot> => {
  const config = activityFetchConfigByType[activityType];
  const record = await fetchObjectById<HubSpotActivityRecord>(
    accessToken,
    config.objectType,
    activityId,
    config.properties,
    ["contacts", "companies", "deals"],
  );

  return toActivitySnapshot(activityType, record);
};
