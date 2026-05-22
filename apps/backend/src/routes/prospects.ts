import { randomUUID } from "node:crypto";
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
import { getSupabaseAdmin } from "../db/client.js";
import { invalidateQueueCache } from "../services/queue.service.js";

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

type DealAnalysisRunParams = {
  id: string;
};

type DealAnalysisJobParams = {
  jobId: string;
};

type DealAnalysisRunBody = {
  orgId?: string | null;
  hubspotDealId?: string | null;
  llmProvider?: string | null;
  llmModel?: string | null;
  refresh?: boolean;
};

type ProspectParams = {
  id: string;
};

type ProspectActionBody = {
  userId?: string | null;
  reason?: string | null;
  snoozedUntil?: string | null;
};

type ProspectDetail = {
  id: string;
  orgId: string;
  ownerUserId: string | null;
  name: string;
  company: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  dealStage: string | null;
  dealAmount: number | null;
  closeProbability: number;
  lastContactAt: string | null;
  nextAction: string | null;
  aiSummary: string | null;
  aiPriorityScore: number;
  snoozedUntil: string | null;
  skippedAt: string | null;
  hubspotContactId: string;
  hubspotDealId: string | null;
  syncedAt: string;
  updatedAt: string;
};

type ProspectActionResult = {
  prospectId: string;
  action: "snooze" | "skip";
  snoozedUntil: string | null;
  skippedAt: string | null;
};

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

type DealAnalysisJobLog = {
  at: string;
  level: "info" | "success" | "error";
  message: string;
};

type DealAnalysisJobStatus = "queued" | "running" | "completed" | "failed";

type DealAnalysisJobSnapshot = {
  jobId: string;
  prospectId: string;
  orgId: string | null;
  hubspotDealId: string | null;
  status: DealAnalysisJobStatus;
  progress: number;
  currentStep: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  logs: DealAnalysisJobLog[];
  result: DealAnalysisBundleResult | null;
  error: string | null;
};

const DEAL_ANALYSIS_JOB_TTL_MS = 60 * 60 * 1000;
const dealAnalysisJobs = new Map<string, DealAnalysisJobSnapshot>();

const cleanupDealAnalysisJobs = (): void => {
  const cutoff = Date.now() - DEAL_ANALYSIS_JOB_TTL_MS;

  for (const [jobId, job] of dealAnalysisJobs.entries()) {
    if (new Date(job.updatedAt).getTime() < cutoff) {
      dealAnalysisJobs.delete(jobId);
    }
  }
};

const createDealAnalysisJob = (
  prospectId: string,
  body: DealAnalysisRunBody,
): DealAnalysisJobSnapshot => {
  cleanupDealAnalysisJobs();

  const now = new Date().toISOString();
  const job: DealAnalysisJobSnapshot = {
    jobId: randomUUID(),
    prospectId,
    orgId: body.orgId ?? null,
    hubspotDealId: body.hubspotDealId ?? null,
    status: "queued",
    progress: 0,
    currentStep: "Analyse du deal en attente",
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    logs: [
      {
        at: now,
        level: "info",
        message: "Job d'analyse complete du deal cree.",
      },
    ],
    result: null,
    error: null,
  };

  dealAnalysisJobs.set(job.jobId, job);

  return job;
};

const markDealAnalysisJobRunning = (jobId: string, step: string, progress: number): void => {
  const job = dealAnalysisJobs.get(jobId);

  if (!job || job.status === "completed" || job.status === "failed") {
    return;
  }

  const now = new Date().toISOString();
  job.status = "running";
  job.progress = Math.max(job.progress, Math.min(99, Math.round(progress)));
  job.currentStep = step;
  job.updatedAt = now;
  job.logs = [
    ...job.logs,
    {
      at: now,
      level: "info" as const,
      message: step,
    },
  ].slice(-40);
};

const completeDealAnalysisJob = (jobId: string, result: DealAnalysisBundleResult): void => {
  const job = dealAnalysisJobs.get(jobId);

  if (!job) {
    return;
  }

  const now = new Date().toISOString();
  job.status = "completed";
  job.progress = 100;
  job.currentStep = "Analyse complete du deal terminee";
  job.updatedAt = now;
  job.finishedAt = now;
  job.result = result;
  job.error = null;
  job.logs = [
    ...job.logs,
    {
      at: now,
      level: "success" as const,
      message: "Analyse complete du deal disponible.",
    },
  ].slice(-40);
};

const failDealAnalysisJob = (jobId: string, error: unknown): void => {
  const job = dealAnalysisJobs.get(jobId);

  if (!job) {
    return;
  }

  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : "Erreur inconnue pendant l'analyse du deal.";
  job.status = "failed";
  job.currentStep = "Analyse du deal en erreur";
  job.updatedAt = now;
  job.finishedAt = now;
  job.error = message;
  job.logs = [
    ...job.logs,
    {
      at: now,
      level: "error" as const,
      message,
    },
  ].slice(-40);
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

        return reply.send({
          success: true,
          data: mapProspectDetail(prospect as Record<string, unknown>),
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
      cleanupDealAnalysisJobs();

      const job = dealAnalysisJobs.get(request.params.jobId);

      if (!job) {
        return reply.code(404).send({
          success: false,
          error: "Job d'analyse deal introuvable.",
        });
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

  app.post<{ Params: DealAnalysisRunParams; Body: DealAnalysisRunBody; Reply: ApiResponse<DealAnalysisJobSnapshot> }>(
    "/api/prospects/:id/deal-analysis-runs",
    async (request, reply) => {
      const job = createDealAnalysisJob(request.params.id, request.body);

      void (async () => {
        try {
          markDealAnalysisJobRunning(job.jobId, "Construction du contexte CRM et HubSpot", 15);
          const result = await buildDealAnalysisBundleForProspect(request.params.id, {
            orgId: request.body.orgId ?? null,
            hubspotDealId: request.body.hubspotDealId ?? null,
            llmProvider: request.body.llmProvider ?? null,
            llmModel: request.body.llmModel ?? null,
            refresh: request.body.refresh ?? true,
          });
          markDealAnalysisJobRunning(job.jobId, "Persistance des analyses du deal", 90);
          completeDealAnalysisJob(job.jobId, result);
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
          failDealAnalysisJob(job.jobId, error);
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
