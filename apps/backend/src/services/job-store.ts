import { getSupabaseAdmin } from "../db/client.js";
import type { Json } from "../db/database.types.js";

export type PersistentJobStatus = "queued" | "running" | "completed" | "failed" | "skipped";

export type PersistentJobLog = {
  at: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
};

export type PersistentJobSnapshot<TResult extends Json | null = Json | null> = {
  id: string;
  orgId: string | null;
  type: string;
  status: PersistentJobStatus;
  progress: number;
  currentStep: string;
  logs: PersistentJobLog[];
  result: TResult;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

type BackendJobRow = {
  id: string;
  org_id: string | null;
  type: string;
  status: PersistentJobStatus;
  progress: number;
  current_step: string;
  logs: Json;
  result: Json | null;
  error: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
};

const memoryJobs = new Map<string, PersistentJobSnapshot>();

const mapRowToJob = <TResult extends Json | null>(row: BackendJobRow): PersistentJobSnapshot<TResult> => ({
  id: row.id,
  orgId: row.org_id,
  type: row.type,
  status: row.status,
  progress: row.progress,
  currentStep: row.current_step,
  logs: Array.isArray(row.logs) ? (row.logs as PersistentJobLog[]) : [],
  result: row.result as TResult,
  error: row.error,
  startedAt: row.started_at,
  updatedAt: row.updated_at,
  finishedAt: row.finished_at,
});

export const createJob = async <TResult extends Json | null = Json | null>(input: {
  id: string;
  orgId: string | null;
  type: string;
  currentStep: string;
  logs: PersistentJobLog[];
}): Promise<PersistentJobSnapshot<TResult>> => {
  const now = new Date().toISOString();
  const job: PersistentJobSnapshot<TResult> = {
    id: input.id,
    orgId: input.orgId,
    type: input.type,
    status: "queued",
    progress: 0,
    currentStep: input.currentStep,
    logs: input.logs,
    result: null as TResult,
    error: null,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
  };

  memoryJobs.set(input.id, job as PersistentJobSnapshot);

  try {
    const supabase = getSupabaseAdmin();
    await supabase.from("backend_jobs").upsert({
      id: input.id,
      org_id: input.orgId,
      type: input.type,
      status: job.status,
      progress: job.progress,
      current_step: job.currentStep,
      logs: job.logs as unknown as Json,
      result: null,
      error: null,
      started_at: now,
      updated_at: now,
      finished_at: null,
    });
  } catch {
    // The in-memory store keeps dev/local flows working before migrations are applied.
  }

  return job;
};

export const updateJob = async <TResult extends Json | null = Json | null>(
  id: string,
  patch: Partial<Pick<PersistentJobSnapshot<TResult>, "status" | "progress" | "currentStep" | "logs" | "result" | "error" | "finishedAt">>,
): Promise<void> => {
  const existing = memoryJobs.get(id);
  const now = new Date().toISOString();

  if (existing) {
    memoryJobs.set(id, {
      ...existing,
      ...patch,
      updatedAt: now,
    } as PersistentJobSnapshot);
  }

  try {
    const supabase = getSupabaseAdmin();
    await supabase
      .from("backend_jobs")
      .update({
        status: patch.status,
        progress: patch.progress,
        current_step: patch.currentStep,
        logs: patch.logs as unknown as Json | undefined,
        result: patch.result as Json | undefined,
        error: patch.error,
        updated_at: now,
        finished_at: patch.finishedAt,
      })
      .eq("id", id);
  } catch {
    // Best-effort persistence; callers still keep their in-process snapshot.
  }
};

export const getJob = async <TResult extends Json | null = Json | null>(
  id: string,
): Promise<PersistentJobSnapshot<TResult> | null> => {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("backend_jobs").select("*").eq("id", id).maybeSingle();

    if (!error && data) {
      return mapRowToJob<TResult>(data as BackendJobRow);
    }
  } catch {
    // Fall back to memory below.
  }

  return (memoryJobs.get(id) as PersistentJobSnapshot<TResult> | undefined) ?? null;
};
