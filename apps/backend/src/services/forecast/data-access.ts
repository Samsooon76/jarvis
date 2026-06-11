import { getSupabaseAdmin } from "../../db/client.js";
import type {
  DealAiAnalysisMetadataRow,
  DealAiAnalysisRow,
  ForecastDealContext,
  ForecastOverviewOptions,
  ForecastScope,
  HubSpotCompanyRow,
  HubSpotContactRow,
  HubSpotDealRow,
  OwnerUserRow,
} from "./types.js";
import { addDays } from "./shared.js";
import { isForecastableDeal, isSignedPaymentPendingStage } from "./deal-status.js";

export const MAX_OPEN_DEALS = 250;

const FORECAST_DEAL_SELECT =
  "hubspot_deal_id, hubspot_owner_id, primary_contact_id, primary_company_id, deal_name, amount, pipeline_label, deal_stage, deal_stage_label, deal_lifecycle_status, is_closed_deal, close_probability, closed_at, hubspot_updated_at, properties, synced_at";

export const loadOpenDealContexts = async (options: Required<Pick<ForecastOverviewOptions, "orgId">> & {
  scope: ForecastScope;
  hubspotOwnerId: string | null;
  dateFrom: string;
  dateTo: string;
}): Promise<ForecastDealContext[]> => {
  if (options.scope === "owner" && !options.hubspotOwnerId) {
    return [];
  }

  const supabase = getSupabaseAdmin();
  const dateToExclusive = addDays(new Date(`${options.dateTo}T00:00:00.000Z`), 1).toISOString();

  const scopedQuery = () => {
    let query = supabase.from("hubspot_deals").select(FORECAST_DEAL_SELECT).eq("org_id", options.orgId);

    if (options.scope === "owner" && options.hubspotOwnerId) {
      query = query.eq("hubspot_owner_id", options.hubspotOwnerId);
    }

    return query;
  };

  // 1) Fenetre temporelle : deals ouverts (close date prevue) + paiements recus dans la periode.
  const windowedQuery = scopedQuery()
    .gte("closed_at", `${options.dateFrom}T00:00:00.000Z`)
    .lt("closed_at", dateToExclusive)
    .order("amount", { ascending: false })
    .limit(MAX_OPEN_DEALS);

  // 2) Backlog signe : "Deal Signed/Payment Pending" toujours visible, quelle que soit la date de signature.
  const backlogQuery = scopedQuery()
    .or("deal_stage_label.ilike.%payment pending%,deal_stage_label.ilike.%signed%")
    .order("amount", { ascending: false })
    .limit(MAX_OPEN_DEALS);

  const [windowedResult, backlogResult] = await Promise.all([windowedQuery, backlogQuery]);

  if (windowedResult.error) {
    throw new Error(`Impossible de charger les deals forecast Supabase: ${windowedResult.error.message}`);
  }

  if (backlogResult.error) {
    throw new Error(`Impossible de charger le backlog signe du forecast: ${backlogResult.error.message}`);
  }

  const dealRowsById = new Map<string, HubSpotDealRow>();

  for (const row of (windowedResult.data ?? []) as HubSpotDealRow[]) {
    dealRowsById.set(row.hubspot_deal_id, row);
  }

  // On n'ajoute du backlog que les deals reellement en "signed / payment pending" (les paiements recus
  // hors periode restent exclus, conformement au rattachement par mois civil).
  for (const row of (backlogResult.data ?? []) as HubSpotDealRow[]) {
    if (isSignedPaymentPendingStage(row) && !dealRowsById.has(row.hubspot_deal_id)) {
      dealRowsById.set(row.hubspot_deal_id, row);
    }
  }

  const deals = Array.from(dealRowsById.values()).filter(isForecastableDeal);
  const contactIds = Array.from(new Set(deals.map((deal) => deal.primary_contact_id).filter((value): value is string => Boolean(value))));
  const companyIds = Array.from(new Set(deals.map((deal) => deal.primary_company_id).filter((value): value is string => Boolean(value))));
  const ownerIds = Array.from(new Set(deals.map((deal) => deal.hubspot_owner_id).filter((value): value is string => Boolean(value))));

  const [contactsResult, companiesResult, ownersResult] = await Promise.all([
    contactIds.length > 0
      ? supabase.from("hubspot_contacts").select("hubspot_contact_id, name, company_name").eq("org_id", options.orgId).in("hubspot_contact_id", contactIds)
      : Promise.resolve({ data: [], error: null }),
    companyIds.length > 0
      ? supabase.from("hubspot_companies").select("hubspot_company_id, name").eq("org_id", options.orgId).in("hubspot_company_id", companyIds)
      : Promise.resolve({ data: [], error: null }),
    ownerIds.length > 0
      ? supabase.from("users").select("hubspot_owner_id, name").eq("org_id", options.orgId).in("hubspot_owner_id", ownerIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (contactsResult.error) {
    throw new Error(`Impossible de charger les contacts du forecast: ${contactsResult.error.message}`);
  }

  if (companiesResult.error) {
    throw new Error(`Impossible de charger les entreprises du forecast: ${companiesResult.error.message}`);
  }

  if (ownersResult.error) {
    throw new Error(`Impossible de charger les owners du forecast: ${ownersResult.error.message}`);
  }

  const contactById = new Map(((contactsResult.data ?? []) as HubSpotContactRow[]).map((contact) => [contact.hubspot_contact_id, contact]));
  const companyById = new Map(((companiesResult.data ?? []) as HubSpotCompanyRow[]).map((company) => [company.hubspot_company_id, company]));
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

export const loadLatestDealIntelligence = async (
  orgId: string,
  hubspotDealIds: string[],
  provider: string,
  model: string,
): Promise<Map<string, DealAiAnalysisRow>> => {
  if (hubspotDealIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("deal_ai_analyses")
    .select("hubspot_deal_id, analysis, close_won_probability, generated_at, expires_at")
    .eq("org_id", orgId)
    .eq("provider", provider)
    .eq("model", model)
    .eq("analysis_type", "deal_intelligence")
    .in("hubspot_deal_id", hubspotDealIds)
    .order("generated_at", { ascending: false });

  if (error) {
    throw new Error(`Impossible de charger les analyses IA du forecast: ${error.message}`);
  }

  const latestByDealId = new Map<string, DealAiAnalysisRow>();

  for (const row of (data ?? []) as DealAiAnalysisRow[]) {
    if (!latestByDealId.has(row.hubspot_deal_id)) {
      latestByDealId.set(row.hubspot_deal_id, row);
    }
  }

  return latestByDealId;
};

export const loadLatestDealAnalysisMetadata = async (
  orgId: string,
  hubspotDealIds: string[],
  provider: string,
  model: string,
  analysisType: "deal_qualification" | "deal_activity_plan",
): Promise<Map<string, DealAiAnalysisMetadataRow>> => {
  if (hubspotDealIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("deal_ai_analyses")
    .select("hubspot_deal_id, generated_at, expires_at")
    .eq("org_id", orgId)
    .eq("provider", provider)
    .eq("model", model)
    .eq("analysis_type", analysisType)
    .in("hubspot_deal_id", hubspotDealIds)
    .order("generated_at", { ascending: false });

  if (error) {
    throw new Error(`Impossible de charger la couverture d'analyse IA du forecast: ${error.message}`);
  }

  const latestByDealId = new Map<string, DealAiAnalysisMetadataRow>();

  for (const row of (data ?? []) as DealAiAnalysisMetadataRow[]) {
    if (!latestByDealId.has(row.hubspot_deal_id)) {
      latestByDealId.set(row.hubspot_deal_id, row);
    }
  }

  return latestByDealId;
};

export const isFreshAnalysisMetadata = (row: DealAiAnalysisMetadataRow | null | undefined): boolean => {
  if (!row) {
    return false;
  }

  const expiresAt = new Date(row.expires_at).getTime();

  return Number.isNaN(expiresAt) || expiresAt >= Date.now();
};
