import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { getSupabaseAdmin } from "../db/client.js";
import { enqueueHubSpotRealtimeJob } from "./hubspot-realtime-queue.service.js";

export type HubSpotWebhookSubscriptionType =
  | "object.creation"
  | "object.deletion"
  | "object.merge"
  | "object.restore"
  | "object.propertyChange"
  | "object.associationChange"
  | "contact.privacyDeletion"
  | string;

export type NormalizedHubSpotWebhookEvent = {
  appId: string | null;
  portalId: string;
  subscriptionId: string | null;
  subscriptionType: HubSpotWebhookSubscriptionType;
  objectTypeId: string | null;
  objectId: string | null;
  propertyName: string | null;
  propertyValue: string | null;
  occurredAt: string | null;
  attemptNumber: number | null;
  eventId: string | null;
  changeSource: string | null;
  sourceId: string | null;
  association: {
    fromObjectId: string | null;
    fromObjectTypeId: string | null;
    toObjectId: string | null;
    toObjectTypeId: string | null;
    associationTypeId: string | null;
    associationCategory: string | null;
    associationRemoved: boolean | null;
    isPrimaryAssociation: boolean | null;
  };
  merge: {
    primaryObjectId: string | null;
    mergedObjectIds: string[];
    newObjectId: string | null;
  };
  payload: Record<string, unknown>;
  eventFingerprint: string;
};

type HubSpotWebhookHeaderMap = Record<string, string | string[] | undefined>;

type HubSpotWebhookSignatureInput = {
  appSecret: string;
  headers: HubSpotWebhookHeaderMap;
  method: string;
  requestUri: string;
  rawBody: string;
};

type AcceptHubSpotWebhookInput = {
  headers: HubSpotWebhookHeaderMap;
  method: string;
  requestUri: string;
  rawBody: string;
  parsedBody: unknown;
};

type HubSpotWebhookEventInsertRow = {
  org_id: string | null;
  portal_id: string;
  app_id: string | null;
  subscription_id: string | null;
  subscription_type: string;
  event_id: string | null;
  event_fingerprint: string;
  object_type_id: string | null;
  object_id: string | null;
  property_name: string | null;
  property_value: string | null;
  occurred_at: string | null;
  attempt_number: number | null;
  payload: Record<string, unknown>;
  processing_status: "queued" | "ignored";
  error_message: string | null;
};

type HubSpotWebhookEventInsertResult = {
  id: string;
  org_id: string | null;
  event_fingerprint: string;
  processing_status: string;
};

type OrganizationPortalRow = {
  id: string;
  hubspot_portal_id: string | null;
};

export type AcceptedHubSpotWebhookBatch = {
  accepted: number;
  duplicate: number;
};

const SIGNATURE_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

const getHeader = (headers: HubSpotWebhookHeaderMap, name: string): string | null => {
  const directValue = headers[name] ?? headers[name.toLowerCase()];
  const value = Array.isArray(directValue) ? directValue[0] : directValue;

  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const safeCompare = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
};

const decodeHubSpotSignatureUri = (requestUri: string): string =>
  requestUri
    .replace(/%3A/gi, ":")
    .replace(/%2F/gi, "/")
    .replace(/%3F/gi, "?")
    .replace(/%40/gi, "@")
    .replace(/%21/gi, "!")
    .replace(/%24/gi, "$")
    .replace(/%27/gi, "'")
    .replace(/%28/gi, "(")
    .replace(/%29/gi, ")")
    .replace(/%2A/gi, "*")
    .replace(/%2C/gi, ",")
    .replace(/%3B/gi, ";");

export const verifyHubSpotWebhookSignature = ({
  appSecret,
  headers,
  method,
  requestUri,
  rawBody,
}: HubSpotWebhookSignatureInput): boolean => {
  if (!appSecret) {
    return false;
  }

  const signatureV3 = getHeader(headers, "x-hubspot-signature-v3");
  const timestamp = getHeader(headers, "x-hubspot-request-timestamp");

  if (signatureV3 && timestamp) {
    const timestampMs = Number(timestamp);

    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > SIGNATURE_TIMESTAMP_TOLERANCE_MS) {
      return false;
    }

    const source = `${method.toUpperCase()}${decodeHubSpotSignatureUri(requestUri)}${rawBody}${timestamp}`;
    const expectedBase64 = createHmac("sha256", appSecret).update(source, "utf8").digest("base64");
    const expectedHex = createHmac("sha256", appSecret).update(source, "utf8").digest("hex");

    return safeCompare(signatureV3, expectedBase64) || safeCompare(signatureV3, expectedHex);
  }

  const legacySignature = getHeader(headers, "x-hubspot-signature");

  if (!legacySignature) {
    return false;
  }

  const version = getHeader(headers, "x-hubspot-signature-version");
  const legacySource =
    version === "v2"
      ? `${appSecret}${method.toUpperCase()}${decodeHubSpotSignatureUri(requestUri)}${rawBody}`
      : `${appSecret}${rawBody}`;
  const expectedLegacySignature = createHash("sha256").update(legacySource, "utf8").digest("hex");

  return safeCompare(legacySignature, expectedLegacySignature);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

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

const readBoolean = (record: Record<string, unknown>, key: string): boolean | null => {
  const value = record[key];

  return typeof value === "boolean" ? value : null;
};

const readStringArray = (record: Record<string, unknown>, key: string): string[] => {
  const value = record[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" || typeof item === "number" ? String(item) : null))
    .filter((item): item is string => Boolean(item?.trim()));
};

const normalizeTimestamp = (value: string | number | null): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (!value) {
    return null;
  }

  const stringValue = String(value);
  const parsed = Number(stringValue);
  const timestamp = Number.isFinite(parsed) && /^\d+$/.test(stringValue) ? parsed : new Date(stringValue).getTime();

  return Number.isFinite(timestamp) && !Number.isNaN(timestamp) ? new Date(timestamp).toISOString() : null;
};

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

const buildHubSpotWebhookEventFingerprint = (
  event: Omit<NormalizedHubSpotWebhookEvent, "eventFingerprint">,
): string => {
  const fingerprintSource = {
    appId: event.appId,
    portalId: event.portalId,
    subscriptionId: event.subscriptionId,
    subscriptionType: event.subscriptionType,
    objectTypeId: event.objectTypeId,
    objectId: event.objectId,
    propertyName: event.propertyName,
    propertyValue: event.propertyValue,
    occurredAt: event.occurredAt,
    association: event.association,
    merge: event.merge,
  };

  return createHash("sha256").update(stableStringify(fingerprintSource), "utf8").digest("hex");
};

const normalizeWebhookEvent = (payload: Record<string, unknown>): NormalizedHubSpotWebhookEvent | null => {
  const portalId = readString(payload, "portalId");
  const subscriptionType = readString(payload, "subscriptionType") ?? readString(payload, "eventType");

  if (!portalId || !subscriptionType) {
    return null;
  }

  const occurredAt = normalizeTimestamp(readString(payload, "occurredAt") ?? readString(payload, "label"));
  const eventWithoutFingerprint: Omit<NormalizedHubSpotWebhookEvent, "eventFingerprint"> = {
    appId: readString(payload, "appId"),
    portalId,
    subscriptionId: readString(payload, "subscriptionId"),
    subscriptionType,
    objectTypeId: readString(payload, "objectTypeId"),
    objectId: readString(payload, "objectId"),
    propertyName: readString(payload, "propertyName"),
    propertyValue: readString(payload, "propertyValue"),
    occurredAt,
    attemptNumber: readNumber(payload, "attemptNumber"),
    eventId: readString(payload, "eventId"),
    changeSource: readString(payload, "changeSource"),
    sourceId: readString(payload, "sourceId"),
    association: {
      fromObjectId: readString(payload, "fromObjectId"),
      fromObjectTypeId: readString(payload, "fromObjectTypeId"),
      toObjectId: readString(payload, "toObjectId"),
      toObjectTypeId: readString(payload, "toObjectTypeId"),
      associationTypeId: readString(payload, "associationTypeId"),
      associationCategory: readString(payload, "associationCategory"),
      associationRemoved: readBoolean(payload, "associationRemoved"),
      isPrimaryAssociation: readBoolean(payload, "isPrimaryAssociation"),
    },
    merge: {
      primaryObjectId: readString(payload, "primaryObjectId"),
      mergedObjectIds: readStringArray(payload, "mergedObjectIds"),
      newObjectId: readString(payload, "newObjectId"),
    },
    payload,
  };

  return {
    ...eventWithoutFingerprint,
    eventFingerprint: buildHubSpotWebhookEventFingerprint(eventWithoutFingerprint),
  };
};

export const parseHubSpotWebhookEvents = (payload: unknown): NormalizedHubSpotWebhookEvent[] => {
  const eventPayloads = Array.isArray(payload) ? payload : [payload];

  return eventPayloads
    .filter(isRecord)
    .map((eventPayload) => normalizeWebhookEvent(eventPayload))
    .filter((event): event is NormalizedHubSpotWebhookEvent => Boolean(event));
};

const loadOrgIdByPortalId = async (portalIds: string[]): Promise<Map<string, string>> => {
  if (portalIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("organizations")
    .select("id, hubspot_portal_id")
    .in("hubspot_portal_id", portalIds);

  if (error) {
    throw new Error(`Impossible de mapper les portals HubSpot: ${error.message}`);
  }

  return new Map(
    ((data ?? []) as OrganizationPortalRow[])
      .filter((row) => row.hubspot_portal_id)
      .map((row) => [row.hubspot_portal_id ?? "", row.id]),
  );
};

const persistWebhookEvents = async (
  events: NormalizedHubSpotWebhookEvent[],
): Promise<{
  inserted: HubSpotWebhookEventInsertResult[];
  duplicate: number;
  ignored: number;
}> => {
  if (events.length === 0) {
    return {
      inserted: [],
      duplicate: 0,
      ignored: 0,
    };
  }

  const portalIds = Array.from(new Set(events.map((event) => event.portalId)));
  const orgIdByPortalId = await loadOrgIdByPortalId(portalIds);
  const rows: HubSpotWebhookEventInsertRow[] = events.map((event) => {
    const orgId = orgIdByPortalId.get(event.portalId) ?? null;

    return {
      org_id: orgId,
      portal_id: event.portalId,
      app_id: event.appId,
      subscription_id: event.subscriptionId,
      subscription_type: event.subscriptionType,
      event_id: event.eventId,
      event_fingerprint: event.eventFingerprint,
      object_type_id: event.objectTypeId,
      object_id: event.objectId,
      property_name: event.propertyName,
      property_value: event.propertyValue,
      occurred_at: event.occurredAt,
      attempt_number: event.attemptNumber,
      payload: event.payload,
      processing_status: orgId ? "queued" : "ignored",
      error_message: orgId ? null : "Portal HubSpot non relie a une organisation Jarvis.",
    };
  });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("hubspot_webhook_events")
    .upsert(rows, {
      onConflict: "event_fingerprint",
      ignoreDuplicates: true,
    })
    .select("id, org_id, event_fingerprint, processing_status");

  if (error) {
    throw new Error(`Impossible de persister les webhooks HubSpot: ${error.message}`);
  }

  const inserted = (data ?? []) as HubSpotWebhookEventInsertResult[];
  const ignored = inserted.filter((event) => event.processing_status === "ignored").length;

  return {
    inserted,
    duplicate: Math.max(0, rows.length - inserted.length),
    ignored,
  };
};

export const acceptHubSpotWebhookBatch = async ({
  headers,
  method,
  requestUri,
  rawBody,
  parsedBody,
}: AcceptHubSpotWebhookInput): Promise<AcceptedHubSpotWebhookBatch> => {
  const signatureIsValid = verifyHubSpotWebhookSignature({
    appSecret: env.hubspotClientSecret,
    headers,
    method,
    requestUri,
    rawBody,
  });

  if (!signatureIsValid) {
    throw new Error("Signature HubSpot invalide.");
  }

  const events = parseHubSpotWebhookEvents(parsedBody);
  const { inserted, duplicate } = await persistWebhookEvents(events);
  const eventsToProcess = inserted.filter((event) => event.org_id && event.processing_status === "queued");

  await Promise.all(
    eventsToProcess.map((event) =>
      enqueueHubSpotRealtimeJob({
        type: "process-webhook-event",
        eventId: event.id,
      }),
    ),
  );

  return {
    accepted: eventsToProcess.length,
    duplicate,
  };
};
