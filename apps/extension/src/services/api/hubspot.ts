import { API_BASE_URL, apiPath, getJson, postJson, type ApiRequestOptions } from "./client";
import { clearHubSpotOrgCaches, pollDelayMs, POLL_TIMEOUT_MS, wait } from "./cache";

export type HubSpotConnectionStatus = {
  orgId: string;
  connected: boolean;
  hubspotPortalId: string | null;
  prospectCount: number;
  syncedDealCount: number;
  hubspotDealCount: number | null;
  lastSyncedAt: string | null;
};

export type HubSpotOwnerOption = {
  ownerId: string;
  userId: string | null;
  hubspotUserId: string | null;
  name: string;
  email: string;
  teamName: string | null;
  prospectCount: number;
  syncedDealCount: number;
  lastSyncedAt: string | null;
};

export type HubSpotLastUpdateItem = {
  id: string;
  orgId: string;
  hubspotDealId: string;
  dealName: string | null;
  companyName: string | null;
  amount: number | null;
  dealStage: string | null;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  reason: string | null;
  eventCount: number;
  nextAction: {
    title: string;
    rationale: string;
    dueInDays: number;
    priority: "low" | "medium" | "high";
  } | null;
  analysisProvider: string | null;
  analysisModel: string | null;
  errorMessage: string | null;
  receivedAt: string;
  scheduledFor: string;
  processedAt: string | null;
};

type HubSpotLastUpdatesPayload = {
  orgId: string;
  updates: HubSpotLastUpdateItem[];
};

export type HubSpotSyncResult = {
  orgId: string;
  syncedCount: number;
  crm: {
    contactCount: number;
    companyCount: number;
    dealCount: number;
    leadCount: number;
  };
  autoFollowUp?: {
    analyzedCount: number;
    createdCount: number;
    skippedCount: number;
    failedCount: number;
  };
};

export type HubSpotSyncJobLog = {
  at: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
};

export type HubSpotSyncJobStatus = {
  jobId: string;
  orgId: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  currentStep: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  logs: HubSpotSyncJobLog[];
  result: HubSpotSyncResult | null;
  error: string | null;
};

export type HubSpotDisconnectResult = {
  orgId: string;
  disconnected: true;
  purgedProspectCount: number;
};

export const fetchHubSpotLastUpdates = async (
  orgId: string,
  limit = 12,
  options: ApiRequestOptions = {},
): Promise<HubSpotLastUpdateItem[]> => {
  const payload = await getJson<HubSpotLastUpdatesPayload>(
    apiPath("/api/hubspot/last-updates", { orgId, limit }),
    options,
  );

  return payload.updates;
};

export const buildHubSpotConnectUrl = (orgId: string, returnTo: string): string => {
  const redirectUrl = new URL(`${API_BASE_URL}/api/auth/hubspot/start`);
  redirectUrl.searchParams.set("orgId", orgId);
  redirectUrl.searchParams.set("returnTo", returnTo);
  redirectUrl.searchParams.set("_", String(Date.now()));

  return redirectUrl.toString();
};

export const syncHubSpotToSupabase = async (
  orgId: string,
  hubspotOwnerIds: string[] = [],
  onProgress?: (status: HubSpotSyncJobStatus) => void,
): Promise<HubSpotSyncResult> =>
  startAndPollHubSpotSync(orgId, hubspotOwnerIds, onProgress);

export const fetchHubSpotSyncJob = async (jobId: string): Promise<HubSpotSyncJobStatus> =>
  getJson<HubSpotSyncJobStatus>(`/api/sync/hubspot/jobs/${encodeURIComponent(jobId)}`);

const runHubSpotSyncInline = async (orgId: string, hubspotOwnerIds: string[]): Promise<HubSpotSyncResult> =>
  postJson<HubSpotSyncResult>("/api/sync/hubspot", {
    orgId,
    hubspotOwnerIds,
    async: false,
  });

const startAndPollHubSpotSync = async (
  orgId: string,
  hubspotOwnerIds: string[],
  onProgress?: (status: HubSpotSyncJobStatus) => void,
): Promise<HubSpotSyncResult> => {
  clearHubSpotOrgCaches(orgId);
  const startedJob = await postJson<HubSpotSyncJobStatus>("/api/sync/hubspot", {
    orgId,
    hubspotOwnerIds,
    async: true,
  });
  onProgress?.(startedJob);

  let currentJob = startedJob;
  let attempt = 0;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (currentJob.status !== "completed" && currentJob.status !== "failed") {
    if (Date.now() > deadline) {
      throw new Error("Delai d'attente depasse pendant la synchronisation HubSpot. Veuillez reessayer.");
    }
    await wait(pollDelayMs(attempt));
    attempt += 1;
    try {
      currentJob = await fetchHubSpotSyncJob(startedJob.jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";

      if (!message.includes("Job de sync HubSpot introuvable")) {
        throw error;
      }

      const result = await runHubSpotSyncInline(orgId, hubspotOwnerIds);
      onProgress?.({
        ...startedJob,
        status: "completed",
        progress: 100,
        currentStep: "Sync terminee",
        updatedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        logs: [
          ...startedJob.logs,
          {
            at: new Date().toISOString(),
            level: "warning",
            message: "Polling async indisponible sur le backend. Sync relancee en mode direct.",
          },
        ],
        result,
        error: null,
      });

      clearHubSpotOrgCaches(orgId);

      return result;
    }
    onProgress?.(currentJob);
  }

  if (currentJob.status === "failed") {
    throw new Error(currentJob.error ?? "Erreur inconnue pendant la sync HubSpot.");
  }

  if (!currentJob.result) {
    throw new Error("La sync HubSpot est terminee mais aucun resultat n'a ete renvoye.");
  }

  clearHubSpotOrgCaches(orgId);

  return currentJob.result;
};

export const disconnectHubSpot = async (orgId: string): Promise<HubSpotDisconnectResult> =>
  postJson<HubSpotDisconnectResult>("/api/hubspot/disconnect", { orgId, purgeData: true }).finally(() =>
    clearHubSpotOrgCaches(orgId),
  );
