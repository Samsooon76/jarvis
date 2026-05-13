import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import {
  analyzeDealActivityPlanForProspect,
  analyzeDealIntelligenceForProspect,
  analyzeDealQualificationForProspect,
  buildDealAnalysisBundleForProspect,
  buildDealAnalysisPageForProspect,
  type DealAnalysisBundleResult,
  type DealActivityPlanResult,
  type DealAnalysisPageResult,
  type DealIntelligenceResult,
  type DealQualificationResult,
} from "../services/deal-intelligence.service.js";
import { getHubSpotAccessToken } from "../services/hubspot-auth.service.js";
import { hubSpotService, type HubSpotDealActivityDebug } from "../services/hubspot.service.js";
import type { FollowUpTaskRecommendation } from "../services/llm/llm.provider.js";
import {
  type FollowUpTaskDebugInfo,
  type FollowUpTaskRequestContext,
  previewFollowUpTaskForProspect,
  runFollowUpTaskForProspect,
} from "../services/follow-up-task.service.js";

type FollowUpTaskParams = {
  id: string;
};

type FollowUpTaskBody = {
  dryRun?: boolean;
  objective?: string | null;
  orgId?: string | null;
  hubspotOwnerId?: string | null;
  hubspotContactId?: string | null;
  hubspotDealId?: string | null;
  contactName?: string | null;
  company?: string | null;
  dealName?: string | null;
  dealStage?: string | null;
  lastContactAt?: string | null;
  nextAction?: string | null;
};

type DealIntelligenceQuery = {
  orgId?: string;
  hubspotDealId?: string;
  llmProvider?: string;
  llmModel?: string;
  contactName?: string;
  contactTitle?: string;
  contactEmail?: string;
  contactPhone?: string;
  companyName?: string;
  ownerName?: string;
  closeDate?: string;
  closeProbability?: string;
  dealAmount?: string;
  dealStage?: string;
  lastContactAt?: string;
  nextAction?: string;
  refresh?: string;
};

type DealActivityDebugQuery = {
  orgId?: string;
  hubspotDealId?: string;
};

const parseOptionalNumber = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
};

type FollowUpTaskResult = {
  prospectId: string;
  created: boolean;
  dryRun: boolean;
  recommendation: FollowUpTaskRecommendation;
  hubspotTaskId: string | null;
  localActionId: string | null;
  localActionPersisted: boolean;
  debug: FollowUpTaskDebugInfo;
};

export const registerProspectRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Querystring: DealActivityDebugQuery; Reply: ApiResponse<HubSpotDealActivityDebug> }>(
    "/api/prospects/deal-activity-debug",
    async (request, reply) => {
      const orgId = request.query.orgId;
      const hubspotDealId = request.query.hubspotDealId;

      if (!orgId || !hubspotDealId) {
        return reply.code(400).send({
          success: false,
          error: "Les parametres orgId et hubspotDealId sont obligatoires.",
        });
      }

      try {
        const accessToken = await getHubSpotAccessToken(orgId);
        const debug = await hubSpotService.fetchDealActivityDebug(accessToken, hubspotDealId);

        return reply.send({
          success: true,
          data: debug,
        });
      } catch (error) {
        request.log.error({ error, orgId, hubspotDealId }, "Impossible de diagnostiquer les activites du deal.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le diagnostic activite HubSpot.",
        });
      }
    },
  );

  app.get<{ Params: FollowUpTaskParams; Querystring: DealIntelligenceQuery; Reply: ApiResponse<DealIntelligenceResult> }>(
    "/api/prospects/:id/deal-intelligence",
    async (request, reply) => {
      try {
        const result = await analyzeDealIntelligenceForProspect(request.params.id, {
          orgId: request.query.orgId ?? null,
          hubspotDealId: request.query.hubspotDealId ?? null,
          llmProvider: request.query.llmProvider ?? null,
          llmModel: request.query.llmModel ?? null,
          currentCloseProbability: parseOptionalNumber(request.query.closeProbability),
          dealAmount: parseOptionalNumber(request.query.dealAmount),
          dealStage: request.query.dealStage ?? null,
          lastContactAt: request.query.lastContactAt ?? null,
          nextAction: request.query.nextAction ?? null,
          refresh: request.query.refresh === "true",
        });

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        request.log.error(
          {
            err: error instanceof Error ? error : undefined,
            errorMessage: error instanceof Error ? error.message : String(error),
            prospectId: request.params.id,
            orgId: request.query.orgId,
          },
          "Impossible d'analyser le deal avec l'IA.",
        );

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant l'analyse IA du deal.",
        });
      }
    },
  );

  app.get<{ Params: FollowUpTaskParams; Querystring: DealIntelligenceQuery; Reply: ApiResponse<DealAnalysisPageResult> }>(
    "/api/prospects/:id/deal-analysis-page",
    async (request, reply) => {
      try {
        const result = await buildDealAnalysisPageForProspect(request.params.id, {
          orgId: request.query.orgId ?? null,
          hubspotDealId: request.query.hubspotDealId ?? null,
          llmProvider: request.query.llmProvider ?? null,
          llmModel: request.query.llmModel ?? null,
          contactName: request.query.contactName ?? null,
          contactTitle: request.query.contactTitle ?? null,
          contactEmail: request.query.contactEmail ?? null,
          contactPhone: request.query.contactPhone ?? null,
          companyName: request.query.companyName ?? null,
          ownerName: request.query.ownerName ?? null,
          closeDate: request.query.closeDate ?? null,
          currentCloseProbability: parseOptionalNumber(request.query.closeProbability),
          dealAmount: parseOptionalNumber(request.query.dealAmount),
          dealStage: request.query.dealStage ?? null,
          lastContactAt: request.query.lastContactAt ?? null,
          nextAction: request.query.nextAction ?? null,
          refresh: request.query.refresh === "true",
        });

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        request.log.error(
          {
            err: error instanceof Error ? error : undefined,
            errorMessage: error instanceof Error ? error.message : String(error),
            prospectId: request.params.id,
            orgId: request.query.orgId,
          },
          "Impossible de construire la page d'analyse du deal.",
        );

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant la construction de la page deal.",
        });
      }
    },
  );

  app.get<{ Params: FollowUpTaskParams; Querystring: DealIntelligenceQuery; Reply: ApiResponse<DealAnalysisBundleResult> }>(
    "/api/prospects/:id/deal-analysis-bundle",
    async (request, reply) => {
      try {
        const result = await buildDealAnalysisBundleForProspect(request.params.id, {
          orgId: request.query.orgId ?? null,
          hubspotDealId: request.query.hubspotDealId ?? null,
          llmProvider: request.query.llmProvider ?? null,
          llmModel: request.query.llmModel ?? null,
          contactName: request.query.contactName ?? null,
          contactTitle: request.query.contactTitle ?? null,
          contactEmail: request.query.contactEmail ?? null,
          contactPhone: request.query.contactPhone ?? null,
          companyName: request.query.companyName ?? null,
          ownerName: request.query.ownerName ?? null,
          closeDate: request.query.closeDate ?? null,
          currentCloseProbability: parseOptionalNumber(request.query.closeProbability),
          dealAmount: parseOptionalNumber(request.query.dealAmount),
          dealStage: request.query.dealStage ?? null,
          lastContactAt: request.query.lastContactAt ?? null,
          nextAction: request.query.nextAction ?? null,
          refresh: request.query.refresh === "true",
        });

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        request.log.error(
          {
            err: error instanceof Error ? error : undefined,
            errorMessage: error instanceof Error ? error.message : String(error),
            prospectId: request.params.id,
            orgId: request.query.orgId,
          },
          "Impossible de construire le bundle d'analyse du deal.",
        );

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le bundle d'analyse du deal.",
        });
      }
    },
  );

  app.get<{ Params: FollowUpTaskParams; Querystring: DealIntelligenceQuery; Reply: ApiResponse<DealQualificationResult> }>(
    "/api/prospects/:id/deal-qualification",
    async (request, reply) => {
      try {
        const result = await analyzeDealQualificationForProspect(request.params.id, {
          orgId: request.query.orgId ?? null,
          hubspotDealId: request.query.hubspotDealId ?? null,
          llmProvider: request.query.llmProvider ?? null,
          llmModel: request.query.llmModel ?? null,
          contactName: request.query.contactName ?? null,
          contactTitle: request.query.contactTitle ?? null,
          contactEmail: request.query.contactEmail ?? null,
          contactPhone: request.query.contactPhone ?? null,
          companyName: request.query.companyName ?? null,
          ownerName: request.query.ownerName ?? null,
          closeDate: request.query.closeDate ?? null,
          currentCloseProbability: parseOptionalNumber(request.query.closeProbability),
          dealAmount: parseOptionalNumber(request.query.dealAmount),
          dealStage: request.query.dealStage ?? null,
          lastContactAt: request.query.lastContactAt ?? null,
          nextAction: request.query.nextAction ?? null,
          refresh: request.query.refresh === "true",
        });

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        request.log.error(
          {
            err: error instanceof Error ? error : undefined,
            errorMessage: error instanceof Error ? error.message : String(error),
            prospectId: request.params.id,
            orgId: request.query.orgId,
          },
          "Impossible de qualifier le deal avec l'IA.",
        );

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant la qualification IA du deal.",
        });
      }
    },
  );

  app.get<{ Params: FollowUpTaskParams; Querystring: DealIntelligenceQuery; Reply: ApiResponse<DealActivityPlanResult> }>(
    "/api/prospects/:id/deal-activity-plan",
    async (request, reply) => {
      try {
        const result = await analyzeDealActivityPlanForProspect(request.params.id, {
          orgId: request.query.orgId ?? null,
          hubspotDealId: request.query.hubspotDealId ?? null,
          llmProvider: request.query.llmProvider ?? null,
          llmModel: request.query.llmModel ?? null,
          contactName: request.query.contactName ?? null,
          contactTitle: request.query.contactTitle ?? null,
          contactEmail: request.query.contactEmail ?? null,
          contactPhone: request.query.contactPhone ?? null,
          companyName: request.query.companyName ?? null,
          ownerName: request.query.ownerName ?? null,
          closeDate: request.query.closeDate ?? null,
          currentCloseProbability: parseOptionalNumber(request.query.closeProbability),
          dealAmount: parseOptionalNumber(request.query.dealAmount),
          dealStage: request.query.dealStage ?? null,
          lastContactAt: request.query.lastContactAt ?? null,
          nextAction: request.query.nextAction ?? null,
          refresh: request.query.refresh === "true",
        });

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        request.log.error(
          {
            err: error instanceof Error ? error : undefined,
            errorMessage: error instanceof Error ? error.message : String(error),
            prospectId: request.params.id,
            orgId: request.query.orgId,
          },
          "Impossible de construire l'activite et le plan d'action du deal.",
        );

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant l'analyse activite du deal.",
        });
      }
    },
  );

  app.post<{ Params: FollowUpTaskParams; Body: FollowUpTaskBody; Reply: ApiResponse<FollowUpTaskResult> }>(
    "/api/prospects/:id/follow-up-task",
    async (request, reply) => {
      const prospectId = request.params.id;
      const dryRun = request.body.dryRun === true;
      const context: FollowUpTaskRequestContext = {
        orgId: request.body.orgId ?? null,
        hubspotOwnerId: request.body.hubspotOwnerId ?? null,
        hubspotContactId: request.body.hubspotContactId ?? null,
        hubspotDealId: request.body.hubspotDealId ?? null,
        contactName: request.body.contactName ?? null,
        company: request.body.company ?? null,
        dealName: request.body.dealName ?? null,
        dealStage: request.body.dealStage ?? null,
        lastContactAt: request.body.lastContactAt ?? null,
        nextAction: request.body.nextAction ?? null,
      };

      try {
        if (dryRun) {
          const preview = await previewFollowUpTaskForProspect(
            prospectId,
            request.body.objective ?? "Detecter si une relance commerciale doit etre creee dans HubSpot",
            context,
          );

          return reply.send({
            success: true,
            data: {
              prospectId: preview.prospectId,
              created: false,
              dryRun,
              recommendation: preview.recommendation,
              hubspotTaskId: null,
              localActionId: null,
              localActionPersisted: false,
              debug: preview.debug,
            },
          });
        }

        const result = await runFollowUpTaskForProspect(
          prospectId,
          request.body.objective ?? "Detecter si une relance commerciale doit etre creee dans HubSpot",
          context,
        );

        if (!result.created) {
          return reply.send({
            success: true,
            data: {
              prospectId: result.prospectId,
              created: false,
              dryRun,
              recommendation: result.recommendation,
              hubspotTaskId: null,
              localActionId: null,
              localActionPersisted: false,
              debug: result.debug,
            },
          });
        }

        return reply.send({
          success: true,
          data: {
            prospectId: result.prospectId,
            created: true,
            dryRun,
            recommendation: result.recommendation,
            hubspotTaskId: result.hubspotTaskId,
            localActionId: result.localActionId,
            localActionPersisted: result.localActionPersisted,
            debug: result.debug,
          },
        });
      } catch (error) {
        request.log.error(
          {
            err: error instanceof Error ? error : undefined,
            errorMessage: error instanceof Error ? error.message : String(error),
            prospectId,
            dryRun,
            context,
          },
          "Impossible d'analyser ou creer la tache de relance HubSpot.",
        );

        return reply.code(500).send({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Erreur inconnue pendant l'analyse de relance ou la creation de tache HubSpot.",
        });
      }
    },
  );
};
