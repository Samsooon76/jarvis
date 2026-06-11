import type { FastifyInstance } from "fastify";
import type { ApiResponse, QueueData } from "@jarvis/shared";
import { env } from "../config/env.js";
import { getSupabaseAdmin } from "../db/client.js";
import { loadHubSpotDashboard, type HubSpotQueueDashboardData } from "../services/hubspot-dashboard.service.js";
import {
  assertManagerOrAdmin,
  assertOrgAccess,
  loadOptionalAuthenticatedAppUserProfile,
  requireAuth,
} from "../services/app-auth.service.js";
import { getQueueDebug, getUserQueue, type QueueDebugData } from "../services/queue.service.js";
import { formatDurationMs, getNowMs } from "../lib/format.js";

type QueueParams = {
  userId: string;
};

type QueueDashboardQuery = {
  orgId?: string;
  hubspotOwnerId?: string;
  live?: string;
};

const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidOrgId = (value: string | undefined): value is string =>
  typeof value === "string" && UUID_V4_LIKE_PATTERN.test(value.trim());


const getStatusCode = (message: string): number => {
  if (message.includes("introuvable")) {
    return 404;
  }

  if (message.includes("aucune organisation") || message.includes("n'est rattache")) {
    return 400;
  }

  return 500;
};

const loadQueueUserOrgId = async (userId: string): Promise<string | null> => {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("org_id")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de verifier l'organisation du commercial: ${error.message}`);
  }

  return typeof data?.org_id === "string" ? data.org_id : null;
};

export const registerQueueRoutes = async (app: FastifyInstance): Promise<void> => {
  for (const dashboardRoute of ["/api/queue/dashboard", "/api/hubspot/queue-dashboard"]) {
    app.get<{ Querystring: QueueDashboardQuery; Reply: ApiResponse<HubSpotQueueDashboardData> }>(
      dashboardRoute,
      async (request, reply) => {
        const orgId = request.query.orgId;

        if (!orgId) {
          return reply.code(400).send({
            success: false,
            error: "Le parametre orgId est obligatoire pour charger la queue dashboard.",
          });
        }

        if (!isValidOrgId(orgId)) {
          return reply.code(400).send({
            success: false,
            error: "Le parametre orgId doit etre un UUID Jarvis valide.",
          });
        }

        try {
          const authenticatedProfile = await loadOptionalAuthenticatedAppUserProfile(request);
          let preferredHubSpotOwnerId = request.query.hubspotOwnerId ?? null;

          if (authenticatedProfile) {
            if (!authenticatedProfile.orgId || authenticatedProfile.orgId !== orgId) {
              return reply.code(403).send({
                success: false,
                error: "Cette session n'a pas acces a cette organisation.",
              });
            }

            if (authenticatedProfile.role === "sales") {
              if (!authenticatedProfile.hubspotOwnerId) {
                return reply.code(403).send({
                  success: false,
                  error: "Ce compte sales n'est rattache a aucun owner HubSpot.",
                });
              }

              if (preferredHubSpotOwnerId && preferredHubSpotOwnerId !== authenticatedProfile.hubspotOwnerId) {
                return reply.code(403).send({
                  success: false,
                  error: "Un commercial ne peut charger que ses propres deals HubSpot.",
                });
              }

              preferredHubSpotOwnerId = authenticatedProfile.hubspotOwnerId;
            }
          }

          const dashboard = await loadHubSpotDashboard({
            orgId,
            preferredHubSpotOwnerId,
            live: request.query.live !== "false",
          });

          if (!dashboard.status.connected) {
            return reply.code(409).send({
              success: false,
              error: "HubSpot n'est pas connecte pour cette organisation.",
            });
          }

          return reply.send({
            success: true,
            data: dashboard,
          });
        } catch (error) {
          request.log.error({ error, orgId }, "Impossible de charger la queue dashboard.");

          return reply.code(500).send({
            success: false,
            error: error instanceof Error ? error.message : "Erreur inconnue pendant le chargement de la queue dashboard.",
          });
        }
      },
    );
  }

  app.get<{ Params: QueueParams; Reply: ApiResponse<QueueData> }>(
    "/api/queue/:userId",
    async (request, reply) => {
      const requestStartedAtMs = getNowMs();
      const { userId } = request.params;

      try {
        const auth = requireAuth(request);
        if (auth.role === "sales" && auth.appUserId !== userId) {
          return reply.code(403).send({
            success: false,
            error: "Un commercial ne peut charger que sa propre queue.",
          });
        }

        const orgId = await loadQueueUserOrgId(userId);
        assertOrgAccess(request, orgId);
        const { payload, cacheHit } = await getUserQueue(userId);
        const totalDurationMs = formatDurationMs(requestStartedAtMs);

        reply.header("Server-Timing", `total;dur=${totalDurationMs}`);
        reply.header("X-Response-Time-Ms", String(totalDurationMs));
        request.log.info(
          {
            userId,
            durationMs: totalDurationMs,
            rowCount: payload.prospects.length,
            cacheHit,
          },
          "Queue chargee.",
        );

        return reply.send({
          success: true,
          data: payload,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erreur inconnue pendant le chargement de la queue.";
        request.log.error({ error, userId }, "Impossible de charger la morning queue reelle.");

        return reply.code(getStatusCode(message)).send({
          success: false,
          error: message,
        });
      }
    },
  );

  app.get<{ Params: QueueParams; Reply: ApiResponse<QueueDebugData> }>(
    "/api/debug/queue/:userId",
    async (request, reply) => {
      if (!env.enableDebugRoutes) {
        return reply.code(404).send({
          success: false,
          error: "Route debug indisponible.",
        });
      }

      try {
        const auth = requireAuth(request);
        if (auth.role === "sales" && auth.appUserId !== request.params.userId) {
          return reply.code(403).send({
            success: false,
            error: "Un commercial ne peut diagnostiquer que sa propre queue.",
          });
        }

        if (auth.role !== "sales") {
          assertManagerOrAdmin(request);
        }

        const orgId = await loadQueueUserOrgId(request.params.userId);
        assertOrgAccess(request, orgId);
        const debug = await getQueueDebug(request.params.userId);

        return reply.send({
          success: true,
          data: debug,
        });
      } catch (error) {
        request.log.error({ error, userId: request.params.userId }, "Impossible de diagnostiquer la queue.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le diagnostic queue.",
        });
      }
    },
  );
};
