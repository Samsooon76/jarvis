import { getSupabaseAdmin } from "../../db/client.js";
import { getHubSpotAccessToken } from "../hubspot-auth.service.js";
import { loadHubSpotRealtimeOwnerIds } from "../hubspot-owner-scope.service.js";
import { hubSpotService } from "../hubspot.service.js";
import { syncHubSpotProspects } from "../../routes/hubspot/helpers.js";

export type PlaybookTeamDealsSyncResult = {
  ownerIds: string[];
  ownerCount: number;
  dealCount: number;
  ownerNames: string[];
};

export const loadPlaybookTeamOwnerNames = async (orgId: string, ownerIds: string[]): Promise<string[]> => {
  if (ownerIds.length === 0) {
    return [];
  }

  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("hubspot_owner_id, name")
    .eq("org_id", orgId)
    .in("hubspot_owner_id", ownerIds);

  if (error) {
    return [];
  }

  return (data ?? [])
    .map((row) => row.name?.trim())
    .filter((name): name is string => Boolean(name));
};

export const resolvePlaybookTeamOwnerIds = async (orgId: string): Promise<string[]> => {
  const salesAeOwnerIds = Array.from(await loadHubSpotRealtimeOwnerIds(orgId));

  if (salesAeOwnerIds.length > 0) {
    return salesAeOwnerIds;
  }

  try {
    const accessToken = await getHubSpotAccessToken(orgId);
    const owners = await hubSpotService.fetchOwners(accessToken);

    return owners.filter((owner) => !owner.archived).map((owner) => owner.id);
  } catch {
    const { data, error } = await getSupabaseAdmin()
      .from("users")
      .select("hubspot_owner_id")
      .eq("org_id", orgId)
      .not("hubspot_owner_id", "is", null);

    if (error) {
      throw new Error(`Impossible de charger les owners HubSpot de l'equipe: ${error.message}`);
    }

    return Array.from(
      new Set(
        ((data ?? []) as Array<{ hubspot_owner_id: string | null }>)
          .map((row) => row.hubspot_owner_id)
          .filter((ownerId): ownerId is string => Boolean(ownerId)),
      ),
    );
  }
};

export const ensureTeamDealsForPlaybook = async (orgId: string): Promise<PlaybookTeamDealsSyncResult> => {
  const ownerIds = await resolvePlaybookTeamOwnerIds(orgId);

  if (ownerIds.length === 0) {
    return { ownerIds: [], ownerCount: 0, dealCount: 0, ownerNames: [] };
  }

  const syncResult = await syncHubSpotProspects(orgId, [], false, ownerIds);
  const ownerNames = await loadPlaybookTeamOwnerNames(orgId, ownerIds);

  return {
    ownerIds,
    ownerCount: ownerIds.length,
    dealCount: syncResult.crm.dealCount,
    ownerNames,
  };
};