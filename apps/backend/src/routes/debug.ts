import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import { captureServerError, getSentryDsnProjectId, isSentryReady } from "../lib/sentry.js";
import { diagnoseHubSpotOwners, type HubSpotOwnerDiagnostic } from "../services/hubspot-owner-diagnostic.service.js";

type DebugHubSpotParams = {
  orgId: string;
};

type DebugSentryResult = {
  enabled: boolean;
  eventId: string | null;
  flushed: boolean;
  projectId: string | null;
};

export const registerDebugRoutes = async (app: FastifyInstance): Promise<void> => {
  app.post<{ Reply: ApiResponse<DebugSentryResult> }>("/api/debug/sentry", async (_request, reply) => {
    const result = await captureServerError(new Error("Jarvis backend Sentry smoke test"), {
      feature: "debug",
      operation: "sentry_backend_smoke_test",
      source: "fastify",
    });

    return reply.send({
      success: true,
      data: {
        enabled: isSentryReady(),
        eventId: result.eventId,
        flushed: result.flushed,
        projectId: getSentryDsnProjectId(),
      },
    });
  });

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
