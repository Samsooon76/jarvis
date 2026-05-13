import type { FastifyInstance } from "fastify";
import type { ApiResponse, QueueData, QueueProspect } from "@jarvis/shared";
import { env } from "../config/env.js";
import { getSupabaseAdmin } from "../db/client.js";

type QueueParams = {
  userId: string;
};

type QueueUserRow = {
  id: string;
  org_id: string | null;
};

type QueueProspectRow = {
  ai_priority_score: number;
  ai_summary: string | null;
  close_probability: number;
  company: string | null;
  created_at: string;
  deal_amount: number | null;
  deal_stage: string | null;
  id: string;
  last_contact_at: string | null;
  name: string;
  next_action: string | null;
  snoozed_until: string | null;
  title: string | null;
};

type QueueCacheEntry = {
  expiresAt: number;
  payload: QueueData;
};

const QUEUE_CACHE_TTL_MS = 30_000;
const QUEUE_MAX_PROSPECTS = 50;
const queueCache = new Map<string, QueueCacheEntry>();

const getNowMs = (): number => performance.now();
const formatDurationMs = (startedAtMs: number): number => Math.round((getNowMs() - startedAtMs) * 100) / 100;

const getPriority = (score: number): QueueProspect["priority"] => {
  if (score >= 80) {
    return "urgent";
  }

  if (score >= 50) {
    return "important";
  }

  return "routine";
};

const buildReason = (summary: string | null, nextAction: string | null): string => {
  if (summary) {
    return summary;
  }

  if (nextAction) {
    return `Priorite du jour: ${nextAction}`;
  }

  return "Aucun contexte IA disponible pour le moment.";
};

export const registerQueueRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Params: QueueParams; Reply: ApiResponse<QueueData> }>(
    "/api/queue/:userId",
    async (request, reply) => {
      const requestStartedAtMs = getNowMs();
      const { userId } = request.params;
      const cachedQueue = queueCache.get(userId);

      if (cachedQueue && cachedQueue.expiresAt > Date.now()) {
        const durationMs = formatDurationMs(requestStartedAtMs);
        reply.header("Server-Timing", `total;dur=${durationMs}, cache;dur=${durationMs}`);
        reply.header("X-Response-Time-Ms", String(durationMs));
        request.log.info({ userId, durationMs, cacheHit: true }, "Queue chargee depuis le cache.");

        return reply.send({
          success: true,
          data: cachedQueue.payload,
        });
      }

      if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
        request.log.warn(
          { userId },
          "Supabase non configure localement, impossible de charger la queue reelle.",
        );

        return reply.code(500).send({
          success: false,
          error: "Supabase n'est pas configure. La queue reelle est indisponible.",
        });
      }

      try {
        const supabase = getSupabaseAdmin();
        const now = new Date();
        const nowIso = now.toISOString();
        const userQueryStartedAtMs = getNowMs();

        const { data: user, error: userError } = await supabase
          .from("users")
          .select("id, org_id")
          .eq("id", userId)
          .maybeSingle();
        const userQueryDurationMs = formatDurationMs(userQueryStartedAtMs);
        const queueUser = user as QueueUserRow | null;

        if (userError) {
          request.log.error({ error: userError, userId }, "Erreur Supabase lors du chargement du user.");

          return reply.code(500).send({
            success: false,
            error: "Impossible de charger le commercial depuis Supabase.",
          });
        }

        if (!queueUser) {
          return reply.code(404).send({
            success: false,
            error: "Commercial introuvable dans Supabase.",
          });
        }

        if (!queueUser.org_id) {
          return reply.code(400).send({
            success: false,
            error: "Ce commercial n'est rattache a aucune organisation.",
          });
        }

        const prospectsQueryStartedAtMs = getNowMs();
        const { data: prospects, error: prospectsError } = await supabase
          .from("prospects")
          .select(
            "id, name, title, company, deal_amount, deal_stage, close_probability, last_contact_at, next_action, ai_summary, ai_priority_score, snoozed_until, created_at",
          )
          .eq("org_id", queueUser.org_id)
          .eq("owner_user_id", queueUser.id)
          .is("skipped_at", null)
          .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
          .order("ai_priority_score", { ascending: false })
          .order("last_contact_at", { ascending: true, nullsFirst: true })
          .limit(QUEUE_MAX_PROSPECTS);
        const prospectsQueryDurationMs = formatDurationMs(prospectsQueryStartedAtMs);
        const queueRows = (prospects ?? []) as QueueProspectRow[];

        if (prospectsError) {
          request.log.error(
            { error: prospectsError, userId, orgId: queueUser.org_id },
            "Erreur Supabase lors du chargement des prospects.",
          );

          return reply.code(500).send({
            success: false,
            error: "Impossible de charger la queue depuis Supabase.",
          });
        }

        const mappingStartedAtMs = getNowMs();
        const queueProspects: QueueProspect[] = queueRows.map((prospect) => ({
          id: prospect.id,
          name: prospect.name,
          title: prospect.title ?? "Titre non renseigne",
          company: prospect.company ?? "Entreprise non renseignee",
          dealAmount: prospect.deal_amount ?? 0,
          dealStage: prospect.deal_stage ?? "Stage non renseigne",
          closeProbability: prospect.close_probability,
          closeDate: null,
          lastContactAt: prospect.last_contact_at ?? prospect.created_at,
          nextAction: prospect.next_action ?? "Aucune action recommandee",
          reason: buildReason(prospect.ai_summary, prospect.next_action),
          priority: getPriority(prospect.ai_priority_score),
        }));
        const mappingDurationMs = formatDurationMs(mappingStartedAtMs);

        const payload: QueueData = {
          userId: queueUser.id,
          generatedAt: nowIso,
          prospects: queueProspects,
        };

        queueCache.set(userId, {
          expiresAt: Date.now() + QUEUE_CACHE_TTL_MS,
          payload,
        });

        const totalDurationMs = formatDurationMs(requestStartedAtMs);
        reply.header(
          "Server-Timing",
          `total;dur=${totalDurationMs}, user;dur=${userQueryDurationMs}, prospects;dur=${prospectsQueryDurationMs}, map;dur=${mappingDurationMs}`,
        );
        reply.header("X-Response-Time-Ms", String(totalDurationMs));
        request.log.info(
          {
            userId,
            orgId: queueUser.org_id,
            durationMs: totalDurationMs,
            userQueryDurationMs,
            prospectsQueryDurationMs,
            mappingDurationMs,
            rowCount: queueRows.length,
            cacheHit: false,
          },
          "Queue chargee.",
        );

        return reply.send({
          success: true,
          data: payload,
        });
      } catch (error) {
        request.log.error({ error, userId }, "Impossible de charger la morning queue reelle.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur inconnue pendant le chargement de la queue.",
        });
      }
    },
  );
};
