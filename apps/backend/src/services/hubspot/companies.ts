import {
  HUBSPOT_BATCH_READ_LIMIT,
  HUBSPOT_COMPANY_PROPERTIES,
  HUBSPOT_DEFAULT_MAX_RETRIES,
  createBatches,
  fetchAssociatedIds,
  hubSpotFetch,
} from "./client.js";
import { buildContextSummary, readProperty } from "./shared.js";
import type { HubSpotCompany } from "./types.js";

export const buildCompanyContextSummary = (company: HubSpotCompany | null): string | null => {
  if (!company) {
    return null;
  }

  return buildContextSummary([
    ["Entreprise", readProperty(company.properties, "name")],
    ["Domaine", readProperty(company.properties, "domain")],
    ["Secteur", readProperty(company.properties, "industry")],
    ["Ville", readProperty(company.properties, "city")],
    ["Pays", readProperty(company.properties, "country")],
    ["Employes", readProperty(company.properties, "numberofemployees")],
    ["Revenu annuel", readProperty(company.properties, "annualrevenue")],
    ["Lifecycle stage", readProperty(company.properties, "lifecyclestage")],
    ["Derniere modification", readProperty(company.properties, "hs_lastmodifieddate")],
  ]);
};

export const fetchCompaniesByIds = async (accessToken: string, companyIds: string[]): Promise<HubSpotCompany[]> => {
  const companies: HubSpotCompany[] = [];

  for (const batch of createBatches(companyIds, HUBSPOT_BATCH_READ_LIMIT)) {
    const payload = await hubSpotFetch<{ results: HubSpotCompany[] }>("/crm/v3/objects/companies/batch/read", {
      method: "POST",
      accessToken,
      body: JSON.stringify({
        inputs: batch.map((companyId) => ({
          id: companyId,
        })),
        properties: HUBSPOT_COMPANY_PROPERTIES,
      }),
      maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
    });

    companies.push(...payload.results);
  }

  return companies;
};

export const fetchAssociatedDealIdsForCompany = async (accessToken: string, companyId: string): Promise<string[]> =>
  fetchAssociatedIds(accessToken, "companies", companyId, "deals");
