import type { HubSpotActivitySnapshot, HubSpotActivityType } from "../hubspot.service.js";
import type { HubSpotActivityUpsertRow, HubSpotDealStageLookupRow, DealLifecycleStatus, JsonRecord } from "./types.js";

export const ACTIVITY_TYPE_BY_OBJECT_TYPE_ID: Record<string, HubSpotActivityType> = {
  "0-48": "call",
  "0-18": "communication",
  "0-49": "email",
  "0-46": "note",
  "0-47": "meeting",
};

export const ACTIVITY_TYPE_BY_NAME: Record<string, HubSpotActivityType> = {
  calls: "call",
  call: "call",
  communications: "communication",
  communication: "communication",
  emails: "email",
  email: "email",
  notes: "note",
  note: "note",
  meetings: "meeting",
  meeting: "meeting",
};

export const DEAL_OBJECT_TYPE_IDS = new Set(["0-3", "deal", "deals"]);
export const TASK_OBJECT_TYPE_IDS = new Set(["0-27", "task", "tasks"]);
export const LEAD_OBJECT_TYPE_IDS = new Set(["0-136", "lead", "leads"]);
export const ACTIVITY_REHYDRATE_DELAY_MS = 2 * 60 * 1000;

const INTERESTING_TASK_PROPERTIES = new Set([
  "hs_task_status",
  "hs_task_priority",
  "hs_task_subject",
  "hs_task_body",
  "hs_timestamp",
  "hubspot_owner_id",
]);

const INTERESTING_LEAD_PROPERTIES = new Set([
  "hs_lead_name",
  "hs_pipeline",
  "hs_pipeline_stage",
  "hubspot_owner_id",
]);

export const asRecord = (value: unknown): JsonRecord | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;

export const readPayloadString = (payload: JsonRecord | null, key: string): string | null => {
  const value = payload?.[key];

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
};

export const toIsoFromNow = (delayMs: number): string => new Date(Date.now() + delayMs).toISOString();

export const normalizeActivityTableType = (
  activity: HubSpotActivitySnapshot,
): HubSpotActivityUpsertRow["activity_type"] =>
  activity.activityType === "communication" && activity.channel === "SMS" ? "sms" : activity.activityType;

export const readActivityMetadata = (activity: HubSpotActivitySnapshot, key: string): string | null =>
  activity.metadata[key] ?? activity.properties[key] ?? null;

export const normalizeCallDirection = (value: string | null): "inbound" | "outbound" => {
  const normalized = value?.trim().toLowerCase();

  return normalized === "inbound" ? "inbound" : "outbound";
};

export const normalizeCallStatus = (
  activity: HubSpotActivitySnapshot,
): "completed" | "missed" | "voicemail" | null => {
  const hasVoicemail = activity.properties.hs_call_has_voicemail === "true";
  const status = activity.properties.hs_call_status?.trim().toUpperCase() ?? null;

  if (hasVoicemail) {
    return "voicemail";
  }

  if (status === "COMPLETED") {
    return "completed";
  }

  if (status && ["BUSY", "CANCELED", "FAILED", "NO_ANSWER"].includes(status)) {
    return "missed";
  }

  return null;
};

export const parseDurationSeconds = (value: string | null): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(0, Math.round(parsed / 1000));
};

export const isInterestingDealProperty = (propertyName: string | null): boolean =>
  !propertyName ||
  [
    "amount",
    "closedate",
    "dealstage",
    "hs_deal_stage_probability",
    "probabilite_de__closing",
    "hubspot_owner_id",
    "pipeline",
  ].includes(propertyName);

export const isInterestingTaskProperty = (propertyName: string | null): boolean =>
  !propertyName || INTERESTING_TASK_PROPERTIES.has(propertyName);

export const isInterestingLeadProperty = (propertyName: string | null): boolean =>
  !propertyName || INTERESTING_LEAD_PROPERTIES.has(propertyName);

const isTaskObjectTypeId = (objectTypeId: string | null): boolean =>
  Boolean(objectTypeId && TASK_OBJECT_TYPE_IDS.has(objectTypeId));

const isLeadObjectTypeId = (objectTypeId: string | null): boolean =>
  Boolean(objectTypeId && LEAD_OBJECT_TYPE_IDS.has(objectTypeId));

export const resolveTaskId = (
  objectTypeId: string | null,
  objectId: string | null,
  subscriptionType: string,
): string | null => {
  if (isTaskObjectTypeId(objectTypeId)) {
    return objectId;
  }

  if (subscriptionType.startsWith("task.")) {
    return objectId;
  }

  return null;
};

export const resolveLeadId = (
  objectTypeId: string | null,
  objectId: string | null,
  subscriptionType: string,
): string | null => {
  if (isLeadObjectTypeId(objectTypeId)) {
    return objectId;
  }

  if (subscriptionType.startsWith("lead.")) {
    return objectId;
  }

  return null;
};

export const resolveAssociationTaskId = (payload: JsonRecord | null): string | null => {
  const fromObjectTypeId = readPayloadString(payload, "fromObjectTypeId");
  const toObjectTypeId = readPayloadString(payload, "toObjectTypeId");
  const fromObjectId = readPayloadString(payload, "fromObjectId");
  const toObjectId = readPayloadString(payload, "toObjectId");

  if (fromObjectTypeId && TASK_OBJECT_TYPE_IDS.has(fromObjectTypeId)) {
    return fromObjectId;
  }

  if (toObjectTypeId && TASK_OBJECT_TYPE_IDS.has(toObjectTypeId)) {
    return toObjectId;
  }

  return null;
};

export const resolveAssociationLeadId = (payload: JsonRecord | null): string | null => {
  const fromObjectTypeId = readPayloadString(payload, "fromObjectTypeId");
  const toObjectTypeId = readPayloadString(payload, "toObjectTypeId");
  const fromObjectId = readPayloadString(payload, "fromObjectId");
  const toObjectId = readPayloadString(payload, "toObjectId");

  if (fromObjectTypeId && LEAD_OBJECT_TYPE_IDS.has(fromObjectTypeId)) {
    return fromObjectId;
  }

  if (toObjectTypeId && LEAD_OBJECT_TYPE_IDS.has(toObjectTypeId)) {
    return toObjectId;
  }

  return null;
};

export const isTaskWebhookEvent = (
  subscriptionType: string,
  objectTypeId: string | null,
  propertyName: string | null,
): boolean => {
  if (subscriptionType === "object.creation" && isTaskObjectTypeId(objectTypeId)) {
    return true;
  }

  if (subscriptionType === "object.deletion" && isTaskObjectTypeId(objectTypeId)) {
    return true;
  }

  if (subscriptionType === "object.propertyChange" && isTaskObjectTypeId(objectTypeId)) {
    return isInterestingTaskProperty(propertyName);
  }

  if (subscriptionType === "object.associationChange") {
    return Boolean(
      (objectTypeId && TASK_OBJECT_TYPE_IDS.has(objectTypeId)) || subscriptionType.includes("task"),
    );
  }

  return subscriptionType === "task.creation" || subscriptionType === "task.deletion" || subscriptionType === "task.propertyChange";
};

export const isLeadWebhookEvent = (
  subscriptionType: string,
  objectTypeId: string | null,
  propertyName: string | null,
): boolean => {
  if (subscriptionType === "object.creation" && isLeadObjectTypeId(objectTypeId)) {
    return true;
  }

  if (subscriptionType === "object.deletion" && isLeadObjectTypeId(objectTypeId)) {
    return true;
  }

  if (subscriptionType === "object.propertyChange" && isLeadObjectTypeId(objectTypeId)) {
    return isInterestingLeadProperty(propertyName);
  }

  if (subscriptionType === "object.associationChange" && isLeadObjectTypeId(objectTypeId)) {
    return true;
  }

  return subscriptionType === "lead.creation" || subscriptionType === "lead.deletion" || subscriptionType === "lead.propertyChange";
};

export const resolveActivityTarget = (
  objectTypeId: string | null,
  objectId: string | null,
): { activityType: HubSpotActivityType; hubspotActivityId: string } | null => {
  if (!objectTypeId || !objectId) {
    return null;
  }

  const activityType = ACTIVITY_TYPE_BY_OBJECT_TYPE_ID[objectTypeId] ?? ACTIVITY_TYPE_BY_NAME[objectTypeId];

  return activityType
    ? {
        activityType,
        hubspotActivityId: objectId,
      }
    : null;
};

export const resolveAssociationActivityTarget = (
  payload: JsonRecord | null,
): { activityType: HubSpotActivityType; hubspotActivityId: string } | null => {
  const fromObjectTypeId = readPayloadString(payload, "fromObjectTypeId");
  const toObjectTypeId = readPayloadString(payload, "toObjectTypeId");
  const fromObjectId = readPayloadString(payload, "fromObjectId");
  const toObjectId = readPayloadString(payload, "toObjectId");

  return resolveActivityTarget(fromObjectTypeId, fromObjectId) ?? resolveActivityTarget(toObjectTypeId, toObjectId);
};

export const resolveAssociationDealId = (payload: JsonRecord | null): string | null => {
  const fromObjectTypeId = readPayloadString(payload, "fromObjectTypeId");
  const toObjectTypeId = readPayloadString(payload, "toObjectTypeId");
  const fromObjectId = readPayloadString(payload, "fromObjectId");
  const toObjectId = readPayloadString(payload, "toObjectId");

  if (fromObjectTypeId && DEAL_OBJECT_TYPE_IDS.has(fromObjectTypeId)) {
    return fromObjectId;
  }

  if (toObjectTypeId && DEAL_OBJECT_TYPE_IDS.has(toObjectTypeId)) {
    return toObjectId;
  }

  return null;
};

export const parseWebhookAmount = (value: string | null): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number(value.trim());

  return Number.isFinite(parsed) ? parsed : null;
};

export const parseWebhookProbability = (value: string | null): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number(value.trim().replace("%", ""));

  if (!Number.isFinite(parsed)) {
    return null;
  }

  // HubSpot envoie la probabilite en 0-1; Jarvis la stocke en 0-100.
  const percentage = parsed >= 0 && parsed <= 1 ? parsed * 100 : parsed;

  return Math.max(0, Math.min(100, Math.round(percentage)));
};

export const parseManualProbability = (value: string | null): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number(value.trim().replace("%", ""));

  if (!Number.isFinite(parsed)) {
    return null;
  }

  // Propriete custom saisie manuellement: deja exprimee en pourcentage (0-100).
  return Math.max(0, Math.min(100, Math.round(parsed)));
};

export const normalizeWebhookDate = (value: string | null): string | null => {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  // HubSpot envoie les dates de propriete sous forme d'epoch en millisecondes.
  const timestamp = /^\d+$/.test(trimmed) ? Number(trimmed) : new Date(trimmed).getTime();

  return Number.isFinite(timestamp) && !Number.isNaN(timestamp) ? new Date(timestamp).toISOString() : null;
};

export const normalizeStageText = (value: string | null | undefined): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

export const compactStageText = (value: string | null | undefined): string =>
  normalizeStageText(value).replace(/[^a-z0-9]+/g, "");

export const parseStageProbability = (value: number | string | null): number | null => {
  const parsed = typeof value === "string" ? Number(value) : value;

  return parsed !== null && Number.isFinite(parsed) ? Number(parsed) : null;
};

export const normalizeStageProbability = (value: number | string | null): number => {
  const parsed = parseStageProbability(value);

  if (parsed === null) {
    return 0;
  }

  const percentage = parsed >= 0 && parsed <= 1 ? parsed * 100 : parsed;

  return Math.max(0, Math.min(100, Math.round(percentage)));
};

export const resolveDealLifecycleStatusFromStage = (
  dealStageId: string | null,
  stage: HubSpotDealStageLookupRow | null,
): DealLifecycleStatus => {
  const normalizedStage = normalizeStageText(`${dealStageId ?? ""} ${stage?.stage_label ?? ""}`);
  const compactStage = compactStageText(normalizedStage);
  const probability = parseStageProbability(stage?.probability ?? null);

  if (
    compactStage.includes("closedlost") ||
    compactStage.includes("closelost") ||
    compactStage === "lost" ||
    normalizedStage.includes(" lost") ||
    normalizedStage.includes("perdu") ||
    normalizedStage.includes("perdue")
  ) {
    return "lost";
  }

  if (
    compactStage.includes("closedwon") ||
    compactStage === "won" ||
    normalizedStage.includes(" won") ||
    normalizedStage.includes("gagne") ||
    normalizedStage.includes("gagnee")
  ) {
    return "won";
  }

  if (probability !== null) {
    if (probability <= 0) {
      return "lost";
    }

    if (probability >= 1) {
      return "won";
    }
  }

  // Stage ferme sans signal explicite: ne pas supposer "won" (closed lost mal classe).
  return "pending";
};
