import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import { hubSpotService, type HubSpotDealHistoryItem } from "../../services/hubspot.service.js";
import { loadLocalHubSpotDealHistory } from "../../services/hubspot-activity-history.service.js";
import { getHubSpotAccessToken } from "../../services/hubspot-auth.service.js";
import { getPublicErrorMessage, isValidOrgId } from "./helpers.js";

type HubSpotDealHistoryQuery = {
  orgId?: string;
};

type HubSpotDealHistoryPayload = {
  orgId: string;
  dealId: string;
  dealName: string | null;
  companyName: string | null;
  dealContext: string | null;
  companyContext: string | null;
  contactNames: string[];
  timeline: HubSpotDealHistoryItem[];
};

export const registerHubSpotDealsRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Params: { dealId: string }; Querystring: HubSpotDealHistoryQuery; Reply: ApiResponse<HubSpotDealHistoryPayload> }>(
    "/api/deals/:dealId/history",
    async (request, reply) => {
      const orgId = request.query.orgId;
      const dealId = request.params.dealId?.trim();

      if (!orgId || !dealId) {
        return reply.code(400).send({
          success: false,
          error: "Les parametres orgId et dealId sont obligatoires pour charger l'historique du deal.",
        });
      }

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        let history = await loadLocalHubSpotDealHistory(orgId, dealId);

        if (!history) {
          const accessToken = await getHubSpotAccessToken(orgId);
          history = await hubSpotService.fetchDealHistory(accessToken, dealId);
        }

        if (!history) {
          throw new Error("Historique HubSpot introuvable.");
        }

        return reply.send({
          success: true,
          data: {
            orgId,
            dealId,
            dealName: history.dealName,
            companyName: history.companyName,
            dealContext: history.dealContext,
            companyContext: history.companyContext,
            contactNames: history.contactNames,
            timeline: history.timeline,
          },
        });
      } catch (error) {
        request.log.error(
          {
            err: error instanceof Error ? error : undefined,
            errorMessage: error instanceof Error ? error.message : String(error),
            orgId,
            dealId,
          },
          "Impossible de charger l'historique du deal HubSpot.",
        );

        return reply.code(500).send({
          success: false,
          error: getPublicErrorMessage(error, "Erreur inconnue pendant le chargement de l'historique du deal."),
        });
      }
    },
  );
};
