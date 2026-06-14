import { getSupabaseAdmin } from "../../db/client.js";
import { getHubSpotAccessToken } from "../hubspot-auth.service.js";
import { hubSpotService, type HubSpotActivitySnapshot, type HubSpotActivityType } from "../hubspot.service.js";
import { enqueueHubSpotRealtimeJob } from "../hubspot-realtime-queue.service.js";
import { loadHubSpotRealtimeOwnerIds } from "../hubspot-owner-scope.service.js";
import {
  ACTIVITY_REHYDRATE_DELAY_MS,
  normalizeActivityTableType,
  normalizeCallDirection,
  normalizeCallStatus,
  parseDurationSeconds,
  readActivityMetadata,
} from "./shared.js";
import { acceptNormalizedActivityEvents } from "./normalized-events.js";
import { scheduleDealReanalysis } from "./reanalysis.js";
import type {
  HubSpotActivityUpsertRow,
  HubSpotDealLookupRow,
  HubSpotWebhookEventRow,
  ProspectLookupRow,
} from "./types.js";

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

const loadRealtimeOwnerIds = async (orgId: string): Promise<Set<string>> => {
  return loadHubSpotRealtimeOwnerIds(orgId);
};

export const filterEligibleRealtimeDealIds = async (
  orgId: string,
  dealIds: string[],
  options: { includeClosed?: boolean } = {},
): Promise<string[]> => {
  const uniqueDealIds = Array.from(new Set(dealIds.filter(Boolean)));

  if (uniqueDealIds.length === 0) {
    return [];
  }

  const realtimeOwnerIds = await loadRealtimeOwnerIds(orgId);

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("hubspot_deals")
    .select("hubspot_deal_id, hubspot_owner_id")
    .eq("org_id", orgId)
    .in("hubspot_deal_id", uniqueDealIds);

  if (options.includeClosed !== true) {
    query = query.eq("deal_lifecycle_status", "pending");
  }

  if (realtimeOwnerIds.size > 0) {
    query = query.in("hubspot_owner_id", Array.from(realtimeOwnerIds));
  }

  const { data, error } = await query;

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

export const upsertHubSpotActivity = async (
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

const resolveJarvisUserIdFromHubSpotOwner = async (
  orgId: string,
  hubspotOwnerId: string | null,
): Promise<string | null> => {
  if (!hubspotOwnerId) {
    return null;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("id")
    .eq("org_id", orgId)
    .eq("hubspot_owner_id", hubspotOwnerId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de resoudre l'owner HubSpot du call: ${error.message}`);
  }

  return (data as { id: string } | null)?.id ?? null;
};

const buildCallSummaryFromActivity = (activity: HubSpotActivitySnapshot): string | null => {
  const parts = [
    activity.body?.trim() || null,
    activity.title?.trim() || null,
    readActivityMetadata(activity, "disposition"),
  ].filter((part): part is string => Boolean(part?.trim()));

  return parts.length > 0 ? parts.join("\n") : null;
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
  const hubspotOwnerId = readActivityMetadata(activity, "ownerId");
  const userId =
    (await resolveJarvisUserIdFromHubSpotOwner(orgId, hubspotOwnerId)) ?? prospect?.owner_user_id ?? null;
  const { error } = await supabase.from("calls").upsert(
    {
      org_id: orgId,
      user_id: userId,
      prospect_id: prospect?.id ?? null,
      external_call_id: `hubspot:${activity.id}`,
      direction: normalizeCallDirection(activity.properties.hs_call_direction ?? null),
      status: normalizeCallStatus(activity),
      duration_seconds: parseDurationSeconds(activity.properties.hs_call_duration ?? null),
      started_at: activity.occurredAt,
      ended_at: null,
      transcript: null,
      ai_summary: buildCallSummaryFromActivity(activity),
    },
    {
      onConflict: "org_id,external_call_id",
    },
  );

  if (error) {
    throw new Error(`Impossible de sauvegarder l'appel HubSpot local: ${error.message}`);
  }
};

export const hydrateActivity = async (
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
  await acceptNormalizedActivityEvents({
    orgId,
    activity,
    impactedDealIds,
    sourceEventId: event?.id ?? null,
  });
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
