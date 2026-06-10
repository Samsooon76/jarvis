import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { getSupabaseAdmin } from "../db/client.js";

// Capture quotidienne des deals ouverts pour le tracking forecast vs realite.
// 100% deterministe: probas et categories IA lues depuis les caches existants
// (deal_ai_analyses, forecast_synthesis); aucune analyse LLM declenchee ici.

const QUEUE_NAME = "forecast-maintenance";
const CAPTURE_JOB_NAME = "capture-forecast-snapshots";
// Tous les jours a 05:00 UTC, apres les syncs nocturnes.
const CAPTURE_CRON_PATTERN = "0 5 * * *";
const IN_MEMORY_CAPTURE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_RETENTION_MONTHS = 18;
const SNAPSHOT_BATCH_SIZE = 500;

type LoggerLike = {
  info: (payload: object, message?: string) => void;
  warn: (payload: object, message?: string) => void;
  error: (payload: object, message?: string) => void;
};

type SnapshotDealRow = {
  hubspot_deal_id: string;
  hubspot_owner_id: string | null;
  amount: number | string | null;
  deal_stage: string | null;
  deal_stage_label: string | null;
  deal_lifecycle_status: "pending" | "won" | "lost" | null;
  is_closed_deal: boolean | null;
  close_probability: number | null;
  closed_at: string | null;
};

type AiAnalysisRow = {
  hubspot_deal_id: string;
  close_won_probability: number | null;
};

type SynthesisRow = {
  analysis: {
    deals?: Array<{ hubspotDealId?: string; category?: string }>;
  } | null;
};

type OwnerUserRow = {
  id: string;
  hubspot_owner_id: string | null;
};

const AI_CATEGORIES = new Set(["commit", "bestCase", "atRisk", "slipping"]);

let scheduler: { queue: Queue; worker: Worker } | null = null;
let inMemoryTimer: NodeJS.Timeout | null = null;

const getDealStageText = (deal: SnapshotDealRow): string =>
  (deal.deal_stage_label ?? deal.deal_stage ?? "").toLowerCase();

const isLostDeal = (deal: SnapshotDealRow): boolean =>
  deal.deal_lifecycle_status === "lost" || getDealStageText(deal).includes("lost") || getDealStageText(deal).includes("perdu");

const isWonDeal = (deal: SnapshotDealRow): boolean =>
  !isLostDeal(deal) && (deal.deal_lifecycle_status === "won" || deal.is_closed_deal === true);

const isOpenDeal = (deal: SnapshotDealRow): boolean => !isWonDeal(deal) && !isLostDeal(deal);

const parseAmount = (value: number | string | null): number | null => {
  const parsed = typeof value === "string" ? Number(value) : value;

  return parsed !== null && Number.isFinite(parsed) ? Number(parsed) : null;
};

const toForecastPeriod = (closeDate: string | null): string | null =>
  closeDate ? closeDate.slice(0, 7) : null;

const loadOpenDeals = async (orgId: string): Promise<SnapshotDealRow[]> => {
  const { data, error } = await getSupabaseAdmin()
    .from("hubspot_deals")
    .select(
      "hubspot_deal_id, hubspot_owner_id, amount, deal_stage, deal_stage_label, deal_lifecycle_status, is_closed_deal, close_probability, closed_at",
    )
    .eq("org_id", orgId)
    .limit(10000);

  if (error) {
    throw new Error(`Impossible de charger les deals pour les snapshots forecast: ${error.message}`);
  }

  return ((data ?? []) as SnapshotDealRow[]).filter(isOpenDeal);
};

// Probabilite IA depuis le cache deal_ai_analyses (jamais d'analyse declenchee).
const loadAiProbabilities = async (orgId: string, hubspotDealIds: string[]): Promise<Map<string, number>> => {
  if (hubspotDealIds.length === 0) {
    return new Map();
  }

  const { data, error } = await getSupabaseAdmin()
    .from("deal_ai_analyses")
    .select("hubspot_deal_id, close_won_probability")
    .eq("org_id", orgId)
    .eq("analysis_type", "deal_intelligence")
    .in("hubspot_deal_id", hubspotDealIds)
    .order("generated_at", { ascending: false });

  if (error) {
    return new Map();
  }

  const probabilityByDealId = new Map<string, number>();

  for (const row of (data ?? []) as AiAnalysisRow[]) {
    if (!probabilityByDealId.has(row.hubspot_deal_id) && row.close_won_probability !== null) {
      probabilityByDealId.set(row.hubspot_deal_id, row.close_won_probability);
    }
  }

  return probabilityByDealId;
};

// Categorie IA (commit/bestCase/atRisk/slipping) depuis le cache forecast_synthesis.
const loadAiCategories = async (orgId: string): Promise<Map<string, string>> => {
  const { data, error } = await getSupabaseAdmin()
    .from("forecast_synthesis")
    .select("analysis")
    .eq("org_id", orgId)
    .order("generated_at", { ascending: false })
    .limit(20);

  if (error) {
    return new Map();
  }

  const categoryByDealId = new Map<string, string>();

  // Les syntheses les plus recentes priment (rows triees par generated_at desc).
  for (const row of (data ?? []) as SynthesisRow[]) {
    for (const deal of row.analysis?.deals ?? []) {
      if (deal.hubspotDealId && deal.category && AI_CATEGORIES.has(deal.category) && !categoryByDealId.has(deal.hubspotDealId)) {
        categoryByDealId.set(deal.hubspotDealId, deal.category);
      }
    }
  }

  return categoryByDealId;
};

const loadOwnerUserIds = async (orgId: string): Promise<Map<string, string>> => {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("id, hubspot_owner_id")
    .eq("org_id", orgId)
    .not("hubspot_owner_id", "is", null);

  if (error) {
    throw new Error(`Impossible de charger les owners pour les snapshots forecast: ${error.message}`);
  }

  return new Map(
    ((data ?? []) as OwnerUserRow[])
      .filter((user) => user.hubspot_owner_id)
      .map((user) => [user.hubspot_owner_id as string, user.id]),
  );
};

const purgeOldSnapshots = async (orgId: string): Promise<void> => {
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - SNAPSHOT_RETENTION_MONTHS);

  const { error } = await getSupabaseAdmin()
    .from("forecast_snapshots")
    .delete()
    .eq("org_id", orgId)
    .lt("created_at", cutoff.toISOString());

  if (error) {
    throw new Error(`Impossible de purger les snapshots forecast: ${error.message}`);
  }
};

// Photographie les deals ouverts d'une org. Idempotent: la contrainte unique
// (org, deal, date) garantit qu'un re-run du meme jour n'ecrit rien de neuf.
export const captureForecastSnapshots = async (orgId: string): Promise<number> => {
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const openDeals = await loadOpenDeals(orgId);

  if (openDeals.length === 0) {
    return 0;
  }

  const [aiProbabilities, aiCategories, ownerUserIds] = await Promise.all([
    loadAiProbabilities(
      orgId,
      openDeals.map((deal) => deal.hubspot_deal_id),
    ),
    loadAiCategories(orgId),
    loadOwnerUserIds(orgId),
  ]);

  const rows = openDeals.map((deal) => {
    const closeDate = deal.closed_at ? deal.closed_at.slice(0, 10) : null;

    return {
      org_id: orgId,
      snapshot_date: snapshotDate,
      hubspot_deal_id: deal.hubspot_deal_id,
      owner_user_id: deal.hubspot_owner_id ? ownerUserIds.get(deal.hubspot_owner_id) ?? null : null,
      hubspot_owner_id: deal.hubspot_owner_id,
      deal_stage: deal.deal_stage_label ?? deal.deal_stage,
      amount: parseAmount(deal.amount),
      close_date: closeDate,
      crm_probability: deal.close_probability,
      ai_probability: aiProbabilities.get(deal.hubspot_deal_id) ?? null,
      ai_category: aiCategories.get(deal.hubspot_deal_id) ?? null,
      forecast_period: toForecastPeriod(closeDate),
    };
  });

  for (let index = 0; index < rows.length; index += SNAPSHOT_BATCH_SIZE) {
    const { error } = await getSupabaseAdmin()
      .from("forecast_snapshots")
      .upsert(rows.slice(index, index + SNAPSHOT_BATCH_SIZE), {
        onConflict: "org_id,hubspot_deal_id,snapshot_date",
        ignoreDuplicates: true,
      });

    if (error) {
      throw new Error(`Impossible d'ecrire les snapshots forecast: ${error.message}`);
    }
  }

  await purgeOldSnapshots(orgId);

  return rows.length;
};

export const captureForecastSnapshotsForAllOrgs = async (logger?: LoggerLike): Promise<void> => {
  const { data, error } = await getSupabaseAdmin().from("organizations").select("id");

  if (error) {
    throw new Error(`Impossible de lister les organisations pour les snapshots forecast: ${error.message}`);
  }

  for (const org of (data ?? []) as Array<{ id: string }>) {
    try {
      const count = await captureForecastSnapshots(org.id);

      logger?.info({ orgId: org.id, count }, "Snapshots forecast captures.");
    } catch (captureError) {
      logger?.error({ orgId: org.id, error: captureError }, "Capture des snapshots forecast en echec.");
    }
  }
};

// Resolution a la cloture: fige la realite (won/lost, montant final) sur tous
// les snapshots non resolus du deal. Appelee par le processor webhook quand le
// stage change, APRES application de la nouvelle valeur en base.
export const resolveForecastSnapshotsForDeal = async (orgId: string, hubspotDealId: string): Promise<void> => {
  const { data, error } = await getSupabaseAdmin()
    .from("hubspot_deals")
    .select(
      "hubspot_deal_id, hubspot_owner_id, amount, deal_stage, deal_stage_label, deal_lifecycle_status, is_closed_deal, close_probability, closed_at",
    )
    .eq("org_id", orgId)
    .eq("hubspot_deal_id", hubspotDealId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le deal pour la resolution des snapshots: ${error.message}`);
  }

  const deal = data as SnapshotDealRow | null;

  if (!deal || isOpenDeal(deal)) {
    return;
  }

  const outcome = isWonDeal(deal) ? "won" : "lost";
  const now = new Date().toISOString();
  const { error: updateError } = await getSupabaseAdmin()
    .from("forecast_snapshots")
    .update({
      outcome,
      final_amount: parseAmount(deal.amount),
      closed_at: deal.closed_at ?? now,
      resolved_at: now,
    })
    .eq("org_id", orgId)
    .eq("hubspot_deal_id", hubspotDealId)
    .is("resolved_at", null);

  if (updateError) {
    throw new Error(`Impossible de resoudre les snapshots forecast: ${updateError.message}`);
  }
};

// Planifie la capture quotidienne: job BullMQ repeatable si Redis est configure,
// sinon (dev/test) un timer en memoire.
export const startForecastSnapshotScheduler = (logger: LoggerLike): void => {
  if (scheduler || inMemoryTimer) {
    return;
  }

  if (env.redisUrl) {
    const connection = new Redis(env.redisUrl, { maxRetriesPerRequest: null });
    const queue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    });
    const worker = new Worker(
      QUEUE_NAME,
      async () => {
        await captureForecastSnapshotsForAllOrgs(logger);
      },
      { connection, concurrency: 1 },
    );

    worker.on("failed", (_job, error) => {
      logger.error({ error, queue: QUEUE_NAME }, "Job de snapshots forecast en echec.");
    });

    void queue
      .add(
        CAPTURE_JOB_NAME,
        {},
        {
          repeat: { pattern: CAPTURE_CRON_PATTERN },
          jobId: CAPTURE_JOB_NAME,
        },
      )
      .then(() => {
        logger.info({ queue: QUEUE_NAME, pattern: CAPTURE_CRON_PATTERN }, "Capture quotidienne des snapshots forecast planifiee.");
      })
      .catch((error: unknown) => {
        logger.error({ error, queue: QUEUE_NAME }, "Impossible de planifier la capture des snapshots forecast.");
      });

    scheduler = { queue, worker };
    return;
  }

  if (env.nodeEnv !== "development" && env.nodeEnv !== "test") {
    logger.warn(
      { queue: QUEUE_NAME },
      "REDIS_URL absent: la capture quotidienne des snapshots forecast n'est pas planifiee.",
    );
    return;
  }

  // Dev/test: timer en memoire; l'idempotence par (org, deal, date) rend les
  // executions multiples inoffensives.
  inMemoryTimer = setInterval(() => {
    void captureForecastSnapshotsForAllOrgs(logger).catch((error: unknown) => {
      logger.error({ error }, "Capture en memoire des snapshots forecast en echec.");
    });
  }, IN_MEMORY_CAPTURE_INTERVAL_MS);
  inMemoryTimer.unref();
};
