import type { ProspectPriority, QueueData, QueueProspect } from "@jarvis/shared";
import { apiPath, getJson, type ApiRequestOptions } from "./client";
import type { HubSpotConnectionStatus, HubSpotLastUpdateItem, HubSpotOwnerOption } from "./hubspot";

type HubSpotOwnerProspect = {
  id: string;
  dealName: string | null;
  contactName: string;
  email: string | null;
  company: string | null;
  title: string | null;
  dealStage: string | null;
  dealStageLabel: string | null;
  dealAmount: number | null;
  closeProbability: number;
  closedAt: string | null;
  dealLifecycleStatus: "pending" | "won" | "lost" | null;
  isClosedDeal: boolean | null;
  lastContactAt: string | null;
  hubspotDealId: string | null;
  syncedAt: string;
  nextAction: string;
  reason: string;
  priority: ProspectPriority;
};

type HubSpotOwnerProspectsPayload = {
  orgId: string;
  hubspotOwnerId: string;
  hubspotDealCount: number | null;
  prospects: HubSpotOwnerProspect[];
};

type HubSpotQueueDashboardPayload = HubSpotOwnerProspectsPayload & {
  status: HubSpotConnectionStatus;
  owner: HubSpotOwnerOption;
  owners: HubSpotOwnerOption[];
  lastUpdates: HubSpotLastUpdateItem[];
};

export type HubSpotQueueData = Omit<QueueData, "generatedAt"> & {
  // null tant qu'aucune sync HubSpot reelle n'a eu lieu (pas de date fabriquee).
  generatedAt: string | null;
  hubspotPortalId: string | null;
  owner: HubSpotOwnerOption;
  owners: HubSpotOwnerOption[];
  hubspotDealCount: number | null;
  lastUpdates: HubSpotLastUpdateItem[];
};

const toQueueProspect = (prospect: HubSpotOwnerProspect): QueueProspect => ({
  id: prospect.id,
  name: prospect.contactName,
  title: prospect.title ?? "Titre non renseigne",
  company: prospect.company ?? prospect.dealName ?? prospect.contactName,
  dealAmount: prospect.dealAmount ?? 0,
  dealStage: prospect.dealStageLabel ?? prospect.dealStage ?? "Stage HubSpot non renseigne",
  closeProbability: prospect.closeProbability,
  closeDate: prospect.closedAt,
  lastContactAt: prospect.lastContactAt ?? prospect.syncedAt,
  nextAction: prospect.nextAction,
  reason: prospect.reason,
  priority: prospect.priority,
  email: prospect.email,
  phone: null,
  dealName: prospect.dealName,
  hubspotDealId: prospect.hubspotDealId,
});

export const fetchHubSpotQueue = async (
  orgId: string,
  preferredHubSpotOwnerId: string | null,
  live: boolean,
  options: ApiRequestOptions = {},
): Promise<HubSpotQueueData> => {
  const payload = await getJson<HubSpotQueueDashboardPayload>(
    apiPath("/api/queue/dashboard", {
      orgId,
      hubspotOwnerId: preferredHubSpotOwnerId,
      live,
      limit: 12,
    }),
    options,
  );
  const { status, owner, owners, lastUpdates } = payload;

  if (!status.connected) {
    return {
      userId: preferredHubSpotOwnerId ?? "",
      generatedAt: null,
      prospects: [],
      hubspotPortalId: null,
      owner: {
        ownerId: preferredHubSpotOwnerId ?? "",
        userId: null,
        hubspotUserId: null,
        name: "HubSpot non connecte",
        email: "",
        teamName: null,
        prospectCount: 0,
        syncedDealCount: 0,
        lastSyncedAt: null,
      },
      owners: [],
      hubspotDealCount: 0,
      lastUpdates,
    };
  }

  if (owners.length === 0) {
    throw new Error("Aucun owner HubSpot disponible pour cette organisation.");
  }
  const prospects = payload.prospects.map(toQueueProspect);

  return {
    userId: owner.ownerId,
    generatedAt: status.lastSyncedAt ?? owner.lastSyncedAt ?? null,
    prospects,
    hubspotPortalId: status.hubspotPortalId,
    owner,
    owners,
    hubspotDealCount: payload.hubspotDealCount ?? owner.syncedDealCount,
    lastUpdates,
  };
};
