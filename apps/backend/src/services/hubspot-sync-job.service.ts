import type { Json } from "../db/database.types.js";
import { createJob, getJob, updateJob } from "./job-store.js";
import { upsertHubSpotSyncStatus } from "./hubspot-sync-status.service.js";

export type SyncResult = {
  orgId: string;
  syncedCount: number;
  crm: {
    contactCount: number;
    companyCount: number;
    dealCount: number;
    leadCount: number;
  };
  autoFollowUp: {
    analyzedCount: number;
    createdCount: number;
    skippedCount: number;
    failedCount: number;
  };
};

export type SyncProgressLog = {
  at: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
};

export type SyncProgressStatus = "queued" | "running" | "completed" | "failed";

export type SyncJobSnapshot = {
  jobId: string;
  orgId: string;
  status: SyncProgressStatus;
  progress: number;
  currentStep: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  logs: SyncProgressLog[];
  result: SyncResult | null;
  error: string | null;
};

export type SyncProgressEvent = {
  progress: number;
  step: string;
  level?: SyncProgressLog["level"];
  message?: string;
};

const HUBSPOT_SYNC_JOB_LOG_LIMIT = 80;
const HUBSPOT_SYNC_JOB_TYPE = "hubspot_sync";

const createSyncJobId = (): string => `hubspot-sync-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const toSyncJobSnapshot = (job: Awaited<ReturnType<typeof getJob>>): SyncJobSnapshot | null => {
  if (!job || job.type !== HUBSPOT_SYNC_JOB_TYPE || !job.orgId) {
    return null;
  }

  return {
    jobId: job.id,
    orgId: job.orgId,
    status: job.status === "skipped" ? "failed" : job.status,
    progress: job.progress,
    currentStep: job.currentStep,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    logs: job.logs.filter((log) => log.level !== "warning") as SyncProgressLog[],
    result: job.result as SyncResult | null,
    error: job.error,
  };
};

export const loadHubSpotSyncJob = async (jobId: string): Promise<SyncJobSnapshot | null> => {
  const job = await getJob(jobId);
  return toSyncJobSnapshot(job);
};

export const createHubSpotSyncJob = async (orgId: string): Promise<SyncJobSnapshot> => {
  const now = new Date().toISOString();
  const job = await createJob({
    id: createSyncJobId(),
    orgId,
    type: HUBSPOT_SYNC_JOB_TYPE,
    currentStep: "Sync en attente",
    logs: [
      {
        at: now,
        level: "info",
        message: "Job de sync HubSpot cree.",
      },
    ],
  });

  void upsertHubSpotSyncStatus({
    orgId,
    status: "queued",
    jobId: job.id,
    progress: 0,
    currentStep: job.currentStep,
  });

  const snapshot = toSyncJobSnapshot(job);

  if (!snapshot) {
    throw new Error("Job de sync HubSpot invalide apres creation.");
  }

  return snapshot;
};

export const updateHubSpotSyncJob = async (jobId: string, event: SyncProgressEvent): Promise<void> => {
  const job = await loadHubSpotSyncJob(jobId);

  if (!job) {
    return;
  }

  const now = new Date().toISOString();
  job.status = job.status === "queued" ? "running" : job.status;
  job.progress = Math.max(job.progress, Math.min(99, Math.round(event.progress)));
  job.currentStep = event.step;

  if (event.message) {
    job.logs = [
      ...job.logs,
      {
        at: now,
        level: event.level ?? "info",
        message: event.message,
      },
    ].slice(-HUBSPOT_SYNC_JOB_LOG_LIMIT);
  }
  await updateJob(jobId, {
    status: job.status,
    progress: job.progress,
    currentStep: job.currentStep,
    logs: job.logs,
  });
  void upsertHubSpotSyncStatus({
    orgId: job.orgId,
    status: "running",
    jobId,
    progress: job.progress,
    currentStep: job.currentStep,
  });
};

export const completeHubSpotSyncJob = async (jobId: string, result: SyncResult): Promise<void> => {
  const job = await loadHubSpotSyncJob(jobId);

  if (!job) {
    return;
  }

  const now = new Date().toISOString();
  job.status = "completed";
  job.progress = 100;
  job.currentStep = "Sync terminee";
  job.finishedAt = now;
  job.result = result;
  job.logs = [
    ...job.logs,
    {
      at: now,
      level: "success",
      message: `Sync terminee: ${result.syncedCount} prospect(s), ${result.crm.dealCount} deal(s), ${result.crm.contactCount} contact(s), ${result.crm.leadCount} lead(s).`,
    } satisfies SyncProgressLog,
  ].slice(-HUBSPOT_SYNC_JOB_LOG_LIMIT);
  await updateJob(jobId, {
    status: "completed",
    progress: 100,
    currentStep: job.currentStep,
    logs: job.logs,
    result: result as unknown as Json,
    error: null,
    finishedAt: now,
  });
  void upsertHubSpotSyncStatus({
    orgId: job.orgId,
    status: "completed",
    jobId,
    progress: 100,
    currentStep: job.currentStep,
  });
};

export const failHubSpotSyncJob = async (jobId: string, error: unknown): Promise<void> => {
  const job = await loadHubSpotSyncJob(jobId);

  if (!job) {
    return;
  }

  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : "Erreur inconnue pendant la sync HubSpot.";
  job.status = "failed";
  job.currentStep = "Sync en erreur";
  job.finishedAt = now;
  job.error = message;
  job.logs = [
    ...job.logs,
    {
      at: now,
      level: "error",
      message,
    } satisfies SyncProgressLog,
  ].slice(-HUBSPOT_SYNC_JOB_LOG_LIMIT);
  await updateJob(jobId, {
    status: "failed",
    progress: job.progress,
    currentStep: job.currentStep,
    logs: job.logs,
    error: message,
    finishedAt: now,
  });
  void upsertHubSpotSyncStatus({
    orgId: job.orgId,
    status: "failed",
    jobId,
    progress: job.progress,
    currentStep: job.currentStep,
    error: message,
  });
};

