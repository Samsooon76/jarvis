import type { ProspectPriority } from "@jarvis/shared";
import { apiPath, type ApiRequestOptions } from "./client";
import { getCachedJson, HUBSPOT_LEADS_CACHE_PREFIX, HUBSPOT_LEADS_CACHE_TTL_MS } from "./cache";

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
  priority: ProspectPriority;
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

export const fetchHubSpotLeads = async (
  orgId: string,
  hubspotOwnerId: string,
  limit = 500,
  options: ApiRequestOptions = {},
  forceRefresh = false,
): Promise<HubSpotLeadListItem[]> => {
  const path = apiPath("/api/leads", { orgId, hubspotOwnerId, limit });
  const payload = await getCachedJson<HubSpotLeadsPayload>(
    `${HUBSPOT_LEADS_CACHE_PREFIX}${path}`,
    path,
    HUBSPOT_LEADS_CACHE_TTL_MS,
    forceRefresh,
    options,
  );

  return payload.leads;
};

export const fetchHubSpotLeadAccounts = async (
  orgId: string,
  hubspotOwnerId: string,
  limit = 500,
  options: ApiRequestOptions = {},
  forceRefresh = false,
): Promise<HubSpotLeadAccountItem[]> => {
  const path = apiPath("/api/leads/accounts", { orgId, hubspotOwnerId, limit });
  const payload = await getCachedJson<HubSpotLeadAccountsPayload>(
    `${HUBSPOT_LEADS_CACHE_PREFIX}${path}`,
    path,
    HUBSPOT_LEADS_CACHE_TTL_MS,
    forceRefresh,
    options,
  );

  return payload.accounts;
};
