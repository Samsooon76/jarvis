import { getSupabaseAdmin } from "../db/client.js";
import type { Json } from "../db/database.types.js";
import { getHubSpotAccessToken } from "./hubspot-auth.service.js";
import { hubSpotService } from "./hubspot.service.js";
import { getHubSpotSyncStatus, type HubSpotSyncStatusSnapshot } from "./hubspot-sync-status.service.js";

export type HubSpotOwnerDiagnostic = {
  orgId: string;
  supabaseConfigured: boolean;
  orgFound: boolean;
  tokenPresent: boolean;
  tokenUsable: boolean;
  hubspotOwnerCount: number;
  jarvisUserCount: number;
  matchedOwnerCount: number;
  unknownOwnerIds: string[];
  prospectsWithoutOwner: number;
  prospectsWithUnknownOwner: number;
  prospectsWithJarvisOwner: number;
  syncStatus: HubSpotSyncStatusSnapshot | null;
  checkedAt: string;
};

type UserOwnerRow = {
  id: string;
  hubspot_owner_id: string | null;
};

type ProspectOwnerRow = {
  owner_user_id: string | null;
  raw_data: Json;
};

const getRawOwnerId = (rawData: Json): string | null => {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    return null;
  }

  const value = rawData.hubspotOwnerId;

  return typeof value === "string" && value.trim() ? value : null;
};

export const diagnoseHubSpotOwners = async (orgId: string): Promise<HubSpotOwnerDiagnostic> => {
  const supabase = getSupabaseAdmin();
  const checkedAt = new Date().toISOString();
  const { data: org, error: orgError } = await supabase.from("organizations").select("id").eq("id", orgId).maybeSingle();

  if (orgError) {
    throw new Error(`Impossible de charger l'organisation: ${orgError.message}`);
  }

  let tokenPresent = false;
  let tokenUsable = false;
  let hubspotOwnerCount = 0;

  try {
    const accessToken = await getHubSpotAccessToken(orgId);
    tokenPresent = true;
    const owners = await hubSpotService.fetchOwners(accessToken);
    hubspotOwnerCount = owners.filter((owner) => !owner.archived).length;
    tokenUsable = true;
  } catch (error) {
    tokenPresent = !(error instanceof Error && error.message.includes("Aucun token HubSpot"));
  }

  const [{ data: users, error: usersError }, { data: prospects, error: prospectsError }, syncStatus] =
    await Promise.all([
      supabase.from("users").select("id, hubspot_owner_id").eq("org_id", orgId),
      supabase.from("prospects").select("owner_user_id, raw_data").eq("org_id", orgId).range(0, 9999),
      getHubSpotSyncStatus(orgId).catch(() => null),
    ]);

  if (usersError) {
    throw new Error(`Impossible de charger les users Jarvis: ${usersError.message}`);
  }

  if (prospectsError) {
    throw new Error(`Impossible de charger les prospects: ${prospectsError.message}`);
  }

  const userRows = (users ?? []) as UserOwnerRow[];
  const prospectRows = (prospects ?? []) as ProspectOwnerRow[];
  const knownUserIds = new Set(userRows.map((user) => user.id));
  const knownOwnerIds = new Set(
    userRows.map((user) => user.hubspot_owner_id).filter((ownerId): ownerId is string => Boolean(ownerId)),
  );
  const unknownOwnerIds = new Set<string>();
  let prospectsWithoutOwner = 0;
  let prospectsWithUnknownOwner = 0;
  let prospectsWithJarvisOwner = 0;

  for (const prospect of prospectRows) {
    if (prospect.owner_user_id && knownUserIds.has(prospect.owner_user_id)) {
      prospectsWithJarvisOwner += 1;
      continue;
    }

    const rawOwnerId = getRawOwnerId(prospect.raw_data);

    if (!rawOwnerId) {
      prospectsWithoutOwner += 1;
      continue;
    }

    if (!knownOwnerIds.has(rawOwnerId)) {
      unknownOwnerIds.add(rawOwnerId);
      prospectsWithUnknownOwner += 1;
    }
  }

  return {
    orgId,
    supabaseConfigured: true,
    orgFound: Boolean(org),
    tokenPresent,
    tokenUsable,
    hubspotOwnerCount,
    jarvisUserCount: userRows.length,
    matchedOwnerCount: knownOwnerIds.size,
    unknownOwnerIds: Array.from(unknownOwnerIds).sort(),
    prospectsWithoutOwner,
    prospectsWithUnknownOwner,
    prospectsWithJarvisOwner,
    syncStatus,
    checkedAt,
  };
};
