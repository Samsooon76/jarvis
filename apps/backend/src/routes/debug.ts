import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import { captureServerError, getSentryDsnProjectId, isSentryReady } from "../lib/sentry.js";
import {
  normalizeDealPromptInput,
  type DealPromptNormalizeResult,
} from "../services/deal-intelligence/prompt-normalizer.js";
import { buildDealAnalysisV1Instructions } from "../services/llm/deal-analysis-v1.js";
import { previewDealAnalysisV1LlmRequestForProspect } from "../services/deal-intelligence/v1.js";
import { diagnoseHubSpotOwners, type HubSpotOwnerDiagnostic } from "../services/hubspot-owner-diagnostic.service.js";

const currentDirectoryPath = dirname(fileURLToPath(import.meta.url));

type ParseDealPromptBody = {
  rawInput?: string;
};

type DebugHubSpotParams = {
  orgId: string;
};

type DebugDealLightPromptParams = {
  prospectId: string;
};

type DebugDealLightPromptQuery = {
  format?: string;
  include?: string;
  stats?: string;
};

type DebugDealLightPromptStats = {
  lightPromptChars: number;
  userPromptChars: number;
  instructionsChars: number;
  activityCount: number;
};

type DebugDealLightPromptResult = {
  prospectId: string;
  dealName: string | null;
  companyName: string | null;
  hubspotDealId: string;
  stats: DebugDealLightPromptStats;
  lightPrompt?: string | null;
  userPrompt?: string;
};

type DebugSentryResult = {
  enabled: boolean;
  eventId: string | null;
  flushed: boolean;
  projectId: string | null;
};

export const registerDebugRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get("/api/debug/deal-prompt-parser", async (_request, reply) => {
    const html = await readFile(join(currentDirectoryPath, "deal-prompt-parser-page.html"), "utf8");

    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.get<{
    Params: DebugDealLightPromptParams;
    Querystring: DebugDealLightPromptQuery;
  }>(
    "/api/debug/deal-light-prompt/:prospectId",
    async (request, reply) => {
      try {
        const preview = await previewDealAnalysisV1LlmRequestForProspect(request.params.prospectId);
        const lightPrompt = preview.llmInput.lightUserPrompt ?? null;
        const instructions = buildDealAnalysisV1Instructions(preview.lifecycleStatus);
        const activityCount =
          lightPrompt?.split("\n").filter((line) => /^\d{4}-\d{2}-\d{2}T/.test(line)).length ?? 0;
        const stats: DebugDealLightPromptStats = {
          lightPromptChars: lightPrompt?.length ?? 0,
          userPromptChars: preview.userPrompt.length,
          instructionsChars: instructions.length,
          activityCount,
        };

        if (request.query.format === "text") {
          return reply.type("text/plain; charset=utf-8").send(lightPrompt ?? "");
        }

        const includeUserPrompt = request.query.include === "user";
        const statsOnly = request.query.stats === "only";

        const payload: ApiResponse<DebugDealLightPromptResult> = {
          success: true,
          data: {
            prospectId: preview.prospectId,
            dealName: preview.dealName,
            companyName: preview.companyName,
            hubspotDealId: preview.hubspotDealId,
            stats,
            ...(statsOnly
              ? {}
              : {
                  lightPrompt,
                }),
            ...(includeUserPrompt ? { userPrompt: preview.userPrompt } : {}),
          },
        };

        return reply.send(payload);
      } catch (error) {
        request.log.error({ error, prospectId: request.params.prospectId }, "Impossible de generer le light prompt.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant la generation du light prompt.",
        });
      }
    },
  );

  app.post<{ Body: ParseDealPromptBody; Reply: ApiResponse<DealPromptNormalizeResult> }>(
    "/api/debug/parse-deal-prompt",
    async (request, reply) => {
      const rawInput = request.body?.rawInput?.trim();

      if (!rawInput) {
        return reply.code(400).send({
          success: false,
          error: "rawInput est requis.",
        });
      }

      return reply.send({
        success: true,
        data: normalizeDealPromptInput(rawInput),
      });
    },
  );

  app.post<{ Reply: ApiResponse<DebugSentryResult> }>("/api/debug/sentry", async (_request, reply) => {
    const result = await captureServerError(new Error("Jarvis backend Sentry smoke test"), {
      feature: "debug",
      operation: "sentry_backend_smoke_test",
      source: "fastify",
    });

    return reply.send({
      success: true,
      data: {
        enabled: isSentryReady(),
        eventId: result.eventId,
        flushed: result.flushed,
        projectId: getSentryDsnProjectId(),
      },
    });
  });

  app.get<{ Params: DebugHubSpotParams; Reply: ApiResponse<HubSpotOwnerDiagnostic> }>(
    "/api/debug/hubspot/:orgId",
    async (request, reply) => {
      try {
        const diagnostic = await diagnoseHubSpotOwners(request.params.orgId);

        return reply.send({
          success: true,
          data: diagnostic,
        });
      } catch (error) {
        request.log.error({ error, orgId: request.params.orgId }, "Impossible de diagnostiquer HubSpot.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le diagnostic HubSpot.",
        });
      }
    },
  );
};
