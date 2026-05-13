import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import { createLlmProvider } from "../services/llm/provider.factory.js";
import type { DealHistoryAnalysis } from "../services/llm/llm.provider.js";

type AnalyzeDealHistoryBody = {
  history?: string;
  companyName?: string | null;
  dealName?: string | null;
  companyContext?: string | null;
  dealContext?: string | null;
  objective?: string | null;
};

export const registerLlmRoutes = async (app: FastifyInstance): Promise<void> => {
  app.post<{ Body: AnalyzeDealHistoryBody; Reply: ApiResponse<DealHistoryAnalysis> }>(
    "/api/llm/deal-history/analyze",
    async (request, reply) => {
      const history = request.body.history?.trim();

      if (!history) {
        return reply.code(400).send({
          success: false,
          error: "Le champ history est obligatoire pour analyser un deal.",
        });
      }

      try {
        const provider = createLlmProvider();
        const analysis = await provider.analyzeDealHistory({
          history,
          companyName: request.body.companyName ?? null,
          dealName: request.body.dealName ?? null,
          companyContext: request.body.companyContext ?? null,
          dealContext: request.body.dealContext ?? null,
          objective: request.body.objective ?? null,
        });

        return reply.send({
          success: true,
          data: analysis,
        });
      } catch (error) {
        request.log.error(
          {
            err: error instanceof Error ? error : undefined,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
          "Impossible d'analyser l'historique du deal avec Vertex AI.",
        );

        return reply.code(500).send({
          success: false,
          error:
            error instanceof Error ? error.message : "Erreur inconnue pendant l'analyse du deal.",
        });
      }
    },
  );
};
