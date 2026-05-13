import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import {
  analyzeForecastDeal,
  analyzeForecastOpenDeals,
  getForecastOverview,
  type ForecastAnalyzeDealResult,
  type ForecastAnalyzeProgressEvent,
  type ForecastAnalyzeResult,
  type ForecastOverviewResult,
  type ForecastScope,
} from "../services/forecast.service.js";

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

const forecastAnalyzeJobs = new Map<string, ForecastAnalyzeJobSnapshot>();
const FORECAST_JOB_TTL_MS = 60 * 60 * 1000;

const cleanupForecastAnalyzeJobs = (): void => {
  const cutoff = Date.now() - FORECAST_JOB_TTL_MS;

  for (const [jobId, job] of forecastAnalyzeJobs.entries()) {
    if (new Date(job.updatedAt).getTime() < cutoff) {
      forecastAnalyzeJobs.delete(jobId);
    }
  }
};

const createForecastAnalyzeJob = (orgId: string): ForecastAnalyzeJobSnapshot => {
  cleanupForecastAnalyzeJobs();

  const now = new Date().toISOString();
  const job: ForecastAnalyzeJobSnapshot = {
    jobId: randomUUID(),
    orgId,
    status: "queued",
    progress: 0,
    currentStep: "Analyse forecast en attente",
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    logs: [
      {
        at: now,
        level: "info",
        message: "Job d'analyse des deals ouverts cree.",
      },
    ],
    result: null,
    error: null,
  };

  forecastAnalyzeJobs.set(job.jobId, job);

  return job;
};

const updateForecastAnalyzeJob = (jobId: string, event: ForecastAnalyzeProgressEvent): void => {
  const job = forecastAnalyzeJobs.get(jobId);

  if (!job || job.status === "completed" || job.status === "failed") {
    return;
  }

  const now = new Date().toISOString();
  job.status = "running";
  job.progress = Math.max(job.progress, Math.min(99, Math.round(event.progress)));
  job.currentStep = event.step;
  job.updatedAt = now;

  if (event.message) {
    job.logs = [
      ...job.logs,
      {
        at: now,
        level: event.level ?? "info",
        message: event.message,
      },
    ].slice(-80);
  }
};

const completeForecastAnalyzeJob = (jobId: string, result: ForecastAnalyzeResult): void => {
  const job = forecastAnalyzeJobs.get(jobId);

  if (!job) {
    return;
  }

  const now = new Date().toISOString();
  job.status = "completed";
  job.progress = 100;
  job.currentStep = "Analyse forecast terminee";
  job.updatedAt = now;
  job.finishedAt = now;
  job.result = result;
  job.logs = [
    ...job.logs,
    {
      at: now,
      level: "success" as const,
      message: `Analyse terminee: ${result.analyzedCount} traite(s), ${result.reusedCount} reutilise(s), ${result.failedCount} echec(s).`,
    },
  ].slice(-80);
};

const failForecastAnalyzeJob = (jobId: string, error: unknown): void => {
  const job = forecastAnalyzeJobs.get(jobId);

  if (!job) {
    return;
  }

  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : "Erreur inconnue pendant l'analyse forecast.";
  job.status = "failed";
  job.currentStep = "Analyse forecast en erreur";
  job.updatedAt = now;
  job.finishedAt = now;
  job.error = message;
  job.logs = [
    ...job.logs,
    {
      at: now,
      level: "error" as const,
      message,
    },
  ].slice(-80);
};

export const registerForecastRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Params: ForecastAnalyzeJobParams; Reply: ApiResponse<ForecastAnalyzeJobSnapshot> }>(
    "/api/forecast/analyze-open-deals/jobs/:jobId",
    async (request, reply) => {
      cleanupForecastAnalyzeJobs();

      const job = forecastAnalyzeJobs.get(request.params.jobId);

      if (!job) {
        return reply.code(404).send({
          success: false,
          error: "Job d'analyse forecast introuvable.",
        });
      }

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

      try {
        if (request.body.async === true) {
          const job = createForecastAnalyzeJob(orgId);

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
            onProgress: (event) => updateForecastAnalyzeJob(job.jobId, event),
          })
            .then((result) => completeForecastAnalyzeJob(job.jobId, result))
            .catch((error: unknown) => failForecastAnalyzeJob(job.jobId, error));

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
};
