import { env } from "../config/env.js";
import { getSupabaseAdmin } from "../db/client.js";
import { analyzeDealActivityPlanForProspect } from "./deal-intelligence.service.js";
import { getHubSpotAccessToken } from "./hubspot-auth.service.js";
import { resolveLlmProviderPreference } from "./llm/provider-preference.service.js";
import {
  hubSpotService,
  type HubSpotActivitySnapshot,
  type HubSpotActivityType,
} from "./hubspot.service.js";
import {
  enqueueHubSpotRealtimeJob,
  type HubSpotRealtimeJob,
} from "./hubspot-realtime-queue.service.js";

type HubSpotWebhookEventRow = {
  id: string;
  org_id: string | null;
  portal_id: string;
  subscription_type: string;
  object_type_id: string | null;
  object_id: string | null;
  property_name: string | null;
  property_value: string | null;
  occurred_at: string | null;
  payload: unknown;
  processing_status: string;
};

type HubSpotActivityUpsertRow = {
  org_id: string;
  hubspot_activity_id: string;
  activity_type: "call" | "communication" | "email" | "note" | "meeting" | "sms";
  activity_channel: string | null;
  hubspot_owner_id: string | null;
  occurred_at: string | null;
  title: string | null;
  body: string | null;
  direction: string | null;
  status: string | null;
  disposition: string | null;
  source_object_type_id: string | null;
  source_object_type: string | null;
  properties: Record<string, string | null>;
  associated_contact_ids: string[];
  associated_company_ids: string[];
  associated_deal_ids: string[];
  last_hubspot_event_at: string | null;
  synced_at: string;
};

type HubSpotRealtimeAnalysisRunRow = {
  id: string;
  org_id: string;
  hubspot_deal_id: string;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  scheduled_for: string;
  trigger_event_ids: string[];
};

type ProspectLookupRow = {
  id: string;
  owner_user_id: string | null;
};

type HubSpotDealLookupRow = {
  hubspot_deal_id: string;
  hubspot_owner_id?: string | null;
};

type HubSpotActivityLookupRow = {
  hubspot_activity_id: string;
  activity_type: "call" | "communication" | "email" | "note" | "meeting" | "sms";
  associated_deal_ids: string[];
};

type JsonRecord = Record<string, unknown>;

const ACTIVITY_TYPE_BY_OBJECT_TYPE_ID: Record<string, HubSpotActivityType> = {
  "0-48": "call",
  "0-18": "communication",
  "0-49": "email",
  "0-46": "note",
  "0-47": "meeting",
};

const ACTIVITY_TYPE_BY_NAME: Record<string, HubSpotActivityType> = {
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

const DEAL_OBJECT_TYPE_IDS = new Set(["0-3", "deal", "deals"]);
const ACTIVITY_REHYDRATE_DELAY_MS = 2 * 60 * 1000;

const asRecord = (value: unknown): JsonRecord | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;

const readPayloadString = (payload: JsonRecord | null, key: string): string | null => {
  const value = payload?.[key];

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
};

const toIsoFromNow = (delayMs: number): string => new Date(Date.now() + delayMs).toISOString();

const normalizeActivityTableType = (
  activity: HubSpotActivitySnapshot,
): HubSpotActivityUpsertRow["activity_type"] =>
  activity.activityType === "communication" && activity.channel === "SMS" ? "sms" : activity.activityType;

const readActivityMetadata = (activity: HubSpotActivitySnapshot, key: string): string | null =>
  activity.metadata[key] ?? activity.properties[key] ?? null;

const normalizeCallDirection = (value: string | null): "inbound" | "outbound" => {
  const normalized = value?.trim().toLowerCase();

  return normalized === "inbound" ? "inbound" : "outbound";
};

const normalizeCallStatus = (activity: HubSpotActivitySnapshot): "completed" | "missed" | "voicemail" | null => {
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

const parseDurationSeconds = (value: string | null): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(0, Math.round(parsed / 1000));
};

const isInterestingDealProperty = (propertyName: string | null): boolean =>
  !propertyName ||
  [
    "amount",
    "closedate",
    "dealstage",
    "hs_deal_stage_probability",
    "hubspot_owner_id",
    "pipeline",
  ].includes(propertyName);

const resolveActivityTarget = (
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

const resolveAssociationActivityTarget = (
  payload: JsonRecord | null,
): { activityType: HubSpotActivityType; hubspotActivityId: string } | null => {
  const fromObjectTypeId = readPayloadString(payload, "fromObjectTypeId");
  const toObjectTypeId = readPayloadString(payload, "toObjectTypeId");
  const fromObjectId = readPayloadString(payload, "fromObjectId");
  const toObjectId = readPayloadString(payload, "toObjectId");

  return resolveActivityTarget(fromObjectTypeId, fromObjectId) ?? resolveActivityTarget(toObjectTypeId, toObjectId);
};

const resolveAssociationDealId = (payload: JsonRecord | null): string | null => {
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

const loadWebhookEvent = async (eventId: string): Promise<HubSpotWebhookEventRow | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("hubspot_webhook_events")
    .select(
      "id, org_id, portal_id, subscription_type, object_type_id, object_id, property_name, property_value, occurred_at, payload, processing_status",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger l'evenement webhook HubSpot: ${error.message}`);
  }

  return data as HubSpotWebhookEventRow | null;
};

const updateWebhookEventStatus = async (
  eventId: string,
  status: "processing" | "completed" | "failed" | "ignored",
  errorMessage: string | null = null,
): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("hubspot_webhook_events")
    .update({
      processing_status: status,
      error_message: errorMessage,
      processed_at: status === "completed" || status === "failed" || status === "ignored" ? new Date().toISOString() : null,
    })
    .eq("id", eventId);

  if (error) {
    throw new Error(`Impossible de mettre a jour l'evenement webhook HubSpot: ${error.message}`);
  }
};

const queryOpenDealsByArrayField = async (
  orgId: string,
  fieldName: "associated_contact_ids" | "associated_company_ids",
  objectIds: string[],
): Promise<string[]> => {
  if (objectIds.length === 0) {
    return [];
  }

  const supabase = getSupabaseAdmin();
  const results: string[] = [];

  for (const objectId of objectIds) {
    const { data, error } = await supabase
      .from("hubspot_deals")
      .select("hubspot_deal_id")
      .eq("org_id", orgId)
      .eq("deal_lifecycle_status", "pending")
      .contains(fieldName, [objectId]);

    if (error) {
      throw new Error(`Impossible de charger les deals ouverts HubSpot: ${error.message}`);
    }

    results.push(...((data ?? []) as HubSpotDealLookupRow[]).map((row) => row.hubspot_deal_id));
  }

  return results;
};

const loadSalesAeOwnerIds = async (orgId: string): Promise<Set<string>> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("users")
    .select("hubspot_owner_id")
    .eq("org_id", orgId)
    .not("hubspot_owner_id", "is", null);

  if (error) {
    throw new Error(`Impossible de charger les owners Sales AE: ${error.message}`);
  }

  return new Set(
    ((data ?? []) as Array<{ hubspot_owner_id: string | null }>)
      .map((row) => row.hubspot_owner_id)
      .filter((ownerId): ownerId is string => Boolean(ownerId)),
  );
};

const filterEligibleRealtimeDealIds = async (orgId: string, dealIds: string[]): Promise<string[]> => {
  const uniqueDealIds = Array.from(new Set(dealIds.filter(Boolean)));

  if (uniqueDealIds.length === 0) {
    return [];
  }

  const salesAeOwnerIds = await loadSalesAeOwnerIds(orgId);

  if (salesAeOwnerIds.size === 0) {
    return [];
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("hubspot_deals")
    .select("hubspot_deal_id, hubspot_owner_id")
    .eq("org_id", orgId)
    .eq("deal_lifecycle_status", "pending")
    .in("hubspot_deal_id", uniqueDealIds)
    .in("hubspot_owner_id", Array.from(salesAeOwnerIds));

  if (error) {
    throw new Error(`Impossible de filtrer les deals realtime eligibles: ${error.message}`);
  }

  return ((data ?? []) as HubSpotDealLookupRow[]).map((row) => row.hubspot_deal_id);
};

const resolveImpactedDealIds = async (
  orgId: string,
  accessToken: string,
  activity: HubSpotActivitySnapshot,
): Promise<string[]> => {
  const impactedDealIds = new Set(activity.associatedDealIds);

  if (impactedDealIds.size === 0) {
    const [localContactDeals, localCompanyDeals] = await Promise.all([
      queryOpenDealsByArrayField(orgId, "associated_contact_ids", activity.associatedContactIds),
      queryOpenDealsByArrayField(orgId, "associated_company_ids", activity.associatedCompanyIds),
    ]);

    for (const dealId of [...localContactDeals, ...localCompanyDeals]) {
      impactedDealIds.add(dealId);
    }
  }

  if (impactedDealIds.size === 0) {
    const nestedDealIds = await Promise.all([
      ...activity.associatedContactIds.map((contactId) =>
        hubSpotService.fetchAssociatedDealIdsForContact(accessToken, contactId),
      ),
      ...activity.associatedCompanyIds.map((companyId) =>
        hubSpotService.fetchAssociatedDealIdsForCompany(accessToken, companyId),
      ),
    ]);

    for (const dealId of nestedDealIds.flat()) {
      impactedDealIds.add(dealId);
    }
  }

  return filterEligibleRealtimeDealIds(orgId, Array.from(impactedDealIds));
};

const upsertHubSpotActivity = async (
  orgId: string,
  activity: HubSpotActivitySnapshot,
  impactedDealIds: string[],
  event: HubSpotWebhookEventRow | null,
): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const syncedAt = new Date().toISOString();
  const activityTableType = normalizeActivityTableType(activity);
  const row: HubSpotActivityUpsertRow = {
    org_id: orgId,
    hubspot_activity_id: activity.id,
    activity_type: activityTableType,
    activity_channel: activity.channel,
    hubspot_owner_id: readActivityMetadata(activity, "ownerId"),
    occurred_at: activity.occurredAt,
    title: activity.title,
    body: activity.body,
    direction:
      readActivityMetadata(activity, "direction") ??
      activity.properties.hs_call_direction ??
      activity.properties.hs_email_direction ??
      null,
    status:
      readActivityMetadata(activity, "status") ??
      activity.properties.hs_call_status ??
      activity.properties.hs_email_status ??
      null,
    disposition: readActivityMetadata(activity, "disposition"),
    source_object_type_id: event?.object_type_id ?? null,
    source_object_type: activity.activityType,
    properties: activity.properties,
    associated_contact_ids: activity.associatedContactIds,
    associated_company_ids: activity.associatedCompanyIds,
    associated_deal_ids: impactedDealIds,
    last_hubspot_event_at: event?.occurred_at ?? null,
    synced_at: syncedAt,
  };

  const { error } = await supabase.from("hubspot_activities").upsert(row, {
    onConflict: "org_id,activity_type,hubspot_activity_id",
  });

  if (error) {
    throw new Error(`Impossible de sauvegarder l'activite HubSpot: ${error.message}`);
  }

  if (impactedDealIds.length > 0) {
    const linkRows = impactedDealIds.map((hubspotDealId) => ({
      org_id: orgId,
      activity_type: activityTableType,
      hubspot_activity_id: activity.id,
      hubspot_deal_id: hubspotDealId,
      link_source: activity.associatedDealIds.includes(hubspotDealId) ? "direct" : "contact_or_company",
      last_seen_at: syncedAt,
    }));
    const { error: linkError } = await supabase.from("hubspot_activity_deal_links").upsert(linkRows, {
      onConflict: "org_id,activity_type,hubspot_activity_id,hubspot_deal_id",
    });

    if (linkError) {
      throw new Error(`Impossible de sauvegarder les liens activite/deal HubSpot: ${linkError.message}`);
    }
  }
};

const loadProspectForActivity = async (
  orgId: string,
  activity: HubSpotActivitySnapshot,
  impactedDealIds: string[],
): Promise<ProspectLookupRow | null> => {
  const supabase = getSupabaseAdmin();
  let query = supabase.from("prospects").select("id, owner_user_id").eq("org_id", orgId).limit(1);

  if (impactedDealIds[0]) {
    query = query.eq("hubspot_deal_id", impactedDealIds[0]);
  } else if (activity.associatedContactIds[0]) {
    query = query.eq("hubspot_contact_id", activity.associatedContactIds[0]);
  } else {
    return null;
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le prospect lie a l'activite: ${error.message}`);
  }

  return data as ProspectLookupRow | null;
};

const upsertCallFromActivity = async (
  orgId: string,
  activity: HubSpotActivitySnapshot,
  impactedDealIds: string[],
): Promise<void> => {
  if (activity.activityType !== "call") {
    return;
  }

  const supabase = getSupabaseAdmin();
  const prospect = await loadProspectForActivity(orgId, activity, impactedDealIds);
  const { error } = await supabase.from("calls").upsert(
    {
      org_id: orgId,
      user_id: prospect?.owner_user_id ?? null,
      prospect_id: prospect?.id ?? null,
      external_call_id: `hubspot:${activity.id}`,
      direction: normalizeCallDirection(activity.properties.hs_call_direction ?? null),
      status: normalizeCallStatus(activity),
      duration_seconds: parseDurationSeconds(activity.properties.hs_call_duration ?? null),
      started_at: activity.occurredAt,
      ended_at: null,
      transcript: null,
      ai_summary: null,
    },
    {
      onConflict: "org_id,external_call_id",
    },
  );

  if (error) {
    throw new Error(`Impossible de sauvegarder l'appel HubSpot local: ${error.message}`);
  }
};

const scheduleDealReanalysis = async (
  orgId: string,
  hubspotDealId: string,
  triggerEventId: string | null,
  reason: string,
): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const delayMs = Math.max(10, env.hubspotWebhookDebounceSeconds) * 1000;
  const scheduledFor = toIsoFromNow(delayMs);
  const { data: existingRunData, error: existingRunError } = await supabase
    .from("hubspot_realtime_analysis_runs")
    .select("id, org_id, hubspot_deal_id, status, scheduled_for, trigger_event_ids")
    .eq("org_id", orgId)
    .eq("hubspot_deal_id", hubspotDealId)
    .eq("status", "queued")
    .order("scheduled_for", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingRunError) {
    throw new Error(`Impossible de charger le run d'analyse realtime: ${existingRunError.message}`);
  }

  const existingRun = existingRunData as HubSpotRealtimeAnalysisRunRow | null;
  const triggerEventIds = Array.from(
    new Set([...(existingRun?.trigger_event_ids ?? []), triggerEventId].filter((id): id is string => Boolean(id))),
  );

  if (existingRun) {
    const { error } = await supabase
      .from("hubspot_realtime_analysis_runs")
      .update({
        scheduled_for: scheduledFor,
        trigger_event_ids: triggerEventIds,
        reason,
      })
      .eq("id", existingRun.id);

    if (error) {
      throw new Error(`Impossible de debouncer l'analyse realtime: ${error.message}`);
    }

    await enqueueHubSpotRealtimeJob(
      {
        type: "reanalyse-deal",
        runId: existingRun.id,
      },
      {
        delay: delayMs,
      },
    );
    return;
  }

  const { data: insertedRunData, error: insertError } = await supabase
    .from("hubspot_realtime_analysis_runs")
    .insert({
      org_id: orgId,
      hubspot_deal_id: hubspotDealId,
      status: "queued",
      reason,
      scheduled_for: scheduledFor,
      trigger_event_ids: triggerEventIds,
    })
    .select("id")
    .single();

  if (insertError) {
    throw new Error(`Impossible de planifier l'analyse realtime: ${insertError.message}`);
  }

  const insertedRun = insertedRunData as { id: string };

  await enqueueHubSpotRealtimeJob(
    {
      type: "reanalyse-deal",
      runId: insertedRun.id,
    },
    {
      delay: delayMs,
    },
  );
};

const hydrateActivity = async (
  orgId: string,
  activityType: HubSpotActivityType,
  hubspotActivityId: string,
  event: HubSpotWebhookEventRow | null,
  scheduleDelayedRehydrate: boolean,
): Promise<void> => {
  const accessToken = await getHubSpotAccessToken(orgId);
  const activity = await hubSpotService.fetchActivity(accessToken, activityType, hubspotActivityId);
  const impactedDealIds = await resolveImpactedDealIds(orgId, accessToken, activity);

  if (impactedDealIds.length === 0) {
    return;
  }

  await upsertHubSpotActivity(orgId, activity, impactedDealIds, event);
  await upsertCallFromActivity(orgId, activity, impactedDealIds);
  await Promise.all(
    impactedDealIds.map((hubspotDealId) =>
      scheduleDealReanalysis(orgId, hubspotDealId, event?.id ?? null, `Nouvelle interaction HubSpot ${activityType}`),
    ),
  );

  if (scheduleDelayedRehydrate) {
    await enqueueHubSpotRealtimeJob(
      {
        type: "rehydrate-activity",
        orgId,
        activityType,
        hubspotActivityId,
      },
      {
        delay: ACTIVITY_REHYDRATE_DELAY_MS,
      },
    );
  }
};

const purgePrivacyDeletedContact = async (orgId: string, hubspotContactId: string): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const { data: impactedActivitiesData, error: activitiesError } = await supabase
    .from("hubspot_activities")
    .select("hubspot_activity_id, activity_type, associated_deal_ids")
    .eq("org_id", orgId)
    .contains("associated_contact_ids", [hubspotContactId]);

  if (activitiesError) {
    throw new Error(`Impossible de charger les activites a purger: ${activitiesError.message}`);
  }

  const impactedActivities = (impactedActivitiesData ?? []) as HubSpotActivityLookupRow[];
  const impactedDealIds = Array.from(new Set(impactedActivities.flatMap((activity) => activity.associated_deal_ids)));

  if (impactedActivities.length > 0) {
    const activityIds = impactedActivities.map((activity) => activity.hubspot_activity_id);
    const { error: linksError } = await supabase
      .from("hubspot_activity_deal_links")
      .delete()
      .eq("org_id", orgId)
      .in("hubspot_activity_id", activityIds);

    if (linksError) {
      throw new Error(`Impossible de purger les liens activite/deal: ${linksError.message}`);
    }
  }

  const [
    deleteActivitiesResult,
    deleteContactResult,
    deleteProspectsResult,
    deleteAnalysesResult,
  ] = await Promise.all([
    supabase.from("hubspot_activities").delete().eq("org_id", orgId).contains("associated_contact_ids", [hubspotContactId]),
    supabase.from("hubspot_contacts").delete().eq("org_id", orgId).eq("hubspot_contact_id", hubspotContactId),
    supabase.from("prospects").delete().eq("org_id", orgId).eq("hubspot_contact_id", hubspotContactId),
    impactedDealIds.length > 0
      ? supabase.from("deal_ai_analyses").delete().eq("org_id", orgId).in("hubspot_deal_id", impactedDealIds)
      : Promise.resolve({ data: null, error: null }),
  ]);

  const firstError =
    deleteActivitiesResult.error ??
    deleteContactResult.error ??
    deleteProspectsResult.error ??
    deleteAnalysesResult.error;

  if (firstError) {
    throw new Error(`Impossible de purger le contact RGPD HubSpot: ${firstError.message}`);
  }
};

const processHubSpotWebhookEvent = async (eventId: string): Promise<void> => {
  const event = await loadWebhookEvent(eventId);

  if (!event) {
    return;
  }

  if (!event.org_id) {
    await updateWebhookEventStatus(event.id, "ignored", "Evenement sans organisation Jarvis.");
    return;
  }

  await updateWebhookEventStatus(event.id, "processing");

  try {
    const payload = asRecord(event.payload);
    const directActivityTarget = resolveActivityTarget(event.object_type_id, event.object_id);
    const associationActivityTarget =
      event.subscription_type === "object.associationChange" ? resolveAssociationActivityTarget(payload) : null;
    const activityTarget = directActivityTarget ?? associationActivityTarget;
    const scheduleDelayedRehydrate =
      event.subscription_type === "object.creation" || event.subscription_type.endsWith(".creation");

    if (event.subscription_type === "contact.privacyDeletion" && event.object_id) {
      await purgePrivacyDeletedContact(event.org_id, event.object_id);
      await updateWebhookEventStatus(event.id, "completed");
      return;
    }

    if (activityTarget) {
      await hydrateActivity(
        event.org_id,
        activityTarget.activityType,
        activityTarget.hubspotActivityId,
        event,
        scheduleDelayedRehydrate,
      );
      await updateWebhookEventStatus(event.id, "completed");
      return;
    }

    const associationDealId =
      event.subscription_type === "object.associationChange" ? resolveAssociationDealId(payload) : null;
    const legacyDealId = event.subscription_type.startsWith("deal.") ? event.object_id : null;
    const dealId =
      (event.object_type_id && DEAL_OBJECT_TYPE_IDS.has(event.object_type_id) ? event.object_id : null) ??
      associationDealId ??
      legacyDealId;

    if (dealId && isInterestingDealProperty(event.property_name)) {
      const [eligibleDealId] = await filterEligibleRealtimeDealIds(event.org_id, [dealId]);

      if (!eligibleDealId) {
        await updateWebhookEventStatus(event.id, "ignored", "Deal hors scope realtime: ferme ou hors Sales AE.");
        return;
      }

      await scheduleDealReanalysis(event.org_id, eligibleDealId, event.id, "Changement HubSpot sur le deal");
      await updateWebhookEventStatus(event.id, "completed");
      return;
    }

    await updateWebhookEventStatus(event.id, "ignored", "Type d'evenement HubSpot non exploite pour le realtime.");
  } catch (error) {
    await updateWebhookEventStatus(
      event.id,
      "failed",
      error instanceof Error ? error.message : "Erreur inconnue pendant le traitement webhook HubSpot.",
    );
    throw error;
  }
};

const rehydrateHubSpotActivity = async (
  orgId: string,
  activityType: HubSpotActivityType,
  hubspotActivityId: string,
): Promise<void> => {
  await hydrateActivity(orgId, activityType, hubspotActivityId, null, false);
};

const runHubSpotDealReanalysis = async (runId: string): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("hubspot_realtime_analysis_runs")
    .select("id, org_id, hubspot_deal_id, status, scheduled_for, trigger_event_ids")
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le run d'analyse realtime: ${error.message}`);
  }

  const run = data as HubSpotRealtimeAnalysisRunRow | null;

  if (!run || run.status !== "queued") {
    return;
  }

  const scheduledAtMs = new Date(run.scheduled_for).getTime();

  if (Number.isFinite(scheduledAtMs) && scheduledAtMs > Date.now()) {
    await enqueueHubSpotRealtimeJob(
      {
        type: "reanalyse-deal",
        runId,
      },
      {
        delay: scheduledAtMs - Date.now(),
      },
    );
    return;
  }

  const { error: startError } = await supabase
    .from("hubspot_realtime_analysis_runs")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", run.id);

  if (startError) {
    throw new Error(`Impossible de demarrer l'analyse realtime: ${startError.message}`);
  }

  try {
    const { data: prospectData, error: prospectError } = await supabase
      .from("prospects")
      .select("id")
      .eq("org_id", run.org_id)
      .eq("hubspot_deal_id", run.hubspot_deal_id)
      .limit(1)
      .maybeSingle();

    if (prospectError) {
      throw new Error(`Impossible de charger le prospect du deal realtime: ${prospectError.message}`);
    }

    const prospectId = (prospectData as { id: string } | null)?.id ?? `hubspot:${run.hubspot_deal_id}`;

    const llmPreference = await resolveLlmProviderPreference(run.org_id);

    await analyzeDealActivityPlanForProspect(prospectId, {
      orgId: run.org_id,
      hubspotDealId: run.hubspot_deal_id,
      llmProvider: llmPreference.provider,
      llmModel: llmPreference.model,
      refresh: true,
    });

    const { error: completeError } = await supabase
      .from("hubspot_realtime_analysis_runs")
      .update({
        status: "completed",
        finished_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", run.id);

    if (completeError) {
      throw new Error(`Impossible de finaliser l'analyse realtime: ${completeError.message}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue pendant l'analyse realtime.";
    await supabase
      .from("hubspot_realtime_analysis_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: message,
      })
      .eq("id", run.id);
    throw error;
  }
};

export const processHubSpotRealtimeJob = async (job: HubSpotRealtimeJob): Promise<void> => {
  if (job.type === "process-webhook-event") {
    await processHubSpotWebhookEvent(job.eventId);
    return;
  }

  if (job.type === "rehydrate-activity") {
    await rehydrateHubSpotActivity(job.orgId, job.activityType, job.hubspotActivityId);
    return;
  }

  await runHubSpotDealReanalysis(job.runId);
};
