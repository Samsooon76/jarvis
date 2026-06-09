import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import { getSalesActivityStats, type SalesActivityStats } from "../services/sales-activity-stats.service.js";
import {
  backfillClosedDealActivities,
  type SalesActivityBackfillResult,
} from "../services/hubspot-activity.service.js";

type SalesActivityStatsQuery = {
  orgId?: string;
  scope?: string;
  hubspotOwnerId?: string;
  dateFrom?: string;
  dateTo?: string;
};

type SalesActivityBackfillBody = {
  orgId?: string;
  dateFrom?: string;
  dateTo?: string;
};

const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidOrgId = (value: string | undefined): value is string =>
  typeof value === "string" && UUID_V4_LIKE_PATTERN.test(value.trim());

const parseScope = (value: string | undefined | null): "all" | "owner" => (value === "owner" ? "owner" : "all");

export const registerSalesActivityStatsRoutes = async (app: FastifyInstance): Promise<void> => {
  // Nombre d'activites commerciales (call/sms/meeting) sur les deals gagnes vs perdus.
  app.get<{ Querystring: SalesActivityStatsQuery; Reply: ApiResponse<SalesActivityStats> }>(
    "/api/activities/stats",
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
        const result = await getSalesActivityStats(orgId, {
          scope,
          hubspotOwnerId: request.query.hubspotOwnerId?.trim() || null,
          closedFrom: request.query.dateFrom ?? null,
          closedTo: request.query.dateTo ?? null,
        });

        return reply.send({ success: true, data: result });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de charger les statistiques d'activites.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le chargement des activites.",
        });
      }
    },
  );

  // Backfill des activites (call/sms/meeting) des deals clotures sur une periode.
  // Necessaire car le flux temps-reel ne relie pas les activites aux deals fermes.
  app.post<{ Body: SalesActivityBackfillBody; Reply: ApiResponse<SalesActivityBackfillResult> }>(
    "/api/activities/backfill",
    async (request, reply) => {
      const orgId = request.body.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        const result = await backfillClosedDealActivities(orgId, {
          closedFrom: request.body.dateFrom ?? null,
          closedTo: request.body.dateTo ?? null,
        });

        return reply.send({ success: true, data: result });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de backfiller les activites des deals.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le backfill des activites.",
        });
      }
    },
  );
};
