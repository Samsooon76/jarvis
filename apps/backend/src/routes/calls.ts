import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import type { Json } from "../db/database.types.js";
import { getErrorMessage, getErrorStatusCode } from "../lib/errors.js";
import { requireAuth } from "../services/app-auth.service.js";
import { createJob, getJob, updateJob, type PersistentJobSnapshot } from "../services/job-store.js";
import {
  analyzeCall,
  createCallAnalysisRun,
  getCallAnalysisDetail,
  getCallInsights,
  listBackfillCallIds,
  listCallAnalyses,
  updateCallAnalysisRun,
  type CallAnalysisDetail,
  type CallAnalysisListItem,
  type CallInsightSummary,
} from "../services/call-intelligence/data-access.js";

const CALL_ANALYSIS_JOB_TYPE = "call_analysis_backfill";
const JOB_LOG_LIMIT = 80;

type CallIdParams = {
  id: string;
};

type CallsQuery = {
  orgId?: string;
  userId?: string;
  limit?: string;
  period?: string;
  type?: string;
};

const VALID_PERIODS = new Set(["7d", "30d", "90d", "all"]);
const VALID_DIRECTIONS = new Set(["inbound", "outbound", "all"]);

const parsePeriod = (value: string | undefined): "7d" | "30d" | "90d" | "all" | undefined =>
  value && VALID_PERIODS.has(value) ? (value as "7d" | "30d" | "90d" | "all") : undefined;

const parseDirection = (value: string | undefined): "inbound" | "outbound" | "all" | undefined =>
  value && VALID_DIRECTIONS.has(value) ? (value as "inbound" | "outbound" | "all") : undefined;

type AnalyzeCallBody = {
  refresh?: boolean;
};

type BackfillBody = {
  orgId?: string;
  limit?: number;
  refresh?: boolean;
};

type BackfillResult = {
  runId: string;
  processed: number;
  analyzed: number;
  skipped: number;
  failed: number;
};

type CallAnalysisJobSnapshot = PersistentJobSnapshot<BackfillResult & Json>;

const parseLimit = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(max, Math.trunc(parsed));
};

const runBackfillJob = async (input: {
  jobId: string;
  runId: string;
  orgId: string;
  auth: ReturnType<typeof requireAuth>;
  limit: number;
  refresh: boolean;
}): Promise<void> => {
  const appendLog = async (progress: number, currentStep: string, message?: string, level: "info" | "success" | "warning" | "error" = "info"): Promise<void> => {
    const job = await getJob(input.jobId);

    if (!job || job.status === "completed" || job.status === "failed") {
      return;
    }

    await updateJob(input.jobId, {
      status: "running",
      progress: Math.max(job.progress, Math.min(99, Math.round(progress))),
      currentStep,
      logs: message
        ? [...job.logs, { at: new Date().toISOString(), level, message }].slice(-JOB_LOG_LIMIT)
        : job.logs,
    });
  };

  let processed = 0;
  let analyzed = 0;
  let skipped = 0;
  let failed = 0;

  try {
    await updateCallAnalysisRun(input.runId, { status: "running" });
    await appendLog(1, "Chargement des calls", "Recherche des calls a analyser.");

    const callIds = await listBackfillCallIds(input.auth, input.orgId, input.limit);

    if (callIds.length === 0) {
      const finishedAt = new Date().toISOString();
      const result = { runId: input.runId, processed, analyzed, skipped, failed };

      await updateCallAnalysisRun(input.runId, { status: "completed", finished_at: finishedAt });
      await updateJob(input.jobId, {
        status: "completed",
        progress: 100,
        currentStep: "Aucun call a analyser",
        logs: [{ at: finishedAt, level: "success", message: "Aucun call eligible trouve." }],
        result: result as BackfillResult & Json,
        finishedAt,
      });
      return;
    }

    for (const callId of callIds) {
      processed += 1;

      try {
        await analyzeCall(callId, input.auth, { refresh: input.refresh });
        analyzed += 1;
      } catch (error) {
        const message = getErrorMessage(error, "Call ignore pendant le backfill.");

        if (getErrorStatusCode(error, 500) === 400) {
          skipped += 1;
        } else {
          failed += 1;
        }

        await appendLog(
          (processed / callIds.length) * 95,
          "Analyse des calls",
          `Call ${callId}: ${message}`,
          getErrorStatusCode(error, 500) === 400 ? "warning" : "error",
        );
      }

      await updateCallAnalysisRun(input.runId, {
        processed_count: processed,
        analyzed_count: analyzed,
        skipped_count: skipped,
        failed_count: failed,
      });
      await appendLog((processed / callIds.length) * 95, "Analyse des calls");
    }

    const finishedAt = new Date().toISOString();
    const result = { runId: input.runId, processed, analyzed, skipped, failed };

    await updateCallAnalysisRun(input.runId, {
      status: "completed",
      processed_count: processed,
      analyzed_count: analyzed,
      skipped_count: skipped,
      failed_count: failed,
      finished_at: finishedAt,
    });
    await updateJob(input.jobId, {
      status: "completed",
      progress: 100,
      currentStep: "Backfill calls termine",
      logs: [
        ...((await getJob(input.jobId))?.logs ?? []),
        {
          at: finishedAt,
          level: "success" as const,
          message: `Backfill termine: ${analyzed} analyse(s), ${skipped} ignore(s), ${failed} echec(s).`,
        },
      ].slice(-JOB_LOG_LIMIT),
      result: result as BackfillResult & Json,
      finishedAt,
    });
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const message = getErrorMessage(error, "Erreur inconnue pendant le backfill calls.");

    await updateCallAnalysisRun(input.runId, {
      status: "failed",
      processed_count: processed,
      analyzed_count: analyzed,
      skipped_count: skipped,
      failed_count: failed,
      error: message,
      finished_at: finishedAt,
    });
    await updateJob(input.jobId, {
      status: "failed",
      currentStep: "Backfill calls en erreur",
      logs: [
        ...((await getJob(input.jobId))?.logs ?? []),
        { at: finishedAt, level: "error" as const, message },
      ].slice(-JOB_LOG_LIMIT),
      error: message,
      finishedAt,
    });
  }
};

export const registerCallRoutes = async (app: FastifyInstance): Promise<void> => {
  const startBackfill = async (
    request: FastifyRequest<{ Body: BackfillBody; Reply: ApiResponse<CallAnalysisJobSnapshot> }>,
    reply: FastifyReply,
  ) => {
    try {
      const auth = requireAuth(request);
      const orgId = request.body?.orgId ?? auth.orgId;

      if (!orgId) {
        return reply.code(400).send({ success: false, error: "orgId est obligatoire pour lancer le backfill calls." });
      }

      const limit = Math.min(Math.max(request.body?.limit ?? 100, 1), 500);
      const refresh = request.body?.refresh === true;
      const run = await createCallAnalysisRun({
        orgId,
        requestedByUserId: auth.appUserId,
        scope: { limit, refresh, ownerScoped: auth.role === "sales" } as Json,
      });
      const job = await createJob<BackfillResult & Json>({
        id: randomUUID(),
        orgId,
        type: CALL_ANALYSIS_JOB_TYPE,
        currentStep: "Backfill calls en attente",
        logs: [{ at: new Date().toISOString(), level: "info", message: "Backfill d'analyse calls cree." }],
      });

      void runBackfillJob({ jobId: job.id, runId: run.id, orgId, auth, limit, refresh });

      return reply.code(202).send({ success: true, data: job as CallAnalysisJobSnapshot });
    } catch (error) {
      request.log.error({ error }, "Impossible de lancer le backfill calls.");

      return reply.code(getErrorStatusCode(error)).send({
        success: false,
        error: getErrorMessage(error, "Impossible de lancer le backfill calls."),
      });
    }
  };

  app.get<{ Querystring: CallsQuery; Reply: ApiResponse<CallAnalysisListItem[]> }>(
    "/api/calls",
    async (request, reply) => {
      try {
        const auth = requireAuth(request);
        const calls = await listCallAnalyses(auth, {
          orgId: request.query.orgId,
          userId: request.query.userId,
          limit: parseLimit(request.query.limit, 50, 200),
          period: parsePeriod(request.query.period),
          direction: parseDirection(request.query.type),
        });

        return reply.send({ success: true, data: calls });
      } catch (error) {
        request.log.error({ error }, "Impossible de lister les calls.");

        return reply.code(getErrorStatusCode(error)).send({
          success: false,
          error: getErrorMessage(error, "Impossible de lister les calls."),
        });
      }
    },
  );

  app.get<{ Querystring: Pick<CallsQuery, "orgId" | "period" | "userId">; Reply: ApiResponse<CallInsightSummary> }>(
    "/api/calls/insights",
    async (request, reply) => {
      try {
        const auth = requireAuth(request);
        const insights = await getCallInsights(
          auth,
          request.query.orgId,
          parsePeriod(request.query.period),
          request.query.userId ?? null,
        );

        return reply.send({ success: true, data: insights });
      } catch (error) {
        request.log.error({ error }, "Impossible de charger les insights calls.");

        return reply.code(getErrorStatusCode(error)).send({
          success: false,
          error: getErrorMessage(error, "Impossible de charger les insights calls."),
        });
      }
    },
  );

  app.get<{ Params: CallIdParams; Reply: ApiResponse<CallAnalysisDetail> }>(
    "/api/calls/:id",
    async (request, reply) => {
      try {
        const auth = requireAuth(request);
        const detail = await getCallAnalysisDetail(request.params.id, auth);

        return reply.send({ success: true, data: detail });
      } catch (error) {
        request.log.error({ error, callId: request.params.id }, "Impossible de charger le call.");

        return reply.code(getErrorStatusCode(error)).send({
          success: false,
          error: getErrorMessage(error, "Impossible de charger le call."),
        });
      }
    },
  );

  app.post<{ Params: CallIdParams; Body: AnalyzeCallBody; Reply: ApiResponse<CallAnalysisDetail> }>(
    "/api/calls/:id/analyze",
    async (request, reply) => {
      try {
        const auth = requireAuth(request);
        const detail = await analyzeCall(request.params.id, auth, { refresh: request.body?.refresh === true });

        return reply.send({ success: true, data: detail });
      } catch (error) {
        request.log.error({ error, callId: request.params.id }, "Impossible d'analyser le call.");

        return reply.code(getErrorStatusCode(error)).send({
          success: false,
          error: getErrorMessage(error, "Impossible d'analyser le call."),
        });
      }
    },
  );

  app.post<{ Body: BackfillBody; Reply: ApiResponse<CallAnalysisJobSnapshot> }>(
    "/api/calls/backfill/run",
    startBackfill,
  );

  app.post<{ Body: BackfillBody; Reply: ApiResponse<CallAnalysisJobSnapshot> }>("/api/calls/analyze/run", startBackfill);

  app.get<{ Params: { jobId: string }; Reply: ApiResponse<CallAnalysisJobSnapshot> }>(
    "/api/calls/backfill/jobs/:jobId",
    async (request, reply) => {
      try {
        const auth = requireAuth(request);
        const job = await getJob<BackfillResult & Json>(request.params.jobId);

        if (!job || job.type !== CALL_ANALYSIS_JOB_TYPE) {
          return reply.code(404).send({ success: false, error: "Job de backfill calls introuvable." });
        }

        if (auth.orgId && job.orgId && auth.orgId !== job.orgId) {
          return reply.code(403).send({ success: false, error: "Cette session n'a pas acces a ce job." });
        }

        return reply.send({ success: true, data: job as CallAnalysisJobSnapshot });
      } catch (error) {
        request.log.error({ error, jobId: request.params.jobId }, "Impossible de charger le job calls.");

        return reply.code(getErrorStatusCode(error)).send({
          success: false,
          error: getErrorMessage(error, "Impossible de charger le job calls."),
        });
      }
    },
  );
};
