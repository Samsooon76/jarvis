import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import {
  assertOrgAccess,
  requireAuth,
} from "../services/app-auth.service.js";
import {
  completeSalesTask,
  getTodaySalesTasks,
  skipSalesTask,
  snoozeSalesTask,
  type SalesTaskActionResult,
  type SalesTasksTodayPayload,
} from "../services/task-planning.service.js";
import {
  analyzeAndApplyHubSpotTask,
  analyzeHubSpotTask,
  applyHubSpotTaskAnalysis,
  type TaskAnalyzerApplyResult,
  type TaskAnalyzerResult,
} from "../services/task-analyzer.service.js";
import { invalidateHubSpotTasksCache } from "./hubspot.js";

type TaskAnalyzeParams = {
  taskId: string;
};

type TodayTasksParams = {
  userId: string;
};

type SalesTaskParams = {
  id: string;
};

type TaskAnalyzeBody = {
  orgId?: string;
  llmProvider?: string | null;
  llmModel?: string | null;
  refresh?: boolean;
  includeHistory?: boolean;
};

type SalesTaskActionBody = {
  reason?: string | null;
};

type SalesTaskSnoozeBody = SalesTaskActionBody & {
  snoozedUntil?: string | null;
};

export const registerTaskRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Params: TodayTasksParams; Reply: ApiResponse<SalesTasksTodayPayload> }>(
    "/api/tasks/today/:userId",
    async (request, reply) => {
      try {
        const auth = requireAuth(request);
        if (auth.role === "sales" && auth.appUserId !== request.params.userId) {
          return reply.code(403).send({
            success: false,
            error: "Un commercial ne peut charger que ses propres taches.",
          });
        }
        const payload = await getTodaySalesTasks(request.params.userId);

        return reply.send({
          success: true,
          data: payload,
        });
      } catch (error) {
        request.log.error({ error, userId: request.params.userId }, "Impossible de charger les taches du jour.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le chargement des taches du jour.",
        });
      }
    },
  );

  app.post<{ Params: SalesTaskParams; Body: SalesTaskActionBody; Reply: ApiResponse<SalesTaskActionResult> }>(
    "/api/tasks/:id/complete",
    async (request, reply) => {
      try {
        const auth = requireAuth(request);
        const result = await completeSalesTask(request.params.id, auth);

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        request.log.error({ error, taskId: request.params.id }, "Impossible de terminer la tache Jarvis.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant la completion de la tache.",
        });
      }
    },
  );

  app.post<{ Params: SalesTaskParams; Body: SalesTaskSnoozeBody; Reply: ApiResponse<SalesTaskActionResult> }>(
    "/api/tasks/:id/snooze",
    async (request, reply) => {
      const snoozedUntil = request.body?.snoozedUntil;

      if (!snoozedUntil) {
        return reply.code(400).send({
          success: false,
          error: "Le champ snoozedUntil est obligatoire.",
        });
      }

      try {
        const auth = requireAuth(request);
        const result = await snoozeSalesTask(request.params.id, snoozedUntil, auth, request.body?.reason ?? null);

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        request.log.error({ error, taskId: request.params.id }, "Impossible de snoozer la tache Jarvis.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le snooze de la tache.",
        });
      }
    },
  );

  app.post<{ Params: SalesTaskParams; Body: SalesTaskActionBody; Reply: ApiResponse<SalesTaskActionResult> }>(
    "/api/tasks/:id/skip",
    async (request, reply) => {
      try {
        const auth = requireAuth(request);
        const result = await skipSalesTask(request.params.id, auth, request.body?.reason ?? null);

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        request.log.error({ error, taskId: request.params.id }, "Impossible d'ignorer la tache Jarvis.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le skip de la tache.",
        });
      }
    },
  );

  app.post<{ Params: TaskAnalyzeParams; Body: TaskAnalyzeBody; Reply: ApiResponse<TaskAnalyzerResult> }>(
    "/api/tasks/:taskId/analyze",
    async (request, reply) => {
      const orgId = request.body.orgId?.trim();

      if (!orgId) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId est obligatoire pour analyser une tache.",
        });
      }

      try {
        assertOrgAccess(request, orgId);
        const result = await analyzeHubSpotTask({
          orgId,
          hubspotTaskId: request.params.taskId,
          llmProvider: request.body.llmProvider ?? null,
          llmModel: request.body.llmModel ?? null,
          refresh: request.body.refresh === true,
          includeHistory: request.body.includeHistory === true,
        });

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        request.log.error(
          {
            error,
            orgId,
            taskId: request.params.taskId,
          },
          "Impossible d'analyser la tache HubSpot.",
        );

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant l'analyse de la tache.",
        });
      }
    },
  );

  app.post<{ Params: TaskAnalyzeParams; Body: TaskAnalyzeBody; Reply: ApiResponse<TaskAnalyzerApplyResult> }>(
    "/api/tasks/:taskId/analyze-and-apply",
    async (request, reply) => {
      const orgId = request.body.orgId?.trim();

      if (!orgId) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId est obligatoire pour analyser une tache.",
        });
      }

      try {
        assertOrgAccess(request, orgId);
        const result = await analyzeAndApplyHubSpotTask({
          orgId,
          hubspotTaskId: request.params.taskId,
          llmProvider: request.body.llmProvider ?? null,
          llmModel: request.body.llmModel ?? null,
          refresh: request.body.refresh === true,
          includeHistory: request.body.includeHistory === true,
        });
        invalidateHubSpotTasksCache(orgId);

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        request.log.error(
          {
            error,
            orgId,
            taskId: request.params.taskId,
          },
          "Impossible d'analyser et appliquer la tache HubSpot.",
        );

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant l'analyse de la tache.",
        });
      }
    },
  );

  app.post<{ Params: TaskAnalyzeParams; Body: TaskAnalyzeBody; Reply: ApiResponse<TaskAnalyzerApplyResult> }>(
    "/api/tasks/:taskId/apply-analysis",
    async (request, reply) => {
      const orgId = request.body.orgId?.trim();

      if (!orgId) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId est obligatoire pour appliquer l'analyse d'une tache.",
        });
      }

      try {
        assertOrgAccess(request, orgId);
        const result = await applyHubSpotTaskAnalysis({
          orgId,
          hubspotTaskId: request.params.taskId,
        });
        invalidateHubSpotTasksCache(orgId);

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        request.log.error(
          {
            error,
            orgId,
            taskId: request.params.taskId,
          },
          "Impossible d'appliquer l'analyse de la tache HubSpot.",
        );

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant l'application de l'analyse.",
        });
      }
    },
  );
};
