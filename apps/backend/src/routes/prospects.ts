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
import {
  type FollowUpTaskRequestContext,
  previewFollowUpTaskForProspect,
  runFollowUpTaskForProspect,
} from "../services/prospects/follow-up-task.service.js";
import { getSupabaseAdmin } from "../db/client.js";
import { invalidateQueueCache } from "../services/prospects/queue.service.js";
import { assertOrgAccess, requireAuth } from "../services/app-auth.service.js";
import { logProspectAccess } from "../services/prospects/prospect-access-log.service.js";
import {
  completeDealAnalysisJob,
  createDealAnalysisJob,
  failDealAnalysisJob,
  loadDealAnalysisJob,
  markDealAnalysisJobRunning,
  type DealAnalysisJobSnapshot,
} from "../services/prospects/deal-analysis-job.service.js";
import type {
  DealActivityDebugQuery,
  DealAnalysisJobParams,
  DealAnalysisRunBody,
  DealAnalysisRunParams,
  DealIntelligenceQuery,
  FollowUpTaskBody,
  FollowUpTaskParams,
  FollowUpTaskResult,
  ProspectActionBody,
  ProspectActionResult,
  ProspectDetail,
  ProspectParams,
} from "./prospects.types.js";

const parseOptionalNumber = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
};

const mapProspectDetail = (row: Record<string, unknown>): ProspectDetail => ({
  id: String(row.id),
  orgId: String(row.org_id),
  ownerUserId: typeof row.owner_user_id === "string" ? row.owner_user_id : null,
  name: String(row.name),
  company: typeof row.company === "string" ? row.company : null,
  title: typeof row.title === "string" ? row.title : null,
  email: typeof row.email === "string" ? row.email : null,
  phone: typeof row.phone === "string" ? row.phone : null,
  dealStage: typeof row.deal_stage === "string" ? row.deal_stage : null,
  dealAmount: typeof row.deal_amount === "number" ? row.deal_amount : row.deal_amount === null ? null : Number(row.deal_amount),
  closeProbability: Number(row.close_probability ?? 0),
  lastContactAt: typeof row.last_contact_at === "string" ? row.last_contact_at : null,
  nextAction: typeof row.next_action === "string" ? row.next_action : null,
  aiSummary: typeof row.ai_summary === "string" ? row.ai_summary : null,
  aiPriorityScore: Number(row.ai_priority_score ?? 0),
  snoozedUntil: typeof row.snoozed_until === "string" ? row.snoozed_until : null,
  skippedAt: typeof row.skipped_at === "string" ? row.skipped_at : null,
  hubspotContactId: String(row.hubspot_contact_id),
  hubspotDealId: typeof row.hubspot_deal_id === "string" ? row.hubspot_deal_id : null,
  syncedAt: String(row.synced_at),
  updatedAt: String(row.updated_at),
});

const sanitizeReason = (reason: string | null | undefined): string | null => {
  const trimmed = reason?.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, 500);
};

export const registerProspectRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Params: ProspectParams; Reply: ApiResponse<ProspectDetail> }>(
    "/api/prospects/:id",
    async (request, reply) => {
      try {
        const supabase = getSupabaseAdmin();
        const { data: prospect, error } = await supabase
          .from("prospects")
          .select(
            "id, org_id, owner_user_id, name, company, title, email, phone, deal_stage, deal_amount, close_probability, last_contact_at, next_action, ai_summary, ai_priority_score, snoozed_until, skipped_at, hubspot_contact_id, hubspot_deal_id, synced_at, updated_at",
          )
          .eq("id", request.params.id)
          .maybeSingle();

        if (error) {
          throw new Error(`Impossible de charger la fiche prospect: ${error.message}`);
        }

        if (!prospect) {
          return reply.code(404).send({
            success: false,
            error: "Prospect introuvable.",
          });
        }
        const mappedProspect = mapProspectDetail(prospect as Record<string, unknown>);
        assertOrgAccess(request, mappedProspect.orgId);
        const auth = requireAuth(request);
        await logProspectAccess({
          orgId: mappedProspect.orgId,
          userId: auth.appUserId,
          prospectId: mappedProspect.id,
          source: "prospect_detail",
        }).catch((logError: unknown) => {
          request.log.warn({ error: logError, prospectId: mappedProspect.id }, "Journalisation acces prospect ignoree.");
        });

        return reply.send({
          success: true,
          data: mappedProspect,
        });
      } catch (error) {
        request.log.error({ error, prospectId: request.params.id }, "Impossible de charger la fiche prospect.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le chargement du prospect.",
        });
      }
    },
  );

  app.post<{ Params: ProspectParams; Body: ProspectActionBody; Reply: ApiResponse<ProspectActionResult> }>(
    "/api/prospects/:id/snooze",
    async (request, reply) => {
      const snoozedUntil = request.body?.snoozedUntil;

      if (!snoozedUntil || Number.isNaN(new Date(snoozedUntil).getTime())) {
        return reply.code(400).send({
          success: false,
          error: "snoozedUntil doit etre une date ISO valide.",
        });
      }

      try {
        const supabase = getSupabaseAdmin();
        const { data: updated, error } = await supabase
          .from("prospects")
          .update({
            snoozed_until: snoozedUntil,
            skipped_at: null,
          })
          .eq("id", request.params.id)
          .select("id, owner_user_id, snoozed_until, skipped_at")
          .maybeSingle();

        if (error) {
          throw new Error(`Impossible de snoozer le prospect: ${error.message}`);
        }

        if (!updated) {
          return reply.code(404).send({
            success: false,
            error: "Prospect introuvable.",
          });
        }

        await supabase.from("queue_action_audit").insert({
          prospect_id: request.params.id,
          user_id: request.body?.userId ?? null,
          action: "snooze",
          reason: sanitizeReason(request.body?.reason),
          snoozed_until: snoozedUntil,
        });

        const ownerUserId = (updated as { owner_user_id?: string | null }).owner_user_id ?? request.body?.userId ?? null;
        invalidateQueueCache(ownerUserId);

        return reply.send({
          success: true,
          data: {
            prospectId: request.params.id,
            action: "snooze",
            snoozedUntil,
            skippedAt: null,
          },
        });
      } catch (error) {
        request.log.error({ error, prospectId: request.params.id }, "Impossible de snoozer le prospect.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le snooze du prospect.",
        });
      }
    },
  );

  app.post<{ Params: ProspectParams; Body: ProspectActionBody; Reply: ApiResponse<ProspectActionResult> }>(
    "/api/prospects/:id/skip",
    async (request, reply) => {
      try {
        const supabase = getSupabaseAdmin();
        const skippedAt = new Date().toISOString();
        const { data: updated, error } = await supabase
          .from("prospects")
          .update({
            skipped_at: skippedAt,
            snoozed_until: null,
          })
          .eq("id", request.params.id)
          .select("id, owner_user_id, snoozed_until, skipped_at")
          .maybeSingle();

        if (error) {
          throw new Error(`Impossible d'ignorer le prospect: ${error.message}`);
        }

        if (!updated) {
          return reply.code(404).send({
            success: false,
            error: "Prospect introuvable.",
          });
        }

        await supabase.from("queue_action_audit").insert({
          prospect_id: request.params.id,
          user_id: request.body?.userId ?? null,
          action: "skip",
          reason: sanitizeReason(request.body?.reason),
          snoozed_until: null,
        });

        const ownerUserId = (updated as { owner_user_id?: string | null }).owner_user_id ?? request.body?.userId ?? null;
        invalidateQueueCache(ownerUserId);

        return reply.send({
          success: true,
          data: {
            prospectId: request.params.id,
            action: "skip",
            snoozedUntil: null,
            skippedAt,
          },
        });
      } catch (error) {
        request.log.error({ error, prospectId: request.params.id }, "Impossible d'ignorer le prospect.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le skip du prospect.",
        });
      }
    },
  );

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

  app.get<{ Params: DealAnalysisJobParams; Reply: ApiResponse<DealAnalysisJobSnapshot> }>(
    "/api/prospects/deal-analysis-runs/:jobId",
    async (request, reply) => {
      const job = await loadDealAnalysisJob(request.params.jobId);

      if (!job) {
        return reply.code(404).send({
          success: false,
          error: "Job d'analyse deal introuvable.",
        });
      }
      if (job.orgId) {
        assertOrgAccess(request, job.orgId);
      }

      return reply.send({
        success: true,
        data: job,
      });
    },
  );

  app.get<{ Params: FollowUpTaskParams; Querystring: DealIntelligenceQuery; Reply: ApiResponse<DealIntelligenceResult> }>(
    "/api/prospects/:id/deal-intelligence",
    async (request, reply) => {
      try {
        if (request.query.orgId) {
          assertOrgAccess(request, request.query.orgId);
        }
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
        await logProspectAccess({
          orgId: result.orgId,
          userId: requireAuth(request).appUserId,
          prospectId: result.prospectId,
          source: "deal_intelligence",
        }).catch((logError: unknown) => {
          request.log.warn({ error: logError, prospectId: result.prospectId }, "Journalisation acces prospect ignoree.");
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

  app.post<{ Params: DealAnalysisRunParams; Body: DealAnalysisRunBody; Reply: ApiResponse<DealAnalysisJobSnapshot> }>(
    "/api/prospects/:id/deal-analysis-runs",
    async (request, reply) => {
      if (request.body.orgId) {
        assertOrgAccess(request, request.body.orgId);
      }
      const job = await createDealAnalysisJob(request.params.id, request.body);

      void (async () => {
        try {
          await markDealAnalysisJobRunning(job.jobId, "Construction du contexte CRM et HubSpot", 15);
          const result = await buildDealAnalysisBundleForProspect(request.params.id, {
            orgId: request.body.orgId ?? null,
            hubspotDealId: request.body.hubspotDealId ?? null,
            llmProvider: request.body.llmProvider ?? null,
            llmModel: request.body.llmModel ?? null,
            refresh: request.body.refresh ?? false,
          });
          await markDealAnalysisJobRunning(job.jobId, "Persistance des analyses du deal", 90);
          await completeDealAnalysisJob(job.jobId, result);
        } catch (error) {
          request.log.error(
            {
              err: error instanceof Error ? error : undefined,
              errorMessage: error instanceof Error ? error.message : String(error),
              prospectId: request.params.id,
              orgId: request.body.orgId,
              jobId: job.jobId,
            },
            "Job d'analyse complete du deal en erreur.",
          );
          await failDealAnalysisJob(job.jobId, error);
        }
      })();

      return reply.code(202).send({
        success: true,
        data: job,
      });
    },
  );

  app.get<{ Params: FollowUpTaskParams; Querystring: DealIntelligenceQuery; Reply: ApiResponse<DealAnalysisPageResult> }>(
    "/api/prospects/:id/deal-analysis-page",
    async (request, reply) => {
      try {
        if (request.query.orgId) {
          assertOrgAccess(request, request.query.orgId);
        }
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
        await logProspectAccess({
          orgId: result.orgId,
          userId: requireAuth(request).appUserId,
          prospectId: result.prospectId,
          source: "deal_analysis_page",
        }).catch((logError: unknown) => {
          request.log.warn({ error: logError, prospectId: result.prospectId }, "Journalisation acces prospect ignoree.");
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
        if (request.query.orgId) {
          assertOrgAccess(request, request.query.orgId);
        }
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
        await logProspectAccess({
          orgId: result.page.orgId,
          userId: requireAuth(request).appUserId,
          prospectId: result.page.prospectId,
          source: "deal_analysis_bundle",
        }).catch((logError: unknown) => {
          request.log.warn({ error: logError, prospectId: result.page.prospectId }, "Journalisation acces prospect ignoree.");
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
        if (request.query.orgId) {
          assertOrgAccess(request, request.query.orgId);
        }
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
        await logProspectAccess({
          orgId: result.orgId,
          userId: requireAuth(request).appUserId,
          prospectId: result.prospectId,
          source: "deal_qualification",
        }).catch((logError: unknown) => {
          request.log.warn({ error: logError, prospectId: result.prospectId }, "Journalisation acces prospect ignoree.");
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
        if (request.query.orgId) {
          assertOrgAccess(request, request.query.orgId);
        }
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
        await logProspectAccess({
          orgId: result.orgId,
          userId: requireAuth(request).appUserId,
          prospectId: result.prospectId,
          source: "deal_activity_plan",
        }).catch((logError: unknown) => {
          request.log.warn({ error: logError, prospectId: result.prospectId }, "Journalisation acces prospect ignoree.");
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
        if (context.orgId) {
          assertOrgAccess(request, context.orgId);
        }
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
