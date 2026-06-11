import { fetchAllPages } from "./client.js";
import type { HubSpotOwner } from "./types.js";

export const fetchOwners = async (accessToken: string): Promise<HubSpotOwner[]> => {
  try {
    return await fetchAllPages<HubSpotOwner>("/crm/v3/owners", accessToken);
  } catch (error) {
    if (error instanceof Error && error.message.includes("403")) {
      throw new Error(
        "HubSpot refuse la liste des owners. Ajoute le scope crm.objects.owners.read puis reconnecte HubSpot.",
      );
    }

    throw error;
  }
};
