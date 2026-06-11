import { randomUUID } from "node:crypto";
import type { Json } from "../../db/database.types.js";
import type { DealAnalysisBundleResult } from "../deal-intelligence.service.js";
import { createJob, getJob, updateJob, type PersistentJobSnapshot } from "../job-store.js";
import type { DealAnalysisRunBody } from "../../routes/prospects.types.js";

type DealAnalysisJobLog = {
  at: string;
  level: "info" | "success" | "error";
  message: string;
};

type DealAnalysisJobStatus = "queued" | "running" | "completed" | "failed";

export type DealAnalysisJobSnapshot = {
  jobId: string;
  prospectId: string;
  orgId: string | null;
  hubspotDealId: string | null;
  status: DealAnalysisJobStatus;
  progress: number;
  currentStep: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  logs: DealAnalysisJobLog[];
  result: DealAnalysisBundleResult | null;
  error: string | null;
};

const DEAL_ANALYSIS_JOB_TYPE = "deal_analysis";
const DEAL_ANALYSIS_JOB_LOG_LIMIT = 40;

const toDealAnalysisJobSnapshot = (
  job: PersistentJobSnapshot<Json | null>,
): DealAnalysisJobSnapshot | null => {
  if (job.type !== DEAL_ANALYSIS_JOB_TYPE) {
    return null;
  }

  const result = job.result as DealAnalysisBundleResult | null;
  const snapshot = result?.page.snapshot ?? null;

  return {
    jobId: job.id,
    prospectId: snapshot?.prospectId ?? "",
    orgId: job.orgId ?? snapshot?.orgId ?? null,
    hubspotDealId: snapshot?.hubspotDealId ?? null,
    status: job.status === "skipped" ? "failed" : job.status,
    progress: job.progress,
    currentStep: job.currentStep,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    logs: job.logs as DealAnalysisJobLog[],
    result,
    error: job.error,
  };
};

export const loadDealAnalysisJob = async (jobId: string): Promise<DealAnalysisJobSnapshot | null> => {
  const job = await getJob(jobId);
  return job ? toDealAnalysisJobSnapshot(job) : null;
};

export const createDealAnalysisJob = async (
  prospectId: string,
  body: DealAnalysisRunBody,
): Promise<DealAnalysisJobSnapshot> => {
  const now = new Date().toISOString();
  const job = await createJob({
    id: randomUUID(),
    orgId: body.orgId ?? null,
    type: DEAL_ANALYSIS_JOB_TYPE,
    currentStep: "Analyse du deal en attente",
    logs: [
      {
        at: now,
        level: "info",
        message: "Job d'analyse complete du deal cree.",
      },
    ],
  });

  const snapshot = await loadDealAnalysisJob(job.id);

  if (!snapshot) {
    throw new Error("Job d'analyse deal invalide apres creation.");
  }

  return {
    ...snapshot,
    prospectId,
    hubspotDealId: body.hubspotDealId ?? null,
  };
};

export const markDealAnalysisJobRunning = async (jobId: string, step: string, progress: number): Promise<void> => {
  const job = await loadDealAnalysisJob(jobId);

  if (!job || job.status === "completed" || job.status === "failed") {
    return;
  }

  const now = new Date().toISOString();
  job.status = "running";
  job.progress = Math.max(job.progress, Math.min(99, Math.round(progress)));
  job.currentStep = step;
  job.logs = [
    ...job.logs,
    {
      at: now,
      level: "info" as const,
      message: step,
    },
  ].slice(-DEAL_ANALYSIS_JOB_LOG_LIMIT);

  await updateJob(jobId, {
    status: "running",
    progress: job.progress,
    currentStep: job.currentStep,
    logs: job.logs,
  });
};

export const completeDealAnalysisJob = async (jobId: string, result: DealAnalysisBundleResult): Promise<void> => {
  const job = await loadDealAnalysisJob(jobId);

  if (!job) {
    return;
  }

  const now = new Date().toISOString();
  job.status = "completed";
  job.progress = 100;
  job.currentStep = "Analyse complete du deal terminee";
  job.finishedAt = now;
  job.result = result;
  job.error = null;
  job.logs = [
    ...job.logs,
    {
      at: now,
      level: "success" as const,
      message: "Analyse complete du deal disponible.",
    },
  ].slice(-DEAL_ANALYSIS_JOB_LOG_LIMIT);

  await updateJob(jobId, {
    status: "completed",
    progress: 100,
    currentStep: job.currentStep,
    logs: job.logs,
    result: result as unknown as Json,
    error: null,
    finishedAt: now,
  });
};

export const failDealAnalysisJob = async (jobId: string, error: unknown): Promise<void> => {
  const job = await loadDealAnalysisJob(jobId);

  if (!job) {
    return;
  }

  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : "Erreur inconnue pendant l'analyse du deal.";
  job.status = "failed";
  job.currentStep = "Analyse du deal en erreur";
  job.finishedAt = now;
  job.error = message;
  job.logs = [
    ...job.logs,
    {
      at: now,
      level: "error" as const,
      message,
    },
  ].slice(-DEAL_ANALYSIS_JOB_LOG_LIMIT);

  await updateJob(jobId, {
    status: "failed",
    progress: job.progress,
    currentStep: job.currentStep,
    logs: job.logs,
    error: message,
    finishedAt: now,
  });
};

