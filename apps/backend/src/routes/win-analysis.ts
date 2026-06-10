import type { FastifyInstance } from "fastify";
import type {
  ApiResponse,
  CloseWonDealAnalysis,
  WinAnalysisDealListItem,
  WinAnalysisOverview,
  WinAnalysisRun,
  WinBenchmark,
  WinBenchmarkComparison,
} from "@jarvis/shared";
import { assertManagerOrAdmin, assertOrgAccess } from "../services/app-auth.service.js";
import {
  compareDealToBenchmark,
  createWinAnalysisRun,
  executeWinAnalysisRun,
  getWinAnalysisDealDetail,
  getWinAnalysisOverview,
  getWinAnalysisRun,
  getWinBenchmarks,
} from "../services/win-analysis.service.js";

type WinAnalysisQuery = {
  orgId?: string;
  dateFrom?: string;
  dateTo?: string;
};

type WinAnalysisRunBody = {
  orgId?: string;
  dateFrom?: string;
  dateTo?: string;
};

type WinAnalysisRunParams = {
  runId: string;
};

type WinAnalysisDealParams = {
  dealId: string;
};

const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidOrgId = (value: string | undefined): value is string =>
  typeof value === "string" && UUID_V4_LIKE_PATTERN.test(value.trim());

export const registerWinAnalysisRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Querystring: WinAnalysisQuery; Reply: ApiResponse<WinAnalysisOverview> }>(
    "/api/win-analysis/overview",
    async (request, reply) => {
      const orgId = request.query.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({ success: false, error: "Le parametre orgId doit etre un UUID Jarvis valide." });
      }

      try {
        assertOrgAccess(request, orgId);
        assertManagerOrAdmin(request);
        const overview = await getWinAnalysisOverview({
          orgId,
          dateFrom: request.query.dateFrom ?? null,
          dateTo: request.query.dateTo ?? null,
        });

        return reply.send({ success: true, data: overview });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de charger la vue win analysis.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le chargement win analysis.",
        });
      }
    },
  );

  app.post<{ Body: WinAnalysisRunBody; Reply: ApiResponse<WinAnalysisRun> }>(
    "/api/win-analysis/run",
    async (request, reply) => {
      const orgId = request.body.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({ success: false, error: "Le champ orgId doit etre un UUID Jarvis valide." });
      }

      try {
        assertOrgAccess(request, orgId);
        assertManagerOrAdmin(request);
        const run = await createWinAnalysisRun({
          orgId,
          dateFrom: request.body.dateFrom ?? null,
          dateTo: request.body.dateTo ?? null,
        });

        void executeWinAnalysisRun(run.id).catch((error: unknown) => {
          request.log.error({ error, orgId, runId: run.id }, "Echec du run win analysis.");
        });

        return reply.code(202).send({ success: true, data: run });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de lancer le run win analysis.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le lancement win analysis.",
        });
      }
    },
  );

  app.get<{ Params: WinAnalysisRunParams; Reply: ApiResponse<WinAnalysisRun> }>(
    "/api/win-analysis/run/:runId",
    async (request, reply) => {
      try {
        const run = await getWinAnalysisRun(request.params.runId);
        assertOrgAccess(request, run.orgId);
        assertManagerOrAdmin(request);

        return reply.send({ success: true, data: run });
      } catch (error) {
        request.log.error({ error, runId: request.params.runId }, "Impossible de charger le run win analysis.");

        return reply.code(404).send({
          success: false,
          error: error instanceof Error ? error.message : "Run win analysis introuvable.",
        });
      }
    },
  );

  app.get<{
    Params: WinAnalysisDealParams;
    Querystring: WinAnalysisQuery;
    Reply: ApiResponse<{ deal: WinAnalysisDealListItem; analysis: CloseWonDealAnalysis | null; generatedAt: string | null }>;
  }>("/api/win-analysis/deal/:dealId", async (request, reply) => {
    const orgId = request.query.orgId;

    if (!isValidOrgId(orgId)) {
      return reply.code(400).send({ success: false, error: "Le parametre orgId doit etre un UUID Jarvis valide." });
    }

    try {
      assertOrgAccess(request, orgId);
      assertManagerOrAdmin(request);
      const detail = await getWinAnalysisDealDetail(orgId, request.params.dealId);

      return reply.send({ success: true, data: detail });
    } catch (error) {
      request.log.error({ error, orgId, dealId: request.params.dealId }, "Impossible de charger le deal win analysis.");

      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Erreur inconnue pendant le chargement du deal gagne.",
      });
    }
  });

  app.get<{ Querystring: WinAnalysisQuery; Reply: ApiResponse<WinBenchmark[]> }>(
    "/api/win-analysis/benchmark",
    async (request, reply) => {
      const orgId = request.query.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({ success: false, error: "Le parametre orgId doit etre un UUID Jarvis valide." });
      }

      try {
        // Benchmark accessible a tous les membres de l'org (0 LLM, donnees agregees).
        assertOrgAccess(request, orgId);
        const benchmarks = await getWinBenchmarks(orgId);

        return reply.send({ success: true, data: benchmarks });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de charger le benchmark wins.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le chargement du benchmark.",
        });
      }
    },
  );

  // Gaps vs deals gagnes: accessible au sales (c'est sa reco actionnable).
  app.get<{ Params: WinAnalysisDealParams; Querystring: WinAnalysisQuery; Reply: ApiResponse<WinBenchmarkComparison> }>(
    "/api/win-analysis/gaps/:dealId",
    async (request, reply) => {
      const orgId = request.query.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({ success: false, error: "Le parametre orgId doit etre un UUID Jarvis valide." });
      }

      try {
        assertOrgAccess(request, orgId);
        const comparison = await compareDealToBenchmark(orgId, request.params.dealId);

        return reply.send({ success: true, data: comparison });
      } catch (error) {
        request.log.error({ error, orgId, dealId: request.params.dealId }, "Impossible de comparer le deal au benchmark wins.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant la comparaison au benchmark.",
        });
      }
    },
  );
};
