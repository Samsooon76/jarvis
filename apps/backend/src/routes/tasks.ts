import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
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

type TaskAnalyzeBody = {
  orgId?: string;
  llmProvider?: string | null;
  llmModel?: string | null;
  refresh?: boolean;
  includeHistory?: boolean;
};

export const registerTaskRoutes = async (app: FastifyInstance): Promise<void> => {
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
