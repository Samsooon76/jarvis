import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import type { Json } from "../db/database.types.js";
import {
  assertManagerOrAdmin,
  assertOrgAccess,
  assertOwnerScope,
} from "../services/app-auth.service.js";
import {
  analyzeForecastDeal,
  analyzeForecastOpenDeals,
  generateForecastSynthesis,
  getForecastOverview,
  type ForecastAnalyzeDealResult,
  type ForecastAnalyzeProgressEvent,
  type ForecastAnalyzeResult,
  type ForecastGenerateSynthesisResult,
  type ForecastOverviewResult,
  type ForecastScope,
} from "../services/forecast.service.js";
import { createJob, getJob, updateJob, type PersistentJobSnapshot } from "../services/job-store.js";

type ForecastOverviewQuery = {
  orgId?: string;
  scope?: string;
  hubspotOwnerId?: string;
  dateFrom?: string;
  dateTo?: string;
  llmProvider?: string;
  llmModel?: string;
};

type ForecastAnalyzeBody = {
  orgId?: string;
  scope?: string;
  hubspotOwnerId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  llmProvider?: string | null;
  llmModel?: string | null;
  refresh?: boolean;
  limit?: number | null;
  batchSize?: number | null;
  retryFailedCount?: number | null;
  async?: boolean;
};

type ForecastDealParams = {
  hubspotDealId: string;
};

type ForecastAnalyzeJobParams = {
  jobId: string;
};

type ForecastAnalyzeJobLog = {
  at: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
};

type ForecastAnalyzeJobStatus = "queued" | "running" | "completed" | "failed";

type ForecastAnalyzeJobSnapshot = {
  jobId: string;
  orgId: string;
  status: ForecastAnalyzeJobStatus;
  progress: number;
  currentStep: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  logs: ForecastAnalyzeJobLog[];
  result: ForecastAnalyzeResult | null;
  error: string | null;
};

const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidOrgId = (value: string | undefined): value is string =>
  typeof value === "string" && UUID_V4_LIKE_PATTERN.test(value.trim());

const parseScope = (value: string | undefined | null): ForecastScope => (value === "owner" ? "owner" : "all");

const FORECAST_ANALYZE_JOB_TYPE = "forecast_analyze";
const FORECAST_ANALYZE_JOB_LOG_LIMIT = 80;

const toForecastAnalyzeJobSnapshot = (
  job: PersistentJobSnapshot<Json | null>,
): ForecastAnalyzeJobSnapshot | null => {
  if (job.type !== FORECAST_ANALYZE_JOB_TYPE || !job.orgId) {
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
    logs: job.logs as ForecastAnalyzeJobLog[],
    result: job.result as ForecastAnalyzeResult | null,
    error: job.error,
  };
};

const loadForecastAnalyzeJob = async (jobId: string): Promise<ForecastAnalyzeJobSnapshot | null> => {
  const job = await getJob(jobId);
  return job ? toForecastAnalyzeJobSnapshot(job) : null;
};

const createForecastAnalyzeJob = async (orgId: string): Promise<ForecastAnalyzeJobSnapshot> => {
  const now = new Date().toISOString();
  const job = await createJob({
    id: randomUUID(),
    orgId,
    type: FORECAST_ANALYZE_JOB_TYPE,
    currentStep: "Analyse forecast en attente",
    logs: [
      {
        at: now,
        level: "info",
        message: "Job d'analyse des deals ouverts cree.",
      },
    ],
  });

  const snapshot = toForecastAnalyzeJobSnapshot(job);

  if (!snapshot) {
    throw new Error("Job d'analyse forecast invalide apres creation.");
  }

  return snapshot;
};

const updateForecastAnalyzeJob = async (jobId: string, event: ForecastAnalyzeProgressEvent): Promise<void> => {
  const job = await loadForecastAnalyzeJob(jobId);

  if (!job || job.status === "completed" || job.status === "failed") {
    return;
  }

  const now = new Date().toISOString();
  job.status = "running";
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
    ].slice(-FORECAST_ANALYZE_JOB_LOG_LIMIT);
  }

  await updateJob(jobId, {
    status: job.status,
    progress: job.progress,
    currentStep: job.currentStep,
    logs: job.logs,
  });
};

const completeForecastAnalyzeJob = async (jobId: string, result: ForecastAnalyzeResult): Promise<void> => {
  const job = await loadForecastAnalyzeJob(jobId);

  if (!job) {
    return;
  }

  const now = new Date().toISOString();
  job.status = "completed";
  job.progress = 100;
  job.currentStep = "Analyse forecast terminee";
  job.finishedAt = now;
  job.result = result;
  job.logs = [
    ...job.logs,
    {
      at: now,
      level: "success" as const,
      message: `Analyse terminee: ${result.analyzedCount} traite(s), ${result.reusedCount} reutilise(s), ${result.failedCount} echec(s).`,
    },
  ].slice(-FORECAST_ANALYZE_JOB_LOG_LIMIT);

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

const failForecastAnalyzeJob = async (jobId: string, error: unknown): Promise<void> => {
  const job = await loadForecastAnalyzeJob(jobId);

  if (!job) {
    return;
  }

  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : "Erreur inconnue pendant l'analyse forecast.";
  job.status = "failed";
  job.currentStep = "Analyse forecast en erreur";
  job.finishedAt = now;
  job.error = message;
  job.logs = [
    ...job.logs,
    {
      at: now,
      level: "error" as const,
      message,
    },
  ].slice(-FORECAST_ANALYZE_JOB_LOG_LIMIT);

  await updateJob(jobId, {
    status: "failed",
    progress: job.progress,
    currentStep: job.currentStep,
    logs: job.logs,
    error: message,
    finishedAt: now,
  });
};

export const registerForecastRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Params: ForecastAnalyzeJobParams; Reply: ApiResponse<ForecastAnalyzeJobSnapshot> }>(
    "/api/forecast/analyze-open-deals/jobs/:jobId",
    async (request, reply) => {
      const job = await loadForecastAnalyzeJob(request.params.jobId);

      if (!job) {
        return reply.code(404).send({
          success: false,
          error: "Job d'analyse forecast introuvable.",
        });
      }
      assertOrgAccess(request, job.orgId);

      return reply.send({
        success: true,
        data: job,
      });
    },
  );

  app.get<{ Querystring: ForecastOverviewQuery; Reply: ApiResponse<ForecastOverviewResult> }>(
    "/api/forecast/overview",
    async (request, reply) => {
      const orgId = request.query.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId doit etre un UUID Jarvis valide.",
        });
      }
      const scope = parseScope(request.query.scope);

      if (scope === "owner" && !request.query.hubspotOwnerId?.trim()) {
        return reply.code(400).send({
          success: false,
          error: "hubspotOwnerId est obligatoire pour le scope owner.",
        });
      }
      assertOrgAccess(request, orgId);
      if (scope === "all") {
        assertManagerOrAdmin(request);
      } else {
        assertOwnerScope(request, request.query.hubspotOwnerId ?? null);
      }

      try {
        const result = await getForecastOverview({
          orgId,
          scope,
          hubspotOwnerId: request.query.hubspotOwnerId ?? null,
          dateFrom: request.query.dateFrom ?? null,
          dateTo: request.query.dateTo ?? null,
          llmProvider: request.query.llmProvider ?? null,
          llmModel: request.query.llmModel ?? null,
        });

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de charger le forecast IA.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le chargement du forecast.",
        });
      }
    },
  );

  app.post<{ Body: ForecastAnalyzeBody; Reply: ApiResponse<ForecastAnalyzeResult | ForecastAnalyzeJobSnapshot> }>(
    "/api/forecast/analyze-open-deals",
    async (request, reply) => {
      const orgId = request.body.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId doit etre un UUID Jarvis valide.",
        });
      }

      const scope = parseScope(request.body.scope);

      if (scope === "owner" && !request.body.hubspotOwnerId?.trim()) {
        return reply.code(400).send({
          success: false,
          error: "hubspotOwnerId est obligatoire pour le scope owner.",
        });
      }
      assertOrgAccess(request, orgId);
      if (scope === "all") {
        assertManagerOrAdmin(request);
      } else {
        assertOwnerScope(request, request.body.hubspotOwnerId ?? null);
      }

      try {
        if (request.body.async === true) {
          const job = await createForecastAnalyzeJob(orgId);

          void analyzeForecastOpenDeals({
            orgId,
            scope,
            hubspotOwnerId: request.body.hubspotOwnerId ?? null,
            dateFrom: request.body.dateFrom ?? null,
            dateTo: request.body.dateTo ?? null,
            llmProvider: request.body.llmProvider ?? null,
            llmModel: request.body.llmModel ?? null,
            refresh: request.body.refresh === true,
            limit: request.body.limit ?? null,
            batchSize: request.body.batchSize ?? null,
            retryFailedCount: request.body.retryFailedCount ?? null,
            onProgress: (event) => {
              void updateForecastAnalyzeJob(job.jobId, event);
            },
          })
            .then((result) => {
              void completeForecastAnalyzeJob(job.jobId, result);
            })
            .catch((error: unknown) => {
              void failForecastAnalyzeJob(job.jobId, error);
            });

          return reply.send({
            success: true,
            data: job,
          });
        }

        const result = await analyzeForecastOpenDeals({
          orgId,
          scope,
          hubspotOwnerId: request.body.hubspotOwnerId ?? null,
          dateFrom: request.body.dateFrom ?? null,
          dateTo: request.body.dateTo ?? null,
          llmProvider: request.body.llmProvider ?? null,
          llmModel: request.body.llmModel ?? null,
          refresh: request.body.refresh === true,
          limit: request.body.limit ?? null,
          batchSize: request.body.batchSize ?? null,
          retryFailedCount: request.body.retryFailedCount ?? null,
        });

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de lancer l'analyse forecast IA.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant l'analyse forecast.",
        });
      }
    },
  );

  app.post<{ Params: ForecastDealParams; Body: ForecastAnalyzeBody; Reply: ApiResponse<ForecastAnalyzeDealResult> }>(
    "/api/forecast/deals/:hubspotDealId/analyze",
    async (request, reply) => {
      const orgId = request.body.orgId;
      const hubspotDealId = request.params.hubspotDealId.trim();

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId doit etre un UUID Jarvis valide.",
        });
      }

      if (!hubspotDealId) {
        return reply.code(400).send({
          success: false,
          error: "hubspotDealId est obligatoire.",
        });
      }

      const scope = parseScope(request.body.scope);

      if (scope === "owner" && !request.body.hubspotOwnerId?.trim()) {
        return reply.code(400).send({
          success: false,
          error: "hubspotOwnerId est obligatoire pour le scope owner.",
        });
      }
      assertOrgAccess(request, orgId);
      assertOwnerScope(request, scope === "owner" ? request.body.hubspotOwnerId ?? null : null);
      assertManagerOrAdmin(request);

      try {
        const result = await analyzeForecastDeal(hubspotDealId, {
          orgId,
          scope,
          hubspotOwnerId: request.body.hubspotOwnerId ?? null,
          dateFrom: request.body.dateFrom ?? null,
          dateTo: request.body.dateTo ?? null,
          llmProvider: request.body.llmProvider ?? null,
          llmModel: request.body.llmModel ?? null,
          refresh: request.body.refresh === true,
        });

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        request.log.error({ error, orgId, hubspotDealId }, "Impossible de relancer l'analyse IA du deal forecast.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant l'analyse du deal forecast.",
        });
      }
    },
  );

  app.post<{ Body: ForecastAnalyzeBody; Reply: ApiResponse<ForecastGenerateSynthesisResult> }>(
    "/api/forecast/synthesis",
    async (request, reply) => {
      const orgId = request.body.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId doit etre un UUID Jarvis valide.",
        });
      }

      const scope = parseScope(request.body.scope);

      if (scope === "owner" && !request.body.hubspotOwnerId?.trim()) {
        return reply.code(400).send({
          success: false,
          error: "hubspotOwnerId est obligatoire pour le scope owner.",
        });
      }
      assertOrgAccess(request, orgId);
      assertOwnerScope(request, scope === "owner" ? request.body.hubspotOwnerId ?? null : null);
      assertManagerOrAdmin(request);

      try {
        const result = await generateForecastSynthesis({
          orgId,
          scope,
          hubspotOwnerId: request.body.hubspotOwnerId ?? null,
          dateFrom: request.body.dateFrom ?? null,
          dateTo: request.body.dateTo ?? null,
          llmProvider: request.body.llmProvider ?? null,
          llmModel: request.body.llmModel ?? null,
        });

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de generer la synthese forecast IA.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant la synthese forecast.",
        });
      }
    },
  );
};
