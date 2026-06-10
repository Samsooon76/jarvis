import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  ApiResponse,
  RepCoaching,
  TeamCoachingCard,
  TeamCoachingJobLog,
  TeamCoachingJobSnapshot,
  TeamCoachingRunResult,
} from "@jarvis/shared";
import type { Json } from "../db/database.types.js";
import { loadAuthenticatedAppUserProfile, type AppUserProfile } from "../services/app-auth.service.js";
import { createJob, getJob, updateJob, type PersistentJobSnapshot } from "../services/job-store.js";
import { getRepCoaching, listTeamCoaching, runTeamCoaching } from "../services/rep-coaching.service.js";

const TEAM_COACHING_JOB_TYPE = "team_coaching_run";
const TEAM_COACHING_JOB_LOG_LIMIT = 50;

type CoachingRecipient = {
  userId: string;
  orgId: string;
  role: "manager" | "admin";
};

type RepCoachingParams = {
  userId: string;
};

type RepCoachingQuery = {
  refresh?: string;
};

type TeamCoachingJobParams = {
  jobId: string;
};

const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Le coaching est reserve aux admins/managers (le sales ne voit pas son profil en v1).
const resolveCoachingRecipient = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<CoachingRecipient | null> => {
  let profile: AppUserProfile;

  try {
    profile = await loadAuthenticatedAppUserProfile(request);
  } catch (error) {
    void reply.code(401).send({
      success: false,
      error: error instanceof Error ? error.message : "Authentification requise.",
    });
    return null;
  }

  if (profile.role !== "admin" && profile.role !== "manager") {
    void reply.code(403).send({
      success: false,
      error: "Le coaching IA est reserve aux administrateurs et managers.",
    });
    return null;
  }

  if (!profile.id || !profile.orgId) {
    void reply.code(403).send({
      success: false,
      error: "Profil Jarvis incomplet: organisation requise pour le coaching IA.",
    });
    return null;
  }

  return {
    userId: profile.id,
    orgId: profile.orgId,
    role: profile.role,
  };
};

const toTeamCoachingJobSnapshot = (job: PersistentJobSnapshot<Json | null>): TeamCoachingJobSnapshot | null => {
  if (job.type !== TEAM_COACHING_JOB_TYPE || !job.orgId) {
    return null;
  }

  return {
    jobId: job.id,
    orgId: job.orgId,
    status: job.status === "skipped" ? "failed" : job.status,
    progress: job.progress,
    currentStep: job.currentStep,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    logs: job.logs as TeamCoachingJobLog[],
    result: job.result as TeamCoachingRunResult | null,
    error: job.error,
  };
};

const runTeamCoachingJob = async (jobId: string, orgId: string): Promise<void> => {
  const appendLog = async (
    progress: number,
    step: string,
    message?: string,
    level: TeamCoachingJobLog["level"] = "info",
  ): Promise<void> => {
    const job = await getJob(jobId);

    if (!job || job.status === "completed" || job.status === "failed") {
      return;
    }

    const logs = message
      ? [...(job.logs as TeamCoachingJobLog[]), { at: new Date().toISOString(), level, message }].slice(
          -TEAM_COACHING_JOB_LOG_LIMIT,
        )
      : (job.logs as TeamCoachingJobLog[]);

    await updateJob(jobId, {
      status: "running",
      progress: Math.max(job.progress, Math.min(99, Math.round(progress))),
      currentStep: step,
      logs,
    });
  };

  try {
    await appendLog(1, "Analyse coaching equipe demarree", "Analyse des commerciaux en cours.");

    const result = await runTeamCoaching(orgId, async (event) => {
      await appendLog(event.progress, event.step, event.message, event.level);
    });

    const job = await getJob(jobId);
    const now = new Date().toISOString();

    await updateJob(jobId, {
      status: "completed",
      progress: 100,
      currentStep: "Analyse coaching equipe terminee",
      logs: [
        ...((job?.logs ?? []) as TeamCoachingJobLog[]),
        {
          at: now,
          level: "success" as const,
          message: `Coaching termine: ${result.processed} genere(s), ${result.reused} en cache, ${result.skipped} ignore(s) (donnees insuffisantes), ${result.failed} echec(s).`,
        },
      ].slice(-TEAM_COACHING_JOB_LOG_LIMIT),
      result: result as unknown as Json,
      error: null,
      finishedAt: now,
    });
  } catch (error) {
    const job = await getJob(jobId);
    const now = new Date().toISOString();
    const message = error instanceof Error ? error.message : "Erreur inconnue pendant le coaching equipe.";

    await updateJob(jobId, {
      status: "failed",
      progress: job?.progress ?? 0,
      currentStep: "Analyse coaching equipe en erreur",
      logs: [
        ...((job?.logs ?? []) as TeamCoachingJobLog[]),
        { at: now, level: "error" as const, message },
      ].slice(-TEAM_COACHING_JOB_LOG_LIMIT),
      error: message,
      finishedAt: now,
    });
  }
};

export const registerRepCoachingRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Reply: ApiResponse<TeamCoachingCard[]> }>("/api/coaching/team", async (request, reply) => {
    const recipient = await resolveCoachingRecipient(request, reply);

    if (!recipient) {
      return reply;
    }

    try {
      const cards = await listTeamCoaching(recipient.orgId);

      return reply.send({ success: true, data: cards });
    } catch (error) {
      request.log.error({ error }, "Impossible de charger le coaching equipe.");

      return reply.code(500).send({
        success: false,
        error: "Impossible de charger le coaching equipe.",
      });
    }
  });

  app.get<{ Params: RepCoachingParams; Querystring: RepCoachingQuery; Reply: ApiResponse<RepCoaching> }>(
    "/api/coaching/rep/:userId",
    async (request, reply) => {
      const recipient = await resolveCoachingRecipient(request, reply);

      if (!recipient) {
        return reply;
      }

      if (!UUID_V4_LIKE_PATTERN.test(request.params.userId)) {
        return reply.code(400).send({
          success: false,
          error: "L'identifiant du commercial est invalide.",
        });
      }

      try {
        const coaching = await getRepCoaching(recipient.orgId, request.params.userId, {
          refresh: request.query.refresh === "true",
        });

        return reply.send({ success: true, data: coaching });
      } catch (error) {
        request.log.error({ error, targetUserId: request.params.userId }, "Impossible de generer le coaching.");

        return reply.code(500).send({
          success: false,
          error: "Impossible de generer le profil de coaching.",
        });
      }
    },
  );

  app.post<{ Reply: ApiResponse<TeamCoachingJobSnapshot> }>("/api/coaching/team/run", async (request, reply) => {
    const recipient = await resolveCoachingRecipient(request, reply);

    if (!recipient) {
      return reply;
    }

    try {
      const job = await createJob({
        id: randomUUID(),
        orgId: recipient.orgId,
        type: TEAM_COACHING_JOB_TYPE,
        currentStep: "Analyse coaching equipe en attente",
        logs: [
          {
            at: new Date().toISOString(),
            level: "info",
            message: "Job de coaching equipe cree.",
          },
        ],
      });

      const snapshot = toTeamCoachingJobSnapshot(job);

      if (!snapshot) {
        throw new Error("Job de coaching equipe invalide apres creation.");
      }

      // Le job tourne en arriere-plan; le front poll /jobs/:jobId.
      void runTeamCoachingJob(snapshot.jobId, recipient.orgId);

      return reply.send({ success: true, data: snapshot });
    } catch (error) {
      request.log.error({ error }, "Impossible de demarrer le coaching equipe.");

      return reply.code(500).send({
        success: false,
        error: "Impossible de demarrer l'analyse coaching equipe.",
      });
    }
  });

  app.get<{ Params: TeamCoachingJobParams; Reply: ApiResponse<TeamCoachingJobSnapshot> }>(
    "/api/coaching/team/jobs/:jobId",
    async (request, reply) => {
      const recipient = await resolveCoachingRecipient(request, reply);

      if (!recipient) {
        return reply;
      }

      const job = await getJob(request.params.jobId);
      const snapshot = job ? toTeamCoachingJobSnapshot(job) : null;

      if (!snapshot || snapshot.orgId !== recipient.orgId) {
        return reply.code(404).send({
          success: false,
          error: "Job de coaching equipe introuvable.",
        });
      }

      return reply.send({ success: true, data: snapshot });
    },
  );
};
