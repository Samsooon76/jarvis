import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import { getSupabaseAdmin } from "../db/client.js";
import type { Json } from "../db/database.types.js";
import { getHubSpotAccessToken } from "../services/hubspot-auth.service.js";
import {
  loadLeadContactScoreCacheForLeads,
  scoreLeadContactsWithCachedScores,
  type LeadContactScoringContactInput,
  type LeadContactScoringLeadInput,
  type LeadContactCachedScore,
  type ScoredLeadContact,
} from "../services/lead-contact-scoring.service.js";
import { hubSpotService, type HubSpotContactSnapshotItem, type HubSpotLeadRecord } from "../services/hubspot.service.js";

type LeadsQuery = {
  orgId?: string;
  hubspotOwnerId?: string;
  limit?: string;
  refreshAi?: string;
};

type HubSpotLeadRow = {
  hubspot_contact_id: string;
  hubspot_owner_id: string | null;
  email: string | null;
  name: string;
  phone: string | null;
  title: string | null;
  company_name: string | null;
  properties: Json;
  synced_at: string;
  updated_at: string;
};

type HubSpotCompanyRow = {
  hubspot_company_id: string;
  name: string | null;
};

type HubSpotStoredLeadRow = {
  hubspot_lead_id: string;
  hubspot_owner_id: string | null;
  associated_contact_ids: string[];
  associated_company_ids: string[];
  name: string;
  pipeline_id: string | null;
  pipeline_label: string | null;
  phase_id: string | null;
  phase_label: string | null;
  hubspot_created_at: string | null;
  hubspot_updated_at: string | null;
  properties: Json;
  synced_at: string;
  updated_at: string;
};

type HubSpotLeadUpsertRow = {
  org_id: string;
  hubspot_lead_id: string;
  hubspot_owner_id: string | null;
  associated_contact_ids: string[];
  associated_company_ids: string[];
  name: string;
  pipeline_id: string | null;
  pipeline_label: string | null;
  phase_id: string | null;
  phase_label: string | null;
  hubspot_created_at: string | null;
  hubspot_updated_at: string | null;
  properties: Record<string, string | null>;
  synced_at: string;
};

type HubSpotContactUpsertRow = {
  org_id: string;
  hubspot_contact_id: string;
  hubspot_owner_id: string | null;
  email: string | null;
  name: string;
  phone: string | null;
  title: string | null;
  company_name: string | null;
  properties: Record<string, string | null>;
  synced_at: string;
};

export type HubSpotLeadListItem = {
  hubspotLeadId: string | null;
  hubspotContactId: string;
  hubspotOwnerId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  companyName: string | null;
  pipelineId: string | null;
  pipelineLabel: string | null;
  phaseId: string | null;
  phaseLabel: string | null;
  lifecycleStage: string | null;
  leadStatus: string | null;
  lastActivityAt: string | null;
  syncedAt: string;
  updatedAt: string;
};

export type HubSpotLeadContactListItem = {
  hubspotContactId: string;
  hubspotOwnerId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  lifecycleStage: string | null;
  leadStatus: string | null;
  lastActivityAt: string | null;
  deterministicScore: number;
  aiScore: number | null;
  finalScore: number;
  priority: "urgent" | "important" | "routine";
  reason: string;
  recommendedAction: string;
  confidence: "low" | "medium" | "high" | null;
  scoringSource: "deterministic" | "ai_cached";
};

export type HubSpotLeadAccountItem = {
  lead: {
    hubspotLeadId: string;
    hubspotOwnerId: string | null;
    name: string;
    companyName: string | null;
    pipelineId: string | null;
    pipelineLabel: string | null;
    phaseId: string | null;
    phaseLabel: string | null;
    lifecycleStage: string | null;
    leadStatus: string | null;
    lastActivityAt: string | null;
    syncedAt: string;
    updatedAt: string;
    contactCount: number;
  };
  contacts: HubSpotLeadContactListItem[];
  bestContact: HubSpotLeadContactListItem | null;
};

type HubSpotLeadsPayload = {
  orgId: string;
  hubspotOwnerId: string;
  leads: HubSpotLeadListItem[];
};

type HubSpotLeadAccountsPayload = {
  orgId: string;
  hubspotOwnerId: string;
  accounts: HubSpotLeadAccountItem[];
};

const MAX_LEADS_LIMIT = 500;
const SUPABASE_IN_BATCH_SIZE = 80;
const STALE_ASSOCIATION_REFRESH_MS = 5 * 60 * 1000;
const OPEN_LEAD_PHASE_LABELS = [
  "Nouveau",
  "Tentative en cours",
  "Connecté",
  "To Recontact",
  "Meeting Booked",
  "No Show",
  "Mapping",
  "Qualifié",
] as const;
const OPEN_LEAD_PHASE_KEYS = new Set(OPEN_LEAD_PHASE_LABELS.map((label) => label.toLowerCase()));

const readProperty = (properties: Json, key: string): string | null => {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return null;
  }

  const value = properties[key];

  return typeof value === "string" && value.trim() ? value : null;
};

const readRecordProperty = (properties: Record<string, string | null>, key: string): string | null => {
  const value = properties[key];

  return typeof value === "string" && value.trim() ? value : null;
};

const buildHubSpotContactName = (properties: Record<string, string | null>): string => {
  const name = [readRecordProperty(properties, "firstname"), readRecordProperty(properties, "lastname")]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(" ");

  return name || readRecordProperty(properties, "email") || readRecordProperty(properties, "phone") || "Contact HubSpot";
};

const parseLimit = (value: string | undefined): number => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return MAX_LEADS_LIMIT;
  }

  return Math.min(parsed, MAX_LEADS_LIMIT);
};

const normalizeHubSpotTimestamp = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();

  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
};

const hasStaleMissingLeadAssociations = (leads: HubSpotStoredLeadRow[]): boolean =>
  leads.some((lead) => {
    if (lead.associated_contact_ids.length > 0) {
      return false;
    }

    const syncedAt = new Date(lead.synced_at).getTime();

    return Number.isNaN(syncedAt) || Date.now() - syncedAt > STALE_ASSOCIATION_REFRESH_MS;
  });

const createBatches = <T>(items: T[], batchSize: number): T[][] => {
  const batches: T[][] = [];

  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }

  return batches;
};

const loadLocalContactsById = async (
  orgId: string,
  contactIds: string[],
): Promise<Map<string, HubSpotLeadRow>> => {
  if (contactIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseAdmin();
  const contactBatches = await Promise.all(createBatches(Array.from(new Set(contactIds)), SUPABASE_IN_BATCH_SIZE).map(async (batch) => {
    const { data, error } = await supabase
      .from("hubspot_contacts")
      .select("hubspot_contact_id, hubspot_owner_id, email, name, phone, title, company_name, properties, synced_at, updated_at")
      .eq("org_id", orgId)
      .in("hubspot_contact_id", batch);

    if (error) {
      throw new Error(`Impossible de charger les contacts associes aux leads: ${error.message}`);
    }

    return (data ?? []) as HubSpotLeadRow[];
  }));
  const contacts = contactBatches.flat();

  return new Map(contacts.map((contact) => [contact.hubspot_contact_id, contact]));
};

const loadLocalCompaniesById = async (
  orgId: string,
  companyIds: string[],
): Promise<Map<string, HubSpotCompanyRow>> => {
  if (companyIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseAdmin();
  const companyBatches = await Promise.all(createBatches(Array.from(new Set(companyIds)), SUPABASE_IN_BATCH_SIZE).map(async (batch) => {
    const { data, error } = await supabase
      .from("hubspot_companies")
      .select("hubspot_company_id, name")
      .eq("org_id", orgId)
      .in("hubspot_company_id", batch);

    if (error) {
      throw new Error(`Impossible de charger les societes associees aux leads: ${error.message}`);
    }

    return (data ?? []) as HubSpotCompanyRow[];
  }));
  const companies = companyBatches.flat();

  return new Map(companies.map((company) => [company.hubspot_company_id, company]));
};

const loadStoredLeadsByOwner = async (
  orgId: string,
  hubspotOwnerId: string,
  limit: number,
): Promise<HubSpotStoredLeadRow[] | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("hubspot_leads")
    .select(
      [
        "hubspot_lead_id",
        "hubspot_owner_id",
        "associated_contact_ids",
        "associated_company_ids",
        "name",
        "pipeline_id",
        "pipeline_label",
        "phase_id",
        "phase_label",
        "hubspot_created_at",
        "hubspot_updated_at",
        "properties",
        "synced_at",
        "updated_at",
      ].join(", "),
    )
    .eq("org_id", orgId)
    .eq("hubspot_owner_id", hubspotOwnerId)
    .order("hubspot_updated_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    if (error.code === "PGRST205" || error.message.includes("hubspot_leads")) {
      return null;
    }

    throw new Error(`Impossible de charger les leads synchronises depuis Supabase: ${error.message}`);
  }

  return ((data ?? []) as unknown) as HubSpotStoredLeadRow[];
};

const upsertLiveLeads = async (
  orgId: string,
  leads: HubSpotLeadRecord[],
): Promise<void> => {
  if (leads.length === 0) {
    return;
  }

  const syncedAt = new Date().toISOString();
  const rows: HubSpotLeadUpsertRow[] = leads.map((lead) => ({
    org_id: orgId,
    hubspot_lead_id: lead.id,
    hubspot_owner_id: lead.hubspotOwnerId,
    associated_contact_ids: lead.associatedContactIds,
    associated_company_ids: lead.associatedCompanyIds,
    name: lead.name,
    pipeline_id: lead.pipelineId,
    pipeline_label: lead.pipelineLabel,
    phase_id: lead.phaseId,
    phase_label: lead.phaseLabel,
    hubspot_created_at: normalizeHubSpotTimestamp(lead.createdAt),
    hubspot_updated_at: normalizeHubSpotTimestamp(lead.updatedAt),
    properties: lead.properties,
    synced_at: syncedAt,
  }));
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("hubspot_leads").upsert(rows, {
    onConflict: "org_id,hubspot_lead_id",
  });

  if (error) {
    throw new Error(`Impossible de persister les leads HubSpot dans Supabase: ${error.message}`);
  }
};

const upsertLiveContacts = async (
  orgId: string,
  contacts: HubSpotContactSnapshotItem[],
): Promise<void> => {
  if (contacts.length === 0) {
    return;
  }

  const syncedAt = new Date().toISOString();
  const rows: HubSpotContactUpsertRow[] = contacts.map((contact) => ({
    org_id: orgId,
    hubspot_contact_id: contact.id,
    hubspot_owner_id: readRecordProperty(contact.properties, "hubspot_owner_id"),
    email: readRecordProperty(contact.properties, "email"),
    name: buildHubSpotContactName(contact.properties),
    phone: readRecordProperty(contact.properties, "phone"),
    title: readRecordProperty(contact.properties, "jobtitle"),
    company_name: readRecordProperty(contact.properties, "company"),
    properties: contact.properties,
    synced_at: syncedAt,
  }));
  const supabase = getSupabaseAdmin();

  for (const batch of createBatches(rows, SUPABASE_IN_BATCH_SIZE)) {
    const { error } = await supabase.from("hubspot_contacts").upsert(batch, {
      onConflict: "org_id,hubspot_contact_id",
    });

    if (error) {
      throw new Error(`Impossible de persister les contacts HubSpot dans Supabase: ${error.message}`);
    }
  }
};

const loadHydratedContactsById = async (
  orgId: string,
  contactIds: string[],
  accessToken: string | (() => Promise<string>),
): Promise<Map<string, HubSpotLeadRow>> => {
  const contactById = await loadLocalContactsById(orgId, contactIds);
  const missingContactIds = Array.from(new Set(contactIds.filter((contactId) => !contactById.has(contactId))));

  if (missingContactIds.length === 0) {
    return contactById;
  }

  const resolvedAccessToken = typeof accessToken === "string" ? accessToken : await accessToken();
  const fetchedContacts = await hubSpotService.fetchContactsByIds(resolvedAccessToken, missingContactIds);
  await upsertLiveContacts(orgId, fetchedContacts);

  return loadLocalContactsById(orgId, contactIds);
};

const mapStoredLead = (
  lead: HubSpotStoredLeadRow,
  contactById: Map<string, HubSpotLeadRow>,
  companyById: Map<string, HubSpotCompanyRow>,
): HubSpotLeadListItem => {
  const contact = lead.associated_contact_ids.map((contactId) => contactById.get(contactId)).find(Boolean) ?? null;
  const company = lead.associated_company_ids.map((companyId) => companyById.get(companyId)).find(Boolean) ?? null;

  return {
    hubspotLeadId: lead.hubspot_lead_id,
    hubspotContactId: contact?.hubspot_contact_id ?? lead.associated_contact_ids[0] ?? "",
    hubspotOwnerId: lead.hubspot_owner_id,
    name: company?.name ?? lead.name,
    email: contact?.email ?? null,
    phone: contact?.phone ?? null,
    title: contact?.title ?? null,
    companyName: company?.name ?? contact?.company_name ?? null,
    pipelineId: lead.pipeline_id,
    pipelineLabel: lead.pipeline_label,
    phaseId: lead.phase_id,
    phaseLabel: lead.phase_label,
    lifecycleStage: contact ? readProperty(contact.properties, "lifecyclestage") : null,
    leadStatus: contact ? readProperty(contact.properties, "hs_lead_status") : null,
    lastActivityAt: contact ? readProperty(contact.properties, "lastactivitydate") : null,
    syncedAt: lead.synced_at,
    updatedAt: lead.hubspot_updated_at ?? lead.updated_at,
  };
};

const mapLiveLead = (
  lead: HubSpotLeadRecord,
  contactById: Map<string, HubSpotLeadRow>,
  companyById: Map<string, HubSpotCompanyRow>,
): HubSpotLeadListItem => {
  const contact = lead.associatedContactIds.map((contactId) => contactById.get(contactId)).find(Boolean) ?? null;
  const company = lead.associatedCompanyIds.map((companyId) => companyById.get(companyId)).find(Boolean) ?? null;

  return {
    hubspotLeadId: lead.id,
    hubspotContactId: contact?.hubspot_contact_id ?? lead.associatedContactIds[0] ?? "",
    hubspotOwnerId: lead.hubspotOwnerId,
    name: company?.name ?? lead.name,
    email: contact?.email ?? null,
    phone: contact?.phone ?? null,
    title: contact?.title ?? null,
    companyName: company?.name ?? contact?.company_name ?? null,
    pipelineId: lead.pipelineId,
    pipelineLabel: lead.pipelineLabel,
    phaseId: lead.phaseId,
    phaseLabel: lead.phaseLabel,
    lifecycleStage: contact ? readProperty(contact.properties, "lifecyclestage") : null,
    leadStatus: contact ? readProperty(contact.properties, "hs_lead_status") : null,
    lastActivityAt: contact ? readProperty(contact.properties, "lastactivitydate") : null,
    syncedAt: contact?.synced_at ?? lead.updatedAt ?? lead.createdAt ?? new Date().toISOString(),
    updatedAt: lead.updatedAt ?? contact?.updated_at ?? contact?.synced_at ?? new Date().toISOString(),
  };
};

const isOpenLead = (lead: HubSpotLeadRecord): boolean => {
  const normalizedPhaseLabel = lead.phaseLabel?.trim().toLowerCase();

  return Boolean(normalizedPhaseLabel && OPEN_LEAD_PHASE_KEYS.has(normalizedPhaseLabel));
};

const isOpenLeadListItem = (lead: HubSpotLeadListItem): boolean => {
  const normalizedPhaseLabel = lead.phaseLabel?.trim().toLowerCase();

  return Boolean(normalizedPhaseLabel && OPEN_LEAD_PHASE_KEYS.has(normalizedPhaseLabel));
};

const toContactScoringInput = (contact: HubSpotLeadRow): LeadContactScoringContactInput => ({
  hubspotContactId: contact.hubspot_contact_id,
  hubspotOwnerId: contact.hubspot_owner_id,
  name: contact.name,
  title: contact.title,
  email: contact.email,
  phone: contact.phone,
  lifecycleStage: readProperty(contact.properties, "lifecyclestage"),
  leadStatus: readProperty(contact.properties, "hs_lead_status"),
  lastActivityAt: readProperty(contact.properties, "lastactivitydate") ?? contact.updated_at ?? contact.synced_at,
});

const mapScoredContact = (contact: ScoredLeadContact): HubSpotLeadContactListItem => ({
  hubspotContactId: contact.hubspotContactId,
  hubspotOwnerId: contact.hubspotOwnerId,
  name: contact.name,
  email: contact.email,
  phone: contact.phone,
  title: contact.title,
  lifecycleStage: contact.lifecycleStage,
  leadStatus: contact.leadStatus,
  lastActivityAt: contact.lastActivityAt,
  deterministicScore: contact.deterministicScore,
  aiScore: contact.aiScore,
  finalScore: contact.finalScore,
  priority: contact.priority,
  reason: contact.reason,
  recommendedAction: contact.recommendedAction,
  confidence: contact.confidence,
  scoringSource: contact.source,
});

const buildStoredLeadAccount = async (
  orgId: string,
  lead: HubSpotStoredLeadRow,
  contactById: Map<string, HubSpotLeadRow>,
  companyById: Map<string, HubSpotCompanyRow>,
  scoreCacheByLeadId: Map<string, Map<string, LeadContactCachedScore>>,
): Promise<HubSpotLeadAccountItem | null> => {
  const normalizedPhaseLabel = lead.phase_label?.trim().toLowerCase();

  if (!normalizedPhaseLabel || !OPEN_LEAD_PHASE_KEYS.has(normalizedPhaseLabel)) {
    return null;
  }

  const contacts = lead.associated_contact_ids
    .map((contactId) => contactById.get(contactId))
    .filter((contact): contact is HubSpotLeadRow => Boolean(contact));
  const company = lead.associated_company_ids.map((companyId) => companyById.get(companyId)).find(Boolean) ?? null;
  const leadName = company?.name ?? lead.name;
  const lastActivityAt =
    contacts
      .map((contact) => readProperty(contact.properties, "lastactivitydate"))
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? lead.hubspot_updated_at ?? lead.updated_at;
  const firstContact = contacts[0] ?? null;
  const scoringLead: LeadContactScoringLeadInput = {
    orgId,
    hubspotLeadId: lead.hubspot_lead_id,
    name: lead.name,
    companyName: leadName,
    pipelineLabel: lead.pipeline_label,
    phaseId: lead.phase_id,
    phaseLabel: lead.phase_label,
    hubspotOwnerId: lead.hubspot_owner_id,
    lastActivityAt,
  };
  const scoredContacts = scoreLeadContactsWithCachedScores(
    scoringLead,
    contacts.map(toContactScoringInput),
    scoreCacheByLeadId.get(lead.hubspot_lead_id),
  );
  const mappedContacts = scoredContacts.map(mapScoredContact);

  return {
    lead: {
      hubspotLeadId: lead.hubspot_lead_id,
      hubspotOwnerId: lead.hubspot_owner_id,
      name: leadName,
      companyName: company?.name ?? firstContact?.company_name ?? leadName,
      pipelineId: lead.pipeline_id,
      pipelineLabel: lead.pipeline_label,
      phaseId: lead.phase_id,
      phaseLabel: lead.phase_label,
      lifecycleStage: firstContact ? readProperty(firstContact.properties, "lifecyclestage") : null,
      leadStatus: firstContact ? readProperty(firstContact.properties, "hs_lead_status") : null,
      lastActivityAt,
      syncedAt: lead.synced_at,
      updatedAt: lead.hubspot_updated_at ?? lead.updated_at,
      contactCount: contacts.length,
    },
    contacts: mappedContacts,
    bestContact: mappedContacts[0] ?? null,
  };
};

const buildLiveLeadAccount = async (
  orgId: string,
  lead: HubSpotLeadRecord,
  contactById: Map<string, HubSpotLeadRow>,
  companyById: Map<string, HubSpotCompanyRow>,
  scoreCacheByLeadId: Map<string, Map<string, LeadContactCachedScore>>,
): Promise<HubSpotLeadAccountItem | null> => {
  if (!isOpenLead(lead)) {
    return null;
  }

  const contacts = lead.associatedContactIds
    .map((contactId) => contactById.get(contactId))
    .filter((contact): contact is HubSpotLeadRow => Boolean(contact));
  const company = lead.associatedCompanyIds.map((companyId) => companyById.get(companyId)).find(Boolean) ?? null;
  const leadName = company?.name ?? lead.name;
  const lastActivityAt =
    contacts
      .map((contact) => readProperty(contact.properties, "lastactivitydate"))
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? lead.updatedAt ?? lead.createdAt ?? new Date().toISOString();
  const firstContact = contacts[0] ?? null;
  const scoringLead: LeadContactScoringLeadInput = {
    orgId,
    hubspotLeadId: lead.id,
    name: lead.name,
    companyName: leadName,
    pipelineLabel: lead.pipelineLabel,
    phaseId: lead.phaseId,
    phaseLabel: lead.phaseLabel,
    hubspotOwnerId: lead.hubspotOwnerId,
    lastActivityAt,
  };
  const scoredContacts = scoreLeadContactsWithCachedScores(
    scoringLead,
    contacts.map(toContactScoringInput),
    scoreCacheByLeadId.get(lead.id),
  );
  const mappedContacts = scoredContacts.map(mapScoredContact);

  return {
    lead: {
      hubspotLeadId: lead.id,
      hubspotOwnerId: lead.hubspotOwnerId,
      name: leadName,
      companyName: company?.name ?? firstContact?.company_name ?? leadName,
      pipelineId: lead.pipelineId,
      pipelineLabel: lead.pipelineLabel,
      phaseId: lead.phaseId,
      phaseLabel: lead.phaseLabel,
      lifecycleStage: firstContact ? readProperty(firstContact.properties, "lifecyclestage") : null,
      leadStatus: firstContact ? readProperty(firstContact.properties, "hs_lead_status") : null,
      lastActivityAt,
      syncedAt: firstContact?.synced_at ?? lead.updatedAt ?? lead.createdAt ?? new Date().toISOString(),
      updatedAt: lead.updatedAt ?? firstContact?.updated_at ?? firstContact?.synced_at ?? new Date().toISOString(),
      contactCount: contacts.length,
    },
    contacts: mappedContacts,
    bestContact: mappedContacts[0] ?? null,
  };
};

const compactAccounts = (accounts: Array<HubSpotLeadAccountItem | null>): HubSpotLeadAccountItem[] =>
  accounts
    .filter((account): account is HubSpotLeadAccountItem => Boolean(account))
    .sort(
      (left, right) =>
        (right.bestContact?.finalScore ?? 0) - (left.bestContact?.finalScore ?? 0) ||
        (right.lead.lastActivityAt ?? "").localeCompare(left.lead.lastActivityAt ?? "") ||
        left.lead.name.localeCompare(right.lead.name, "fr"),
    );

export const registerLeadRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Querystring: LeadsQuery; Reply: ApiResponse<HubSpotLeadAccountsPayload> }>(
    "/api/leads/accounts",
    async (request, reply) => {
      const orgId = request.query.orgId?.trim();
      const hubspotOwnerId = request.query.hubspotOwnerId?.trim();

      if (!orgId || !hubspotOwnerId) {
        return reply.code(400).send({
          success: false,
          error: "Les parametres orgId et hubspotOwnerId sont obligatoires.",
        });
      }

      try {
        const limit = parseLimit(request.query.limit);
        const storedLeads = await loadStoredLeadsByOwner(orgId, hubspotOwnerId, limit);

        const storedContactIds = storedLeads ? Array.from(new Set(storedLeads.flatMap((lead) => lead.associated_contact_ids))) : [];

        if (
          storedLeads &&
          storedLeads.length > 0 &&
          storedContactIds.length > 0 &&
          !hasStaleMissingLeadAssociations(storedLeads)
        ) {
          const contactIds = storedContactIds;
          const companyIds = Array.from(new Set(storedLeads.flatMap((lead) => lead.associated_company_ids)));
          const [contactById, companyById, scoreCacheByLeadId] = await Promise.all([
            loadHydratedContactsById(orgId, contactIds, () => getHubSpotAccessToken(orgId)),
            loadLocalCompaniesById(orgId, companyIds),
            loadLeadContactScoreCacheForLeads(
              orgId,
              storedLeads.map((lead) => lead.hubspot_lead_id),
            ),
          ]);
          const accounts: Array<HubSpotLeadAccountItem | null> = [];

          for (const lead of storedLeads) {
            accounts.push(await buildStoredLeadAccount(orgId, lead, contactById, companyById, scoreCacheByLeadId));
          }

          return reply.send({
            success: true,
            data: {
              orgId,
              hubspotOwnerId,
              accounts: compactAccounts(accounts),
            },
          });
        }

        const accessToken = await getHubSpotAccessToken(orgId);
        const fetchedLiveLeads = await hubSpotService.fetchLeadsByOwner(accessToken, hubspotOwnerId, limit);
        await upsertLiveLeads(orgId, fetchedLiveLeads);

        const liveLeads = fetchedLiveLeads.filter(isOpenLead);
        const contactIds = Array.from(new Set(liveLeads.flatMap((lead) => lead.associatedContactIds)));
        const companyIds = Array.from(new Set(liveLeads.flatMap((lead) => lead.associatedCompanyIds)));
        const [contactById, companyById, scoreCacheByLeadId] = await Promise.all([
          loadHydratedContactsById(orgId, contactIds, accessToken),
          loadLocalCompaniesById(orgId, companyIds),
          loadLeadContactScoreCacheForLeads(
            orgId,
            liveLeads.map((lead) => lead.id),
          ),
        ]);
        const accounts: Array<HubSpotLeadAccountItem | null> = [];

        for (const lead of liveLeads) {
          accounts.push(await buildLiveLeadAccount(orgId, lead, contactById, companyById, scoreCacheByLeadId));
        }

        return reply.send({
          success: true,
          data: {
            orgId,
            hubspotOwnerId,
            accounts: compactAccounts(accounts),
          },
        });
      } catch (error) {
        request.log.error({ error, orgId, hubspotOwnerId }, "Impossible de charger les comptes leads HubSpot.");

        const message =
          error instanceof Error && error.message.includes("crm.objects.leads.read")
            ? "HubSpot refuse la lecture des leads: ajoute le scope crm.objects.leads.read a l'app HubSpot, mets HUBSPOT_SCOPES a jour, puis reconnecte HubSpot pour regenerer les tokens OAuth."
            : error instanceof Error
              ? error.message
              : "Erreur inconnue pendant le chargement des comptes leads.";

        return reply.code(500).send({
          success: false,
          error: message,
        });
      }
    },
  );

  app.get<{ Querystring: LeadsQuery; Reply: ApiResponse<HubSpotLeadsPayload> }>(
    "/api/leads",
    async (request, reply) => {
      const orgId = request.query.orgId?.trim();
      const hubspotOwnerId = request.query.hubspotOwnerId?.trim();

      if (!orgId || !hubspotOwnerId) {
        return reply.code(400).send({
          success: false,
          error: "Les parametres orgId et hubspotOwnerId sont obligatoires.",
        });
      }

      try {
        const limit = parseLimit(request.query.limit);
        const storedLeads = await loadStoredLeadsByOwner(orgId, hubspotOwnerId, limit);

        const storedContactIds = storedLeads ? Array.from(new Set(storedLeads.flatMap((lead) => lead.associated_contact_ids))) : [];

        if (
          storedLeads &&
          storedLeads.length > 0 &&
          storedContactIds.length > 0 &&
          !hasStaleMissingLeadAssociations(storedLeads)
        ) {
          const contactIds = storedContactIds;
          const companyIds = Array.from(new Set(storedLeads.flatMap((lead) => lead.associated_company_ids)));
          const [contactById, companyById] = await Promise.all([
            loadHydratedContactsById(orgId, contactIds, () => getHubSpotAccessToken(orgId)),
            loadLocalCompaniesById(orgId, companyIds),
          ]);
          const leads = storedLeads.map((lead) => mapStoredLead(lead, contactById, companyById)).filter(isOpenLeadListItem);

          return reply.send({
            success: true,
            data: {
              orgId,
              hubspotOwnerId,
              leads,
            },
          });
        }

        const accessToken = await getHubSpotAccessToken(orgId);
        const fetchedLiveLeads = await hubSpotService.fetchLeadsByOwner(accessToken, hubspotOwnerId, limit);
        await upsertLiveLeads(orgId, fetchedLiveLeads);

        const liveLeads = fetchedLiveLeads.filter(isOpenLead);
        const contactIds = Array.from(new Set(liveLeads.flatMap((lead) => lead.associatedContactIds)));
        const companyIds = Array.from(new Set(liveLeads.flatMap((lead) => lead.associatedCompanyIds)));
        const [contactById, companyById] = await Promise.all([
          loadHydratedContactsById(orgId, contactIds, accessToken),
          loadLocalCompaniesById(orgId, companyIds),
        ]);

        return reply.send({
          success: true,
          data: {
            orgId,
            hubspotOwnerId,
            leads: liveLeads.map((lead) => mapLiveLead(lead, contactById, companyById)),
          },
        });
      } catch (error) {
        request.log.error({ error, orgId, hubspotOwnerId }, "Impossible de charger les leads HubSpot.");

        const message =
          error instanceof Error && error.message.includes("crm.objects.leads.read")
            ? "HubSpot refuse la lecture des leads: ajoute le scope crm.objects.leads.read a l'app HubSpot, mets HUBSPOT_SCOPES a jour, puis reconnecte HubSpot pour regenerer les tokens OAuth."
            : error instanceof Error
              ? error.message
              : "Erreur inconnue pendant le chargement des leads.";

        return reply.code(500).send({
          success: false,
          error: message,
        });
      }
    },
  );
};
