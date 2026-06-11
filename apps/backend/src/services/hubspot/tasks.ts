import {
  HUBSPOT_DEFAULT_MAX_RETRIES,
  HUBSPOT_TASK_ASSOCIATION_TYPE_IDS,
  HUBSPOT_TASK_LEVEL_BY_PRIORITY,
  HUBSPOT_TASK_PRIORITY_BY_LEVEL,
  HUBSPOT_TASK_PROPERTIES,
  fetchAssociatedIdMapForMany,
  hubSpotFetch,
} from "./client.js";
import { fetchCompaniesByIds } from "./companies.js";
import { fetchContactsByIds } from "./contacts.js";
import { fetchDealDetailsByIds } from "./deals.js";
import { buildContactName, decodeHtmlEntities, readProperty } from "./shared.js";
import type {
  CreateHubSpotTaskInput,
  CreatedHubSpotTask,
  HubSpotCompany,
  HubSpotContact,
  HubSpotDeal,
  HubSpotSearchResponse,
  HubSpotTask,
  HubSpotTaskListItem,
  HubSpotTaskPriority,
  HubSpotTaskStatus,
} from "./types.js";

export const readAssociationIds = (
  record: HubSpotTask,
  objectType: "contacts" | "companies" | "deals",
): string[] => record.associations?.[objectType]?.results.map((item) => item.id) ?? [];

export const parseHubSpotTaskPriority = (value: string | null): HubSpotTaskPriority | null => {
  const normalizedValue = value?.trim().toUpperCase();

  if (
    normalizedValue === "LOW" ||
    normalizedValue === "MEDIUM" ||
    normalizedValue === "HIGH"
  ) {
    return HUBSPOT_TASK_LEVEL_BY_PRIORITY[normalizedValue];
  }

  return null;
};

export const parseHubSpotTaskStatus = (value: string | null): HubSpotTaskStatus => {
  const normalizedValue = value?.trim().toUpperCase();

  if (normalizedValue === "NOT_STARTED") {
    return "not_started";
  }

  if (normalizedValue === "IN_PROGRESS") {
    return "in_progress";
  }

  if (normalizedValue === "WAITING") {
    return "waiting";
  }

  if (normalizedValue === "COMPLETED") {
    return "completed";
  }

  if (normalizedValue === "DEFERRED") {
    return "deferred";
  }

  return "unknown";
};

export const parseHubSpotTaskTimestamp = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const numericValue = Number(value);
  const timestamp = Number.isFinite(numericValue) ? numericValue : new Date(value).getTime();

  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
};

export const cleanHubSpotTaskBody = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const cleanedValue = decodeHtmlEntities(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\[[^\]]*hubfs[^\]]*\]/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleanedValue || null;
};

export const mapHubSpotTaskListItem = (
  task: HubSpotTask,
  associatedContactById: Map<string, HubSpotContact> = new Map(),
  associatedCompanyById: Map<string, HubSpotCompany> = new Map(),
  associatedDealById: Map<string, HubSpotDeal> = new Map(),
): HubSpotTaskListItem => {
  const associatedContactIds = readAssociationIds(task, "contacts");
  const associatedCompanyIds = readAssociationIds(task, "companies");
  const associatedDealIds = readAssociationIds(task, "deals");
  const associatedDeals = associatedDealIds
    .map((dealId) => associatedDealById.get(dealId) ?? null)
    .filter((deal): deal is HubSpotDeal => Boolean(deal));
  const dealContactIds = associatedDeals.flatMap((deal) => deal.associations?.contacts?.results.map((item) => item.id) ?? []);
  const dealCompanyIds = associatedDeals.flatMap((deal) => deal.associations?.companies?.results.map((item) => item.id) ?? []);
  const firstContact = [...associatedContactIds, ...dealContactIds]
    .map((contactId) => associatedContactById.get(contactId) ?? null)
    .find((contact): contact is HubSpotContact => Boolean(contact)) ?? null;
  const firstCompany = [...associatedCompanyIds, ...dealCompanyIds]
    .map((companyId) => associatedCompanyById.get(companyId) ?? null)
    .find((company): company is HubSpotCompany => Boolean(company)) ?? null;
  const firstDeal = associatedDeals[0] ?? null;

  return {
  id: task.id,
  title: readProperty(task.properties, "hs_task_subject") ?? `Task ${task.id}`,
  body: cleanHubSpotTaskBody(readProperty(task.properties, "hs_task_body")),
  status: parseHubSpotTaskStatus(readProperty(task.properties, "hs_task_status")),
  priority: parseHubSpotTaskPriority(readProperty(task.properties, "hs_task_priority")),
  dueAt: parseHubSpotTaskTimestamp(readProperty(task.properties, "hs_timestamp")),
  ownerHubSpotId: readProperty(task.properties, "hubspot_owner_id"),
  taskType: readProperty(task.properties, "hs_task_type"),
  contactName: firstContact ? buildContactName(firstContact.properties) : null,
  contactEmail: readProperty(firstContact?.properties ?? {}, "email"),
  companyName: firstCompany ? readProperty(firstCompany.properties, "name") : null,
  dealName: readProperty(firstDeal?.properties ?? {}, "dealname"),
  createdAt: parseHubSpotTaskTimestamp(readProperty(task.properties, "hs_createdate")),
  associatedContactIds,
  associatedCompanyIds,
  associatedDealIds,
  };
};

export const enrichTasksWithAssociations = async (
  accessToken: string,
  tasks: HubSpotTask[],
): Promise<HubSpotTask[]> => {
  const taskIds = tasks.map((task) => task.id);
  const [contactIdsByTaskId, companyIdsByTaskId, dealIdsByTaskId] = await Promise.all([
    fetchAssociatedIdMapForMany(accessToken, "tasks", taskIds, "contacts"),
    fetchAssociatedIdMapForMany(accessToken, "tasks", taskIds, "companies"),
    fetchAssociatedIdMapForMany(accessToken, "tasks", taskIds, "deals"),
  ]);

  return tasks.map((task) => ({
    ...task,
    associations: {
      contacts: {
        results: (contactIdsByTaskId.get(task.id) ?? []).map((id) => ({ id })),
      },
      companies: {
        results: (companyIdsByTaskId.get(task.id) ?? []).map((id) => ({ id })),
      },
      deals: {
        results: (dealIdsByTaskId.get(task.id) ?? []).map((id) => ({ id })),
      },
    },
  }));
};

export const createTask = async (accessToken: string, input: CreateHubSpotTaskInput): Promise<CreatedHubSpotTask> => {
    const dueAtDate = new Date(input.dueAt);

    if (Number.isNaN(dueAtDate.getTime())) {
      throw new Error("Date d'echeance HubSpot invalide pour la tache.");
    }

    try {
      const payload = await hubSpotFetch<{
        id: string;
        properties?: Record<string, string | null | undefined>;
      }>("/crm/v3/objects/tasks", {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          properties: {
            hs_task_subject: input.title,
            hs_task_body: input.body,
            hs_task_status: "NOT_STARTED",
            hs_task_type: "TODO",
            hs_timestamp: String(dueAtDate.getTime()),
            ...(input.ownerHubSpotId ? { hubspot_owner_id: input.ownerHubSpotId } : {}),
            ...(input.priority ? { hs_task_priority: HUBSPOT_TASK_PRIORITY_BY_LEVEL[input.priority] } : {}),
          },
          associations: input.associations.map((association) => ({
            to: {
              id: association.objectId,
            },
            types: [
              {
                associationCategory: "HUBSPOT_DEFINED",
                associationTypeId: HUBSPOT_TASK_ASSOCIATION_TYPE_IDS[association.objectType],
              },
            ],
          })),
        }),
        maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
      });

      return {
        taskId: payload.id,
        title: input.title,
        dueAt: dueAtDate.toISOString(),
      };
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("403") || error.message.includes("MISSING_SCOPES"))
      ) {
        throw new Error(
          "HubSpot refuse la creation de taches avec les scopes actuels. Verifie les scopes CRM write disponibles sur l'app, reconnecte l'integration, puis relance un test pour lire le scope exact demande par HubSpot.",
        );
      }

      throw error;
    }
};

export const fetchTask = async (accessToken: string, taskId: string): Promise<HubSpotTask> => {
    return hubSpotFetch<HubSpotTask>(
      `/crm/v3/objects/tasks/${taskId}?properties=hs_task_subject,hs_task_body,hs_task_status,hs_task_priority,hs_task_type,hs_timestamp,hubspot_owner_id,hs_createdate&associations=contacts,companies,deals`,
      {
        accessToken,
        maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
      },
    );
};

export const fetchTaskListItem = async (accessToken: string, taskId: string): Promise<HubSpotTaskListItem> => {
    const task = await fetchTask(accessToken, taskId);

    return mapHubSpotTaskListItem(task);
};

export const fetchTasksByOwner = async (
    accessToken: string,
    hubspotOwnerId: string,
    limit = 500,
    includeCompleted = false,
  ): Promise<HubSpotTaskListItem[]> => {
    const maxResults = Math.max(1, Math.min(500, Math.trunc(limit)));
    const fetchTasksByStatus = async (
      statusOperator: "EQ" | "NEQ",
      statusValue: "COMPLETED",
      sortDirection: "ASCENDING" | "DESCENDING",
    ): Promise<HubSpotTask[]> => {
      const fetchedTasks: HubSpotTask[] = [];
      let after: string | undefined;

      do {
        const remaining = maxResults - fetchedTasks.length;
        const payload = await hubSpotFetch<HubSpotSearchResponse<HubSpotTask>>("/crm/v3/objects/tasks/search", {
          method: "POST",
          accessToken,
          body: JSON.stringify({
            limit: Math.min(100, remaining),
            after,
            properties: [...HUBSPOT_TASK_PROPERTIES, "hs_createdate"],
            associations: ["contacts", "companies", "deals"],
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: "hubspot_owner_id",
                    operator: "EQ",
                    value: hubspotOwnerId,
                  },
                  {
                    propertyName: "hs_task_status",
                    operator: statusOperator,
                    value: statusValue,
                  },
                ],
              },
            ],
            sorts: [
              {
                propertyName: "hs_timestamp",
                direction: sortDirection,
              },
            ],
          }),
          maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
        });

        fetchedTasks.push(...payload.results);
        after = payload.paging?.next?.after;
      } while (after && fetchedTasks.length < maxResults);

      return fetchedTasks;
    };

    const openTasks = await fetchTasksByStatus("NEQ", "COMPLETED", "ASCENDING");
    const completedTasks = includeCompleted ? await fetchTasksByStatus("EQ", "COMPLETED", "DESCENDING") : [];
    const tasksById = new Map<string, HubSpotTask>();

    for (const task of [...openTasks, ...completedTasks]) {
      tasksById.set(task.id, task);
    }

    const tasks = Array.from(tasksById.values());

    const tasksWithAssociations = await enrichTasksWithAssociations(accessToken, tasks);
    const dealIds = Array.from(new Set(tasksWithAssociations.flatMap((task) => readAssociationIds(task, "deals"))));
    const deals = dealIds.length > 0 ? await fetchDealDetailsByIds(accessToken, dealIds) : [];
    const contactIds = Array.from(
      new Set([
        ...tasksWithAssociations.flatMap((task) => readAssociationIds(task, "contacts")),
        ...deals.flatMap((deal) => deal.associations?.contacts?.results.map((item) => item.id) ?? []),
      ]),
    );
    const companyIds = Array.from(
      new Set([
        ...tasksWithAssociations.flatMap((task) => readAssociationIds(task, "companies")),
        ...deals.flatMap((deal) => deal.associations?.companies?.results.map((item) => item.id) ?? []),
      ]),
    );
    const [contacts, companies] = await Promise.all([
      contactIds.length > 0 ? fetchContactsByIds(accessToken, contactIds) : [],
      companyIds.length > 0 ? fetchCompaniesByIds(accessToken, companyIds) : [],
    ]);
    const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
    const companyById = new Map(companies.map((company) => [company.id, company]));
    const dealById = new Map(deals.map((deal) => [deal.id, deal]));

    return tasksWithAssociations.map((task) => mapHubSpotTaskListItem(task, contactById, companyById, dealById));
};

export const updateTaskPriority = async (
    accessToken: string,
    taskId: string,
    priority: HubSpotTaskPriority | null,
  ): Promise<HubSpotTaskListItem> => {
    const updatedTask = await hubSpotFetch<HubSpotTask>(`/crm/v3/objects/tasks/${taskId}`, {
      method: "PATCH",
      accessToken,
      body: JSON.stringify({
        properties: {
          hs_task_priority: priority ? HUBSPOT_TASK_PRIORITY_BY_LEVEL[priority] : "",
        },
      }),
      maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
    });

    return fetchTaskListItem(accessToken, updatedTask.id);
};

export const markTaskCompleted = async (accessToken: string, taskId: string): Promise<void> => {
    await hubSpotFetch<HubSpotTask>(`/crm/v3/objects/tasks/${taskId}`, {
      method: "PATCH",
      accessToken,
      body: JSON.stringify({
        properties: {
          hs_task_status: "COMPLETED",
        },
      }),
      maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
    });
};

export const completeTask = async (accessToken: string, taskId: string): Promise<HubSpotTaskListItem> => {
    await markTaskCompleted(accessToken, taskId);

    return fetchTaskListItem(accessToken, taskId);
};
