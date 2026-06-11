import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import {
  hubSpotService,
  type HubSpotTaskListItem,
  type HubSpotTaskPriority,
} from "../../services/hubspot.service.js";
import { getHubSpotAccessToken } from "../../services/hubspot-auth.service.js";
import { getPublicErrorMessage, isValidOrgId } from "./helpers.js";

type HubSpotTasksQuery = {
  orgId?: string;
  hubspotOwnerId?: string;
  limit?: string;
  includeCompleted?: string;
};

type HubSpotCreateTaskBody = {
  orgId?: string;
  hubspotOwnerId?: string | null;
  title?: string;
  body?: string;
  dueAt?: string;
  priority?: string;
  associations?: Array<{
    objectType?: string;
    objectId?: string;
  }>;
};

type HubSpotTaskPriorityParams = {
  taskId: string;
};

type HubSpotTaskPriorityBody = {
  orgId?: string;
  priority?: string;
};

type HubSpotTasksPayload = {
  orgId: string;
  hubspotOwnerId: string;
  tasks: HubSpotTaskListItem[];
};

type HubSpotTasksCacheEntry = {
  expiresAt: number;
  staleUntil: number;
  payload: HubSpotTasksPayload;
};

const parseHubSpotTasksLimit = (value: string | undefined): number => {
  const parsedValue = Number(value ?? 500);

  if (!Number.isFinite(parsedValue)) {
    return 500;
  }

  return Math.max(1, Math.min(500, Math.trunc(parsedValue)));
};

const isHubSpotTaskPriority = (value: unknown): value is HubSpotTaskPriority =>
  value === "low" || value === "medium" || value === "high";

const parseOptionalHubSpotTaskPriority = (value: unknown): HubSpotTaskPriority | null | undefined => {
  if (value === null || value === "" || value === "none") {
    return null;
  }

  return isHubSpotTaskPriority(value) ? value : undefined;
};

const parseHubSpotTaskAssociations = (
  associations: HubSpotCreateTaskBody["associations"],
): Array<{ objectType: "contact" | "company" | "deal"; objectId: string }> => {
  if (!Array.isArray(associations)) {
    return [];
  }

  return associations
    .map((association) => {
      const objectType = association.objectType;
      const objectId = association.objectId?.trim();

      if (
        (objectType !== "contact" && objectType !== "company" && objectType !== "deal") ||
        !objectId
      ) {
        return null;
      }

      return {
        objectType,
        objectId,
      };
    })
    .filter((association): association is { objectType: "contact" | "company" | "deal"; objectId: string } =>
      Boolean(association),
    );
};

const HUBSPOT_TASKS_CACHE_TTL_MS = 30_000;
const HUBSPOT_TASKS_STALE_TTL_MS = 5 * 60 * 1000;
const hubspotTasksCache = new Map<string, HubSpotTasksCacheEntry>();
const hubspotTasksRefreshes = new Map<string, Promise<HubSpotTasksPayload>>();

const shouldIncludeCompletedTasks = (value: string | undefined): boolean => value === "true";

const getHubSpotTasksCacheKey = (
  orgId: string,
  hubspotOwnerId: string,
  limit: number,
  includeCompleted: boolean,
): string => `${orgId}:${hubspotOwnerId}:${limit}:${includeCompleted ? "with-completed" : "open-only"}`;

const refreshHubSpotTasksCache = async (
  cacheKey: string,
  orgId: string,
  hubspotOwnerId: string,
  limit: number,
  includeCompleted: boolean,
): Promise<HubSpotTasksPayload> => {
  const existingRefresh = hubspotTasksRefreshes.get(cacheKey);

  if (existingRefresh) {
    return existingRefresh;
  }

  const refresh = (async () => {
    const accessToken = await getHubSpotAccessToken(orgId);
    const tasks = await hubSpotService.fetchTasksByOwner(accessToken, hubspotOwnerId, limit, includeCompleted);
    const now = Date.now();
    const payload: HubSpotTasksPayload = {
      orgId,
      hubspotOwnerId,
      tasks,
    };

    hubspotTasksCache.set(cacheKey, {
      expiresAt: now + HUBSPOT_TASKS_CACHE_TTL_MS,
      staleUntil: now + HUBSPOT_TASKS_STALE_TTL_MS,
      payload,
    });

    return payload;
  })();

  hubspotTasksRefreshes.set(cacheKey, refresh);

  try {
    return await refresh;
  } finally {
    hubspotTasksRefreshes.delete(cacheKey);
  }
};

export const invalidateHubSpotTasksCache = (orgId: string): void => {
  for (const cacheKey of hubspotTasksCache.keys()) {
    if (cacheKey.startsWith(`${orgId}:`)) {
      hubspotTasksCache.delete(cacheKey);
    }
  }
};

export const registerHubSpotTasksRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Querystring: HubSpotTasksQuery; Reply: ApiResponse<HubSpotTasksPayload> }>(
    "/api/hubspot/tasks",
    async (request, reply) => {
      const orgId = request.query.orgId;
      const hubspotOwnerId = request.query.hubspotOwnerId;

      if (!orgId || !hubspotOwnerId) {
        return reply.code(400).send({
          success: false,
          error: "Les parametres orgId et hubspotOwnerId sont obligatoires pour charger les taches HubSpot.",
        });
      }

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        const limit = parseHubSpotTasksLimit(request.query.limit);
        const includeCompleted = shouldIncludeCompletedTasks(request.query.includeCompleted);
        const cacheKey = getHubSpotTasksCacheKey(orgId, hubspotOwnerId, limit, includeCompleted);
        const cachedTasks = hubspotTasksCache.get(cacheKey);

        if (cachedTasks && cachedTasks.expiresAt > Date.now()) {
          return reply.send({
            success: true,
            data: cachedTasks.payload,
          });
        }

        if (cachedTasks && cachedTasks.staleUntil > Date.now()) {
          void refreshHubSpotTasksCache(cacheKey, orgId, hubspotOwnerId, limit, includeCompleted).catch((refreshError) => {
            request.log.warn(
              { error: refreshError, orgId, hubspotOwnerId },
              "Refresh asynchrone du cache des taches HubSpot echoue.",
            );
          });

          return reply.send({
            success: true,
            data: cachedTasks.payload,
          });
        }

        const payload = await refreshHubSpotTasksCache(cacheKey, orgId, hubspotOwnerId, limit, includeCompleted);

        return reply.send({
          success: true,
          data: payload,
        });
      } catch (error) {
        request.log.error({ error, orgId, hubspotOwnerId }, "Impossible de charger les taches HubSpot.");

        return reply.code(500).send({
          success: false,
          error: getPublicErrorMessage(error, "Erreur inconnue pendant le chargement des taches HubSpot."),
        });
      }
    },
  );

  app.post<{ Body: HubSpotCreateTaskBody; Reply: ApiResponse<HubSpotTaskListItem> }>(
    "/api/hubspot/tasks",
    async (request, reply) => {
      const orgId = request.body.orgId;
      const title = request.body.title?.trim();
      const body = request.body.body?.trim() ?? "";
      const dueAt = request.body.dueAt?.trim();
      const priority = parseOptionalHubSpotTaskPriority(request.body.priority);

      if (!orgId || !title || !dueAt || priority === undefined) {
        return reply.code(400).send({
          success: false,
          error: "Les champs orgId, title et dueAt sont obligatoires pour creer une tache HubSpot.",
        });
      }

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        const accessToken = await getHubSpotAccessToken(orgId);
        const createdTask = await hubSpotService.createTask(accessToken, {
          title,
          body,
          dueAt,
          priority,
          ownerHubSpotId: request.body.hubspotOwnerId ?? null,
          associations: parseHubSpotTaskAssociations(request.body.associations),
        });
        const task = await hubSpotService.fetchTaskListItem(accessToken, createdTask.taskId);
        invalidateHubSpotTasksCache(orgId);

        return reply.send({
          success: true,
          data: task,
        });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de creer la tache HubSpot.");

        return reply.code(500).send({
          success: false,
          error: getPublicErrorMessage(error, "Erreur inconnue pendant la creation de la tache HubSpot."),
        });
      }
    },
  );

  app.post<{
    Params: HubSpotTaskPriorityParams;
    Body: HubSpotTaskPriorityBody;
    Reply: ApiResponse<HubSpotTaskListItem>;
  }>(
    "/api/hubspot/tasks/:taskId/priority",
    async (request, reply) => {
      const orgId = request.body.orgId;
      const priority = parseOptionalHubSpotTaskPriority(request.body.priority);

      if (!orgId || priority === undefined) {
        return reply.code(400).send({
          success: false,
          error: "Les champs orgId et priority sont obligatoires pour prioriser une tache HubSpot.",
        });
      }

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        const accessToken = await getHubSpotAccessToken(orgId);
        const task = await hubSpotService.updateTaskPriority(accessToken, request.params.taskId, priority);
        invalidateHubSpotTasksCache(orgId);

        return reply.send({
          success: true,
          data: task,
        });
      } catch (error) {
        request.log.error(
          { error, orgId, taskId: request.params.taskId },
          "Impossible de prioriser la tache HubSpot.",
        );

        return reply.code(500).send({
          success: false,
          error: getPublicErrorMessage(error, "Erreur inconnue pendant la priorisation de la tache HubSpot."),
        });
      }
    },
  );
};
