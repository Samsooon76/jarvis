import { createHash } from "node:crypto";
import type { ManagerDigest, ManagerDigestHistoryEntry, ManagerDigestPeriod } from "@jarvis/shared";
import { getSupabaseAdmin } from "../db/client.js";
import { createLlmProvider } from "./llm/provider.factory.js";
import { resolveLlmProviderPreference } from "./llm/provider-preference.service.js";
import type { ManagerDigestAnalysis } from "./llm/llm.provider.js";

// Digest manager: 1 seul appel LLM par (org, destinataire, periode), construit
// uniquement a partir de donnees deja calculees (pulse_notifications, verdicts
// forecast en cache, daily_kpis). Aucun appel LLM par deal.

export type ManagerDigestRecipient = {
  userId: string;
  orgId: string;
  role: "manager" | "admin";
};

type PulseMovementRow = {
  hubspot_deal_id: string;
  deal_name: string | null;
  event_type: string;
  message: string;
  occurred_at: string;
  source_event_id: string;
};

type ForecastSynthesisSourceRow = {
  analysis: {
    deals?: Array<{
      hubspotDealId?: string;
      dealName?: string | null;
      companyName?: string | null;
      amount?: number;
      category?: string;
      reason?: string | null;
      recommendedAction?: string | null;
    }>;
  } | null;
  generated_at: string;
  expires_at: string;
};

type DailyKpiRow = {
  calls_made: number;
  calls_connected: number;
  emails_sent: number;
  meetings_booked: number;
  actions_completed: number;
  deals_moved: number;
  pipeline_value_added: number;
};

type ManagerDigestRow = {
  id: string;
  period: ManagerDigestPeriod;
  date_from: string;
  date_to: string;
  input_hash: string;
  digest: ManagerDigestAnalysis & { stale?: boolean };
  movements: string[];
  movement_count: number;
  provider: string;
  model: string;
  generated_at: string;
};

type ManagerDigestInput = {
  period: ManagerDigestPeriod;
  dateFrom: string;
  dateTo: string;
  teamScopeLabel: string;
  movementsSummary: string;
  movementLines: string[];
  movementCount: number;
  atRiskSummary: string;
  kpisSummary: string;
  knownDealIds: string[];
  // Synthese forecast source plus fraiche que le TTL? Sinon on garde le dernier
  // verdict connu et on marque le digest comme stale plutot que de relancer.
  forecastStale: boolean;
};

const MAX_MOVEMENT_DEALS = 30;
const MAX_AT_RISK_SOURCE_DEALS = 15;
const FORECAST_SOURCE_STALE_HOURS = 6;
const DIGEST_HISTORY_DEFAULT_LIMIT = 10;
const DIGEST_HISTORY_MAX_LIMIT = 50;

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

export const getManagerDigestDateRange = (period: ManagerDigestPeriod): { dateFrom: string; dateTo: string } => {
  const now = new Date();
  const dateTo = toIsoDate(now);

  if (period === "daily") {
    return { dateFrom: dateTo, dateTo };
  }

  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 6);

  return { dateFrom: toIsoDate(from), dateTo };
};

const loadRecipientHubSpotOwnerId = async (recipient: ManagerDigestRecipient): Promise<string | null> => {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("hubspot_owner_id")
    .eq("org_id", recipient.orgId)
    .eq("id", recipient.userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le profil du destinataire du digest: ${error.message}`);
  }

  return (data as { hubspot_owner_id: string | null } | null)?.hubspot_owner_id ?? null;
};

// Mouvements de la periode: notifications Pulse deja persistees, dedupliquees
// par evenement source puis agregees par deal (1 ligne par deal).
const loadMovements = async (
  recipient: ManagerDigestRecipient,
  dateFrom: string,
  dateTo: string,
): Promise<{ lines: string[]; movementCount: number; dealIds: string[] }> => {
  let query = getSupabaseAdmin()
    .from("pulse_notifications")
    .select("hubspot_deal_id, deal_name, event_type, message, occurred_at, source_event_id")
    .eq("org_id", recipient.orgId)
    .gte("occurred_at", `${dateFrom}T00:00:00Z`)
    .lte("occurred_at", `${dateTo}T23:59:59Z`)
    .order("occurred_at", { ascending: false })
    .limit(1000);

  // Manager: son propre flux Pulse (deals de son scope). Admin: toute l'org.
  if (recipient.role !== "admin") {
    query = query.eq("user_id", recipient.userId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Impossible de charger les mouvements du digest: ${error.message}`);
  }

  const rows = (data ?? []) as PulseMovementRow[];
  const seenEvents = new Set<string>();
  const byDeal = new Map<string, { dealName: string | null; messages: string[]; count: number }>();

  for (const row of rows) {
    if (seenEvents.has(row.source_event_id)) {
      continue;
    }

    seenEvents.add(row.source_event_id);
    const entry = byDeal.get(row.hubspot_deal_id) ?? { dealName: row.deal_name, messages: [], count: 0 };
    entry.count += 1;

    if (entry.messages.length < 3 && !entry.messages.includes(row.message)) {
      entry.messages.push(row.message);
    }

    byDeal.set(row.hubspot_deal_id, entry);
  }

  const lines = Array.from(byDeal.entries())
    .sort((left, right) => right[1].count - left[1].count)
    .slice(0, MAX_MOVEMENT_DEALS)
    .map(([dealId, entry]) =>
      [
        `id=${dealId}`,
        entry.dealName ?? "Deal sans nom",
        `${entry.count} changement${entry.count > 1 ? "s" : ""}`,
        entry.messages.join(" ; "),
      ].join(" | "),
    );

  return { lines, movementCount: seenEvents.size, dealIds: Array.from(byDeal.keys()) };
};

// Deals a risque: derniere synthese forecast en cache (aucune analyse relancee).
const loadAtRiskFromForecastCache = async (
  recipient: ManagerDigestRecipient,
  hubspotOwnerId: string | null,
): Promise<{ summary: string; dealIds: string[]; dealNamesById: Map<string, string>; stale: boolean }> => {
  const empty = { summary: "", dealIds: [] as string[], dealNamesById: new Map<string, string>(), stale: false };
  let query = getSupabaseAdmin()
    .from("forecast_synthesis")
    .select("analysis, generated_at, expires_at")
    .eq("org_id", recipient.orgId)
    .order("generated_at", { ascending: false })
    .limit(1);

  // Manager rattache a un owner HubSpot: sa synthese owner. Sinon synthese org.
  if (recipient.role !== "admin" && hubspotOwnerId) {
    query = query.eq("scope", "owner").eq("hubspot_owner_id", hubspotOwnerId);
  } else {
    query = query.eq("scope", "all");
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    // Table absente ou pas encore migree: le digest reste utilisable sans section risque.
    return empty;
  }

  const row = data as ForecastSynthesisSourceRow | null;
  const deals = row?.analysis?.deals ?? [];

  if (!row || deals.length === 0) {
    return empty;
  }

  const staleCutoff = Date.now() - FORECAST_SOURCE_STALE_HOURS * 60 * 60 * 1000;
  const stale = new Date(row.generated_at).getTime() < staleCutoff;
  const atRiskDeals = deals
    .filter((deal) => deal.category === "atRisk" || deal.category === "slipping")
    .filter((deal): deal is typeof deal & { hubspotDealId: string } => Boolean(deal.hubspotDealId))
    .slice(0, MAX_AT_RISK_SOURCE_DEALS);

  const dealNamesById = new Map<string, string>();
  const lines = atRiskDeals.map((deal) => {
    const dealName = deal.dealName ?? deal.companyName ?? `Deal ${deal.hubspotDealId}`;
    dealNamesById.set(deal.hubspotDealId, dealName);

    return [
      `id=${deal.hubspotDealId}`,
      dealName,
      `montant=${Math.round(deal.amount ?? 0)}`,
      `categorie=${deal.category}`,
      `raison=${deal.reason ?? "n/a"}`,
      `action=${deal.recommendedAction ?? "n/a"}`,
    ].join(" | ");
  });

  return {
    summary: lines.join("\n"),
    dealIds: atRiskDeals.map((deal) => deal.hubspotDealId),
    dealNamesById,
    stale,
  };
};

const loadKpisSummary = async (orgId: string, dateFrom: string, dateTo: string): Promise<string> => {
  const { data, error } = await getSupabaseAdmin()
    .from("daily_kpis")
    .select("calls_made, calls_connected, emails_sent, meetings_booked, actions_completed, deals_moved, pipeline_value_added")
    .eq("org_id", orgId)
    .gte("date", dateFrom)
    .lte("date", dateTo);

  if (error) {
    throw new Error(`Impossible de charger les KPIs du digest: ${error.message}`);
  }

  const rows = (data ?? []) as DailyKpiRow[];

  if (rows.length === 0) {
    return "";
  }

  const totals = rows.reduce(
    (sum, row) => ({
      callsMade: sum.callsMade + row.calls_made,
      callsConnected: sum.callsConnected + row.calls_connected,
      emailsSent: sum.emailsSent + row.emails_sent,
      meetingsBooked: sum.meetingsBooked + row.meetings_booked,
      actionsCompleted: sum.actionsCompleted + row.actions_completed,
      dealsMoved: sum.dealsMoved + row.deals_moved,
      pipelineValueAdded: sum.pipelineValueAdded + Number(row.pipeline_value_added ?? 0),
    }),
    {
      callsMade: 0,
      callsConnected: 0,
      emailsSent: 0,
      meetingsBooked: 0,
      actionsCompleted: 0,
      dealsMoved: 0,
      pipelineValueAdded: 0,
    },
  );

  return [
    `appels=${totals.callsMade} (connectes=${totals.callsConnected})`,
    `emails=${totals.emailsSent}`,
    `meetings=${totals.meetingsBooked}`,
    `actions terminees=${totals.actionsCompleted}`,
    `deals bouges=${totals.dealsMoved}`,
    `pipeline ajoute=${Math.round(totals.pipelineValueAdded)}`,
  ].join(" | ");
};

export const buildDigestInput = async (
  recipient: ManagerDigestRecipient,
  period: ManagerDigestPeriod,
): Promise<ManagerDigestInput> => {
  const { dateFrom, dateTo } = getManagerDigestDateRange(period);
  const hubspotOwnerId = await loadRecipientHubSpotOwnerId(recipient);
  const [movements, atRisk, kpisSummary] = await Promise.all([
    loadMovements(recipient, dateFrom, dateTo),
    loadAtRiskFromForecastCache(recipient, hubspotOwnerId),
    loadKpisSummary(recipient.orgId, dateFrom, dateTo),
  ]);

  return {
    period,
    dateFrom,
    dateTo,
    teamScopeLabel:
      recipient.role === "admin" ? "Organisation complete" : "Deals assignes au manager",
    movementsSummary: movements.lines.join("\n"),
    movementLines: movements.lines,
    movementCount: movements.movementCount,
    atRiskSummary: atRisk.summary,
    kpisSummary,
    knownDealIds: Array.from(new Set([...movements.dealIds, ...atRisk.dealIds])),
    forecastStale: atRisk.stale,
  };
};

const buildDigestInputHash = (input: ManagerDigestInput): string =>
  createHash("sha256")
    .update(
      [input.period, input.dateFrom, input.dateTo, input.movementsSummary, input.atRiskSummary, input.kpisSummary].join(
        "\n--\n",
      ),
    )
    .digest("hex");

const toManagerDigest = (row: ManagerDigestRow, stale: boolean): ManagerDigest => ({
  id: row.id,
  period: row.period,
  dateFrom: row.date_from,
  dateTo: row.date_to,
  generatedAt: row.generated_at,
  provider: row.provider,
  model: row.model,
  stale,
  movementCount: row.movement_count,
  movements: row.movements ?? [],
  digest: row.digest,
});

// Periode sans mouvement ni risque: digest statique, aucun appel LLM.
const buildEmptyDigestAnalysis = (input: ManagerDigestInput): ManagerDigestAnalysis => ({
  headline:
    input.period === "daily"
      ? "Rien a signaler aujourd'hui: aucun mouvement detecte sur votre perimetre."
      : "Rien a signaler cette semaine: aucun mouvement detecte sur votre perimetre.",
  highlights: [],
  atRiskDeals: [],
  assistDeals: [],
  teamPulse: input.kpisSummary
    ? `Activite de la periode: ${input.kpisSummary}.`
    : "Aucune donnee d'activite disponible sur la periode.",
  confidence: "high",
});

const loadStoredDigest = async (
  recipient: ManagerDigestRecipient,
  period: ManagerDigestPeriod,
  dateFrom: string,
  inputHash: string,
): Promise<ManagerDigestRow | null> => {
  const { data, error } = await getSupabaseAdmin()
    .from("manager_digests")
    .select("id, period, date_from, date_to, input_hash, digest, movements, movement_count, provider, model, generated_at")
    .eq("org_id", recipient.orgId)
    .eq("user_id", recipient.userId)
    .eq("period", period)
    .eq("date_from", dateFrom)
    .eq("input_hash", inputHash)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le digest manager: ${error.message}`);
  }

  return (data as ManagerDigestRow | null) ?? null;
};

export const getOrCreateManagerDigest = async (
  recipient: ManagerDigestRecipient,
  period: ManagerDigestPeriod,
): Promise<ManagerDigest> => {
  const input = await buildDigestInput(recipient, period);
  const inputHash = buildDigestInputHash(input);

  // Cache: memes inputs -> meme digest, cout LLM nul.
  const stored = await loadStoredDigest(recipient, period, input.dateFrom, inputHash);

  if (stored) {
    return toManagerDigest(stored, input.forecastStale);
  }

  const preference = await resolveLlmProviderPreference(recipient.orgId);
  const provider = createLlmProvider({ provider: preference.provider, model: preference.model });

  const hasContent = input.movementsSummary.length > 0 || input.atRiskSummary.length > 0;
  const analysis = hasContent
    ? await provider.analyzeManagerDigest({
        movementsSummary: input.movementsSummary,
        atRiskSummary: input.atRiskSummary,
        kpisSummary: input.kpisSummary,
        period: input.period,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        teamScopeLabel: input.teamScopeLabel,
        knownDealIds: input.knownDealIds,
      })
    : buildEmptyDigestAnalysis(input);

  const generatedAt = new Date().toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("manager_digests")
    .upsert(
      {
        org_id: recipient.orgId,
        user_id: recipient.userId,
        period: input.period,
        date_from: input.dateFrom,
        date_to: input.dateTo,
        input_hash: inputHash,
        digest: analysis,
        movements: input.movementLines,
        movement_count: input.movementCount,
        provider: provider.providerName,
        model: provider.modelName,
        generated_at: generatedAt,
      },
      { onConflict: "org_id,user_id,period,date_from,input_hash" },
    )
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de sauvegarder le digest manager: ${error.message}`);
  }

  return {
    id: (data as { id: string } | null)?.id ?? null,
    period: input.period,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    generatedAt,
    provider: provider.providerName,
    model: provider.modelName,
    stale: input.forecastStale,
    movementCount: input.movementCount,
    movements: input.movementLines,
    digest: analysis,
  };
};

export const listManagerDigestHistory = async (
  recipient: ManagerDigestRecipient,
  limit?: number,
): Promise<ManagerDigestHistoryEntry[]> => {
  const effectiveLimit = Math.min(Math.max(limit ?? DIGEST_HISTORY_DEFAULT_LIMIT, 1), DIGEST_HISTORY_MAX_LIMIT);
  const { data, error } = await getSupabaseAdmin()
    .from("manager_digests")
    .select("id, period, date_from, date_to, digest, generated_at")
    .eq("org_id", recipient.orgId)
    .eq("user_id", recipient.userId)
    .order("generated_at", { ascending: false })
    .limit(effectiveLimit);

  if (error) {
    throw new Error(`Impossible de charger l'historique des digests: ${error.message}`);
  }

  return ((data ?? []) as Array<Pick<ManagerDigestRow, "id" | "period" | "date_from" | "date_to" | "digest" | "generated_at">>).map(
    (row) => ({
      id: row.id,
      period: row.period,
      dateFrom: row.date_from,
      dateTo: row.date_to,
      generatedAt: row.generated_at,
      headline: row.digest?.headline ?? "",
    }),
  );
};
