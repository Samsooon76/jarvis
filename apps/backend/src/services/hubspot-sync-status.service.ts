import { getSupabaseAdmin } from "../db/client.js";

export type HubSpotSyncPersistentStatus = "queued" | "running" | "completed" | "failed";

export type HubSpotSyncStatusSnapshot = {
  orgId: string;
  status: HubSpotSyncPersistentStatus;
  startedAt: string | null;
  finishedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  jobId: string | null;
  progress: number;
  currentStep: string;
  updatedAt: string;
};

type HubSpotSyncStatusRow = {
  org_id: string;
  status: HubSpotSyncPersistentStatus;
  started_at: string | null;
  finished_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  job_id: string | null;
  progress: number;
  current_step: string;
  updated_at: string;
};

const mapSyncStatus = (row: HubSpotSyncStatusRow): HubSpotSyncStatusSnapshot => ({
  orgId: row.org_id,
  status: row.status,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  lastSuccessAt: row.last_success_at,
  lastError: row.last_error,
  jobId: row.job_id,
  progress: row.progress,
  currentStep: row.current_step,
  updatedAt: row.updated_at,
});

export const upsertHubSpotSyncStatus = async (input: {
  orgId: string;
  status: HubSpotSyncPersistentStatus;
  jobId?: string | null;
  progress: number;
  currentStep: string;
  error?: string | null;
}): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  const isFinished = input.status === "completed" || input.status === "failed";

  await supabase.from("hubspot_sync_status").upsert({
    org_id: input.orgId,
    status: input.status,
    started_at: input.status === "queued" || input.status === "running" ? now : undefined,
    finished_at: isFinished ? now : null,
    last_success_at: input.status === "completed" ? now : undefined,
    last_error: input.status === "failed" ? input.error ?? "Erreur inconnue" : null,
    job_id: input.jobId ?? null,
    progress: input.progress,
    current_step: input.currentStep,
    updated_at: now,
  });

  const { error } = await supabase.rpc("set_hubspot_integration_sync_status", {
    target_org_id: input.orgId,
    target_started_at: input.status === "queued" || input.status === "running" ? now : null,
    target_finished_at: isFinished ? now : null,
    target_status: input.status,
    target_error: input.status === "failed" ? input.error ?? "Erreur inconnue" : null,
  });

  if (error) {
    throw new Error(`Impossible de mettre a jour le statut prive HubSpot: ${error.message}`);
  }
};

export const getHubSpotSyncStatus = async (orgId: string): Promise<HubSpotSyncStatusSnapshot | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("hubspot_sync_status").select("*").eq("org_id", orgId).maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le statut persistant de sync HubSpot: ${error.message}`);
  }

  return data ? mapSyncStatus(data as HubSpotSyncStatusRow) : null;
};
