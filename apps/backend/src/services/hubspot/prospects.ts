import { scoreProspect } from "../prospects/scoring.service.js";
import {
  HUBSPOT_COMPANY_PROPERTIES,
  HUBSPOT_CONTACT_PROPERTIES,
  HUBSPOT_DEAL_PROPERTIES,
  HUBSPOT_OWNER_PROSPECT_LIMIT,
  fetchAllPages,
  fetchBatchObjects,
  isHubSpotCompanyScopeError,
  sleep,
} from "./client.js";
import { getCompanyName, buildContactName, parseNumericValue, parsePercentage, readProperty, toNullablePropertiesRecord } from "./shared.js";
import { fetchContactsByIds, searchContactsByName } from "./contacts.js";
import {
  fetchAssociatedIdsByDealIds,
  fetchDealDetailsForContacts,
  fetchPrimaryAssociatedCompanyIdsByDealIds,
  fetchPrimaryAssociatedContactIdsByDealIds,
  searchDealsByOwner,
} from "./deals.js";
import { fetchLeadRecordsByOwners } from "./leads.js";
import {
  buildDealStageLookup,
  buildDealStageSnapshot,
  fetchDealPipelines,
  resolveDealClosedState,
  resolveDealLifecycleStatus,
  resolveDealStageLabel,
  type HubSpotDealStageDefinition,
} from "./pipelines.js";
import type {
  HubSpotCompany,
  HubSpotContact,
  HubSpotCrmSyncSnapshot,
  HubSpotDeal,
  HubSpotProspectSyncItem,
} from "./types.js";

export const createProspectSummary = (
  contact: HubSpotContact,
  deal: HubSpotDeal | null,
  company: HubSpotCompany | null,
  dealStageLookup: Map<string, HubSpotDealStageDefinition>,
): HubSpotProspectSyncItem => {
  const dealAmount = parseNumericValue(deal?.properties.amount);
  const closeProbability = parsePercentage(
    deal?.properties.hs_deal_stage_probability ?? contact.properties.hs_lead_status,
  );
  const associatedContactIds = deal?.associations?.contacts?.results.map((item) => item.id) ?? [];
  const dealStageLabel = resolveDealStageLabel(deal, dealStageLookup);
  const dealLifecycleStatus = resolveDealLifecycleStatus(deal, dealStageLookup);
  const isClosedDeal = resolveDealClosedState(dealLifecycleStatus);
  const closedAt = deal?.properties.closedate ?? null;

  return {
    hubspotContactId: contact.id,
    hubspotDealId: deal?.id ?? null,
    name: buildContactName(contact.properties),
    company: getCompanyName(company, contact.properties.company),
    title: contact.properties.jobtitle ?? null,
    phone: contact.properties.phone ?? null,
    email: contact.properties.email ?? null,
    dealStage: deal?.properties.dealstage ?? null,
    dealStageLabel,
    dealAmount,
    closeProbability,
    closedAt,
    dealLifecycleStatus,
    isClosedDeal,
    lastContactAt:
      contact.properties.lastactivitydate ??
      contact.properties.hs_lastmodifieddate ??
      deal?.properties.hs_lastmodifieddate ??
      null,
    ownerHubSpotId:
      deal?.properties.hubspot_owner_id ?? contact.properties.hubspot_owner_id ?? null,
    rawData: {
      source: "hubspot",
      hubspotContactId: contact.id,
      hubspotDealId: deal?.id ?? null,
      dealName: deal?.properties.dealname ?? null,
      dealStageLabel,
      closedAt,
      dealLifecycleStatus,
      isClosedDeal,
      hubspotOwnerId: deal?.properties.hubspot_owner_id ?? contact.properties.hubspot_owner_id ?? null,
      contactOwnerHubSpotId: contact.properties.hubspot_owner_id ?? null,
      dealOwnerHubSpotId: deal?.properties.hubspot_owner_id ?? null,
      contact: {
        id: contact.id,
        properties: toNullablePropertiesRecord(contact.properties, HUBSPOT_CONTACT_PROPERTIES),
      },
      associatedContactIds,
      deal: deal
        ? {
            id: deal.id,
            properties: toNullablePropertiesRecord(deal.properties, HUBSPOT_DEAL_PROPERTIES),
          }
        : null,
      company: company
        ? {
            id: company.id,
            properties: toNullablePropertiesRecord(company.properties, HUBSPOT_COMPANY_PROPERTIES),
          }
        : null,
    },
  };
};

export const computePriorityScore = (prospect: HubSpotProspectSyncItem): number => {
  const companyEmployeeCount = parseNumericValue(prospect.rawData.company?.properties.numberofemployees);
  const companyRevenue = parseNumericValue(prospect.rawData.company?.properties.annualrevenue);

  return scoreProspect({
    dealAmount: prospect.dealAmount,
    closeProbability: prospect.closeProbability,
    dealStage: prospect.dealStage,
    dealStageLabel: prospect.dealStageLabel,
    lastContactAt: prospect.lastContactAt,
    closeDate: prospect.closedAt,
    companyEmployeeCount,
    companyRevenue,
    companyLifecycleStage: prospect.rawData.company?.properties.lifecyclestage ?? null,
    companyIndustry: prospect.rawData.company?.properties.industry?.trim() ?? null,
    companyDomain: prospect.rawData.company?.properties.domain?.trim() ?? null,
    dealName: prospect.rawData.dealName ?? prospect.hubspotDealId,
  }).ai_priority_score;
};

export const fetchCrmSnapshot = async (accessToken: string): Promise<HubSpotCrmSyncSnapshot> => {
    const [contacts, deals, dealPipelines] = await Promise.all([
      fetchAllPages<HubSpotContact>(
        `/crm/v3/objects/contacts?properties=${HUBSPOT_CONTACT_PROPERTIES.join(",")}&associations=deals`,
        accessToken,
      ),
      fetchAllPages<HubSpotDeal>(
        `/crm/v3/objects/deals?properties=${HUBSPOT_DEAL_PROPERTIES.join(",")}&associations=contacts`,
        accessToken,
      ),
      fetchDealPipelines(accessToken),
    ]);
    const dealStageLookup = buildDealStageLookup(dealPipelines);
    const dealStages = buildDealStageSnapshot(dealStageLookup);
    const dealByContactId = new Map<string, HubSpotDeal>();
    const contactIdsByDealId = new Map<string, string[]>();

    for (const deal of deals) {
      const associatedContacts = deal.associations?.contacts?.results ?? [];
      contactIdsByDealId.set(
        deal.id,
        associatedContacts.map((contact) => contact.id),
      );

      for (const contact of associatedContacts) {
        if (!dealByContactId.has(contact.id)) {
          dealByContactId.set(contact.id, deal);
        }
      }
    }

    const primaryCompanyIdByDealId = new Map<string, string | null>();
    let companyIdsByDealId = new Map<string, string[]>();

    try {
      companyIdsByDealId = await fetchAssociatedIdsByDealIds(accessToken, "companies", deals.map((deal) => deal.id));

      for (const [dealId, companyIdsForDeal] of companyIdsByDealId) {
        primaryCompanyIdByDealId.set(dealId, companyIdsForDeal[0] ?? null);
      }
    } catch (error) {
      if (!isHubSpotCompanyScopeError(error)) {
        throw error;
      }
    }

    const companyIds = Array.from(
      new Set(
        Array.from(primaryCompanyIdByDealId.values()).filter((companyId): companyId is string => Boolean(companyId)),
      ),
    );
    let companyById = new Map<string, HubSpotCompany>();

    if (companyIds.length > 0) {
      const companies = await fetchBatchObjects<HubSpotCompany>(
        accessToken,
        "companies",
        companyIds,
        HUBSPOT_COMPANY_PROPERTIES,
      ).catch((error: unknown) => {
        if (isHubSpotCompanyScopeError(error)) {
          return [] as HubSpotCompany[];
        }

        throw error;
      });

      companyById = new Map(companies.map((company) => [company.id, company]));
    }

    const prospects = contacts.map((contact) => {
      const deal = dealByContactId.get(contact.id) ?? null;
      const companyId = deal ? primaryCompanyIdByDealId.get(deal.id) ?? null : null;

      return createProspectSummary(
        contact,
        deal,
        companyId ? companyById.get(companyId) ?? null : null,
        dealStageLookup,
      );
    });
    const leadOwnerIds = Array.from(
      new Set(
        [
          ...contacts.map((contact) => readProperty(contact.properties, "hubspot_owner_id")),
          ...deals.map((deal) => readProperty(deal.properties, "hubspot_owner_id")),
        ].filter((ownerId): ownerId is string => Boolean(ownerId)),
      ),
    );
    const leads = await fetchLeadRecordsByOwners(accessToken, leadOwnerIds);

    return {
      contacts: contacts.map((contact) => ({
        id: contact.id,
        properties: toNullablePropertiesRecord(contact.properties, HUBSPOT_CONTACT_PROPERTIES),
      })),
      deals: deals.map((deal) => ({
        id: deal.id,
        properties: toNullablePropertiesRecord(deal.properties, HUBSPOT_DEAL_PROPERTIES),
        associatedContactIds: contactIdsByDealId.get(deal.id) ?? [],
        associatedCompanyIds: companyIdsByDealId.get(deal.id) ?? [],
      })),
      companies: Array.from(companyById.values()).map((company) => ({
        id: company.id,
        properties: toNullablePropertiesRecord(company.properties, HUBSPOT_COMPANY_PROPERTIES),
      })),
      leads,
      dealStages,
      prospects,
    };
};

export const fetchProspects = async (accessToken: string): Promise<HubSpotProspectSyncItem[]> => {
    const snapshot = await fetchCrmSnapshot(accessToken);

    return snapshot.prospects;
};

export const fetchProspectsByContactNames = async (accessToken: string, contactNames: string[]): Promise<HubSpotProspectSyncItem[]> => {
    const parsedNames = contactNames
      .map((contactName) => contactName.trim().split(/\s+/).filter(Boolean))
      .map((nameParts) => ({
        firstName: nameParts[0] ?? "",
        lastName: nameParts.slice(1).join(" "),
      }))
      .filter((name): name is { firstName: string; lastName: string } => Boolean(name.firstName && name.lastName));

    if (parsedNames.length === 0) {
      return [];
    }

    const [nestedContacts, dealPipelines] = await Promise.all([
      Promise.all(
        parsedNames.map((parsedName) =>
          searchContactsByName(accessToken, parsedName.firstName, parsedName.lastName),
        ),
      ),
      fetchDealPipelines(accessToken),
    ]);
    const contacts = Array.from(
      new Map(nestedContacts.flat().map((contact) => [contact.id, contact])).values(),
    );
    const dealStageLookup = buildDealStageLookup(dealPipelines);

    if (contacts.length === 0) {
      return [];
    }

    const deals = await fetchDealDetailsForContacts(accessToken, contacts);
    const dealByContactId = new Map<string, HubSpotDeal>();

    for (const deal of deals) {
      for (const contact of deal.associations?.contacts?.results ?? []) {
        if (!dealByContactId.has(contact.id)) {
          dealByContactId.set(contact.id, deal);
        }
      }
    }

    const primaryCompanyIdByDealId = new Map<string, string | null>();

    try {
      const companyAssociations = await fetchPrimaryAssociatedCompanyIdsByDealIds(
        accessToken,
        deals.map((deal) => deal.id),
      );

      for (const [dealId, companyId] of companyAssociations) {
        primaryCompanyIdByDealId.set(dealId, companyId);
      }
    } catch (error) {
      if (!isHubSpotCompanyScopeError(error)) {
        throw error;
      }
    }

    const companyIds = Array.from(
      new Set(
        Array.from(primaryCompanyIdByDealId.values()).filter((companyId): companyId is string => Boolean(companyId)),
      ),
    );
    let companyById = new Map<string, HubSpotCompany>();

    if (companyIds.length > 0) {
      const companies = await fetchBatchObjects<HubSpotCompany>(
        accessToken,
        "companies",
        companyIds,
        HUBSPOT_COMPANY_PROPERTIES,
      ).catch((error: unknown) => {
        if (isHubSpotCompanyScopeError(error)) {
          return [] as HubSpotCompany[];
        }

        throw error;
      });

      companyById = new Map(companies.map((company) => [company.id, company]));
    }

    return contacts.map((contact) => {
      const deal = dealByContactId.get(contact.id) ?? null;
      const companyId = deal ? primaryCompanyIdByDealId.get(deal.id) ?? null : null;

      return createProspectSummary(
        contact,
        deal,
        companyId ? companyById.get(companyId) ?? null : null,
        dealStageLookup,
      );
    });
};

export const fetchProspectsByOwner = async (
    accessToken: string,
    hubspotOwnerId: string,
    maxProspects = HUBSPOT_OWNER_PROSPECT_LIMIT,
  ): Promise<HubSpotProspectSyncItem[]> => {
    const [ownerDeals, dealPipelines] = await Promise.all([
      searchDealsByOwner(accessToken, hubspotOwnerId, maxProspects),
      fetchDealPipelines(accessToken),
    ]);
    const dealStageLookup = buildDealStageLookup(dealPipelines);

    if (ownerDeals.length === 0) {
      return [];
    }

    const primaryContactIdByDealId = await fetchPrimaryAssociatedContactIdsByDealIds(
      accessToken,
      ownerDeals.map((deal) => deal.id),
    );
    const contactIds = Array.from(
      new Set(
        ownerDeals
          .map((deal) => primaryContactIdByDealId.get(deal.id) ?? null)
          .filter((contactId): contactId is string => Boolean(contactId)),
      ),
    );
    const contacts = contactIds.length > 0 ? await fetchContactsByIds(accessToken, contactIds) : [];
    const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
    const primaryCompanyIdByDealId = new Map<string, string | null>();

    try {
      const companyAssociations = await fetchPrimaryAssociatedCompanyIdsByDealIds(
        accessToken,
        ownerDeals.map((deal) => deal.id),
      );

      for (const [dealId, companyId] of companyAssociations) {
        primaryCompanyIdByDealId.set(dealId, companyId);
      }
    } catch (error) {
      if (!isHubSpotCompanyScopeError(error)) {
        throw error;
      }
    }

    const companyIds = Array.from(
      new Set(
        Array.from(primaryCompanyIdByDealId.values()).filter((companyId): companyId is string => Boolean(companyId)),
      ),
    );
    let companyById = new Map<string, HubSpotCompany>();

    if (companyIds.length > 0) {
      const companies = await fetchBatchObjects<HubSpotCompany>(
        accessToken,
        "companies",
        companyIds,
        HUBSPOT_COMPANY_PROPERTIES,
      ).catch((error: unknown) => {
        if (isHubSpotCompanyScopeError(error)) {
          return [] as HubSpotCompany[];
        }

        throw error;
      });

      companyById = new Map(companies.map((company) => [company.id, company]));
    }

    return ownerDeals
      .map((deal) => {
        const primaryContactId = primaryContactIdByDealId.get(deal.id) ?? null;
        const primaryContact =
          (primaryContactId ? contactById.get(primaryContactId) : null) ??
          ({
            id: deal.id,
            properties: {
              firstname: "",
              lastname: "",
              email: null,
              phone: null,
              jobtitle: null,
              company: null,
              lastactivitydate: null,
              hs_lastmodifieddate: deal.properties.hs_lastmodifieddate ?? null,
              hubspot_owner_id: deal.properties.hubspot_owner_id ?? null,
            },
          } satisfies HubSpotContact);

        const companyId = primaryCompanyIdByDealId.get(deal.id) ?? null;

        return createProspectSummary(
          primaryContact,
          deal,
          companyId ? companyById.get(companyId) ?? null : null,
          dealStageLookup,
        );
      })
      .sort((left, right) => (right.dealAmount ?? 0) - (left.dealAmount ?? 0));
};

export const fetchCrmSnapshotByOwners = async (
    accessToken: string,
    hubspotOwnerIds: string[],
  ): Promise<HubSpotCrmSyncSnapshot> => {
    const uniqueOwnerIds = Array.from(new Set(hubspotOwnerIds.map((ownerId) => ownerId.trim()).filter(Boolean)));

    if (uniqueOwnerIds.length === 0) {
      return {
        contacts: [],
        deals: [],
        companies: [],
        leads: [],
        dealStages: [],
        prospects: [],
      };
    }

    const ownerDealResults: HubSpotDeal[] = [];
    const ownerLeadRecords = await fetchLeadRecordsByOwners(accessToken, uniqueOwnerIds);

    for (const [index, hubspotOwnerId] of uniqueOwnerIds.entries()) {
      if (index > 0) {
        await sleep(1_500);
      }

      ownerDealResults.push(...(await searchDealsByOwner(accessToken, hubspotOwnerId)));
    }

    const deals = Array.from(new Map(ownerDealResults.map((deal) => [deal.id, deal])).values());
    const dealIds = deals.map((deal) => deal.id);

    if (deals.length === 0) {
      return {
        contacts: [],
        deals: [],
        companies: [],
        leads: ownerLeadRecords,
        dealStages: [],
        prospects: [],
      };
    }

    const [contactIdsByDealId, companyIdsByDealId, dealPipelines] = await Promise.all([
      fetchAssociatedIdsByDealIds(accessToken, "contacts", dealIds),
      fetchAssociatedIdsByDealIds(accessToken, "companies", dealIds).catch((error: unknown) => {
        if (isHubSpotCompanyScopeError(error)) {
          return new Map<string, string[]>();
        }

        throw error;
      }),
      fetchDealPipelines(accessToken),
    ]);
    const dealStageLookup = buildDealStageLookup(dealPipelines);
    const dealStages = buildDealStageSnapshot(dealStageLookup);
    const contactIds = Array.from(new Set(Array.from(contactIdsByDealId.values()).flat()));
    const companyIds = Array.from(new Set(Array.from(companyIdsByDealId.values()).flat()));
    const [contacts, companies] = await Promise.all([
      contactIds.length > 0 ? fetchContactsByIds(accessToken, contactIds) : [],
      companyIds.length > 0
        ? fetchBatchObjects<HubSpotCompany>(accessToken, "companies", companyIds, HUBSPOT_COMPANY_PROPERTIES).catch(
            (error: unknown) => {
              if (isHubSpotCompanyScopeError(error)) {
                return [] as HubSpotCompany[];
              }

              throw error;
            },
          )
        : [],
    ]);
    const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
    const companyById = new Map(companies.map((company) => [company.id, company]));
    const prospects = deals
      .map((deal) => {
        const contactIdsForDeal = contactIdsByDealId.get(deal.id) ?? [];
        const companyIdsForDeal = companyIdsByDealId.get(deal.id) ?? [];
        const primaryContact =
          contactIdsForDeal.map((contactId) => contactById.get(contactId)).find(Boolean) ??
          ({
            id: deal.id,
            properties: {
              firstname: "",
              lastname: "",
              email: null,
              phone: null,
              jobtitle: null,
              company: null,
              lastactivitydate: null,
              hs_lastmodifieddate: deal.properties.hs_lastmodifieddate ?? null,
              hubspot_owner_id: deal.properties.hubspot_owner_id ?? null,
            },
          } satisfies HubSpotContact);
        const primaryCompany =
          companyIdsForDeal.map((companyId) => companyById.get(companyId)).find(Boolean) ?? null;

        return createProspectSummary(primaryContact, deal, primaryCompany, dealStageLookup);
      })
      .sort((left, right) => (right.dealAmount ?? 0) - (left.dealAmount ?? 0));

    return {
      contacts: contacts.map((contact) => ({
        id: contact.id,
        properties: toNullablePropertiesRecord(contact.properties, HUBSPOT_CONTACT_PROPERTIES),
      })),
      deals: deals.map((deal) => ({
        id: deal.id,
        properties: toNullablePropertiesRecord(deal.properties, HUBSPOT_DEAL_PROPERTIES),
        associatedContactIds: contactIdsByDealId.get(deal.id) ?? [],
        associatedCompanyIds: companyIdsByDealId.get(deal.id) ?? [],
      })),
      companies: companies.map((company) => ({
        id: company.id,
        properties: toNullablePropertiesRecord(company.properties, HUBSPOT_COMPANY_PROPERTIES),
      })),
      leads: ownerLeadRecords,
      dealStages,
      prospects,
    };
};
