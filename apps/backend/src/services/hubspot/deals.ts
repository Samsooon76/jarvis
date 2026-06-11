import {
  HUBSPOT_ASSOCIATION_CONCURRENCY,
  HUBSPOT_BATCH_READ_LIMIT,
  HUBSPOT_CALL_PROPERTIES,
  HUBSPOT_COMMUNICATION_PROPERTIES,
  HUBSPOT_COMPANY_PROPERTIES,
  HUBSPOT_DEAL_PROPERTIES,
  HUBSPOT_DEFAULT_MAX_RETRIES,
  HUBSPOT_DETAIL_CONCURRENCY,
  HUBSPOT_EMAIL_PROPERTIES,
  HUBSPOT_MEETING_PROPERTIES,
  HUBSPOT_NOTE_PROPERTIES,
  HUBSPOT_TASK_PROPERTIES,
  createBatches,
  fetchAssociatedIds,
  fetchAssociatedIdsForMany,
  fetchBatchObjects,
  fetchObjectById,
  hubSpotFetch,
  isHubSpotCompanyScopeError,
} from "./client.js";
import { communicationRecordToHistoryType, toHistoryItem } from "./activities.js";
import { buildCompanyContextSummary } from "./companies.js";
import { buildContactDisplayName, fetchContactsByIds } from "./contacts.js";
import { buildContextSummary, getCompanyName, readProperty } from "./shared.js";
import type {
  HubSpotCall,
  HubSpotCommunication,
  HubSpotCompany,
  HubSpotContact,
  HubSpotDeal,
  HubSpotDealActivityDebug,
  HubSpotDealHistory,
  HubSpotDealHistoryItem,
  HubSpotEmail,
  HubSpotMeeting,
  HubSpotNote,
  HubSpotPropertyHistoryEntry,
  HubSpotSearchResponse,
  HubSpotTask,
} from "./types.js";

export const buildDealContextSummary = (deal: HubSpotDeal | null): string | null => {
  if (!deal) {
    return null;
  }

  return buildContextSummary([
    ["Nom du deal", readProperty(deal.properties, "dealname")],
    ["Stage", readProperty(deal.properties, "dealstage")],
    ["Montant", readProperty(deal.properties, "amount")],
    ["Probabilite", readProperty(deal.properties, "hs_deal_stage_probability")],
    ["Date de closing", readProperty(deal.properties, "closedate")],
    ["Derniere modification", readProperty(deal.properties, "hs_lastmodifieddate")],
  ]);
};

export const searchDealsByOwner = async (
  accessToken: string,
  hubspotOwnerId: string,
  maxResults?: number,
): Promise<HubSpotDeal[]> => {
  const deals: HubSpotDeal[] = [];
  let after: string | undefined;

  do {
    const remaining = typeof maxResults === "number" ? maxResults - deals.length : HUBSPOT_BATCH_READ_LIMIT;
    const payload = await hubSpotFetch<HubSpotSearchResponse<HubSpotDeal>>("/crm/v3/objects/deals/search", {
      method: "POST",
      accessToken,
      body: JSON.stringify({
        limit: Math.min(HUBSPOT_BATCH_READ_LIMIT, remaining),
        after,
        properties: HUBSPOT_DEAL_PROPERTIES,
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
    });

    deals.push(...payload.results);
    after = payload.paging?.next?.after;
  } while (after && (typeof maxResults !== "number" || deals.length < maxResults));

  return deals;
};

export const fetchDealDetailsForContacts = async (
  accessToken: string,
  contacts: HubSpotContact[],
): Promise<HubSpotDeal[]> => {
  const nestedDealIds = await Promise.all(
    contacts.map((contact) => fetchAssociatedIds(accessToken, "contacts", contact.id, "deals")),
  );
  const dealIds = Array.from(new Set(nestedDealIds.flat()));

  return dealIds.length > 0 ? fetchDealDetailsByIds(accessToken, dealIds) : [];
};

export const fetchDealDetailsByIds = async (accessToken: string, dealIds: string[]): Promise<HubSpotDeal[]> => {
  const deals: HubSpotDeal[] = [];

  for (const batch of createBatches(dealIds, HUBSPOT_DETAIL_CONCURRENCY)) {
    const batchDeals = await Promise.all(
      batch.map((dealId) =>
        hubSpotFetch<HubSpotDeal>(
          `/crm/v3/objects/deals/${dealId}?properties=${HUBSPOT_DEAL_PROPERTIES.join(",")}&associations=contacts,companies`,
          {
            accessToken,
            maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
          },
        ),
      ),
    );

    deals.push(...batchDeals);
  }

  return deals;
};

export const fetchPrimaryAssociatedContactIdsByDealIds = async (
  accessToken: string,
  dealIds: string[],
): Promise<Map<string, string | null>> => {
  const primaryContactIdByDealId = new Map<string, string | null>();

  for (const batch of createBatches(dealIds, HUBSPOT_ASSOCIATION_CONCURRENCY)) {
    const batchResults = await Promise.all(
      batch.map(async (dealId) => {
        const contactIds = await fetchAssociatedIds(accessToken, "deals", dealId, "contacts");

        return [dealId, contactIds[0] ?? null] as const;
      }),
    );

    for (const [dealId, contactId] of batchResults) {
      primaryContactIdByDealId.set(dealId, contactId);
    }
  }

  return primaryContactIdByDealId;
};

export const fetchPrimaryAssociatedCompanyIdsByDealIds = async (
  accessToken: string,
  dealIds: string[],
): Promise<Map<string, string | null>> => {
  const primaryCompanyIdByDealId = new Map<string, string | null>();

  for (const batch of createBatches(dealIds, HUBSPOT_ASSOCIATION_CONCURRENCY)) {
    const batchResults = await Promise.all(
      batch.map(async (dealId) => {
        const companyIds = await fetchAssociatedIds(accessToken, "deals", dealId, "companies");

        return [dealId, companyIds[0] ?? null] as const;
      }),
    );

    for (const [dealId, companyId] of batchResults) {
      primaryCompanyIdByDealId.set(dealId, companyId);
    }
  }

  return primaryCompanyIdByDealId;
};

export const fetchAssociatedIdsByDealIds = async (
  accessToken: string,
  toObjectType: "contacts" | "companies",
  dealIds: string[],
): Promise<Map<string, string[]>> => {
  const idsByDealId = new Map<string, string[]>();

  for (const batch of createBatches(dealIds, HUBSPOT_ASSOCIATION_CONCURRENCY)) {
    const batchResults = await Promise.all(
      batch.map(async (dealId) => {
        const associatedIds = await fetchAssociatedIds(accessToken, "deals", dealId, toObjectType);

        return [dealId, associatedIds] as const;
      }),
    );

    for (const [dealId, associatedIds] of batchResults) {
      idsByDealId.set(dealId, associatedIds);
    }
  }

  return idsByDealId;
};

export const fetchDealHistory = async (accessToken: string, dealId: string): Promise<HubSpotDealHistory> => {
    const deal = await fetchObjectById<HubSpotDeal>(accessToken, "deals", dealId, HUBSPOT_DEAL_PROPERTIES, [
      "contacts",
      "companies",
    ]);
    const contactIds = await fetchAssociatedIds(accessToken, "deals", dealId, "contacts");
    let companyIds: string[] = [];

    try {
      companyIds = await fetchAssociatedIds(accessToken, "deals", dealId, "companies");
    } catch (error) {
      if (!isHubSpotCompanyScopeError(error)) {
        throw error;
      }
    }

    const [dealNoteIds, dealCallIds, dealMeetingIds, dealEmailIds, dealCommunicationIds, dealTaskIds] = await Promise.all([
      fetchAssociatedIds(accessToken, "deals", dealId, "notes"),
      fetchAssociatedIds(accessToken, "deals", dealId, "calls"),
      fetchAssociatedIds(accessToken, "deals", dealId, "meetings"),
      fetchAssociatedIds(accessToken, "deals", dealId, "emails"),
      fetchAssociatedIds(accessToken, "deals", dealId, "communications"),
      fetchAssociatedIds(accessToken, "deals", dealId, "tasks"),
    ]);
    const [
      contactNoteIds,
      contactCallIds,
      contactMeetingIds,
      contactEmailIds,
      contactCommunicationIds,
      contactTaskIds,
      companyNoteIds,
      companyCallIds,
      companyMeetingIds,
      companyEmailIds,
      companyCommunicationIds,
      companyTaskIds,
    ] = await Promise.all([
      fetchAssociatedIdsForMany(accessToken, "contacts", contactIds, "notes"),
      fetchAssociatedIdsForMany(accessToken, "contacts", contactIds, "calls"),
      fetchAssociatedIdsForMany(accessToken, "contacts", contactIds, "meetings"),
      fetchAssociatedIdsForMany(accessToken, "contacts", contactIds, "emails"),
      fetchAssociatedIdsForMany(accessToken, "contacts", contactIds, "communications"),
      fetchAssociatedIdsForMany(accessToken, "contacts", contactIds, "tasks"),
      Promise.resolve<string[]>([]),
      Promise.resolve<string[]>([]),
      Promise.resolve<string[]>([]),
      Promise.resolve<string[]>([]),
      Promise.resolve<string[]>([]),
      Promise.resolve<string[]>([]),
    ]);

    if (companyIds.length > 0) {
      try {
        const [
          scopedCompanyNoteIds,
          scopedCompanyCallIds,
          scopedCompanyMeetingIds,
          scopedCompanyEmailIds,
          scopedCompanyCommunicationIds,
          scopedCompanyTaskIds,
        ] = await Promise.all([
          fetchAssociatedIdsForMany(accessToken, "companies", companyIds, "notes"),
          fetchAssociatedIdsForMany(accessToken, "companies", companyIds, "calls"),
          fetchAssociatedIdsForMany(accessToken, "companies", companyIds, "meetings"),
          fetchAssociatedIdsForMany(accessToken, "companies", companyIds, "emails"),
          fetchAssociatedIdsForMany(accessToken, "companies", companyIds, "communications"),
          fetchAssociatedIdsForMany(accessToken, "companies", companyIds, "tasks"),
        ]);

        companyNoteIds.push(...scopedCompanyNoteIds);
        companyCallIds.push(...scopedCompanyCallIds);
        companyMeetingIds.push(...scopedCompanyMeetingIds);
        companyEmailIds.push(...scopedCompanyEmailIds);
        companyCommunicationIds.push(...scopedCompanyCommunicationIds);
        companyTaskIds.push(...scopedCompanyTaskIds);
      } catch (error) {
        if (!isHubSpotCompanyScopeError(error)) {
          throw error;
        }
      }
    }
    const noteIds = Array.from(new Set([...dealNoteIds, ...contactNoteIds, ...companyNoteIds]));
    const callIds = Array.from(new Set([...dealCallIds, ...contactCallIds, ...companyCallIds]));
    const meetingIds = Array.from(new Set([...dealMeetingIds, ...contactMeetingIds, ...companyMeetingIds]));
    const emailIds = Array.from(new Set([...dealEmailIds, ...contactEmailIds, ...companyEmailIds]));
    const communicationIds = Array.from(
      new Set([...dealCommunicationIds, ...contactCommunicationIds, ...companyCommunicationIds]),
    );
    const taskIds = Array.from(new Set([...dealTaskIds, ...contactTaskIds, ...companyTaskIds]));
    let companies: HubSpotCompany[] = [];

    const [contacts, notes, calls, meetings, emails, communications, tasks] = await Promise.all([
      fetchContactsByIds(accessToken, contactIds),
      fetchBatchObjects<HubSpotNote>(accessToken, "notes", noteIds, HUBSPOT_NOTE_PROPERTIES),
      fetchBatchObjects<HubSpotCall>(accessToken, "calls", callIds, HUBSPOT_CALL_PROPERTIES),
      fetchBatchObjects<HubSpotMeeting>(accessToken, "meetings", meetingIds, HUBSPOT_MEETING_PROPERTIES),
      fetchBatchObjects<HubSpotEmail>(accessToken, "emails", emailIds, HUBSPOT_EMAIL_PROPERTIES),
      fetchBatchObjects<HubSpotCommunication>(
        accessToken,
        "communications",
        communicationIds,
        HUBSPOT_COMMUNICATION_PROPERTIES,
      ),
      fetchBatchObjects<HubSpotTask>(accessToken, "tasks", taskIds, HUBSPOT_TASK_PROPERTIES),
    ]);

    if (companyIds.length > 0) {
      try {
        companies = await fetchBatchObjects<{ id: string; properties: Record<string, string | null | undefined> }>(
          accessToken,
          "companies",
          companyIds,
          HUBSPOT_COMPANY_PROPERTIES,
        );
      } catch (error) {
        if (!isHubSpotCompanyScopeError(error)) {
          throw error;
        }
      }
    }
    const timeline: HubSpotDealHistoryItem[] = [
      toHistoryItem("deal", deal),
      ...notes.map((item) => toHistoryItem("note", item)),
      ...calls.map((item) => toHistoryItem("call", item)),
      ...meetings.map((item) => toHistoryItem("meeting", item)),
      ...emails.map((item) => toHistoryItem("email", item)),
      ...communications.map((item) => toHistoryItem(communicationRecordToHistoryType(item), item)),
      ...tasks.map((item) => toHistoryItem("task", item)),
    ].sort((left, right) => {
      const leftValue = left.timestamp ? new Date(left.timestamp).getTime() : 0;
      const rightValue = right.timestamp ? new Date(right.timestamp).getTime() : 0;

      return leftValue - rightValue;
    });

    const primaryCompany = companies[0] ?? null;

    return {
      dealId,
      dealName: readProperty(deal.properties, "dealname"),
      companyName: getCompanyName(primaryCompany, null),
      dealContext: buildDealContextSummary(deal),
      companyContext: buildCompanyContextSummary(primaryCompany),
      contactNames: contacts.map((contact) => buildContactDisplayName(contact)),
      timeline,
    };
};

  // Historique date d'une propriete de deal via l'API HubSpot propertiesWithHistory.
  // Renvoie les versions de la valeur dans l'ordre chronologique croissant.
export const fetchDealPropertyHistory = async (
    accessToken: string,
    dealId: string,
    propertyName: string,
  ): Promise<HubSpotPropertyHistoryEntry[]> => {
    const query = new URLSearchParams();
    query.set("propertiesWithHistory", propertyName);

    const deal = await hubSpotFetch<{
      propertiesWithHistory?: Record<string, Array<{ value?: string | null; timestamp?: string | null }>>;
    }>(`/crm/v3/objects/deals/${dealId}?${query.toString()}`, {
      accessToken,
      maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
    }).catch((error: unknown) => {
      if (error instanceof Error && error.message.includes("(404)")) {
        return null;
      }

      throw error;
    });

    const rawHistory = deal?.propertiesWithHistory?.[propertyName] ?? [];

    return rawHistory
      .map((entry) => ({
        value: typeof entry.value === "string" ? entry.value : entry.value == null ? null : String(entry.value),
        timestamp: entry.timestamp ?? null,
      }))
      .filter((entry): entry is HubSpotPropertyHistoryEntry => Boolean(entry.timestamp))
      .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
};

export const fetchDealActivityDebug = async (accessToken: string, dealId: string): Promise<HubSpotDealActivityDebug> => {
    const contactIds = await fetchAssociatedIds(accessToken, "deals", dealId, "contacts");
    const companyIds = await fetchAssociatedIds(accessToken, "deals", dealId, "companies").catch(() => []);
    const [
      dealNoteIds,
      dealCallIds,
      dealMeetingIds,
      dealEmailIds,
      dealCommunicationIds,
      dealTaskIds,
      contactNoteIds,
      contactCallIds,
      contactMeetingIds,
      contactEmailIds,
      contactCommunicationIds,
      contactTaskIds,
      companyNoteIds,
      companyCallIds,
      companyMeetingIds,
      companyEmailIds,
      companyCommunicationIds,
      companyTaskIds,
      history,
    ] = await Promise.all([
      fetchAssociatedIds(accessToken, "deals", dealId, "notes"),
      fetchAssociatedIds(accessToken, "deals", dealId, "calls"),
      fetchAssociatedIds(accessToken, "deals", dealId, "meetings"),
      fetchAssociatedIds(accessToken, "deals", dealId, "emails"),
      fetchAssociatedIds(accessToken, "deals", dealId, "communications"),
      fetchAssociatedIds(accessToken, "deals", dealId, "tasks"),
      fetchAssociatedIdsForMany(accessToken, "contacts", contactIds, "notes"),
      fetchAssociatedIdsForMany(accessToken, "contacts", contactIds, "calls"),
      fetchAssociatedIdsForMany(accessToken, "contacts", contactIds, "meetings"),
      fetchAssociatedIdsForMany(accessToken, "contacts", contactIds, "emails"),
      fetchAssociatedIdsForMany(accessToken, "contacts", contactIds, "communications"),
      fetchAssociatedIdsForMany(accessToken, "contacts", contactIds, "tasks"),
      fetchAssociatedIdsForMany(accessToken, "companies", companyIds, "notes").catch(() => []),
      fetchAssociatedIdsForMany(accessToken, "companies", companyIds, "calls").catch(() => []),
      fetchAssociatedIdsForMany(accessToken, "companies", companyIds, "meetings").catch(() => []),
      fetchAssociatedIdsForMany(accessToken, "companies", companyIds, "emails").catch(() => []),
      fetchAssociatedIdsForMany(accessToken, "companies", companyIds, "communications").catch(() => []),
      fetchAssociatedIdsForMany(accessToken, "companies", companyIds, "tasks").catch(() => []),
      fetchDealHistory(accessToken, dealId),
    ]);
    const countByType = history.timeline.reduce<Record<HubSpotDealHistoryItem["type"], number>>(
      (counts, item) => {
        counts[item.type] += 1;
        return counts;
      },
      { deal: 0, note: 0, call: 0, meeting: 0, email: 0, sms: 0, communication: 0, task: 0 },
    );
    const uniqueCommunicationIds = Array.from(
      new Set([...dealCommunicationIds, ...contactCommunicationIds, ...companyCommunicationIds]),
    );

    return {
      dealId,
      directAssociationCounts: {
        notes: dealNoteIds.length,
        calls: dealCallIds.length,
        meetings: dealMeetingIds.length,
        emails: dealEmailIds.length,
        communications: dealCommunicationIds.length,
        tasks: dealTaskIds.length,
      },
      contactAssociationCounts: {
        notes: contactNoteIds.length,
        calls: contactCallIds.length,
        meetings: contactMeetingIds.length,
        emails: contactEmailIds.length,
        communications: contactCommunicationIds.length,
        tasks: contactTaskIds.length,
      },
      companyAssociationCounts: {
        notes: companyNoteIds.length,
        calls: companyCallIds.length,
        meetings: companyMeetingIds.length,
        emails: companyEmailIds.length,
        communications: companyCommunicationIds.length,
        tasks: companyTaskIds.length,
      },
      totalUniqueActivityCounts: {
        notes: new Set([...dealNoteIds, ...contactNoteIds, ...companyNoteIds]).size,
        calls: new Set([...dealCallIds, ...contactCallIds, ...companyCallIds]).size,
        meetings: new Set([...dealMeetingIds, ...contactMeetingIds, ...companyMeetingIds]).size,
        emails: new Set([...dealEmailIds, ...contactEmailIds, ...companyEmailIds]).size,
        communications: uniqueCommunicationIds.length,
        sms: countByType.sms,
        tasks: new Set([...dealTaskIds, ...contactTaskIds, ...companyTaskIds]).size,
      },
      timelineCount: history.timeline.length,
      timelineTypes: countByType,
    };
};

  // Activites commerciales (call/meeting/communication) directement associees a un deal.
  // Sert au backfill des deals clotures, que le flux temps-reel ne relie pas.
export const fetchDealSalesActivityIds = async (
    accessToken: string,
    dealId: string,
  ): Promise<{ call: string[]; meeting: string[]; communication: string[] }> => {
    const [call, meeting, communication] = await Promise.all([
      fetchAssociatedIds(accessToken, "deals", dealId, "calls"),
      fetchAssociatedIds(accessToken, "deals", dealId, "meetings"),
      fetchAssociatedIds(accessToken, "deals", dealId, "communications"),
    ]);

    return { call, meeting, communication };
};

export const fetchDealCount = async (accessToken: string): Promise<number> => {
    const payload = await hubSpotFetch<HubSpotSearchResponse<Record<string, never>>>(
      "/crm/v3/objects/deals/search",
      {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          limit: 1,
          properties: ["dealname"],
          filterGroups: [],
          sorts: [],
        }),
        maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
      },
    );

    return payload.total;
};

export const fetchDealCountByOwner = async (accessToken: string, hubspotOwnerId: string): Promise<number> => {
    const payload = await hubSpotFetch<HubSpotSearchResponse<Record<string, never>>>(
      "/crm/v3/objects/deals/search",
      {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          limit: 1,
          properties: ["dealname", "hubspot_owner_id"],
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
          sorts: [],
        }),
        maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
      },
    );

    return payload.total;
};
