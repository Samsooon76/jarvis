import type { QueueData, QueueProspect } from "@jarvis/shared";
import { env } from "../config/env.js";
import { getSupabaseAdmin } from "../db/client.js";
import type { Json } from "../db/database.types.js";
import { scoreProspect } from "./scoring.service.js";
import { computeWinActivityGapCounts } from "./win-analysis.service.js";

type QueueUserRow = {
  id: string;
  org_id: string | null;
  hubspot_owner_id?: string | null;
};

type QueueProspectRow = {
  ai_priority_score: number;
  ai_summary: string | null;
  close_probability: number;
  company: string | null;
  created_at: string;
  deal_amount: number | null;
  deal_stage: string | null;
  email: string | null;
  hubspot_deal_id: string | null;
  id: string;
  last_contact_at: string | null;
  name: string;
  next_action: string | null;
  phone: string | null;
  raw_data: Json;
  skipped_at: string | null;
  snoozed_until: string | null;
  synced_at: string;
  title: string | null;
};

type QueueCacheEntry = {
  expiresAt: number;
  payload: QueueData;
};

export type QueueDebugData = {
  userId: string;
  supabaseConfigured: boolean;
  userFound: boolean;
  orgId: string | null;
  hubspotOwnerId: string | null;
  ownerMatched: boolean;
  totalProspectsForOrg: number;
  prospectsForUser: number;
  activeProspects: number;
  snoozedCount: number;
  skippedCount: number;
  generatedAt: string;
};

const QUEUE_CACHE_TTL_MS = 30_000;
const QUEUE_MAX_PROSPECTS = 50;
const queueCache = new Map<string, QueueCacheEntry>();

const readRawString = (rawData: Json, key: string): string | null => {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    return null;
  }

  const value = rawData[key];

  return typeof value === "string" && value.trim() ? value : null;
};

const mapQueueProspect = (prospect: QueueProspectRow, winActivityGapCount: number | null = null): QueueProspect => {
  const dealName = readRawString(prospect.raw_data, "dealName");
  const closeDate = readRawString(prospect.raw_data, "closedAt") ?? readRawString(prospect.raw_data, "closeDate");
  const scoring = scoreProspect({
    winActivityGapCount,
    dealAmount: prospect.deal_amount,
    closeProbability: prospect.close_probability,
    dealStage: prospect.deal_stage,
    lastContactAt: prospect.last_contact_at,
    closeDate,
    snoozedUntil: prospect.snoozed_until,
    skippedAt: prospect.skipped_at,
    aiSummary: prospect.ai_summary,
    nextAction: prospect.next_action,
    dealName: dealName ?? prospect.hubspot_deal_id,
  });

  return {
    id: prospect.id,
    name: prospect.name,
    title: prospect.title ?? "Titre non renseigne",
    company: prospect.company ?? dealName ?? "Entreprise non renseignee",
    dealAmount: prospect.deal_amount ?? 0,
    dealStage: prospect.deal_stage ?? "Stage non renseigne",
    closeProbability: prospect.close_probability,
    closeDate,
    lastContactAt: prospect.last_contact_at ?? prospect.synced_at ?? prospect.created_at,
    nextAction: scoring.next_action,
    reason: scoring.reason,
    priority: scoring.priority,
    email: prospect.email,
    phone: prospect.phone,
    dealName,
    hubspotDealId: prospect.hubspot_deal_id,
  };
};

export const invalidateQueueCache = (userId?: string | null): void => {
  if (userId) {
    queueCache.delete(userId);
    return;
  }

  queueCache.clear();
};

export const getUserQueue = async (userId: string): Promise<{ payload: QueueData; cacheHit: boolean }> => {
  const cachedQueue = queueCache.get(userId);

  if (cachedQueue && cachedQueue.expiresAt > Date.now()) {
    return { payload: cachedQueue.payload, cacheHit: true };
  }

  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new Error("Supabase n'est pas configure. La queue reelle est indisponible.");
  }

  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, org_id")
    .eq("id", userId)
    .maybeSingle();

  if (userError) {
    throw new Error(`Impossible de charger le commercial depuis Supabase: ${userError.message}`);
  }

  const queueUser = user as QueueUserRow | null;

  if (!queueUser) {
    throw new Error("Commercial introuvable dans Supabase.");
  }

  if (!queueUser.org_id) {
    throw new Error("Ce commercial n'est rattache a aucune organisation.");
  }

  const { data: prospects, error: prospectsError } = await supabase.rpc("get_user_queue", {
    target_user_id: queueUser.id,
    max_rows: QUEUE_MAX_PROSPECTS,
  });

  if (prospectsError) {
    throw new Error(`Impossible de charger la queue depuis Supabase: ${prospectsError.message}`);
  }

  const prospectRows = (prospects ?? []) as QueueProspectRow[];
  // Boucle Win Analysis: les deals en retard d'activite vs le pattern gagnant
  // remontent dans la queue. Best-effort (map vide si benchmark non significatif).
  const winGapCounts = await computeWinActivityGapCounts(
    queueUser.org_id,
    prospectRows.map((prospect) => prospect.hubspot_deal_id).filter((value): value is string => Boolean(value)),
  );
  const queueProspects = prospectRows.map((prospect) =>
    mapQueueProspect(prospect, prospect.hubspot_deal_id ? winGapCounts.get(prospect.hubspot_deal_id) ?? null : null),
  );
  const payload: QueueData = {
    userId: queueUser.id,
    generatedAt: nowIso,
    prospects: queueProspects,
  };

  queueCache.set(userId, {
    expiresAt: Date.now() + QUEUE_CACHE_TTL_MS,
    payload,
  });

  return { payload, cacheHit: false };
};

export const getQueueDebug = async (userId: string): Promise<QueueDebugData> => {
  const generatedAt = new Date().toISOString();

  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    return {
      userId,
      supabaseConfigured: false,
      userFound: false,
      orgId: null,
      hubspotOwnerId: null,
      ownerMatched: false,
      totalProspectsForOrg: 0,
      prospectsForUser: 0,
      activeProspects: 0,
      snoozedCount: 0,
      skippedCount: 0,
      generatedAt,
    };
  }

  const supabase = getSupabaseAdmin();
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, org_id, hubspot_owner_id")
    .eq("id", userId)
    .maybeSingle();

  if (userError) {
    throw new Error(`Impossible de charger le diagnostic user: ${userError.message}`);
  }

  const queueUser = user as QueueUserRow | null;

  if (!queueUser?.org_id) {
    return {
      userId,
      supabaseConfigured: true,
      userFound: Boolean(queueUser),
      orgId: queueUser?.org_id ?? null,
      hubspotOwnerId: queueUser?.hubspot_owner_id ?? null,
      ownerMatched: false,
      totalProspectsForOrg: 0,
      prospectsForUser: 0,
      activeProspects: 0,
      snoozedCount: 0,
      skippedCount: 0,
      generatedAt,
    };
  }

  const nowIso = generatedAt;
  const [total, forUser, active, snoozed, skipped] = await Promise.all([
    supabase.from("prospects").select("id", { count: "exact", head: true }).eq("org_id", queueUser.org_id),
    supabase.from("prospects").select("id", { count: "exact", head: true }).eq("org_id", queueUser.org_id).eq("owner_user_id", userId),
    supabase
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .eq("org_id", queueUser.org_id)
      .eq("owner_user_id", userId)
      .is("skipped_at", null)
      .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`),
    supabase
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .eq("org_id", queueUser.org_id)
      .eq("owner_user_id", userId)
      .gt("snoozed_until", nowIso),
    supabase
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .eq("org_id", queueUser.org_id)
      .eq("owner_user_id", userId)
      .not("skipped_at", "is", null),
  ]);

  const errors = [total.error, forUser.error, active.error, snoozed.error, skipped.error].filter(Boolean);

  if (errors.length > 0) {
    throw new Error(`Impossible de calculer le diagnostic queue: ${errors[0]?.message ?? "erreur Supabase"}`);
  }

  return {
    userId,
    supabaseConfigured: true,
    userFound: true,
    orgId: queueUser.org_id,
    hubspotOwnerId: queueUser.hubspot_owner_id ?? null,
    ownerMatched: Boolean(queueUser.hubspot_owner_id),
    totalProspectsForOrg: total.count ?? 0,
    prospectsForUser: forUser.count ?? 0,
    activeProspects: active.count ?? 0,
    snoozedCount: snoozed.count ?? 0,
    skippedCount: skipped.count ?? 0,
    generatedAt,
  };
};
