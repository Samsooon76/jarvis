import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import { env } from "../../config/env.js";
import { getSupabaseAdmin } from "../../db/client.js";
import { hubSpotService } from "../../services/hubspot.service.js";
import { getHubSpotAccessToken } from "../../services/hubspot-auth.service.js";
import { getHubSpotSyncStatus } from "../../services/hubspot-sync-status.service.js";
import {
  HUBSPOT_STATUS_CACHE_TTL_MS,
  formatOperationError,
  getPublicErrorMessage,
  hubspotStatusCache,
  isValidOrgId,
  type HubSpotConnectionStatus,
} from "./helpers.js";

type HubSpotStatusQuery = {
  orgId?: string;
};

type HubSpotConfigStatus = {
  apiPublicUrl: string | null;
  appUrl: string;
  hubspotRedirectUri: string;
  hasHubSpotClientId: boolean;
  hasHubSpotClientSecret: boolean;
  hasHubSpotAppId: boolean;
};

export const registerHubSpotStatusRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Reply: ApiResponse<HubSpotConfigStatus> }>("/api/hubspot/config-status", async (_request, reply) =>
    reply.send({
      success: true,
      data: {
        apiPublicUrl: env.apiPublicUrl || null,
        appUrl: env.appUrl,
        hubspotRedirectUri: env.hubspotRedirectUri,
        hasHubSpotClientId: Boolean(env.hubspotClientId),
        hasHubSpotClientSecret: Boolean(env.hubspotClientSecret),
        hasHubSpotAppId: Boolean(env.hubspotAppId),
      },
    }),
  );

  app.get<{ Querystring: HubSpotStatusQuery; Reply: ApiResponse<HubSpotConnectionStatus> }>(
    "/api/hubspot/status",
    async (request, reply) => {
      const orgId = request.query.orgId;
      const cachedStatus = orgId ? hubspotStatusCache.get(orgId) : null;

      if (cachedStatus && cachedStatus.expiresAt > Date.now()) {
        return reply.send({
          success: true,
          data: cachedStatus.payload,
        });
      }

      if (!orgId) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId est obligatoire pour charger le statut HubSpot.",
        });
      }

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        const supabase = getSupabaseAdmin();
        const { data: organization, error: organizationError } = await supabase
          .from("organizations")
          .select("id, hubspot_portal_id")
          .eq("id", orgId)
          .maybeSingle();

        if (organizationError) {
          throw new Error(formatOperationError("Impossible de charger l'organisation", organizationError.message));
        }

        const organizationRow = organization as { id: string; hubspot_portal_id: string | null } | null;

        if (!organizationRow) {
          return reply.code(404).send({
            success: false,
            error: "Organisation inconnue.",
          });
        }

        const portalId = organizationRow.hubspot_portal_id ?? null;
        const [
          accessToken,
          { count: prospectCount, error: prospectsCountError },
          { data: dealRows, error: dealsError },
        ] = await Promise.all([
          getHubSpotAccessToken(orgId).catch((error: unknown) => {
            if (error instanceof Error && error.message === "Aucun token HubSpot trouve pour cette organisation.") {
              return null;
            }

            throw error;
          }),
          supabase
            .from("prospects")
            .select("*", { count: "exact", head: true })
            .eq("org_id", orgId)
            .contains("raw_data", { source: "hubspot" }),
          supabase
            .from("prospects")
            .select("hubspot_deal_id, synced_at")
            .eq("org_id", orgId)
            .contains("raw_data", { source: "hubspot" })
            .not("hubspot_deal_id", "is", null),
        ]);

        if (prospectsCountError) {
          throw new Error(formatOperationError("Impossible de compter les prospects", prospectsCountError.message));
        }

        if (dealsError) {
          throw new Error(formatOperationError("Impossible de charger les deals synchronises", dealsError.message));
        }

        const distinctDealIds = new Set(
          (dealRows ?? [])
            .map((row) => row.hubspot_deal_id)
            .filter((value): value is string => typeof value === "string" && value.length > 0),
        );

        let hubspotDealCount: number | null = null;

        if (accessToken) {
          try {
            hubspotDealCount = await hubSpotService.fetchDealCount(accessToken);
          } catch (hubspotCountError) {
            request.log.warn(
              { error: hubspotCountError, orgId },
              "Impossible de charger le nombre de deals live depuis HubSpot.",
            );
          }
        }

        const lastSyncedAt =
          (dealRows ?? []).reduce<string | null>((latestValue, row) => {
            if (!row.synced_at) {
              return latestValue;
            }

            if (!latestValue) {
              return row.synced_at;
            }

            return new Date(row.synced_at).getTime() > new Date(latestValue).getTime()
              ? row.synced_at
              : latestValue;
          }, null) ?? null;

        const payload: HubSpotConnectionStatus = {
          orgId,
          connected: Boolean(accessToken),
          hubspotPortalId: portalId,
          prospectCount: prospectCount ?? 0,
          syncedDealCount: distinctDealIds.size,
          hubspotDealCount,
          lastSyncedAt,
          syncStatus: await getHubSpotSyncStatus(orgId).catch(() => null),
        };

        hubspotStatusCache.set(orgId, {
          expiresAt: Date.now() + HUBSPOT_STATUS_CACHE_TTL_MS,
          payload,
        });

        return reply.send({
          success: true,
          data: payload,
        });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de charger le statut HubSpot.");

        return reply.code(500).send({
          success: false,
          error:
            getPublicErrorMessage(error, "Erreur inconnue pendant le chargement du statut HubSpot."),
        });
      }
    },
  );
};
