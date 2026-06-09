import { getHubSpotAccessToken } from "./hubspot-auth.service.js";
import { hubSpotService, type HubSpotOwner } from "./hubspot.service.js";

const getDisplayTeamName = (teams: HubSpotOwner["teams"] | undefined): string | null =>
  teams?.find((team) => team.primary)?.name ?? teams?.[0]?.name ?? null;

const isSalesAeOwner = (owner: HubSpotOwner): boolean =>
  getDisplayTeamName(owner.teams)?.trim().toLowerCase().includes("sales ae") ?? false;

export const selectRealtimeOwnerIdsFromCrmOwners = (owners: HubSpotOwner[]): Set<string> => {
  const activeOwners = owners.filter((owner) => !owner.archived && owner.id.trim().length > 0);
  const salesAeOwners = activeOwners.filter(isSalesAeOwner);
  const selectedOwners = salesAeOwners.length > 0 ? salesAeOwners : activeOwners;

  return new Set(selectedOwners.map((owner) => owner.id));
};

export const loadHubSpotRealtimeOwnerIds = async (orgId: string): Promise<Set<string>> => {
  try {
    const accessToken = await getHubSpotAccessToken(orgId);
    const owners = await hubSpotService.fetchOwners(accessToken);

    return selectRealtimeOwnerIdsFromCrmOwners(owners);
  } catch {
    // Si HubSpot ne permet pas de lister les owners, le scope realtime reste base
    // sur les deals ouverts synchronises localement, sans dependance aux users Jarvis.
    return new Set();
  }
};
