import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import {
  analyzeCloseLostDeal,
  createCloseLostAnalysisRun,
  executeCloseLostAnalysisRun,
  getCloseLostAnalysisRun,
  getCloseLostDealDetail,
  getCloseLostOverview,
  type CloseLostAnalysisRun,
  type CloseLostDealDetailResult,
  type CloseLostOverviewResult,
  type CloseLostScope,
} from "../services/close-lost-analysis.service.js";

type CloseLostOverviewQuery = {
  orgId?: string;
  scope?: string;
  hubspotOwnerId?: string;
  salesAeOwnerIds?: string;
  dateFrom?: string;
  dateTo?: string;
  llmProvider?: string;
  llmModel?: string;
};

type CloseLostRunBody = {
  orgId?: string;
  scope?: string;
  hubspotOwnerId?: string | null;
  salesAeOwnerIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  llmProvider?: string | null;
  llmModel?: string | null;
  refresh?: boolean;
};

type CloseLostRunParams = {
  runId: string;
};

type CloseLostDealParams = {
  dealId: string;
};

type CloseLostDealQuery = {
  orgId?: string;
  llmProvider?: string;
  llmModel?: string;
};

type CloseLostDealAnalyzeBody = {
  orgId?: string;
  llmProvider?: string | null;
  llmModel?: string | null;
  refresh?: boolean;
};

const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidOrgId = (value: string | undefined): value is string =>
  typeof value === "string" && UUID_V4_LIKE_PATTERN.test(value.trim());

const parseScope = (value: string | undefined): CloseLostScope =>
  value === "owner" ? "owner" : "sales_ae";

const parseOwnerIds = (value: string | undefined): string[] =>
  typeof value === "string"
    ? Array.from(
        new Set(
          value
            .split(",")
            .map((ownerId) => ownerId.trim())
            .filter(Boolean),
        ),
      )
    : [];

const normalizeStringArray = (value: string[] | undefined): string[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.map((item) => item.trim()).filter(Boolean)))
    : [];

export const registerCloseLostAnalysisRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Querystring: CloseLostOverviewQuery; Reply: ApiResponse<CloseLostOverviewResult> }>(
    "/api/close-lost-analysis/overview",
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
        const result = await getCloseLostOverview({
          orgId,
          scope,
          hubspotOwnerId: request.query.hubspotOwnerId ?? null,
          salesAeOwnerIds: parseOwnerIds(request.query.salesAeOwnerIds),
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
        request.log.error({ error, orgId }, "Impossible de charger la vue close lost.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le chargement close lost.",
        });
      }
    },
  );

  app.post<{ Body: CloseLostRunBody; Reply: ApiResponse<CloseLostAnalysisRun> }>(
    "/api/close-lost-analysis/runs",
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

      if (!request.body.dateFrom || !request.body.dateTo) {
        return reply.code(400).send({
          success: false,
          error: "dateFrom et dateTo sont obligatoires pour lancer une analyse close lost.",
        });
      }

      try {
        const run = await createCloseLostAnalysisRun({
          orgId,
          scope,
          hubspotOwnerId: request.body.hubspotOwnerId ?? null,
          salesAeOwnerIds: normalizeStringArray(request.body.salesAeOwnerIds),
          dateFrom: request.body.dateFrom,
          dateTo: request.body.dateTo,
          llmProvider: request.body.llmProvider ?? null,
          llmModel: request.body.llmModel ?? null,
          refresh: request.body.refresh === true,
        });

        void executeCloseLostAnalysisRun(run.id).catch((error: unknown) => {
          request.log.error({ error, orgId, runId: run.id }, "Echec du run close lost.");
        });

        return reply.code(202).send({
          success: true,
          data: run,
        });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de lancer le run close lost.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le lancement close lost.",
        });
      }
    },
  );

  app.get<{ Params: CloseLostRunParams; Reply: ApiResponse<CloseLostAnalysisRun> }>(
    "/api/close-lost-analysis/runs/:runId",
    async (request, reply) => {
      try {
        const run = await getCloseLostAnalysisRun(request.params.runId);

        return reply.send({
          success: true,
          data: run,
        });
      } catch (error) {
        request.log.error({ error, runId: request.params.runId }, "Impossible de charger le run close lost.");

        return reply.code(404).send({
          success: false,
          error: error instanceof Error ? error.message : "Run close lost introuvable.",
        });
      }
    },
  );

  app.get<{ Params: CloseLostDealParams; Querystring: CloseLostDealQuery; Reply: ApiResponse<CloseLostDealDetailResult> }>(
    "/api/close-lost-analysis/deals/:dealId",
    async (request, reply) => {
      const orgId = request.query.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        const result = await getCloseLostDealDetail(
          orgId,
          request.params.dealId,
          request.query.llmProvider ?? null,
          request.query.llmModel ?? null,
        );

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        request.log.error({ error, orgId, dealId: request.params.dealId }, "Impossible de charger le detail close lost.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le chargement du deal close lost.",
        });
      }
    },
  );

  app.post<{ Params: CloseLostDealParams; Body: CloseLostDealAnalyzeBody; Reply: ApiResponse<CloseLostDealDetailResult> }>(
    "/api/close-lost-analysis/deals/:dealId/analyze",
    async (request, reply) => {
      const orgId = request.body.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        const result = await analyzeCloseLostDeal(
          orgId,
          request.params.dealId,
          request.body.llmProvider ?? null,
          request.body.llmModel ?? null,
          request.body.refresh === true,
        );

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        request.log.error({ error, orgId, dealId: request.params.dealId }, "Impossible d'analyser le deal close lost.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant l'analyse close lost.",
        });
      }
    },
  );
};
