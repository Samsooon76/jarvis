import { invalidateHubSpotTasksCache } from "../../routes/hubspot/tasks.routes.js";
import { getHubSpotAccessToken } from "../hubspot-auth.service.js";
import { hubSpotService } from "../hubspot.service.js";
import { loadHubSpotRealtimeOwnerIds } from "../hubspot-owner-scope.service.js";
import type { HubSpotWebhookEventRow } from "./types.js";

const isTaskOwnerInRealtimeScope = async (orgId: string, ownerHubSpotId: string | null): Promise<boolean> => {
  const realtimeOwnerIds = await loadHubSpotRealtimeOwnerIds(orgId);

  if (realtimeOwnerIds.size === 0) {
    return true;
  }

  return Boolean(ownerHubSpotId && realtimeOwnerIds.has(ownerHubSpotId));
};

export const processTaskWebhookEvent = async (
  orgId: string,
  taskId: string,
  event: HubSpotWebhookEventRow,
): Promise<void> => {
  if (event.subscription_type === "object.deletion" || event.subscription_type === "task.deletion") {
    invalidateHubSpotTasksCache(orgId);
    return;
  }

  const accessToken = await getHubSpotAccessToken(orgId);
  const task = await hubSpotService.fetchTaskListItem(accessToken, taskId);
  const inScope = await isTaskOwnerInRealtimeScope(orgId, task.ownerHubSpotId);

  if (!inScope) {
    return;
  }

  invalidateHubSpotTasksCache(orgId);
};