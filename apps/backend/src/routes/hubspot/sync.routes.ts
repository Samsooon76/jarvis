import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import { assertManagerOrAdmin, assertOrgAccess } from "../../services/app-auth.service.js";
import {
  DEFAULT_TARGET_HUBSPOT_CONTACT_NAMES,
  completeHubSpotSyncJob,
  createHubSpotSyncJob,
  failHubSpotSyncJob,
  getPublicErrorMessage,
  isValidOrgId,
  loadHubSpotSyncJob,
  syncHubSpotProspects,
  updateHubSpotSyncJob,
  type SyncJobSnapshot,
  type SyncResult,
} from "./helpers.js";

type HubSpotSyncBody = {
  orgId?: string;
  contactNames?: string[];
  hubspotOwnerIds?: string[];
  async?: boolean;
};

type HubSpotSyncJobParams = {
  jobId: string;
};

export const registerHubSpotSyncRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Params: HubSpotSyncJobParams; Reply: ApiResponse<SyncJobSnapshot> }>(
    "/api/sync/hubspot/jobs/:jobId",
    async (request, reply) => {
      const job = await loadHubSpotSyncJob(request.params.jobId);

      if (!job) {
        return reply.code(404).send({
          success: false,
          error: "Job de sync HubSpot introuvable.",
        });
      }
      assertOrgAccess(request, job.orgId);

      return reply.send({
        success: true,
        data: job,
      });
    },
  );

  app.post<{ Body: HubSpotSyncBody; Reply: ApiResponse<SyncResult | SyncJobSnapshot> }>(
    "/api/sync/hubspot",
    async (request, reply) => {
      const orgId = request.body.orgId;

      if (!orgId) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId est obligatoire pour lancer une sync HubSpot.",
        });
      }

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        assertOrgAccess(request, orgId);
        assertManagerOrAdmin(request);
        const contactNames = Array.isArray(request.body.contactNames)
          ? request.body.contactNames.filter((contactName): contactName is string => typeof contactName === "string")
          : [];
        const hubspotOwnerIds = Array.isArray(request.body.hubspotOwnerIds)
          ? Array.from(
              new Set(
                request.body.hubspotOwnerIds
                  .filter((hubspotOwnerId): hubspotOwnerId is string => typeof hubspotOwnerId === "string")
                  .map((hubspotOwnerId) => hubspotOwnerId.trim())
                  .filter(Boolean),
              ),
            )
          : [];
        const includeFullSync = hubspotOwnerIds.length === 0 && !Array.isArray(request.body.contactNames);
        const targetContactNames =
          hubspotOwnerIds.length === 0 && !Array.isArray(request.body.contactNames)
            ? DEFAULT_TARGET_HUBSPOT_CONTACT_NAMES
            : contactNames;

        if (request.body.async) {
          const job = await createHubSpotSyncJob(orgId);

          void syncHubSpotProspects(orgId, targetContactNames, includeFullSync, hubspotOwnerIds, (event) => {
            void updateHubSpotSyncJob(job.jobId, event);
          })
            .then((syncResult) => {
              void completeHubSpotSyncJob(job.jobId, syncResult);
            })
            .catch((syncError: unknown) => {
              void failHubSpotSyncJob(job.jobId, syncError);
              request.log.error({ error: syncError, orgId, jobId: job.jobId }, "Echec du job de sync HubSpot.");
            });

          return reply.code(202).send({
            success: true,
            data: job,
          });
        }

        const syncResult = await syncHubSpotProspects(orgId, targetContactNames, includeFullSync, hubspotOwnerIds);

        return reply.send({
          success: true,
          data: syncResult,
        });
      } catch (error) {
        request.log.error({ error, orgId }, "Echec de la sync HubSpot.");

        return reply.code(500).send({
          success: false,
          error: getPublicErrorMessage(error, "Erreur inconnue pendant la sync HubSpot."),
        });
      }
    },
  );
};
