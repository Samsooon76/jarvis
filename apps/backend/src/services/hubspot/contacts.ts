import {
  HUBSPOT_BATCH_READ_LIMIT,
  HUBSPOT_CONTACT_PROPERTIES,
  HUBSPOT_DEFAULT_MAX_RETRIES,
  createBatches,
  fetchAssociatedIds,
  hubSpotFetch,
} from "./client.js";
import { buildContactName, toNullablePropertiesRecord } from "./shared.js";
import type { HubSpotContact, HubSpotContactSnapshotItem, HubSpotSearchResponse } from "./types.js";

export const searchContactsByName = async (
  accessToken: string,
  firstName: string,
  lastName: string,
): Promise<HubSpotContact[]> => {
  const payload = await hubSpotFetch<HubSpotSearchResponse<HubSpotContact>>("/crm/v3/objects/contacts/search", {
    method: "POST",
    accessToken,
    body: JSON.stringify({
      limit: HUBSPOT_BATCH_READ_LIMIT,
      properties: HUBSPOT_CONTACT_PROPERTIES,
      filterGroups: [
        {
          filters: [
            {
              propertyName: "firstname",
              operator: "EQ",
              value: firstName,
            },
            {
              propertyName: "lastname",
              operator: "EQ",
              value: lastName,
            },
          ],
        },
      ],
    }),
    maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
  });

  return payload.results;
};

export const fetchContactsByIds = async (accessToken: string, contactIds: string[]): Promise<HubSpotContact[]> => {
  const contacts: HubSpotContact[] = [];

  for (const batch of createBatches(contactIds, HUBSPOT_BATCH_READ_LIMIT)) {
    const payload = await hubSpotFetch<{ results: HubSpotContact[] }>("/crm/v3/objects/contacts/batch/read", {
      method: "POST",
      accessToken,
      body: JSON.stringify({
        inputs: batch.map((contactId) => ({
          id: contactId,
        })),
        properties: HUBSPOT_CONTACT_PROPERTIES,
      }),
      maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
    });

    contacts.push(...payload.results);
  }

  return contacts;
};

export const buildContactDisplayName = (contact: HubSpotContact): string => buildContactName(contact.properties);

export const fetchContactSnapshotsByIds = async (
  accessToken: string,
  contactIds: string[],
): Promise<HubSpotContactSnapshotItem[]> => {
  const contacts = await fetchContactsByIds(accessToken, contactIds);

  return contacts.map((contact) => ({
    id: contact.id,
    properties: toNullablePropertiesRecord(contact.properties, HUBSPOT_CONTACT_PROPERTIES),
  }));
};

export const fetchAssociatedDealIdsForContact = async (accessToken: string, contactId: string): Promise<string[]> =>
  fetchAssociatedIds(accessToken, "contacts", contactId, "deals");
