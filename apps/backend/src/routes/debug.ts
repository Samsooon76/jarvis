import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import { diagnoseHubSpotOwners, type HubSpotOwnerDiagnostic } from "../services/hubspot-owner-diagnostic.service.js";

type DebugHubSpotParams = {
  orgId: string;
};

export const registerDebugRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Params: DebugHubSpotParams; Reply: ApiResponse<HubSpotOwnerDiagnostic> }>(
    "/api/debug/hubspot/:orgId",
    async (request, reply) => {
      try {
        const diagnostic = await diagnoseHubSpotOwners(request.params.orgId);

        return reply.send({
          success: true,
          data: diagnostic,
        });
      } catch (error) {
        request.log.error({ error, orgId: request.params.orgId }, "Impossible de diagnostiquer HubSpot.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le diagnostic HubSpot.",
        });
      }
    },
  );
};
