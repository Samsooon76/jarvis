import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { getSupabaseAdmin } from "../../db/client.js";
import { hubSpotService } from "../../services/hubspot.service.js";
import { upsertHubSpotIntegration } from "../../services/hubspot-auth.service.js";
import {
  DEFAULT_TARGET_HUBSPOT_CONTACT_NAMES,
  completeHubSpotSyncJob,
  createHubSpotSyncJob,
  failHubSpotSyncJob,
  formatOperationError,
  getPublicErrorMessage,
  invalidateHubSpotStatusCache,
  isValidOrgId,
  syncHubSpotProspects,
  updateHubSpotSyncJob,
} from "./helpers.js";

type HubSpotStartQuery = {
  orgId?: string;
  returnTo?: string;
};

type HubSpotCallbackQuery = {
  code?: string;
  state?: string;
};

type OrganizationRow = {
  id: string;
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const buildOAuthPopupHtml = (targetUrl: string, status: "connected" | "error", message: string): string => `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>Jarvis OAuth</title>
  </head>
  <body style="font-family: ui-sans-serif, system-ui; padding: 24px;">
    <p>${escapeHtml(message)}</p>
    <p>Si cette fenetre reste ouverte, <a id="fallback-link" href="${escapeHtml(targetUrl)}">revenir a Jarvis</a>.</p>
    <script>
      const targetUrl = ${JSON.stringify(targetUrl)};
      const status = ${JSON.stringify(status)};
      const targetOrigin = new URL(targetUrl).origin;
      const fallbackLink = document.getElementById("fallback-link");
      fallbackLink.href = targetUrl;

      if (window.opener && !window.opener.closed) {
        try {
          window.opener.postMessage({ type: "jarvis:hubspot-" + status, targetUrl }, targetOrigin);

          if (status === "connected") {
            window.opener.location.href = targetUrl;
          }
        } catch (error) {
          window.location.href = targetUrl;
        }
      }

      if (status === "connected") {
        window.setTimeout(() => {
          window.close();
        }, 250);

        window.setTimeout(() => {
          window.location.href = targetUrl;
        }, 1200);
      }
    </script>
  </body>
</html>`;

export const registerHubSpotOAuthRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Querystring: HubSpotStartQuery }>(
    "/api/auth/hubspot/start",
    async (request, reply) => {
      const orgId = request.query.orgId;

      if (!orgId) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId est obligatoire pour connecter HubSpot.",
        });
      }

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        const authorizationUrl = hubSpotService.buildAuthorizationUrl({
          orgId,
          returnTo: request.query.returnTo ?? `${env.appUrl}/settings?hubspot=connected`,
        });

        request.log.info(
          {
            orgId,
            apiPublicUrl: env.apiPublicUrl || null,
            hubspotRedirectUri: env.hubspotRedirectUri,
          },
          "Demarrage OAuth HubSpot.",
        );

        return reply.redirect(authorizationUrl);
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de construire l'URL OAuth HubSpot.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur de configuration HubSpot.",
        });
      }
    },
  );

  app.get<{ Querystring: HubSpotCallbackQuery }>(
    "/api/auth/hubspot/callback",
    async (request, reply) => {
      const { code, state } = request.query;
      let fallbackTarget = env.appUrl;
      const appendErrorQuery = (targetUrl: string, errorMessage: string): string => {
        const separator = targetUrl.includes("?") ? "&" : "?";

        return `${targetUrl}${separator}hubspot=error&reason=${encodeURIComponent(errorMessage)}`;
      };

      if (!code || !state) {
        return reply.code(400).send({
          success: false,
          error: "HubSpot n'a pas fourni les parametres code/state attendus.",
        });
      }

      try {
        const decodedState = hubSpotService.decodeState(state);
        const orgId = decodedState.orgId;
        const returnTo = decodedState.returnTo ?? env.appUrl;
        fallbackTarget = appendErrorQuery(returnTo, "HubSpot callback invalide.");

        if (!orgId) {
          return reply.code(400).send({
            success: false,
            error: "Etat OAuth invalide: orgId manquant.",
          });
        }

        if (!isValidOrgId(orgId)) {
          return reply.code(400).send({
            success: false,
            error: "Etat OAuth invalide: orgId Jarvis incorrect.",
          });
        }

        const supabase = getSupabaseAdmin();
        const { data: organization, error: organizationError } = await supabase
          .from("organizations")
          .select("id")
          .eq("id", orgId)
          .maybeSingle();

        if (organizationError) {
          throw new Error(formatOperationError("Impossible de charger l'organisation", organizationError.message));
        }

        if (!(organization as OrganizationRow | null)) {
          return reply.code(404).send({
            success: false,
            error: "Organisation inconnue pour cette connexion HubSpot.",
          });
        }

        const tokenResponse = await hubSpotService.exchangeCodeForToken(code);

        await upsertHubSpotIntegration(orgId, {
          accessToken: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token,
          expiresIn: tokenResponse.expires_in,
        });
        invalidateHubSpotStatusCache(orgId);

        if (tokenResponse.hub_id) {
          const { error: updateOrgError } = await supabase
            .from("organizations")
            .update({
              hubspot_portal_id: String(tokenResponse.hub_id),
            })
            .eq("id", orgId);

          if (updateOrgError) {
            throw new Error(
              formatOperationError("Impossible d'enregistrer le portal HubSpot", updateOrgError.message),
            );
          }

          invalidateHubSpotStatusCache(orgId);
        }

        const initialSyncJob = await createHubSpotSyncJob(orgId);

        void syncHubSpotProspects(orgId, DEFAULT_TARGET_HUBSPOT_CONTACT_NAMES, true, [], (event) => {
          void updateHubSpotSyncJob(initialSyncJob.jobId, event);
        })
          .then((syncResult) => {
            void completeHubSpotSyncJob(initialSyncJob.jobId, syncResult);
            request.log.info(
              { orgId, jobId: initialSyncJob.jobId, syncedCount: syncResult.syncedCount },
              "Connexion HubSpot terminee, sync initiale terminee en arriere-plan.",
            );
          })
          .catch((syncError: unknown) => {
            void failHubSpotSyncJob(initialSyncJob.jobId, syncError);
            request.log.error(
              { error: syncError, orgId, jobId: initialSyncJob.jobId },
              "Connexion HubSpot terminee, mais la sync initiale en arriere-plan a echoue.",
            );
          });

        const connectedTarget = new URL(returnTo);
        connectedTarget.searchParams.set("hubspot", "connected");
        connectedTarget.searchParams.set("sync", "started");
        connectedTarget.searchParams.set("syncJobId", initialSyncJob.jobId);

        return reply
          .type("text/html; charset=utf-8")
          .send(
            buildOAuthPopupHtml(
              connectedTarget.toString(),
              "connected",
              "Connexion HubSpot finalisee. Retour vers Jarvis...",
            ),
          );
      } catch (error) {
        request.log.error({ error }, "Echec du callback OAuth HubSpot.");
        const errorMessage =
          getPublicErrorMessage(error, "Erreur inconnue pendant le callback OAuth HubSpot.");

        return reply
          .type("text/html; charset=utf-8")
          .send(
            buildOAuthPopupHtml(
              appendErrorQuery(fallbackTarget.replace(/[?&]reason=[^&]*/g, ""), errorMessage),
              "error",
              `Connexion HubSpot echouee: ${errorMessage}`,
            ),
          );
      }
    },
  );
};
