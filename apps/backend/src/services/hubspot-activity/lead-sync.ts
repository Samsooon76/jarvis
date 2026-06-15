import { getSupabaseAdmin } from "../../db/client.js";
import { getHubSpotAccessToken } from "../hubspot-auth.service.js";
import { hubSpotService } from "../hubspot.service.js";
import { loadHubSpotRealtimeOwnerIds } from "../hubspot-owner-scope.service.js";
import { normalizeWebhookDate } from "./shared.js";
import type { HubSpotWebhookEventRow } from "./types.js";

type HubSpotLeadUpsertRow = {
  org_id: string;
  hubspot_lead_id: string;
  hubspot_owner_id: string | null;
  associated_contact_ids: string[];
  associated_company_ids: string[];
  name: string;
  pipeline_id: string | null;
  pipeline_label: string | null;
  phase_id: string | null;
  phase_label: string | null;
  hubspot_created_at: string | null;
  hubspot_updated_at: string | null;
  properties: Record<string, string | null>;
  synced_at: string;
};

const isLeadOwnerInRealtimeScope = async (orgId: string, ownerHubSpotId: string | null): Promise<boolean> => {
  const realtimeOwnerIds = await loadHubSpotRealtimeOwnerIds(orgId);

  if (realtimeOwnerIds.size === 0) {
    return true;
  }

  return Boolean(ownerHubSpotId && realtimeOwnerIds.has(ownerHubSpotId));
};

const deleteLeadFromJarvis = async (orgId: string, leadId: string): Promise<void> => {
  const { error } = await getSupabaseAdmin()
    .from("hubspot_leads")
    .delete()
    .eq("org_id", orgId)
    .eq("hubspot_lead_id", leadId);

  if (error) {
    throw new Error(`Impossible de supprimer le lead HubSpot synchronise: ${error.message}`);
  }
};

const upsertLeadInJarvis = async (orgId: string, lead: Awaited<ReturnType<typeof hubSpotService.fetchLeadById>>): Promise<void> => {
  if (!lead) {
    return;
  }

  const syncedAt = new Date().toISOString();
  const row: HubSpotLeadUpsertRow = {
    org_id: orgId,
    hubspot_lead_id: lead.id,
    hubspot_owner_id: lead.hubspotOwnerId,
    associated_contact_ids: lead.associatedContactIds,
    associated_company_ids: lead.associatedCompanyIds,
    name: lead.name,
    pipeline_id: lead.pipelineId,
    pipeline_label: lead.pipelineLabel,
    phase_id: lead.phaseId,
    phase_label: lead.phaseLabel,
    hubspot_created_at: normalizeWebhookDate(lead.createdAt),
    hubspot_updated_at: normalizeWebhookDate(lead.updatedAt),
    properties: lead.properties,
    synced_at: syncedAt,
  };
  const { error } = await getSupabaseAdmin().from("hubspot_leads").upsert(row, {
    onConflict: "org_id,hubspot_lead_id",
  });

  if (error) {
    throw new Error(`Impossible de synchroniser le lead HubSpot en temps reel: ${error.message}`);
  }
};

export const processLeadWebhookEvent = async (
  orgId: string,
  leadId: string,
  event: HubSpotWebhookEventRow,
): Promise<void> => {
  if (event.subscription_type === "object.deletion" || event.subscription_type === "lead.deletion") {
    await deleteLeadFromJarvis(orgId, leadId);
    return;
  }

  const accessToken = await getHubSpotAccessToken(orgId);
  const lead = await hubSpotService.fetchLeadById(accessToken, leadId);

  if (!lead) {
    return;
  }

  const inScope = await isLeadOwnerInRealtimeScope(orgId, lead.hubspotOwnerId);

  if (!inScope) {
    return;
  }

  await upsertLeadInJarvis(orgId, lead);
};