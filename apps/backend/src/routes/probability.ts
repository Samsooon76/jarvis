import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import { assertManagerOrAdmin, assertOrgAccess, assertOwnerScope } from "../services/app-auth.service.js";
import {
  backfillOrgProbabilityHistory,
  getDealAgeProbabilityTimeline,
  getDealProbabilityTimeline,
  type DealAgeProbabilityTimeline,
  type DealProbabilityTimeline,
} from "../services/deal-probability.service.js";

type ProbabilityTimelineQuery = {
  orgId?: string;
  scope?: string;
  hubspotOwnerId?: string;
  dateFrom?: string;
  dateTo?: string;
};

type ProbabilityBackfillBody = {
  orgId?: string;
};

type DealProbabilityParams = {
  hubspotDealId: string;
};

type DealProbabilityQuery = {
  orgId?: string;
};

const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidOrgId = (value: string | undefined): value is string =>
  typeof value === "string" && UUID_V4_LIKE_PATTERN.test(value.trim());

const parseScope = (value: string | undefined | null): "all" | "owner" => (value === "owner" ? "owner" : "all");

export const registerProbabilityRoutes = async (app: FastifyInstance): Promise<void> => {
  // Courbe agregee par age du deal (gagnes vs perdus) pour la section Statistiques.
  app.get<{ Querystring: ProbabilityTimelineQuery; Reply: ApiResponse<DealAgeProbabilityTimeline> }>(
    "/api/probability/timeline",
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
        assertOrgAccess(request, orgId);
        if (scope === "all") {
          assertManagerOrAdmin(request);
        } else {
          assertOwnerScope(request, request.query.hubspotOwnerId ?? null);
        }
        const result = await getDealAgeProbabilityTimeline(orgId, {
          scope,
          hubspotOwnerId: request.query.hubspotOwnerId?.trim() || null,
          closedFrom: request.query.dateFrom ?? null,
          closedTo: request.query.dateTo ?? null,
        });

        return reply.send({ success: true, data: result });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de charger la timeline de probabilite.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le chargement de la timeline.",
        });
      }
    },
  );

  // Courbe d'un deal precis, pour la vue Analyse de deal.
  app.get<{ Params: DealProbabilityParams; Querystring: DealProbabilityQuery; Reply: ApiResponse<DealProbabilityTimeline> }>(
    "/api/probability/deals/:hubspotDealId",
    async (request, reply) => {
      const orgId = request.query.orgId;
      const hubspotDealId = request.params.hubspotDealId.trim();

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId doit etre un UUID Jarvis valide.",
        });
      }

      if (!hubspotDealId) {
        return reply.code(400).send({
          success: false,
          error: "hubspotDealId est obligatoire.",
        });
      }

      try {
        assertOrgAccess(request, orgId);
        const result = await getDealProbabilityTimeline(orgId, hubspotDealId);

        return reply.send({ success: true, data: result });
      } catch (error) {
        request.log.error({ error, orgId, hubspotDealId }, "Impossible de charger la timeline du deal.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le chargement de la timeline du deal.",
        });
      }
    },
  );

  // Backfill de l'historique complet depuis HubSpot.
  app.post<{ Body: ProbabilityBackfillBody; Reply: ApiResponse<{ dealsProcessed: number; pointsInserted: number }> }>(
    "/api/probability/backfill",
    async (request, reply) => {
      const orgId = request.body.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        assertOrgAccess(request, orgId);
        assertManagerOrAdmin(request);
        const result = await backfillOrgProbabilityHistory(orgId);

        return reply.send({ success: true, data: result });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de backfiller l'historique de probabilite.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le backfill.",
        });
      }
    },
  );
};
