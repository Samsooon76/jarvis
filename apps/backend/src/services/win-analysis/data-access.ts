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
): Promise<DealContext[]> => {
  const supabase = getSupabaseAdmin();
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

export const loadActivityCounts = async (
  orgId: string,
  hubspotDealIds: string[],
): Promise<Map<string, { calls: number; emails: number; touchpoints: number }>> => {
  if (hubspotDealIds.length === 0) {
    return new Map();
  }

  const { data, error } = await getSupabaseAdmin()
    .from("activity_events")
    .select("hubspot_deal_id, channel")
    .eq("org_id", orgId)
    .in("hubspot_deal_id", hubspotDealIds)
    .limit(50000);

  if (error) {
    // activity_events absent ou vide: benchmark sans dimension activite.
    return new Map();
  }

  const counts = new Map<string, { calls: number; emails: number; touchpoints: number }>();

  for (const row of (data ?? []) as ActivityCountRow[]) {
    if (!row.hubspot_deal_id) {
      continue;
    }

    const entry = counts.get(row.hubspot_deal_id) ?? { calls: 0, emails: 0, touchpoints: 0 };
    entry.touchpoints += 1;

    if (row.channel === "call") {
      entry.calls += 1;
    } else if (row.channel === "email") {
      entry.emails += 1;
    }

    counts.set(row.hubspot_deal_id, entry);
  }

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
