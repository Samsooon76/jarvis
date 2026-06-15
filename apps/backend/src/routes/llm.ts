import type { FastifyInstance } from "fastify";
import type { ApiResponse, AskJarvisRequest, AskJarvisResult } from "@jarvis/shared";
import { assertManagerOrAdmin, assertOrgAccess, requireAuth } from "../services/app-auth.service.js";
import { askJarvis } from "../services/llm/ask.service.js";
import { createLlmProvider } from "../services/llm/provider.factory.js";
import {
  isLlmProviderId,
  resolveLlmProviderPreference,
  saveLlmProviderPreference,
  type LlmProviderPreference,
} from "../services/llm/provider-preference.service.js";
import type { DealHistoryAnalysis } from "../services/llm/llm.provider.js";

type AnalyzeDealHistoryBody = {
  history?: string;
  companyName?: string | null;
  dealName?: string | null;
  companyContext?: string | null;
  dealContext?: string | null;
  objective?: string | null;
};

type LlmProviderPreferenceQuery = {
  orgId?: string;
};

type SaveLlmProviderPreferenceBody = {
  orgId?: string;
  provider?: string;
  model?: string | null;
};

const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidOrgId = (value: string | undefined): value is string =>
  typeof value === "string" && UUID_V4_LIKE_PATTERN.test(value.trim());

export const registerLlmRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Querystring: LlmProviderPreferenceQuery; Reply: ApiResponse<LlmProviderPreference> }>(
    "/api/llm/provider-preference",
    async (request, reply) => {
      const orgId = request.query.orgId;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId doit etre un UUID Jarvis valide.",
        });
      }
      assertOrgAccess(request, orgId);

      try {
        return reply.send({
          success: true,
          data: await resolveLlmProviderPreference(orgId),
        });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de charger la preference IA.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le chargement de la preference IA.",
        });
      }
    },
  );

  app.post<{ Body: SaveLlmProviderPreferenceBody; Reply: ApiResponse<LlmProviderPreference> }>(
    "/api/llm/provider-preference",
    async (request, reply) => {
      const orgId = request.body.orgId;
      const provider = request.body.provider;

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId doit etre un UUID Jarvis valide.",
        });
      }

      if (!isLlmProviderId(provider)) {
        return reply.code(400).send({
          success: false,
          error: "Provider IA non supporte.",
        });
      }
      assertOrgAccess(request, orgId);
      assertManagerOrAdmin(request);

      try {
        return reply.send({
          success: true,
          data: await saveLlmProviderPreference(orgId, provider, request.body.model ?? null),
        });
      } catch (error) {
        request.log.error({ error, orgId, provider }, "Impossible d'enregistrer la preference IA.");

        return reply.code(500).send({
          success: false,
          error:
            error instanceof Error ? error.message : "Erreur inconnue pendant l'enregistrement de la preference IA.",
        });
      }
    },
  );

  app.post<{ Body: AskJarvisRequest; Reply: ApiResponse<AskJarvisResult> }>(
    "/api/llm/ask",
    async (request, reply) => {
      const orgId = request.body.orgId?.trim();
      const question = request.body.question?.trim();

      if (!orgId) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId est obligatoire.",
        });
      }

      if (!question) {
        return reply.code(400).send({
          success: false,
          error: "Le champ question est obligatoire.",
        });
      }

      try {
        assertOrgAccess(request, orgId);
        requireAuth(request);

        return reply.send({
          success: true,
          data: await askJarvis(request.body),
        });
      } catch (error) {
        request.log.error(
          {
            err: error instanceof Error ? error : undefined,
            errorMessage: error instanceof Error ? error.message : String(error),
            orgId,
          },
          "Impossible de repondre a la question Jarvis.",
        );

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant la question Jarvis.",
        });
      }
    },
  );

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
        requireAuth(request);
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
