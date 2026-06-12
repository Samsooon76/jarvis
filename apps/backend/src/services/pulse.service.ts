import { createHash } from "node:crypto";
import type { PulseEventType, PulseNotification, PulseNotificationList, PulsePreferences } from "@jarvis/shared";
import { getSupabaseAdmin } from "../db/client.js";

// Jarvis Pulse: transforme les evenements webhook HubSpot deja persistes en
// notifications par destinataire (admins/managers), avec etat lu/non-lu.

export type PulseRecipientProfile = {
  userId: string;
  orgId: string;
  role: "manager" | "admin";
};

export type PulseDealWebhookEventInput = {
  eventId: string;
  orgId: string;
  hubspotDealId: string;
  propertyName: string | null;
  propertyValue: string | null;
  occurredAt: string | null;
};

export type PulseChange = {
  eventType: PulseEventType;
  title: string;
  message: string;
  previousValue: string | null;
  newValue: string | null;
};

type PulseDealSnapshotRow = {
  deal_name: string | null;
  amount: number | null;
  deal_stage: string | null;
  deal_stage_label: string | null;
  close_probability: number | null;
  closed_at: string | null;
  pipeline: string | null;
  hubspot_owner_id: string | null;
};

type PulsePreferencesRow = {
  user_id: string;
  pulse_enabled: boolean;
  notify_deal_created: boolean;
  notify_probability: boolean;
  notify_amount: boolean;
  notify_stage: boolean;
  notify_close_date: boolean;
  notify_owner: boolean;
  notify_pipeline: boolean;
  notify_playbook: boolean;
};

type PulseRecipientRow = {
  id: string;
  name: string | null;
  role: "sales" | "manager" | "admin";
};

type PulseNotificationRow = {
  id: string;
  user_id: string;
  source_event_id: string;
  event_type: PulseEventType;
  hubspot_deal_id: string;
  deal_name: string | null;
  title: string;
  message: string;
  previous_value: string | null;
  new_value: string | null;
  occurred_at: string;
  read_at: string | null;
  created_at: string;
};

type PulseStageLookupRow = {
  stage_id: string;
  stage_label: string;
  pipeline_id: string;
  pipeline_label: string | null;
};

type PulseOwnerLookupRow = {
  hubspot_owner_id: string | null;
  name: string | null;
};

const PULSE_RETENTION_DAYS = 90;
export const PULSE_NOTIFICATIONS_DEFAULT_LIMIT = 30;
export const PULSE_NOTIFICATIONS_MAX_LIMIT = 100;

export const PULSE_EVENT_TYPES: readonly PulseEventType[] = [
  "deal_created",
  "probability",
  "amount",
  "stage",
  "close_date",
  "owner",
  "pipeline",
  "playbook_suggestion",
];

const PULSE_EVENT_TYPE_BY_PROPERTY: Record<string, PulseEventType> = {
  hs_deal_stage_probability: "probability",
  probabilite_de__closing: "probability",
  amount: "amount",
  dealstage: "stage",
  closedate: "close_date",
  hubspot_owner_id: "owner",
  pipeline: "pipeline",
};

const PULSE_EVENT_TITLES: Record<PulseEventType, string> = {
  deal_created: "Nouveau deal dans le pipe",
  probability: "Probabilite de closing mise a jour",
  amount: "Montant du deal mis a jour",
  stage: "Changement de stage",
  close_date: "Date de closing modifiee",
  owner: "Changement d'owner",
  pipeline: "Changement de pipeline",
  playbook_suggestion: "Suggestion playbook a valider",
};

const PULSE_EVENT_FIELD_LABELS: Record<PulseEventType, string> = {
  deal_created: "creation",
  probability: "probabilite",
  amount: "montant",
  stage: "stage",
  close_date: "date de closing",
  owner: "owner",
  pipeline: "pipeline",
  playbook_suggestion: "playbook",
};

export const mapDealPropertyToPulseEventType = (propertyName: string | null): PulseEventType | null =>
  propertyName ? PULSE_EVENT_TYPE_BY_PROPERTY[propertyName] ?? null : null;

const isPulseEventType = (value: string): value is PulseEventType =>
  (PULSE_EVENT_TYPES as readonly string[]).includes(value);

const parsePulseProbability = (propertyName: string | null, value: string | null): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number(value.trim().replace("%", ""));

  if (!Number.isFinite(parsed)) {
    return null;
  }

  // hs_deal_stage_probability arrive en fraction 0-1; la propriete custom est deja en 0-100.
  const percentage =
    propertyName === "hs_deal_stage_probability" && parsed >= 0 && parsed <= 1 ? parsed * 100 : parsed;

  return Math.max(0, Math.min(100, Math.round(percentage)));
};

const parsePulseAmount = (value: string | null): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number(value.trim());

  return Number.isFinite(parsed) ? parsed : null;
};

const formatPulseAmount = (amount: number | null): string | null =>
  amount === null
    ? null
    : new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(amount);

const formatPulseDate = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  // HubSpot envoie les dates de propriete sous forme d'epoch en millisecondes.
  const timestamp = /^\d+$/.test(trimmed) ? Number(trimmed) : new Date(trimmed).getTime();

  if (!Number.isFinite(timestamp) || Number.isNaN(timestamp)) {
    return null;
  }

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Paris",
  }).format(new Date(timestamp));
};

const formatPulseTransition = (previousValue: string | null, newValue: string | null): string =>
  `${previousValue ?? "non renseigne"} -> ${newValue ?? "non renseigne"}`;

export const buildPulseChange = (input: {
  eventType: PulseEventType;
  dealName: string | null;
  hubspotDealId: string;
  previousValue: string | null;
  newValue: string | null;
}): PulseChange | null => {
  const { eventType, previousValue, newValue } = input;

  // Pas de transition reelle: on ne notifie pas pour eviter le bruit.
  if ((previousValue ?? "") === (newValue ?? "")) {
    return null;
  }

  const dealLabel = input.dealName?.trim() || `Deal HubSpot ${input.hubspotDealId}`;
  const message = `${dealLabel} : ${PULSE_EVENT_FIELD_LABELS[eventType]} ${formatPulseTransition(previousValue, newValue)}`;

  return {
    eventType,
    title: PULSE_EVENT_TITLES[eventType],
    message,
    previousValue,
    newValue,
  };
};

const loadPulseDealSnapshot = async (orgId: string, hubspotDealId: string): Promise<PulseDealSnapshotRow | null> => {
  const { data, error } = await getSupabaseAdmin()
    .from("hubspot_deals")
    .select("deal_name, amount, deal_stage, deal_stage_label, close_probability, closed_at, pipeline, hubspot_owner_id")
    .eq("org_id", orgId)
    .eq("hubspot_deal_id", hubspotDealId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le deal pour Jarvis Pulse: ${error.message}`);
  }

  return data as PulseDealSnapshotRow | null;
};

const loadPulseStageLookup = async (orgId: string): Promise<PulseStageLookupRow[]> => {
  const { data, error } = await getSupabaseAdmin()
    .from("hubspot_deal_stages")
    .select("stage_id, stage_label, pipeline_id, pipeline_label")
    .eq("org_id", orgId);

  if (error) {
    throw new Error(`Impossible de charger les stages HubSpot pour Jarvis Pulse: ${error.message}`);
  }

  return (data ?? []) as PulseStageLookupRow[];
};

const resolveStageLabel = (stages: PulseStageLookupRow[], stageId: string | null): string | null => {
  if (!stageId) {
    return null;
  }

  return stages.find((stage) => stage.stage_id === stageId)?.stage_label ?? stageId;
};

const resolvePipelineLabel = (stages: PulseStageLookupRow[], pipelineId: string | null): string | null => {
  if (!pipelineId) {
    return null;
  }

  return stages.find((stage) => stage.pipeline_id === pipelineId)?.pipeline_label ?? pipelineId;
};

const resolveOwnerName = async (orgId: string, hubspotOwnerId: string | null): Promise<string | null> => {
  if (!hubspotOwnerId) {
    return null;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("hubspot_owner_id, name")
    .eq("org_id", orgId)
    .eq("hubspot_owner_id", hubspotOwnerId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de resoudre l'owner HubSpot pour Jarvis Pulse: ${error.message}`);
  }

  const owner = data as PulseOwnerLookupRow | null;

  return owner?.name?.trim() || `Owner ${hubspotOwnerId}`;
};

const buildPulseChangeForEvent = async (
  event: PulseDealWebhookEventInput,
  eventType: PulseEventType,
  snapshot: PulseDealSnapshotRow | null,
): Promise<PulseChange | null> => {
  const dealName = snapshot?.deal_name ?? null;
  const base = {
    eventType,
    dealName,
    hubspotDealId: event.hubspotDealId,
  };

  if (eventType === "probability") {
    const newProbability = parsePulseProbability(event.propertyName, event.propertyValue);

    return buildPulseChange({
      ...base,
      previousValue: snapshot?.close_probability !== null && snapshot?.close_probability !== undefined
        ? `${snapshot.close_probability}%`
        : null,
      newValue: newProbability === null ? null : `${newProbability}%`,
    });
  }

  if (eventType === "amount") {
    return buildPulseChange({
      ...base,
      previousValue: formatPulseAmount(snapshot?.amount ?? null),
      newValue: formatPulseAmount(parsePulseAmount(event.propertyValue)),
    });
  }

  if (eventType === "close_date") {
    return buildPulseChange({
      ...base,
      previousValue: formatPulseDate(snapshot?.closed_at ?? null),
      newValue: formatPulseDate(event.propertyValue),
    });
  }

  if (eventType === "stage") {
    const stages = await loadPulseStageLookup(event.orgId);

    return buildPulseChange({
      ...base,
      previousValue: snapshot?.deal_stage_label ?? resolveStageLabel(stages, snapshot?.deal_stage ?? null),
      newValue: resolveStageLabel(stages, event.propertyValue),
    });
  }

  if (eventType === "pipeline") {
    const stages = await loadPulseStageLookup(event.orgId);

    return buildPulseChange({
      ...base,
      previousValue: resolvePipelineLabel(stages, snapshot?.pipeline ?? null),
      newValue: resolvePipelineLabel(stages, event.propertyValue),
    });
  }

  const [previousOwner, newOwner] = await Promise.all([
    resolveOwnerName(event.orgId, snapshot?.hubspot_owner_id ?? null),
    resolveOwnerName(event.orgId, event.propertyValue),
  ]);

  return buildPulseChange({
    ...base,
    previousValue: previousOwner,
    newValue: newOwner,
  });
};

const loadPulseRecipients = async (orgId: string): Promise<PulseRecipientRow[]> => {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("id, name, role")
    .eq("org_id", orgId)
    .in("role", ["admin", "manager"]);

  if (error) {
    throw new Error(`Impossible de charger les destinataires Jarvis Pulse: ${error.message}`);
  }

  return (data ?? []) as PulseRecipientRow[];
};

const loadPulsePreferenceRows = async (orgId: string, userIds: string[]): Promise<PulsePreferencesRow[]> => {
  if (userIds.length === 0) {
    return [];
  }

  const { data, error } = await getSupabaseAdmin()
    .from("pulse_preferences")
    .select(
      "user_id, pulse_enabled, notify_deal_created, notify_probability, notify_amount, notify_stage, notify_close_date, notify_owner, notify_pipeline, notify_playbook",
    )
    .eq("org_id", orgId)
    .in("user_id", userIds);

  if (error) {
    throw new Error(`Impossible de charger les preferences Jarvis Pulse: ${error.message}`);
  }

  return (data ?? []) as PulsePreferencesRow[];
};

const isEventTypeEnabled = (preferences: PulsePreferencesRow | undefined, eventType: PulseEventType): boolean => {
  // Valeurs par defaut: tout active tant que l'utilisateur n'a pas enregistre de preferences.
  if (!preferences) {
    return true;
  }

  if (!preferences.pulse_enabled) {
    return false;
  }

  switch (eventType) {
    case "deal_created":
      return preferences.notify_deal_created;
    case "probability":
      return preferences.notify_probability;
    case "amount":
      return preferences.notify_amount;
    case "stage":
      return preferences.notify_stage;
    case "close_date":
      return preferences.notify_close_date;
    case "owner":
      return preferences.notify_owner;
    case "pipeline":
      return preferences.notify_pipeline;
    case "playbook_suggestion":
      return preferences.notify_playbook;
    default:
      return true;
  }
};

export type PulseDealCreatedInput = {
  orgId: string;
  sourceEventId: string;
  hubspotDealId: string;
  dealName: string | null;
  amount: number | null;
  stageLabel: string | null;
  occurredAt: string | null;
};

const formatDealCreatedMessage = (input: PulseDealCreatedInput): string => {
  const dealLabel = input.dealName?.trim() || `Deal HubSpot ${input.hubspotDealId}`;
  const details = [
    formatPulseAmount(input.amount),
    input.stageLabel?.trim() || null,
  ].filter((detail): detail is string => Boolean(detail));

  return details.length > 0
    ? `${dealLabel} vient d'entrer dans le pipe (${details.join(", ")}).`
    : `${dealLabel} vient d'entrer dans le pipe.`;
};

export const buildPulseDealCreatedSourceEventId = (orgId: string, hubspotDealId: string): string => {
  const hash = createHash("sha256").update(`pulse:deal_created:${orgId}:${hubspotDealId}`, "utf8").digest("hex");

  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};

export const generatePulseNotificationsForNewDeal = async (input: PulseDealCreatedInput): Promise<number> => {
  const recipients = await loadPulseRecipients(input.orgId);

  if (recipients.length === 0) {
    return 0;
  }

  const preferenceRows = await loadPulsePreferenceRows(
    input.orgId,
    recipients.map((recipient) => recipient.id),
  );
  const preferencesByUserId = new Map(preferenceRows.map((row) => [row.user_id, row]));
  const eligibleRecipients = recipients.filter((recipient) =>
    isEventTypeEnabled(preferencesByUserId.get(recipient.id), "deal_created"),
  );

  if (eligibleRecipients.length === 0) {
    return 0;
  }

  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const message = formatDealCreatedMessage(input);
  const amountLabel = formatPulseAmount(input.amount);
  const rows = eligibleRecipients.map((recipient) => ({
    org_id: input.orgId,
    user_id: recipient.id,
    source_event_id: input.sourceEventId,
    event_type: "deal_created" satisfies PulseEventType,
    hubspot_deal_id: input.hubspotDealId,
    deal_name: input.dealName,
    title: PULSE_EVENT_TITLES.deal_created,
    message,
    previous_value: null,
    new_value: amountLabel ?? input.stageLabel,
    occurred_at: occurredAt,
  }));

  const { error } = await getSupabaseAdmin()
    .from("pulse_notifications")
    .upsert(rows, { onConflict: "user_id,source_event_id", ignoreDuplicates: true });

  if (error) {
    throw new Error(`Impossible de creer les notifications Jarvis Pulse: ${error.message}`);
  }

  await purgeOldPulseNotifications(input.orgId);

  return rows.length;
};

export type PulsePlaybookSuggestionInput = {
  orgId: string;
  sourceEventId: string;
  playbookId: string;
  suggestionTitle: string;
  rationale: string;
  occurredAt: string | null;
};

export const generatePulseNotificationsForPlaybookSuggestion = async (
  input: PulsePlaybookSuggestionInput,
): Promise<number> => {
  const recipients = await loadPulseRecipients(input.orgId);

  if (recipients.length === 0) {
    return 0;
  }

  const preferenceRows = await loadPulsePreferenceRows(
    input.orgId,
    recipients.map((recipient) => recipient.id),
  );
  const preferencesByUserId = new Map(preferenceRows.map((row) => [row.user_id, row]));
  const eligibleRecipients = recipients.filter((recipient) =>
    isEventTypeEnabled(preferencesByUserId.get(recipient.id), "playbook_suggestion"),
  );

  if (eligibleRecipients.length === 0) {
    return 0;
  }

  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const message = `${input.suggestionTitle}: ${input.rationale}`;
  const rows = eligibleRecipients.map((recipient) => ({
    org_id: input.orgId,
    user_id: recipient.id,
    source_event_id: input.sourceEventId,
    event_type: "playbook_suggestion" satisfies PulseEventType,
    hubspot_deal_id: input.playbookId,
    deal_name: "Playbook",
    title: PULSE_EVENT_TITLES.playbook_suggestion,
    message,
    previous_value: null,
    new_value: input.suggestionTitle,
    occurred_at: occurredAt,
  }));

  const { error } = await getSupabaseAdmin()
    .from("pulse_notifications")
    .upsert(rows, { onConflict: "user_id,source_event_id", ignoreDuplicates: true });

  if (error) {
    throw new Error(`Impossible de creer les notifications playbook Jarvis Pulse: ${error.message}`);
  }

  await purgeOldPulseNotifications(input.orgId);

  return rows.length;
};

const purgeOldPulseNotifications = async (orgId: string): Promise<void> => {
  const cutoff = new Date(Date.now() - PULSE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await getSupabaseAdmin()
    .from("pulse_notifications")
    .delete()
    .eq("org_id", orgId)
    .lt("created_at", cutoff);

  if (error) {
    throw new Error(`Impossible de purger les notifications Jarvis Pulse: ${error.message}`);
  }
};

// Point d'entree appele par le worker webhook temps reel, AVANT que la nouvelle
// valeur ne soit appliquee en base (la base contient donc encore l'ancienne valeur).
export const generatePulseNotificationsForDealWebhookEvent = async (
  event: PulseDealWebhookEventInput,
): Promise<number> => {
  const eventType = mapDealPropertyToPulseEventType(event.propertyName);

  if (!eventType) {
    return 0;
  }

  const recipients = await loadPulseRecipients(event.orgId);

  if (recipients.length === 0) {
    return 0;
  }

  const snapshot = await loadPulseDealSnapshot(event.orgId, event.hubspotDealId);
  const change = await buildPulseChangeForEvent(event, eventType, snapshot);

  if (!change) {
    return 0;
  }

  const preferenceRows = await loadPulsePreferenceRows(
    event.orgId,
    recipients.map((recipient) => recipient.id),
  );
  const preferencesByUserId = new Map(preferenceRows.map((row) => [row.user_id, row]));
  const eligibleRecipients = recipients.filter((recipient) =>
    isEventTypeEnabled(preferencesByUserId.get(recipient.id), eventType),
  );

  if (eligibleRecipients.length === 0) {
    return 0;
  }

  const occurredAt = event.occurredAt ?? new Date().toISOString();
  const rows = eligibleRecipients.map((recipient) => ({
    org_id: event.orgId,
    user_id: recipient.id,
    source_event_id: event.eventId,
    event_type: change.eventType,
    hubspot_deal_id: event.hubspotDealId,
    deal_name: snapshot?.deal_name ?? null,
    title: change.title,
    message: change.message,
    previous_value: change.previousValue,
    new_value: change.newValue,
    occurred_at: occurredAt,
  }));

  // Idempotence: un meme evenement webhook ne produit jamais deux notifications
  // pour le meme destinataire (contrainte unique user_id + source_event_id).
  const { error } = await getSupabaseAdmin()
    .from("pulse_notifications")
    .upsert(rows, { onConflict: "user_id,source_event_id", ignoreDuplicates: true });

  if (error) {
    throw new Error(`Impossible de creer les notifications Jarvis Pulse: ${error.message}`);
  }

  await purgeOldPulseNotifications(event.orgId);

  return rows.length;
};

const toPulseNotification = (row: PulseNotificationRow): PulseNotification => ({
  id: row.id,
  eventType: row.event_type,
  hubspotDealId: row.hubspot_deal_id,
  dealName: row.deal_name,
  title: row.title,
  message: row.message,
  previousValue: row.previous_value,
  newValue: row.new_value,
  occurredAt: row.occurred_at,
  readAt: row.read_at,
  createdAt: row.created_at,
});

const deduplicatePulseNotificationRows = (
  rows: PulseNotificationRow[],
  preferredUserId: string,
): PulseNotificationRow[] => {
  const rowBySourceEventId = new Map<string, PulseNotificationRow>();

  for (const row of rows) {
    const existingRow = rowBySourceEventId.get(row.source_event_id);

    if (!existingRow || row.user_id === preferredUserId) {
      rowBySourceEventId.set(row.source_event_id, row);
    }
  }

  return Array.from(rowBySourceEventId.values());
};

type ListPulseNotificationsOptions = {
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
  eventTypes?: PulseEventType[];
  scope?: "user" | "organization";
};

export const listPulseNotifications = async (
  recipient: PulseRecipientProfile,
  options: ListPulseNotificationsOptions = {},
): Promise<PulseNotificationList> => {
  const supabase = getSupabaseAdmin();
  const limit = Math.min(Math.max(options.limit ?? PULSE_NOTIFICATIONS_DEFAULT_LIMIT, 1), PULSE_NOTIFICATIONS_MAX_LIMIT);
  const offset = Math.max(options.offset ?? 0, 0);

  // Par defaut Pulse montre le flux de l'utilisateur. Un admin peut ouvrir
  // la vue organisation pour suivre les modifications de tous les managers.
  const scope = options.scope ?? "user";
  const queryLimit = scope === "organization" ? Math.min(limit * 10, PULSE_NOTIFICATIONS_MAX_LIMIT * 10) : limit;

  if (scope === "organization" && recipient.role !== "admin") {
    throw new Error("La vue Pulse organisation est reservee aux administrateurs.");
  }

  let query = supabase
    .from("pulse_notifications")
    .select("id, user_id, source_event_id, event_type, hubspot_deal_id, deal_name, title, message, previous_value, new_value, occurred_at, read_at, created_at")
    .eq("org_id", recipient.orgId)
    .order("created_at", { ascending: false })
    .range(offset, offset + queryLimit - 1);

  if (scope === "user") {
    query = query.eq("user_id", recipient.userId);
  }

  if (options.unreadOnly) {
    query = query.is("read_at", null);
  }

  if (options.eventTypes && options.eventTypes.length > 0) {
    query = query.in("event_type", options.eventTypes);
  }

  const [{ data, error }, unreadResult] = await Promise.all([
    query,
    supabase
      .from("pulse_notifications")
      .select("id", { count: "exact", head: true })
      .eq("org_id", recipient.orgId)
      .eq("user_id", recipient.userId)
      .is("read_at", null),
  ]);

  if (error) {
    throw new Error(`Impossible de charger les notifications Jarvis Pulse: ${error.message}`);
  }

  if (unreadResult.error) {
    throw new Error(`Impossible de compter les notifications Jarvis Pulse non lues: ${unreadResult.error.message}`);
  }

  const rows = (data ?? []) as PulseNotificationRow[];
  const visibleRows = scope === "organization" ? deduplicatePulseNotificationRows(rows, recipient.userId).slice(0, limit) : rows;

  return {
    notifications: visibleRows.map(toPulseNotification),
    unreadCount: unreadResult.count ?? 0,
  };
};

export const markPulseNotificationRead = async (
  recipient: PulseRecipientProfile,
  notificationId: string,
): Promise<void> => {
  const { error } = await getSupabaseAdmin()
    .from("pulse_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("org_id", recipient.orgId)
    .eq("user_id", recipient.userId)
    .eq("id", notificationId)
    .is("read_at", null);

  if (error) {
    throw new Error(`Impossible de marquer la notification Jarvis Pulse comme lue: ${error.message}`);
  }
};

export const markAllPulseNotificationsRead = async (recipient: PulseRecipientProfile): Promise<void> => {
  const { error } = await getSupabaseAdmin()
    .from("pulse_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("org_id", recipient.orgId)
    .eq("user_id", recipient.userId)
    .is("read_at", null);

  if (error) {
    throw new Error(`Impossible de marquer les notifications Jarvis Pulse comme lues: ${error.message}`);
  }
};

const DEFAULT_PULSE_PREFERENCES: PulsePreferences = {
  pulseEnabled: true,
  events: {
    deal_created: true,
    probability: true,
    amount: true,
    stage: true,
    close_date: true,
    owner: true,
    pipeline: true,
    playbook_suggestion: true,
  },
};

const toPulsePreferences = (row: PulsePreferencesRow | null): PulsePreferences =>
  row
    ? {
        pulseEnabled: row.pulse_enabled,
        events: {
          probability: row.notify_probability,
          deal_created: row.notify_deal_created,
          amount: row.notify_amount,
          stage: row.notify_stage,
          close_date: row.notify_close_date,
          owner: row.notify_owner,
          pipeline: row.notify_pipeline,
          playbook_suggestion: row.notify_playbook,
        },
      }
    : DEFAULT_PULSE_PREFERENCES;

export const getPulsePreferences = async (recipient: PulseRecipientProfile): Promise<PulsePreferences> => {
  const rows = await loadPulsePreferenceRows(recipient.orgId, [recipient.userId]);

  return toPulsePreferences(rows[0] ?? null);
};

export const parsePulsePreferencesInput = (value: unknown): PulsePreferences | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const pulseEnabled = record.pulseEnabled;
  const events = record.events;

  if (typeof pulseEnabled !== "boolean" || !events || typeof events !== "object" || Array.isArray(events)) {
    return null;
  }

  const eventRecord = events as Record<string, unknown>;
  const parsedEvents: Partial<Record<PulseEventType, boolean>> = {};

  for (const eventType of PULSE_EVENT_TYPES) {
    const eventValue = eventRecord[eventType];

    if (eventType === "playbook_suggestion" && eventValue === undefined) {
      parsedEvents[eventType] = true;
      continue;
    }

    if (typeof eventValue !== "boolean") {
      return null;
    }

    parsedEvents[eventType] = eventValue;
  }

  for (const key of Object.keys(eventRecord)) {
    if (!isPulseEventType(key)) {
      return null;
    }
  }

  return {
    pulseEnabled,
    events: parsedEvents as PulsePreferences["events"],
  };
};

export const updatePulsePreferences = async (
  recipient: PulseRecipientProfile,
  preferences: PulsePreferences,
): Promise<PulsePreferences> => {
  const { error } = await getSupabaseAdmin()
    .from("pulse_preferences")
    .upsert(
      {
        org_id: recipient.orgId,
        user_id: recipient.userId,
        pulse_enabled: preferences.pulseEnabled,
        notify_probability: preferences.events.probability,
        notify_deal_created: preferences.events.deal_created,
        notify_amount: preferences.events.amount,
        notify_stage: preferences.events.stage,
        notify_close_date: preferences.events.close_date,
        notify_owner: preferences.events.owner,
        notify_pipeline: preferences.events.pipeline,
        notify_playbook: preferences.events.playbook_suggestion,
      },
      { onConflict: "org_id,user_id" },
    );

  if (error) {
    throw new Error(`Impossible d'enregistrer les preferences Jarvis Pulse: ${error.message}`);
  }

  return preferences;
};
