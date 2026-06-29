import { getSupabaseAdmin } from "../../db/client.js";
import { getHubSpotAccessToken } from "../hubspot-auth.service.js";
import { loadHubSpotRealtimeOwnerIds } from "../hubspot-owner-scope.service.js";
import {
  HUBSPOT_COMPANY_PROPERTIES,
  HUBSPOT_CONTACT_PROPERTIES,
  HUBSPOT_DEAL_PROPERTIES,
  fetchBatchObjects,
} from "../hubspot/client.js";
import { fetchContactsByIds } from "../hubspot/contacts.js";
import {
  fetchAssociatedIdsByDealIds,
  fetchDealDetailsByIds,
  fetchPrimaryAssociatedCompanyIdsByDealIds,
  fetchPrimaryAssociatedContactIdsByDealIds,
} from "../hubspot/deals.js";
import {
  buildDealStageLookup,
  buildDealStageSnapshot,
  fetchDealPipelines,
  resolveDealClosedState,
  resolveDealLifecycleStatus,
  resolveDealStageLabel,
  type HubSpotDealStageDefinition,
} from "../hubspot/pipelines.js";
import { computePriorityScore, createProspectSummary } from "../hubspot/prospects.js";
import {
  buildContactName,
  getCompanyName,
  parseNumericValue,
  parsePercentage,
  readProperty,
  toNullablePropertiesRecord,
} from "../hubspot/shared.js";
import type { DealLifecycleStatus, HubSpotCompany, HubSpotContact, HubSpotDeal } from "../hubspot/types.js";

export type HydratedHubSpotDealResult = {
  hydrated: boolean;
  inRealtimeScope: boolean;
  hubspotDealId: string;
  dealName: string | null;
  amount: number | null;
  stageLabel: string | null;
  lifecycleStatus: DealLifecycleStatus | null;
};

type DealStageRow = {
  pipeline_id: string;
  pipeline_label: string | null;
  stage_id: string;
  stage_label: string;
  display_order: number | null;
  is_closed: boolean | null;
  probability: number | null;
};

const normalizeHubSpotTimestamp = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();

  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
};

const isDealOwnerInRealtimeScope = async (orgId: string, ownerHubSpotId: string | null): Promise<boolean> => {
  const realtimeOwnerIds = await loadHubSpotRealtimeOwnerIds(orgId);

  if (realtimeOwnerIds.size === 0) {
    return true;
  }

  return Boolean(ownerHubSpotId && realtimeOwnerIds.has(ownerHubSpotId));
};

const loadDealStageLookupFromDb = async (orgId: string): Promise<Map<string, HubSpotDealStageDefinition>> => {
  const { data, error } = await getSupabaseAdmin()
    .from("hubspot_deal_stages")
    .select("pipeline_id, pipeline_label, stage_id, stage_label, display_order, is_closed, probability")
    .eq("org_id", orgId);

  if (error) {
    throw new Error(`Impossible de charger les stages HubSpot: ${error.message}`);
  }

  return new Map(
    ((data ?? []) as DealStageRow[]).map((row) => [
      row.stage_id,
      {
        pipelineId: row.pipeline_id,
        pipelineLabel: row.pipeline_label,
        label: row.stage_label,
        displayOrder: row.display_order,
        isClosed: row.is_closed,
        probability: row.probability,
      },
    ]),
  );
};

const upsertDealStages = async (
  orgId: string,
  dealStageLookup: Map<string, HubSpotDealStageDefinition>,
  syncedAt: string,
): Promise<void> => {
  const stageRows = buildDealStageSnapshot(dealStageLookup).map((stage) => ({
    org_id: orgId,
    pipeline_id: stage.pipelineId,
    pipeline_label: stage.pipelineLabel,
    stage_id: stage.stageId,
    stage_label: stage.stageLabel,
    display_order: stage.displayOrder,
    is_closed: stage.isClosed,
    probability: stage.probability,
    synced_at: syncedAt,
  }));

  if (stageRows.length === 0) {
    return;
  }

  const { error } = await getSupabaseAdmin().from("hubspot_deal_stages").upsert(stageRows, {
    onConflict: "org_id,pipeline_id,stage_id",
  });

  if (error) {
    throw new Error(`Impossible de synchroniser les stages HubSpot: ${error.message}`);
  }
};

const resolveDealStageLookup = async (
  orgId: string,
  accessToken: string,
  dealStageId: string | null,
  syncedAt: string,
): Promise<Map<string, HubSpotDealStageDefinition>> => {
  const lookupFromDb = await loadDealStageLookupFromDb(orgId);

  if (dealStageId && lookupFromDb.has(dealStageId)) {
    return lookupFromDb;
  }

  const lookupFromApi = buildDealStageLookup(await fetchDealPipelines(accessToken));
  await upsertDealStages(orgId, lookupFromApi, syncedAt);

  return lookupFromApi;
};

const buildDealOnlyContactId = (hubspotDealId: string): string => `deal-only:${hubspotDealId}`;

const isDealOnlyContact = (contact: HubSpotContact, deal: HubSpotDeal): boolean =>
  contact.id === buildDealOnlyContactId(deal.id);

const buildPlaceholderContact = (deal: HubSpotDeal): HubSpotContact => {
  const dealName = readProperty(deal.properties, "dealname")?.trim() ?? "Deal HubSpot";

  return {
    id: buildDealOnlyContactId(deal.id),
    properties: {
      firstname: dealName,
      lastname: "",
      email: null,
      phone: null,
      jobtitle: null,
      company: null,
      lastactivitydate: null,
      hs_lastmodifieddate: readProperty(deal.properties, "hs_lastmodifieddate"),
      hubspot_owner_id: readProperty(deal.properties, "hubspot_owner_id"),
    },
  };
};

const upsertDealGraphInJarvis = async ({
  orgId,
  accessToken,
  deal,
  contact,
  company,
  dealStageLookup,
  syncedAt,
}: {
  orgId: string;
  accessToken: string;
  deal: HubSpotDeal;
  contact: HubSpotContact;
  company: HubSpotCompany | null;
  dealStageLookup: Map<string, HubSpotDealStageDefinition>;
  syncedAt: string;
}): Promise<HydratedHubSpotDealResult> => {
  const supabase = getSupabaseAdmin();
  const [contactIdsByDealId, companyIdsByDealId] = await Promise.all([
    fetchAssociatedIdsByDealIds(accessToken, "contacts", [deal.id]).catch(() => new Map<string, string[]>()),
    fetchAssociatedIdsByDealIds(accessToken, "companies", [deal.id]).catch(() => new Map<string, string[]>()),
  ]);
  const associatedContactIds = isDealOnlyContact(contact, deal)
    ? contactIdsByDealId.get(deal.id) ?? []
    : contactIdsByDealId.get(deal.id) ?? [contact.id];
  const associatedCompanyIds = companyIdsByDealId.get(deal.id) ?? (company ? [company.id] : []);
  const dealStageId = readProperty(deal.properties, "dealstage");
  const stageDefinition = dealStageId ? dealStageLookup.get(dealStageId) ?? null : null;
  const lifecycleStatus = resolveDealLifecycleStatus(deal, dealStageLookup);
  const stageLabel = resolveDealStageLabel(deal, dealStageLookup);
  const ownerHubSpotId = readProperty(deal.properties, "hubspot_owner_id");
  const inRealtimeScope = await isDealOwnerInRealtimeScope(orgId, ownerHubSpotId);

  if (!inRealtimeScope) {
    return {
      hydrated: false,
      inRealtimeScope: false,
      hubspotDealId: deal.id,
      dealName: readProperty(deal.properties, "dealname"),
      amount: parseNumericValue(readProperty(deal.properties, "amount")),
      stageLabel,
      lifecycleStatus,
    };
  }

  if (!isDealOnlyContact(contact, deal)) {
    const contactProperties = toNullablePropertiesRecord(contact.properties, HUBSPOT_CONTACT_PROPERTIES);
    const { error: contactError } = await supabase.from("hubspot_contacts").upsert(
      {
        org_id: orgId,
        hubspot_contact_id: contact.id,
        hubspot_owner_id: readProperty(contact.properties, "hubspot_owner_id"),
        email: readProperty(contact.properties, "email"),
        name: buildContactName(contact.properties),
        phone: readProperty(contact.properties, "phone"),
        title: readProperty(contact.properties, "jobtitle"),
        company_name: readProperty(contact.properties, "company"),
        properties: contactProperties,
        synced_at: syncedAt,
      },
      { onConflict: "org_id,hubspot_contact_id" },
    );

    if (contactError) {
      throw new Error(`Impossible de synchroniser le contact HubSpot: ${contactError.message}`);
    }
  }

  if (company) {
    const { error: companyError } = await supabase.from("hubspot_companies").upsert(
      {
        org_id: orgId,
        hubspot_company_id: company.id,
        name: readProperty(company.properties, "name"),
        domain: readProperty(company.properties, "domain"),
        industry: readProperty(company.properties, "industry"),
        city: readProperty(company.properties, "city"),
        country: readProperty(company.properties, "country"),
        properties: toNullablePropertiesRecord(company.properties, HUBSPOT_COMPANY_PROPERTIES),
        synced_at: syncedAt,
      },
      { onConflict: "org_id,hubspot_company_id" },
    );

    if (companyError) {
      throw new Error(`Impossible de synchroniser l'entreprise HubSpot: ${companyError.message}`);
    }
  }

  const dealProperties = toNullablePropertiesRecord(deal.properties, HUBSPOT_DEAL_PROPERTIES);
  const { error: dealError } = await supabase.from("hubspot_deals").upsert(
    {
      org_id: orgId,
      hubspot_deal_id: deal.id,
      hubspot_owner_id: ownerHubSpotId,
      primary_contact_id: associatedContactIds[0] ?? (isDealOnlyContact(contact, deal) ? null : contact.id),
      primary_company_id: associatedCompanyIds[0] ?? null,
      associated_contact_ids: associatedContactIds,
      associated_company_ids: associatedCompanyIds,
      deal_name: readProperty(deal.properties, "dealname"),
      amount: parseNumericValue(readProperty(deal.properties, "amount")),
      pipeline: readProperty(deal.properties, "pipeline"),
      pipeline_label: stageDefinition?.pipelineLabel ?? null,
      deal_stage: dealStageId,
      deal_stage_label: stageLabel,
      deal_lifecycle_status: lifecycleStatus,
      is_closed_deal: resolveDealClosedState(lifecycleStatus),
      close_probability: parsePercentage(
        readProperty(deal.properties, "hs_deal_stage_probability") ??
          readProperty(deal.properties, "probabilite_de__closing"),
      ),
      hubspot_created_at: normalizeHubSpotTimestamp(readProperty(deal.properties, "createdate")),
      closed_at: normalizeHubSpotTimestamp(readProperty(deal.properties, "closedate")),
      hubspot_updated_at: normalizeHubSpotTimestamp(readProperty(deal.properties, "hs_lastmodifieddate")),
      properties: dealProperties,
      synced_at: syncedAt,
    },
    { onConflict: "org_id,hubspot_deal_id" },
  );

  if (dealError) {
    throw new Error(`Impossible de synchroniser le deal HubSpot: ${dealError.message}`);
  }

  const prospect = createProspectSummary(contact, deal, company, dealStageLookup);
  let ownerUserId: string | null = null;

  if (prospect.ownerHubSpotId) {
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("org_id", orgId)
      .eq("hubspot_owner_id", prospect.ownerHubSpotId)
      .maybeSingle();

    if (userError) {
      throw new Error(`Impossible de resoudre l'owner Jarvis du deal: ${userError.message}`);
    }

    ownerUserId = (userData as { id: string } | null)?.id ?? null;
  }

  const { error: prospectError } = await supabase.from("prospects").upsert(
    {
      org_id: orgId,
      owner_user_id: ownerUserId,
      hubspot_contact_id: prospect.hubspotContactId,
      hubspot_deal_id: prospect.hubspotDealId,
      name: prospect.name,
      company: getCompanyName(company, prospect.company),
      title: prospect.title,
      phone: prospect.phone,
      email: prospect.email,
      deal_stage: prospect.dealStageLabel ?? prospect.dealStage,
      deal_amount: prospect.dealAmount,
      close_probability: prospect.closeProbability,
      last_contact_at: prospect.lastContactAt,
      next_action: null,
      next_action_at: null,
      ai_summary: null,
      ai_priority_score: computePriorityScore(prospect),
      raw_data: prospect.rawData,
      synced_at: syncedAt,
    },
    { onConflict: "org_id,hubspot_prospect_key" },
  );

  if (prospectError) {
    throw new Error(`Impossible de synchroniser le prospect HubSpot: ${prospectError.message}`);
  }

  return {
    hydrated: true,
    inRealtimeScope: true,
    hubspotDealId: deal.id,
    dealName: readProperty(deal.properties, "dealname"),
    amount: parseNumericValue(readProperty(deal.properties, "amount")),
    stageLabel,
    lifecycleStatus,
  };
};

export const isHubSpotDealKnownInJarvis = async (orgId: string, hubspotDealId: string): Promise<boolean> => {
  const { data, error } = await getSupabaseAdmin()
    .from("hubspot_deals")
    .select("hubspot_deal_id")
    .eq("org_id", orgId)
    .eq("hubspot_deal_id", hubspotDealId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de verifier la presence du deal HubSpot: ${error.message}`);
  }

  return Boolean(data);
};

export const hydrateHubSpotDealFromWebhook = async (
  orgId: string,
  hubspotDealId: string,
): Promise<HydratedHubSpotDealResult> => {
  const accessToken = await getHubSpotAccessToken(orgId);
  const [deal] = await fetchDealDetailsByIds(accessToken, [hubspotDealId]);

  if (!deal) {
    return {
      hydrated: false,
      inRealtimeScope: false,
      hubspotDealId,
      dealName: null,
      amount: null,
      stageLabel: null,
      lifecycleStatus: null,
    };
  }

  const syncedAt = new Date().toISOString();
  const dealStageId = readProperty(deal.properties, "dealstage");
  const dealStageLookup = await resolveDealStageLookup(orgId, accessToken, dealStageId, syncedAt);
  const [primaryContactIdByDealId, primaryCompanyIdByDealId] = await Promise.all([
    fetchPrimaryAssociatedContactIdsByDealIds(accessToken, [deal.id]),
    fetchPrimaryAssociatedCompanyIdsByDealIds(accessToken, [deal.id]),
  ]);
  const primaryContactId = primaryContactIdByDealId.get(deal.id) ?? deal.associations?.contacts?.results[0]?.id ?? null;
  const primaryCompanyId = primaryCompanyIdByDealId.get(deal.id) ?? deal.associations?.companies?.results[0]?.id ?? null;
  const contacts = primaryContactId ? await fetchContactsByIds(accessToken, [primaryContactId]) : [];
  const contact = contacts[0] ?? buildPlaceholderContact(deal);
  const companies =
    primaryCompanyId
      ? await fetchBatchObjects<HubSpotCompany>(accessToken, "companies", [primaryCompanyId], HUBSPOT_COMPANY_PROPERTIES)
      : [];
  const company = companies[0] ?? null;

  return upsertDealGraphInJarvis({
    orgId,
    accessToken,
    deal,
    contact,
    company,
    dealStageLookup,
    syncedAt,
  });
};

export const ensureHubSpotDealHydrated = async (
  orgId: string,
  hubspotDealId: string,
): Promise<HydratedHubSpotDealResult> => {
  if (await isHubSpotDealKnownInJarvis(orgId, hubspotDealId)) {
    const { data, error } = await getSupabaseAdmin()
      .from("hubspot_deals")
      .select("hubspot_deal_id, deal_name, amount, deal_stage_label, deal_lifecycle_status, hubspot_owner_id")
      .eq("org_id", orgId)
      .eq("hubspot_deal_id", hubspotDealId)
      .maybeSingle();

    if (error) {
      throw new Error(`Impossible de charger le deal HubSpot hydrate: ${error.message}`);
    }

    const row = data as {
      hubspot_deal_id: string;
      deal_name: string | null;
      amount: number | string | null;
      deal_stage_label: string | null;
      deal_lifecycle_status: DealLifecycleStatus | null;
      hubspot_owner_id: string | null;
    } | null;

    if (!row) {
      return hydrateHubSpotDealFromWebhook(orgId, hubspotDealId);
    }

    const inRealtimeScope = await isDealOwnerInRealtimeScope(orgId, row.hubspot_owner_id);

    return {
      hydrated: true,
      inRealtimeScope,
      hubspotDealId: row.hubspot_deal_id,
      dealName: row.deal_name,
      amount: parseNumericValue(row.amount === null ? null : String(row.amount)),
      stageLabel: row.deal_stage_label,
      lifecycleStatus: row.deal_lifecycle_status,
    };
  }

  return hydrateHubSpotDealFromWebhook(orgId, hubspotDealId);
};