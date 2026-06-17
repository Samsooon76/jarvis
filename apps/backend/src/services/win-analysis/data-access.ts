import type { WinAnalysisRun } from "@jarvis/shared";
import { getSupabaseAdmin } from "../../db/client.js";
import {
  CLOSE_WON_ANALYSIS_TYPE,
  isWonDeal,
  mapRunRow,
  MAX_DEALS_PER_RUN,
} from "./shared.js";
import type { ActivityCountRow, CloseWonAnalysisRow, DealContext, HubSpotDealRow, WinRunRow } from "./types.js";

// --- Chargement des deals gagnes ---------------------------------------------

export const loadWonDealContexts = async (
  orgId: string,
  dateFrom: string,
  dateTo: string,
  hubspotDealId?: string | null,
  hubspotOwnerIds?: string[],
): Promise<DealContext[]> => {
  const supabase = getSupabaseAdmin();
  const scopedOwnerIds = Array.from(
    new Set((hubspotOwnerIds ?? []).map((ownerId) => ownerId.trim()).filter(Boolean)),
  );
  let query = supabase
    .from("hubspot_deals")
    .select(
      "hubspot_deal_id, hubspot_owner_id, primary_contact_id, primary_company_id, deal_name, amount, pipeline_label, deal_stage, deal_stage_label, deal_lifecycle_status, is_closed_deal, hubspot_created_at, closed_at, hubspot_updated_at, synced_at",
    )
    .eq("org_id", orgId)
    .order("closed_at", { ascending: false })
    .limit(500);

  if (hubspotDealId) {
    query = query.eq("hubspot_deal_id", hubspotDealId);
  } else {
    query = query
      .not("closed_at", "is", null)
      .gte("closed_at", `${dateFrom}T00:00:00.000Z`)
      .lte("closed_at", `${dateTo}T23:59:59.999Z`);

    if (scopedOwnerIds.length > 0) {
      query = query.in("hubspot_owner_id", scopedOwnerIds);
    }
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Impossible de charger les deals gagnes: ${error.message}`);
  }

  const deals = ((data ?? []) as HubSpotDealRow[]).filter(isWonDeal).slice(0, hubspotDealId ? 1 : MAX_DEALS_PER_RUN);
  const companyIds = Array.from(
    new Set(deals.map((deal) => deal.primary_company_id).filter((value): value is string => Boolean(value))),
  );
  const ownerIds = Array.from(
    new Set(deals.map((deal) => deal.hubspot_owner_id).filter((value): value is string => Boolean(value))),
  );

  const [companiesResult, ownersResult] = await Promise.all([
    companyIds.length > 0
      ? supabase.from("hubspot_companies").select("hubspot_company_id, name").eq("org_id", orgId).in("hubspot_company_id", companyIds)
      : Promise.resolve({ data: [], error: null }),
    ownerIds.length > 0
      ? supabase.from("users").select("hubspot_owner_id, name").eq("org_id", orgId).in("hubspot_owner_id", ownerIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const companyNameById = new Map(
    ((companiesResult.data ?? []) as Array<{ hubspot_company_id: string; name: string | null }>).map((company) => [
      company.hubspot_company_id,
      company.name,
    ]),
  );
  const ownerNameById = new Map(
    ((ownersResult.data ?? []) as Array<{ hubspot_owner_id: string | null; name: string }>)
      .filter((owner) => owner.hubspot_owner_id)
      .map((owner) => [owner.hubspot_owner_id as string, owner.name]),
  );

  return deals.map((row) => ({
    row,
    companyName: row.primary_company_id ? companyNameById.get(row.primary_company_id) ?? null : null,
    ownerName: row.hubspot_owner_id ? ownerNameById.get(row.hubspot_owner_id) ?? null : null,
  }));
};

// --- Cache des analyses close won (deal_ai_analyses) -------------------------

export const loadLatestWinAnalyses = async (
  orgId: string,
  hubspotDealIds: string[],
  provider: string,
  model: string,
): Promise<Map<string, CloseWonAnalysisRow>> => {
  if (hubspotDealIds.length === 0) {
    return new Map();
  }

  const { data, error } = await getSupabaseAdmin()
    .from("deal_ai_analyses")
    .select("hubspot_deal_id, input_hash, analysis, generated_at, expires_at")
    .eq("org_id", orgId)
    .eq("analysis_type", CLOSE_WON_ANALYSIS_TYPE)
    .eq("provider", provider)
    .eq("model", model)
    .in("hubspot_deal_id", hubspotDealIds)
    .order("generated_at", { ascending: false });

  if (error) {
    throw new Error(`Impossible de charger le cache close won: ${error.message}`);
  }

  const latestByDealId = new Map<string, CloseWonAnalysisRow>();

  for (const row of (data ?? []) as CloseWonAnalysisRow[]) {
    if (!latestByDealId.has(row.hubspot_deal_id)) {
      latestByDealId.set(row.hubspot_deal_id, row);
    }
  }

  return latestByDealId;
};

const DEAL_ID_BATCH_SIZE = 200;

type ActivityCountEntry = { calls: number; emails: number; touchpoints: number };

type HubSpotActivityLinkRow = {
  hubspot_deal_id: string;
  activity_type: string;
  hubspot_activity_id: string;
};

type HubSpotActivityRow = {
  hubspot_activity_id: string;
  activity_type: string;
  activity_channel: string | null;
  associated_deal_ids: string[] | null;
};

const createEmptyActivityCount = (): ActivityCountEntry => ({ calls: 0, emails: 0, touchpoints: 0 });

const normalizeActivityChannel = (channel: string | null): string | null => channel?.trim().toUpperCase() ?? null;

const isEmailHubSpotActivity = (activityType: string, channel: string | null): boolean => {
  if (activityType === "email") {
    return true;
  }

  if (activityType !== "communication") {
    return false;
  }

  const normalizedChannel = normalizeActivityChannel(channel);

  return normalizedChannel === "EMAIL";
};

const isCallHubSpotActivity = (activityType: string): boolean => activityType === "call";

const applyHubSpotActivityToCounts = (
  entry: ActivityCountEntry,
  activityType: string,
  channel: string | null,
): void => {
  entry.touchpoints += 1;

  if (isCallHubSpotActivity(activityType)) {
    entry.calls += 1;
    return;
  }

  if (isEmailHubSpotActivity(activityType, channel)) {
    entry.emails += 1;
  }
};

const loadHubSpotActivityChannels = async (
  orgId: string,
  activityIds: string[],
): Promise<Map<string, string | null>> => {
  if (activityIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseAdmin();
  const channels = new Map<string, string | null>();

  for (let index = 0; index < activityIds.length; index += DEAL_ID_BATCH_SIZE) {
    const batch = activityIds.slice(index, index + DEAL_ID_BATCH_SIZE);
    const { data, error } = await supabase
      .from("hubspot_activities")
      .select("hubspot_activity_id, activity_channel")
      .eq("org_id", orgId)
      .eq("activity_type", "communication")
      .in("hubspot_activity_id", batch);

    if (error) {
      continue;
    }

    for (const row of (data ?? []) as Array<{ hubspot_activity_id: string; activity_channel: string | null }>) {
      channels.set(row.hubspot_activity_id, row.activity_channel);
    }
  }

  return channels;
};

const loadHubSpotActivityCounts = async (
  orgId: string,
  hubspotDealIds: string[],
): Promise<Map<string, ActivityCountEntry>> => {
  const counts = new Map<string, ActivityCountEntry>();
  const seenByDeal = new Map<string, Set<string>>();
  const targetDealIds = new Set(hubspotDealIds);
  const supabase = getSupabaseAdmin();

  const trackHubSpotActivity = (
    hubspotDealId: string,
    activityType: string,
    hubspotActivityId: string,
    channel: string | null,
  ): void => {
    if (!targetDealIds.has(hubspotDealId)) {
      return;
    }

    const dedupeKey = `${activityType}:${hubspotActivityId}`;
    const seen = seenByDeal.get(hubspotDealId) ?? new Set<string>();

    if (seen.has(dedupeKey)) {
      return;
    }

    seen.add(dedupeKey);
    seenByDeal.set(hubspotDealId, seen);

    const entry = counts.get(hubspotDealId) ?? createEmptyActivityCount();
    applyHubSpotActivityToCounts(entry, activityType, channel);
    counts.set(hubspotDealId, entry);
  };

  for (let index = 0; index < hubspotDealIds.length; index += DEAL_ID_BATCH_SIZE) {
    const batch = hubspotDealIds.slice(index, index + DEAL_ID_BATCH_SIZE);
    const { data, error } = await supabase
      .from("hubspot_activity_deal_links")
      .select("hubspot_deal_id, activity_type, hubspot_activity_id")
      .eq("org_id", orgId)
      .in("hubspot_deal_id", batch);

    if (error) {
      continue;
    }

    const communicationIds = new Set<string>();
    const communicationLinks: Array<{ hubspotDealId: string; hubspotActivityId: string }> = [];

    for (const row of (data ?? []) as HubSpotActivityLinkRow[]) {
      if (row.activity_type === "communication") {
        communicationIds.add(row.hubspot_activity_id);
        communicationLinks.push({
          hubspotDealId: row.hubspot_deal_id,
          hubspotActivityId: row.hubspot_activity_id,
        });
        continue;
      }

      trackHubSpotActivity(row.hubspot_deal_id, row.activity_type, row.hubspot_activity_id, null);
    }

    const channelsByActivityId = await loadHubSpotActivityChannels(orgId, [...communicationIds]);

    for (const link of communicationLinks) {
      trackHubSpotActivity(
        link.hubspotDealId,
        "communication",
        link.hubspotActivityId,
        channelsByActivityId.get(link.hubspotActivityId) ?? null,
      );
    }
  }

  for (let index = 0; index < hubspotDealIds.length; index += DEAL_ID_BATCH_SIZE) {
    const batch = hubspotDealIds.slice(index, index + DEAL_ID_BATCH_SIZE);
    const { data, error } = await supabase
      .from("hubspot_activities")
      .select("hubspot_activity_id, activity_type, activity_channel, associated_deal_ids")
      .eq("org_id", orgId)
      .overlaps("associated_deal_ids", batch);

    if (error) {
      continue;
    }

    for (const row of (data ?? []) as HubSpotActivityRow[]) {
      for (const hubspotDealId of row.associated_deal_ids ?? []) {
        trackHubSpotActivity(hubspotDealId, row.activity_type, row.hubspot_activity_id, row.activity_channel);
      }
    }
  }

  return counts;
};

const mergeActivityEventCounts = async (
  orgId: string,
  hubspotDealIds: string[],
  counts: Map<string, ActivityCountEntry>,
): Promise<void> => {
  const { data, error } = await getSupabaseAdmin()
    .from("activity_events")
    .select("hubspot_deal_id, channel, external_event_id")
    .eq("org_id", orgId)
    .in("hubspot_deal_id", hubspotDealIds)
    .limit(50000);

  if (error) {
    return;
  }

  const seenByDeal = new Map<string, Set<string>>();

  for (const row of (data ?? []) as ActivityCountRow[]) {
    if (!row.hubspot_deal_id) {
      continue;
    }

    const dedupeKey = row.external_event_id ?? `event:${row.channel}:${row.hubspot_deal_id}`;
    const seen = seenByDeal.get(row.hubspot_deal_id) ?? new Set<string>();

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    seenByDeal.set(row.hubspot_deal_id, seen);

    const entry = counts.get(row.hubspot_deal_id) ?? createEmptyActivityCount();
    entry.touchpoints += 1;

    if (row.channel === "call") {
      entry.calls += 1;
    } else if (row.channel === "email") {
      entry.emails += 1;
    }

    counts.set(row.hubspot_deal_id, entry);
  }
};

export const loadActivityCounts = async (
  orgId: string,
  hubspotDealIds: string[],
): Promise<Map<string, { calls: number; emails: number; touchpoints: number }>> => {
  if (hubspotDealIds.length === 0) {
    return new Map();
  }

  const counts = await loadHubSpotActivityCounts(orgId, hubspotDealIds);
  await mergeActivityEventCounts(orgId, hubspotDealIds, counts);

  return counts;
};

export const updateRun = async (runId: string, updates: Record<string, unknown>): Promise<void> => {
  const { error } = await getSupabaseAdmin().from("close_won_analysis_runs").update(updates).eq("id", runId);

  if (error) {
    throw new Error(`Impossible de mettre a jour le run close won: ${error.message}`);
  }
};

export const loadRun = async (runId: string): Promise<WinAnalysisRun & { provider: string; model: string }> => {
  const { data, error } = await getSupabaseAdmin().from("close_won_analysis_runs").select("*").eq("id", runId).maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le run close won: ${error.message}`);
  }

  if (!data) {
    throw new Error("Run close won introuvable.");
  }

  const row = data as WinRunRow;

  return { ...mapRunRow(row), provider: row.provider, model: row.model };
};

export const loadLastCompletedRun = async (orgId: string): Promise<WinAnalysisRun | null> => {
  const { data, error } = await getSupabaseAdmin()
    .from("close_won_analysis_runs")
    .select("*")
    .eq("org_id", orgId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le dernier run close won: ${error.message}`);
  }

  return data ? mapRunRow(data as WinRunRow) : null;
};
