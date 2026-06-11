import { getSupabaseAdmin } from "../../db/client.js";
import type { HubSpotActivityLookupRow } from "./types.js";

export const purgePrivacyDeletedContact = async (orgId: string, hubspotContactId: string): Promise<void> => {
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
  const { data: impactedProspectData, error: prospectsLoadError } = await supabase
    .from("prospects")
    .select("id")
    .eq("org_id", orgId)
    .eq("hubspot_contact_id", hubspotContactId);

  if (prospectsLoadError) {
    throw new Error(`Impossible de charger les prospects a purger: ${prospectsLoadError.message}`);
  }

  const impactedProspectIds = ((impactedProspectData ?? []) as Array<{ id: string }>).map((prospect) => prospect.id);

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
    deleteFollowUpCacheResult,
    deleteAccessLogsResult,
  ] = await Promise.all([
    supabase.from("hubspot_activities").delete().eq("org_id", orgId).contains("associated_contact_ids", [hubspotContactId]),
    supabase.from("hubspot_contacts").delete().eq("org_id", orgId).eq("hubspot_contact_id", hubspotContactId),
    supabase.from("prospects").delete().eq("org_id", orgId).eq("hubspot_contact_id", hubspotContactId),
    impactedDealIds.length > 0
      ? supabase.from("deal_ai_analyses").delete().eq("org_id", orgId).in("hubspot_deal_id", impactedDealIds)
      : Promise.resolve({ data: null, error: null }),
    impactedDealIds.length > 0
      ? supabase.from("follow_up_task_ai_analyses").delete().eq("org_id", orgId).in("hubspot_deal_id", impactedDealIds)
      : Promise.resolve({ data: null, error: null }),
    impactedProspectIds.length > 0
      ? supabase.from("prospect_access_logs").delete().eq("org_id", orgId).in("prospect_id", impactedProspectIds)
      : Promise.resolve({ data: null, error: null }),
  ]);

  const firstError =
    deleteActivitiesResult.error ??
    deleteContactResult.error ??
    deleteProspectsResult.error ??
    deleteAnalysesResult.error ??
    deleteFollowUpCacheResult.error ??
    deleteAccessLogsResult.error;

  if (firstError) {
    throw new Error(`Impossible de purger le contact RGPD HubSpot: ${firstError.message}`);
  }
};
