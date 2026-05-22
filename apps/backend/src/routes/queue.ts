import type { FastifyInstance } from "fastify";
import type { ApiResponse, QueueData } from "@jarvis/shared";
import { getQueueDebug, getUserQueue, type QueueDebugData } from "../services/queue.service.js";

type QueueParams = {
  userId: string;
};

const getNowMs = (): number => performance.now();
const formatDurationMs = (startedAtMs: number): number => Math.round((getNowMs() - startedAtMs) * 100) / 100;

const getStatusCode = (message: string): number => {
  if (message.includes("introuvable")) {
    return 404;
  }

  if (message.includes("aucune organisation") || message.includes("n'est rattache")) {
    return 400;
  }

  return 500;
};

export const registerQueueRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Params: QueueParams; Reply: ApiResponse<QueueData> }>(
    "/api/queue/:userId",
    async (request, reply) => {
      const requestStartedAtMs = getNowMs();
      const { userId } = request.params;

      try {
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
      try {
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
