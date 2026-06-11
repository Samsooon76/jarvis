import { getSupabaseAdmin } from "../../db/client.js";
import type { LlmProvider, CloseLostDealAnalysis, CloseLostPortfolioAnalysis } from "../llm/llm.provider.js";
import { addDays, isLostDeal, mapRunRow, MAX_DEALS_PER_RUN } from "./shared.js";
import type {
  CloseLostAnalysisRow,
  CloseLostAnalysisRun,
  CloseLostAnalysisRunRow,
  CloseLostDealContext,
  CloseLostRunLog,
  CloseLostRunOptions,
  CloseLostRunStatus,
  HubSpotCompanyRow,
  HubSpotContactRow,
  HubSpotDealRow,
  OwnerUserRow,
} from "./types.js";

export const loadCloseLostDealContexts = async (
  options: Pick<CloseLostRunOptions, "orgId" | "scope" | "hubspotOwnerId" | "salesAeOwnerIds" | "dateFrom" | "dateTo"> & {
    hubspotDealId?: string | null;
  },
): Promise<CloseLostDealContext[]> => {
  const supabase = getSupabaseAdmin();
  const dateToExclusive = addDays(new Date(`${options.dateTo}T00:00:00.000Z`), 1).toISOString();
  let query = supabase
    .from("hubspot_deals")
    .select(
      "hubspot_deal_id, hubspot_owner_id, primary_contact_id, primary_company_id, deal_name, amount, pipeline_label, deal_stage, deal_stage_label, deal_lifecycle_status, is_closed_deal, close_probability, hubspot_created_at, closed_at, hubspot_updated_at, properties, synced_at",
    )
    .eq("org_id", options.orgId)
    .order("closed_at", { ascending: false })
    .limit(500);

  if (options.hubspotDealId) {
    query = query.eq("hubspot_deal_id", options.hubspotDealId);
  } else {
    query = query
      .not("closed_at", "is", null)
      .gte("closed_at", `${options.dateFrom}T00:00:00.000Z`)
      .lt("closed_at", dateToExclusive);
  }

  if (!options.hubspotDealId && options.scope === "owner") {
    if (!options.hubspotOwnerId) {
      return [];
    }

    query = query.eq("hubspot_owner_id", options.hubspotOwnerId);
  } else if (!options.hubspotDealId && options.salesAeOwnerIds && options.salesAeOwnerIds.length > 0) {
    query = query.in("hubspot_owner_id", options.salesAeOwnerIds);
  }

  const { data: dealRows, error: dealsError } = await query;

  if (dealsError) {
    throw new Error(`Impossible de charger les deals close lost: ${dealsError.message}`);
  }

  const deals = ((dealRows ?? []) as HubSpotDealRow[]).filter(isLostDeal).slice(0, MAX_DEALS_PER_RUN);
  const contactIds = Array.from(
    new Set(deals.map((deal) => deal.primary_contact_id).filter((value): value is string => Boolean(value))),
  );
  const companyIds = Array.from(
    new Set(deals.map((deal) => deal.primary_company_id).filter((value): value is string => Boolean(value))),
  );
  const ownerIds = Array.from(
    new Set(deals.map((deal) => deal.hubspot_owner_id).filter((value): value is string => Boolean(value))),
  );

  const [contactsResult, companiesResult, ownersResult] = await Promise.all([
    contactIds.length > 0
      ? supabase
          .from("hubspot_contacts")
          .select("hubspot_contact_id, email, name, phone, title, company_name, properties")
          .eq("org_id", options.orgId)
          .in("hubspot_contact_id", contactIds)
      : Promise.resolve({ data: [], error: null }),
    companyIds.length > 0
      ? supabase
          .from("hubspot_companies")
          .select("hubspot_company_id, name, domain, industry, country, properties")
          .eq("org_id", options.orgId)
          .in("hubspot_company_id", companyIds)
      : Promise.resolve({ data: [], error: null }),
    ownerIds.length > 0
      ? supabase
          .from("users")
          .select("hubspot_owner_id, name")
          .eq("org_id", options.orgId)
          .in("hubspot_owner_id", ownerIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (contactsResult.error) {
    throw new Error(`Impossible de charger les contacts close lost: ${contactsResult.error.message}`);
  }

  if (companiesResult.error) {
    throw new Error(`Impossible de charger les entreprises close lost: ${companiesResult.error.message}`);
  }

  if (ownersResult.error) {
    throw new Error(`Impossible de charger les owners close lost: ${ownersResult.error.message}`);
  }

  const contactById = new Map(
    ((contactsResult.data ?? []) as HubSpotContactRow[]).map((contact) => [contact.hubspot_contact_id, contact]),
  );
  const companyById = new Map(
    ((companiesResult.data ?? []) as HubSpotCompanyRow[]).map((company) => [company.hubspot_company_id, company]),
  );
  const ownerNameByHubSpotId = new Map(
    ((ownersResult.data ?? []) as OwnerUserRow[])
      .filter((owner) => owner.hubspot_owner_id)
      .map((owner) => [owner.hubspot_owner_id as string, owner.name]),
  );

  return deals.map((row) => ({
    row,
    contact: row.primary_contact_id ? contactById.get(row.primary_contact_id) ?? null : null,
    company: row.primary_company_id ? companyById.get(row.primary_company_id) ?? null : null,
    ownerName: row.hubspot_owner_id ? ownerNameByHubSpotId.get(row.hubspot_owner_id) ?? null : null,
  }));
};

export const loadLatestAnalyses = async (
  orgId: string,
  hubspotDealIds: string[],
  provider: string,
  model: string,
): Promise<Map<string, CloseLostAnalysisRow>> => {
  if (hubspotDealIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("close_lost_deal_analyses")
    .select("id, org_id, hubspot_deal_id, provider, model, input_hash, analysis, source_synced_at, generated_at")
    .eq("org_id", orgId)
    .eq("provider", provider)
    .eq("model", model)
    .in("hubspot_deal_id", hubspotDealIds)
    .order("generated_at", { ascending: false });

  if (error) {
    throw new Error(`Impossible de charger le cache close lost: ${error.message}`);
  }

  const latestByDealId = new Map<string, CloseLostAnalysisRow>();

  for (const row of (data ?? []) as CloseLostAnalysisRow[]) {
    if (!latestByDealId.has(row.hubspot_deal_id)) {
      latestByDealId.set(row.hubspot_deal_id, row);
    }
  }

  return latestByDealId;
};

export const loadLastCompletedRun = async (
  options: Pick<CloseLostRunOptions, "orgId" | "scope" | "hubspotOwnerId" | "dateFrom" | "dateTo">,
  provider: string,
  model: string,
): Promise<CloseLostAnalysisRun | null> => {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("close_lost_analysis_runs")
    .select("*")
    .eq("org_id", options.orgId)
    .eq("scope", options.scope)
    .eq("provider", provider)
    .eq("model", model)
    .eq("date_from", options.dateFrom)
    .eq("date_to", options.dateTo)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1);

  if (options.scope === "owner") {
    query = query.eq("hubspot_owner_id", options.hubspotOwnerId ?? "");
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le dernier run close lost: ${error.message}`);
  }

  return data ? mapRunRow(data as CloseLostAnalysisRunRow) : null;
};

export const loadExactCachedAnalysis = async (
  orgId: string,
  hubspotDealId: string,
  provider: string,
  model: string,
  inputHash: string,
): Promise<CloseLostAnalysisRow | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("close_lost_deal_analyses")
    .select("id, org_id, hubspot_deal_id, provider, model, input_hash, analysis, source_synced_at, generated_at")
    .eq("org_id", orgId)
    .eq("hubspot_deal_id", hubspotDealId)
    .eq("provider", provider)
    .eq("model", model)
    .eq("input_hash", inputHash)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le cache close lost du deal: ${error.message}`);
  }

  return data as CloseLostAnalysisRow | null;
};

export const persistDealAnalysis = async (
  orgId: string,
  context: CloseLostDealContext,
  provider: LlmProvider,
  inputHash: string,
  analysis: CloseLostDealAnalysis,
): Promise<CloseLostAnalysisRow> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("close_lost_deal_analyses")
    .upsert(
      {
        org_id: orgId,
        hubspot_deal_id: context.row.hubspot_deal_id,
        provider: provider.providerName,
        model: provider.modelName,
        input_hash: inputHash,
        analysis,
        source_synced_at: context.row.synced_at,
        generated_at: new Date().toISOString(),
      },
      {
        onConflict: "org_id,hubspot_deal_id,provider,model,input_hash",
      },
    )
    .select("id, org_id, hubspot_deal_id, provider, model, input_hash, analysis, source_synced_at, generated_at")
    .single();

  if (error) {
    throw new Error(`Impossible de sauvegarder l'analyse close lost du deal: ${error.message}`);
  }

  return data as CloseLostAnalysisRow;
};

export const updateRun = async (
  runId: string,
  updates: Partial<{
    status: CloseLostRunStatus;
    progress: number;
    current_step: string;
    logs: CloseLostRunLog[];
    deal_count: number;
    analyzed_count: number;
    reused_count: number;
    failed_count: number;
    result: CloseLostPortfolioAnalysis | null;
    error: string | null;
    finished_at: string | null;
  }>,
): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("close_lost_analysis_runs").update(updates).eq("id", runId);

  if (error) {
    throw new Error(`Impossible de mettre a jour le run close lost: ${error.message}`);
  }
};

export const loadRun = async (runId: string): Promise<CloseLostAnalysisRun> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("close_lost_analysis_runs").select("*").eq("id", runId).maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le run close lost: ${error.message}`);
  }

  if (!data) {
    throw new Error("Run close lost introuvable.");
  }

  return mapRunRow(data as CloseLostAnalysisRunRow);
};
