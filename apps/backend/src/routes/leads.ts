import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import { getSupabaseAdmin } from "../db/client.js";
import type { Json } from "../db/database.types.js";
import { getHubSpotAccessToken } from "../services/hubspot-auth.service.js";
import { hubSpotService, type HubSpotLeadRecord } from "../services/hubspot.service.js";

type LeadsQuery = {
  orgId?: string;
  hubspotOwnerId?: string;
  limit?: string;
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

type HubSpotLeadsPayload = {
  orgId: string;
  hubspotOwnerId: string;
  leads: HubSpotLeadListItem[];
};

const MAX_LEADS_LIMIT = 500;
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

const parseLimit = (value: string | undefined): number => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return MAX_LEADS_LIMIT;
  }

  return Math.min(parsed, MAX_LEADS_LIMIT);
};

const loadLocalContactsById = async (
  orgId: string,
  contactIds: string[],
): Promise<Map<string, HubSpotLeadRow>> => {
  if (contactIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("hubspot_contacts")
    .select("hubspot_contact_id, hubspot_owner_id, email, name, phone, title, company_name, properties, synced_at, updated_at")
    .eq("org_id", orgId)
    .in("hubspot_contact_id", contactIds);

  if (error) {
    throw new Error(`Impossible de charger les contacts associes aux leads: ${error.message}`);
  }

  return new Map(((data ?? []) as HubSpotLeadRow[]).map((contact) => [contact.hubspot_contact_id, contact]));
};

const loadLocalCompaniesById = async (
  orgId: string,
  companyIds: string[],
): Promise<Map<string, HubSpotCompanyRow>> => {
  if (companyIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("hubspot_companies")
    .select("hubspot_company_id, name")
    .eq("org_id", orgId)
    .in("hubspot_company_id", companyIds);

  if (error) {
    throw new Error(`Impossible de charger les societes associees aux leads: ${error.message}`);
  }

  return new Map(((data ?? []) as HubSpotCompanyRow[]).map((company) => [company.hubspot_company_id, company]));
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
    name: contact?.name ?? lead.name,
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

export const registerLeadRoutes = async (app: FastifyInstance): Promise<void> => {
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
        const accessToken = await getHubSpotAccessToken(orgId);
        const liveLeads = (await hubSpotService.fetchLeadsByOwner(accessToken, hubspotOwnerId, limit)).filter(isOpenLead);
        const contactIds = Array.from(new Set(liveLeads.flatMap((lead) => lead.associatedContactIds)));
        const companyIds = Array.from(new Set(liveLeads.flatMap((lead) => lead.associatedCompanyIds)));
        const [contactById, companyById] = await Promise.all([
          loadLocalContactsById(orgId, contactIds),
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
