import {
  HUBSPOT_BATCH_READ_LIMIT,
  HUBSPOT_DEFAULT_MAX_RETRIES,
  HUBSPOT_LEAD_OBJECT_TYPE,
  HUBSPOT_LEAD_PROPERTIES,
  HUBSPOT_OWNER_LEAD_LIMIT,
  fetchAssociatedIdMapForMany,
  hubSpotFetch,
  isHubSpotCompanyScopeError,
  isHubSpotLeadScopeError,
  sleep,
} from "./client.js";
import { fetchPipelineStageLookup, type HubSpotDealStageDefinition } from "./pipelines.js";
import { readProperty, toNullablePropertiesRecord } from "./shared.js";
import type { HubSpotLead, HubSpotLeadRecord, HubSpotSearchResponse } from "./types.js";

export const searchLeadsByOwner = async (
  accessToken: string,
  objectType: string,
  hubspotOwnerId: string,
  maxResults: number,
): Promise<HubSpotLead[]> => {
  const leads: HubSpotLead[] = [];
  let after: string | undefined;

  do {
    const remaining = maxResults - leads.length;
    const payload = await hubSpotFetch<HubSpotSearchResponse<HubSpotLead>>(
      `/crm/v3/objects/${objectType}/search`,
      {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          limit: Math.min(HUBSPOT_BATCH_READ_LIMIT, remaining),
          after,
          properties: HUBSPOT_LEAD_PROPERTIES,
          associations: ["contacts", "companies"],
          filterGroups: [
            {
              filters: [
                {
                  propertyName: "hubspot_owner_id",
                  operator: "EQ",
                  value: hubspotOwnerId,
                },
              ],
            },
          ],
          sorts: [
            {
              propertyName: "hs_lastmodifieddate",
              direction: "DESCENDING",
            },
          ],
        }),
        maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
      },
    );

    leads.push(...payload.results);
    after = payload.paging?.next?.after;
  } while (after && leads.length < maxResults);

  return leads.slice(0, maxResults);
};

export const mapLeadRecord = (
  lead: HubSpotLead,
  stageById: Map<string, HubSpotDealStageDefinition>,
  associatedContactIds?: string[],
  associatedCompanyIds?: string[],
): HubSpotLeadRecord => {
  const pipelineId = readProperty(lead.properties, "hs_pipeline");
  const phaseId = readProperty(lead.properties, "hs_pipeline_stage");
  const stage = phaseId ? stageById.get(phaseId) ?? null : null;
  const leadName = readProperty(lead.properties, "hs_lead_name");

  return {
    id: lead.id,
    hubspotOwnerId: readProperty(lead.properties, "hubspot_owner_id"),
    name: leadName ?? `Lead ${lead.id}`,
    pipelineId,
    pipelineLabel: stage?.pipelineLabel ?? null,
    phaseId,
    phaseLabel: stage?.label ?? phaseId,
    associatedContactIds: associatedContactIds ?? lead.associations?.contacts?.results.map((contact) => contact.id) ?? [],
    associatedCompanyIds: associatedCompanyIds ?? lead.associations?.companies?.results.map((company) => company.id) ?? [],
    createdAt: readProperty(lead.properties, "hs_createdate"),
    updatedAt: readProperty(lead.properties, "hs_lastmodifieddate"),
    properties: toNullablePropertiesRecord(lead.properties, HUBSPOT_LEAD_PROPERTIES),
  };
};

export const fetchLeadRecordsByOwners = async (
  accessToken: string,
  hubspotOwnerIds: string[],
): Promise<HubSpotLeadRecord[]> => {
  const uniqueOwnerIds = Array.from(new Set(hubspotOwnerIds.map((ownerId) => ownerId.trim()).filter(Boolean)));

  if (uniqueOwnerIds.length === 0) {
    return [];
  }

  try {
    const stageById = await fetchPipelineStageLookup(accessToken, HUBSPOT_LEAD_OBJECT_TYPE);
    const leadResults: HubSpotLead[] = [];

    for (const [index, hubspotOwnerId] of uniqueOwnerIds.entries()) {
      if (index > 0) {
        await sleep(1_500);
      }

      leadResults.push(...(await searchLeadsByOwner(accessToken, HUBSPOT_LEAD_OBJECT_TYPE, hubspotOwnerId, HUBSPOT_OWNER_LEAD_LIMIT)));
    }

    const leads = Array.from(new Map(leadResults.map((lead) => [lead.id, lead])).values());

    const [contactIdsByLeadId, companyIdsByLeadId] = await Promise.all([
      fetchAssociatedIdMapForMany(accessToken, HUBSPOT_LEAD_OBJECT_TYPE, leads.map((lead) => lead.id), "contacts"),
      fetchAssociatedIdMapForMany(accessToken, HUBSPOT_LEAD_OBJECT_TYPE, leads.map((lead) => lead.id), "companies").catch(
        (error: unknown) => {
          if (isHubSpotCompanyScopeError(error)) {
            return new Map<string, string[]>();
          }

          throw error;
        },
      ),
    ]);

    return leads.map((lead) => mapLeadRecord(lead, stageById, contactIdsByLeadId.get(lead.id), companyIdsByLeadId.get(lead.id)));
  } catch (error) {
    if (isHubSpotLeadScopeError(error)) {
      throw new Error(
        "HubSpot refuse la lecture des leads. Ajoute le scope crm.objects.leads.read puis reconnecte HubSpot.",
      );
    }

    throw error;
  }
};

export const fetchLeadById = async (accessToken: string, leadId: string): Promise<HubSpotLeadRecord | null> => {
  try {
    const lead = await hubSpotFetch<HubSpotLead>(
      `/crm/v3/objects/${HUBSPOT_LEAD_OBJECT_TYPE}/${leadId}?properties=${HUBSPOT_LEAD_PROPERTIES.join(",")}`,
      {
        accessToken,
        maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
      },
    );
    const [stageById, contactIds, companyIds] = await Promise.all([
      fetchPipelineStageLookup(accessToken, HUBSPOT_LEAD_OBJECT_TYPE),
      fetchAssociatedIdMapForMany(accessToken, HUBSPOT_LEAD_OBJECT_TYPE, [lead.id], "contacts"),
      fetchAssociatedIdMapForMany(accessToken, HUBSPOT_LEAD_OBJECT_TYPE, [lead.id], "companies").catch(
        (error: unknown) => {
          if (isHubSpotCompanyScopeError(error)) {
            return new Map<string, string[]>();
          }

          throw error;
        },
      ),
    ]);

    return mapLeadRecord(lead, stageById, contactIds.get(lead.id), companyIds.get(lead.id));
  } catch (error) {
    if (isHubSpotLeadScopeError(error)) {
      return null;
    }

    throw error;
  }
};

export const fetchLeadsByOwner = async (
  accessToken: string,
  hubspotOwnerId: string,
  limit: number,
): Promise<HubSpotLeadRecord[]> => {
  const [leads, stageById] = await Promise.all([
    searchLeadsByOwner(accessToken, HUBSPOT_LEAD_OBJECT_TYPE, hubspotOwnerId, limit),
    fetchPipelineStageLookup(accessToken, HUBSPOT_LEAD_OBJECT_TYPE),
  ]);
  const [contactIdsByLeadId, companyIdsByLeadId] = await Promise.all([
    fetchAssociatedIdMapForMany(accessToken, HUBSPOT_LEAD_OBJECT_TYPE, leads.map((lead) => lead.id), "contacts"),
    fetchAssociatedIdMapForMany(accessToken, HUBSPOT_LEAD_OBJECT_TYPE, leads.map((lead) => lead.id), "companies").catch(
      (error: unknown) => {
        if (isHubSpotCompanyScopeError(error)) {
          return new Map<string, string[]>();
        }

        throw error;
      },
    ),
  ]);

  return leads.map((lead) => mapLeadRecord(lead, stageById, contactIdsByLeadId.get(lead.id), companyIdsByLeadId.get(lead.id)));
};
