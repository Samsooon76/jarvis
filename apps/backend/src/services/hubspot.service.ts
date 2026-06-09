import { env } from "../config/env.js";
import { scoreProspect } from "./scoring.service.js";

type HubSpotTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  hub_id?: number;
  token_type?: string;
};

type HubSpotTokenInfoResponse = {
  hub_id?: number;
  hub_domain?: string;
  user_id?: number;
  app_id?: number;
  expires_in?: number;
};

type HubSpotErrorPayload = {
  status?: string;
  message?: string;
  errorType?: string;
  correlationId?: string;
  policyName?: string;
  groupName?: string;
};

type HubSpotCollectionResponse<T> = {
  results: T[];
  paging?: {
    next?: {
      after?: string;
    };
  };
};

type HubSpotSearchResponse<T> = {
  results: T[];
  total: number;
  paging?: {
    next?: {
      after?: string;
    };
  };
};

type HubSpotAssociationResponse = {
  results?: Array<{ toObjectId?: string | number; toObjectIdStr?: string }>;
  paging?: {
    next?: {
      after?: string;
    };
  };
};

type HubSpotBatchAssociationResponse = {
  results?: Array<{
    from?: {
      id?: string | number;
    };
    to?: Array<{
      toObjectId?: string | number;
    }>;
  }>;
};

type HubSpotContact = {
  id: string;
  properties: Record<string, string | null | undefined>;
  associations?: {
    deals?: {
      results: Array<{ id: string }>;
    };
  };
};

type HubSpotDeal = {
  id: string;
  properties: Record<string, string | null | undefined>;
  associations?: {
    contacts?: {
      results: Array<{ id: string }>;
    };
    companies?: {
      results: Array<{ id: string }>;
    };
  };
};

type HubSpotCompany = {
  id: string;
  properties: Record<string, string | null | undefined>;
};

type HubSpotLead = {
  id: string;
  properties: Record<string, string | null | undefined>;
  associations?: {
    contacts?: {
      results: Array<{ id: string }>;
    };
    companies?: {
      results: Array<{ id: string }>;
    };
  };
};

export type HubSpotLeadRecord = {
  id: string;
  hubspotOwnerId: string | null;
  name: string;
  pipelineId: string | null;
  pipelineLabel: string | null;
  phaseId: string | null;
  phaseLabel: string | null;
  associatedContactIds: string[];
  associatedCompanyIds: string[];
  createdAt: string | null;
  updatedAt: string | null;
  properties: Record<string, string | null>;
};

type HubSpotDealStageMetadata = {
  isClosed?: string;
  probability?: string;
};

type HubSpotDealStage = {
  id?: string | null;
  stageId?: string | null;
  label?: string | null;
  displayOrder?: number | null;
  metadata?: HubSpotDealStageMetadata | null;
};

type HubSpotDealPipeline = {
  id?: string | null;
  pipelineId?: string | null;
  label?: string | null;
  stages?: HubSpotDealStage[];
};

type HubSpotNote = {
  id: string;
  properties: Record<string, string | null | undefined>;
};

type HubSpotCall = {
  id: string;
  properties: Record<string, string | null | undefined>;
};

type HubSpotMeeting = {
  id: string;
  properties: Record<string, string | null | undefined>;
};

type HubSpotEmail = {
  id: string;
  properties: Record<string, string | null | undefined>;
};

type HubSpotCommunication = {
  id: string;
  properties: Record<string, string | null | undefined>;
};

export type HubSpotActivityType = "call" | "communication" | "email" | "note" | "meeting";

type HubSpotActivityAssociations = {
  contacts?: {
    results: Array<{ id: string }>;
  };
  companies?: {
    results: Array<{ id: string }>;
  };
  deals?: {
    results: Array<{ id: string }>;
  };
};

type HubSpotActivityRecord = {
  id: string;
  properties: Record<string, string | null | undefined>;
  associations?: HubSpotActivityAssociations;
};

export type HubSpotOwner = {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  userId?: number | null;
  userIdIncludingInactive?: number | null;
  archived?: boolean;
  teams?: Array<{
    id: string;
    name: string;
    primary?: boolean;
  }>;
};

export type HubSpotProspectSyncItem = {
  hubspotContactId: string;
  hubspotDealId: string | null;
  name: string;
  company: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
  dealStage: string | null;
  dealStageLabel: string | null;
  dealAmount: number | null;
  closeProbability: number;
  closedAt: string | null;
  dealLifecycleStatus: DealLifecycleStatus | null;
  isClosedDeal: boolean | null;
  lastContactAt: string | null;
  ownerHubSpotId: string | null;
  rawData: {
    source: "hubspot";
    hubspotContactId: string;
    hubspotDealId: string | null;
    dealName: string | null;
    dealStageLabel: string | null;
    closedAt: string | null;
    dealLifecycleStatus: DealLifecycleStatus | null;
    isClosedDeal: boolean | null;
    hubspotOwnerId: string | null;
    contactOwnerHubSpotId: string | null;
    dealOwnerHubSpotId: string | null;
    contact: {
      id: string;
      properties: Record<string, string | null>;
    };
    associatedContactIds: string[];
    deal: {
      id: string | null;
      properties: Record<string, string | null>;
    } | null;
    company: {
      id: string;
      properties: Record<string, string | null>;
    } | null;
  };
};

export type HubSpotCrmSyncSnapshot = {
  contacts: Array<{
    id: string;
    properties: Record<string, string | null>;
  }>;
  deals: Array<{
    id: string;
    properties: Record<string, string | null>;
    associatedContactIds: string[];
    associatedCompanyIds: string[];
  }>;
  companies: Array<{
    id: string;
    properties: Record<string, string | null>;
  }>;
  leads: HubSpotLeadRecord[];
  dealStages: Array<{
    pipelineId: string;
    pipelineLabel: string | null;
    stageId: string;
    stageLabel: string;
    displayOrder: number | null;
    isClosed: boolean | null;
    probability: number | null;
  }>;
  prospects: HubSpotProspectSyncItem[];
};

export type HubSpotContactSnapshotItem = HubSpotCrmSyncSnapshot["contacts"][number];

export type DealLifecycleStatus = "pending" | "won" | "lost";

export type HubSpotPropertyHistoryEntry = {
  value: string | null;
  timestamp: string;
};

export type HubSpotDealHistoryItem = {
  id: string;
  type: "deal" | "note" | "call" | "meeting" | "email" | "sms" | "communication" | "task";
  timestamp: string | null;
  title: string;
  body: string | null;
  metadata: Record<string, string | null>;
};

export type HubSpotDealHistory = {
  dealId: string;
  dealName: string | null;
  companyName: string | null;
  dealContext: string | null;
  companyContext: string | null;
  contactNames: string[];
  timeline: HubSpotDealHistoryItem[];
};

export type HubSpotDealActivityDebug = {
  dealId: string;
  directAssociationCounts: Record<"notes" | "calls" | "meetings" | "emails" | "communications" | "tasks", number>;
  contactAssociationCounts: Record<"notes" | "calls" | "meetings" | "emails" | "communications" | "tasks", number>;
  companyAssociationCounts: Record<"notes" | "calls" | "meetings" | "emails" | "communications" | "tasks", number>;
  totalUniqueActivityCounts: Record<"notes" | "calls" | "meetings" | "emails" | "communications" | "sms" | "tasks", number>;
  timelineCount: number;
  timelineTypes: Record<HubSpotDealHistoryItem["type"], number>;
};

export type CreateHubSpotTaskInput = {
  title: string;
  body: string;
  dueAt: string;
  ownerHubSpotId?: string | null;
  priority?: HubSpotTaskPriority | null;
  associations: Array<{
    objectType: "contact" | "company" | "deal";
    objectId: string;
  }>;
};

export type CreatedHubSpotTask = {
  taskId: string;
  title: string;
  dueAt: string;
};

export type HubSpotTask = {
  id: string;
  properties: Record<string, string | null | undefined>;
  associations?: {
    contacts?: {
      results: Array<{ id: string }>;
    };
    companies?: {
      results: Array<{ id: string }>;
    };
    deals?: {
      results: Array<{ id: string }>;
    };
  };
};

export type HubSpotTaskPriority = "low" | "medium" | "high";

export type HubSpotTaskStatus = "not_started" | "in_progress" | "waiting" | "completed" | "deferred" | "unknown";

export type HubSpotTaskListItem = {
  id: string;
  title: string;
  body: string | null;
  status: HubSpotTaskStatus;
  priority: HubSpotTaskPriority | null;
  dueAt: string | null;
  ownerHubSpotId: string | null;
  taskType: string | null;
  contactName: string | null;
  contactEmail: string | null;
  companyName: string | null;
  dealName: string | null;
  createdAt: string | null;
  associatedContactIds: string[];
  associatedCompanyIds: string[];
  associatedDealIds: string[];
};

export type HubSpotActivitySnapshot = {
  id: string;
  activityType: HubSpotActivityType;
  channel: string | null;
  occurredAt: string | null;
  title: string;
  body: string | null;
  metadata: Record<string, string | null>;
  properties: Record<string, string | null>;
  associatedContactIds: string[];
  associatedCompanyIds: string[];
  associatedDealIds: string[];
};

const HUBSPOT_API_BASE_URL = "https://api.hubapi.com";
const HUBSPOT_OAUTH_BASE_URL = "https://app.hubspot.com/oauth/authorize";
const HUBSPOT_TEN_SECOND_ROLLING_WAIT_MS = 11_000;
const HUBSPOT_DEFAULT_MAX_RETRIES = 3;
const HUBSPOT_BATCH_READ_LIMIT = 100;
const HUBSPOT_OWNER_PROSPECT_LIMIT = 100;
const HUBSPOT_OWNER_LEAD_LIMIT = 500;
const HUBSPOT_DETAIL_CONCURRENCY = 10;
const HUBSPOT_ASSOCIATION_CONCURRENCY = 25;
const HUBSPOT_CONTACT_PROPERTIES = [
  "firstname",
  "lastname",
  "email",
  "phone",
  "jobtitle",
  "company",
  "hs_lead_status",
  "lifecyclestage",
  "lastactivitydate",
  "hs_lastmodifieddate",
  "hubspot_owner_id",
];
const HUBSPOT_LEAD_OBJECT_TYPE = "0-136";
const HUBSPOT_LEAD_PROPERTIES = [
  "hs_lead_name",
  "hs_pipeline",
  "hs_pipeline_stage",
  "hubspot_owner_id",
  "hs_createdate",
  "hs_lastmodifieddate",
];
const HUBSPOT_DEAL_PROPERTIES = [
  "dealname",
  "amount",
  "pipeline",
  "dealstage",
  "createdate",
  "closedate",
  "hubspot_owner_id",
  "hs_lastmodifieddate",
  "hs_deal_stage_probability",
];
const HUBSPOT_COMPANY_PROPERTIES = [
  "name",
  "domain",
  "industry",
  "city",
  "country",
  "numberofemployees",
  "annualrevenue",
  "lifecyclestage",
  "hs_lastmodifieddate",
];
const HUBSPOT_NOTE_PROPERTIES = ["hs_timestamp", "hs_note_body", "hubspot_owner_id"];
const HUBSPOT_CALL_PROPERTIES = [
  "hs_timestamp",
  "hs_call_title",
  "hs_call_body",
  "hs_call_status",
  "hs_call_disposition",
  "hs_call_direction",
  "hs_call_duration",
  "hs_call_from_number",
  "hs_call_to_number",
  "hs_call_recording_url",
  "hs_call_has_voicemail",
  "hubspot_owner_id",
];
const HUBSPOT_MEETING_PROPERTIES = [
  "hs_timestamp",
  "hs_meeting_title",
  "hs_meeting_body",
  "hs_meeting_start_time",
  "hs_meeting_end_time",
  "hubspot_owner_id",
];
const HUBSPOT_EMAIL_PROPERTIES = [
  "hs_timestamp",
  "hs_email_subject",
  "hs_email_text",
  "hs_email_html",
  "hs_email_status",
  "hs_email_direction",
  "hubspot_owner_id",
];
const HUBSPOT_COMMUNICATION_PROPERTIES = [
  "hs_timestamp",
  "hs_communication_channel_type",
  "hs_communication_logged_from",
  "hs_communication_body",
  "hubspot_owner_id",
];
const HUBSPOT_TASK_PROPERTIES = [
  "hs_timestamp",
  "hs_task_subject",
  "hs_task_body",
  "hs_task_status",
  "hs_task_priority",
  "hs_task_type",
  "hubspot_owner_id",
];
const HUBSPOT_TASK_ASSOCIATION_TYPE_IDS = {
  contact: 204,
  company: 192,
  deal: 216,
} as const;

const HUBSPOT_TASK_PRIORITY_BY_LEVEL = {
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
} as const;

const HUBSPOT_TASK_LEVEL_BY_PRIORITY = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
} as const satisfies Record<string, HubSpotTaskPriority>;

const isHubSpotCompanyScopeError = (error: unknown): boolean =>
  error instanceof Error &&
  error.message.includes("MISSING_SCOPES") &&
  error.message.includes("crm.objects.companies");

const isHubSpotLeadScopeError = (error: unknown): boolean =>
  error instanceof Error &&
  error.message.includes("MISSING_SCOPES") &&
  error.message.includes("crm.objects.leads");

const toBase64Url = (value: string): string => Buffer.from(value, "utf8").toString("base64url");

const fromBase64Url = (value: string): string => Buffer.from(value, "base64url").toString("utf8");

const parseNumericValue = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
};

const parseBooleanValue = (value: string | null | undefined): boolean | null => {
  if (!value) {
    return null;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === "true") {
    return true;
  }

  if (normalizedValue === "false") {
    return false;
  }

  return null;
};

const readProperty = (properties: Record<string, string | null | undefined>, key: string): string | null =>
  properties[key] ?? null;

const readAssociationIds = (
  record: HubSpotTask,
  objectType: "contacts" | "companies" | "deals",
): string[] => record.associations?.[objectType]?.results.map((item) => item.id) ?? [];

const toNullablePropertiesRecord = (
  properties: Record<string, string | null | undefined>,
  keys: string[],
): Record<string, string | null> =>
  Object.fromEntries(keys.map((key) => [key, readProperty(properties, key)]));

const getCompanyName = (
  company: HubSpotCompany | null,
  fallbackName: string | null | undefined,
): string | null => readProperty(company?.properties ?? {}, "name") ?? fallbackName ?? null;

const buildContextSummary = (entries: Array<[label: string, value: string | null | undefined]>): string | null => {
  const lines = entries
    .map(([label, value]) => {
      const normalizedValue = value?.trim();

      return normalizedValue ? `${label}: ${normalizedValue}` : null;
    })
    .filter((value): value is string => Boolean(value));

  return lines.length > 0 ? lines.join("\n") : null;
};

const buildDealContextSummary = (deal: HubSpotDeal | null): string | null => {
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

const buildCompanyContextSummary = (company: HubSpotCompany | null): string | null => {
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

const parsePercentage = (value: string | null | undefined): number => {
  if (!value) {
    return 0;
  }

  const normalizedValue = value.trim().replace("%", "");
  const parsed = Number(normalizedValue);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  const percentage = parsed >= 0 && parsed <= 1 ? parsed * 100 : parsed;

  return Math.max(0, Math.min(100, Math.round(percentage)));
};

const parseHubSpotTaskPriority = (value: string | null): HubSpotTaskPriority | null => {
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

const parseHubSpotTaskStatus = (value: string | null): HubSpotTaskStatus => {
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

const parseHubSpotTaskTimestamp = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const numericValue = Number(value);
  const timestamp = Number.isFinite(numericValue) ? numericValue : new Date(value).getTime();

  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
};

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");

const cleanHubSpotTaskBody = (value: string | null): string | null => {
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

const mapHubSpotTaskListItem = (
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

const buildContactName = (properties: Record<string, string | null | undefined>): string => {
  const firstName = properties.firstname?.trim();
  const lastName = properties.lastname?.trim();
  const joinedName = [firstName, lastName].filter(Boolean).join(" ").trim();

  if (joinedName) {
    return joinedName;
  }

  return properties.email?.trim() || properties.phone?.trim() || "Prospect HubSpot";
};

type HubSpotDealStageDefinition = {
  pipelineId: string;
  pipelineLabel: string | null;
  label: string | null;
  displayOrder: number | null;
  isClosed: boolean | null;
  probability: number | null;
};

const normalizeClassifierText = (value: string | null | undefined): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const compactClassifierText = (value: string | null | undefined): string =>
  normalizeClassifierText(value).replace(/[^a-z0-9]+/g, "");

const inferLifecycleStatusFromStageText = (
  dealStageId: string | null | undefined,
  stageLabel: string | null | undefined,
): DealLifecycleStatus | null => {
  const normalizedStage = normalizeClassifierText(`${dealStageId ?? ""} ${stageLabel ?? ""}`);
  const compactStage = compactClassifierText(normalizedStage);

  if (!normalizedStage) {
    return null;
  }

  if (
    compactStage.includes("closedlost") ||
    compactStage.includes("closelost") ||
    compactStage === "lost" ||
    normalizedStage.includes(" lost") ||
    normalizedStage.includes("perdu") ||
    normalizedStage.includes("perdue")
  ) {
    return "lost";
  }

  if (
    compactStage.includes("closedwon") ||
    compactStage === "won" ||
    normalizedStage.includes(" won") ||
    normalizedStage.includes("gagne") ||
    normalizedStage.includes("gagnee") ||
    normalizedStage.includes("gagné") ||
    normalizedStage.includes("gagnée")
  ) {
    return "won";
  }

  return "pending";
};

const buildDealStageLookup = (pipelines: HubSpotDealPipeline[]): Map<string, HubSpotDealStageDefinition> => {
  const stageDefinitionByStageId = new Map<string, HubSpotDealStageDefinition>();

  for (const pipeline of pipelines) {
    const pipelineId = pipeline.id ?? pipeline.pipelineId ?? null;

    if (!pipelineId) {
      continue;
    }

    for (const stage of pipeline.stages ?? []) {
      const stageId = stage.id ?? stage.stageId;

      if (!stageId) {
        continue;
      }

      stageDefinitionByStageId.set(stageId, {
        pipelineId,
        pipelineLabel: pipeline.label ?? null,
        label: stage.label ?? null,
        displayOrder: typeof stage.displayOrder === "number" ? stage.displayOrder : null,
        isClosed: parseBooleanValue(stage.metadata?.isClosed),
        probability: parseNumericValue(stage.metadata?.probability),
      });
    }
  }

  return stageDefinitionByStageId;
};

const searchLeadsByOwner = async (
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

const fetchPipelineStageLookup = async (
  accessToken: string,
  objectType: string,
): Promise<Map<string, HubSpotDealStageDefinition>> => {
  const pipelines = await hubSpotFetch<HubSpotCollectionResponse<HubSpotDealPipeline>>(
    `/crm/v3/pipelines/${objectType}`,
    {
      accessToken,
      maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
    },
  );

  return buildDealStageLookup(pipelines.results);
};

const mapLeadRecord = (
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

const fetchLeadRecordsByOwners = async (
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

const buildDealStageSnapshot = (dealStageLookup: Map<string, HubSpotDealStageDefinition>): HubSpotCrmSyncSnapshot["dealStages"] =>
  Array.from(dealStageLookup.entries())
    .map(([stageId, definition]) => ({
      pipelineId: definition.pipelineId,
      pipelineLabel: definition.pipelineLabel,
      stageId,
      stageLabel: definition.label ?? stageId,
      displayOrder: definition.displayOrder,
      isClosed: definition.isClosed,
      probability: definition.probability,
    }))
    .sort((left, right) => {
      if (left.pipelineId !== right.pipelineId) {
        return left.pipelineId.localeCompare(right.pipelineId);
      }

      return (left.displayOrder ?? 0) - (right.displayOrder ?? 0);
    });

const resolveDealLifecycleStatus = (
  deal: HubSpotDeal | null,
  dealStageLookup: Map<string, HubSpotDealStageDefinition>,
): DealLifecycleStatus | null => {
  if (!deal) {
    return null;
  }

  const dealStageId = readProperty(deal.properties, "dealstage");
  const stageDefinition = dealStageId ? dealStageLookup.get(dealStageId) ?? null : null;
  const stageLabel = stageDefinition?.label ?? null;
  const inferredStatusFromText = inferLifecycleStatusFromStageText(dealStageId, stageLabel);
  const stageProbability = stageDefinition?.probability ?? null;
  const isClosed = stageDefinition?.isClosed ?? null;

  if (inferredStatusFromText === "lost") {
    return "lost";
  }

  if (inferredStatusFromText === "won") {
    return "won";
  }

  if (stageProbability !== null) {
    if (stageProbability <= 0) {
      return "lost";
    }

    if (stageProbability >= 1) {
      return "won";
    }
  }

  if (isClosed === true) {
    return "won";
  }

  if (isClosed === false) {
    return "pending";
  }

  return inferredStatusFromText;
};

const resolveDealStageLabel = (
  deal: HubSpotDeal | null,
  dealStageLookup: Map<string, HubSpotDealStageDefinition>,
): string | null => {
  if (!deal) {
    return null;
  }

  const dealStageId = readProperty(deal.properties, "dealstage");

  return (dealStageId ? dealStageLookup.get(dealStageId)?.label ?? null : null) ?? null;
};

const resolveDealClosedState = (dealLifecycleStatus: DealLifecycleStatus | null): boolean | null => {
  if (!dealLifecycleStatus) {
    return null;
  }

  return dealLifecycleStatus !== "pending";
};

const createProspectSummary = (
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

const buildContactDisplayName = (contact: HubSpotContact): string => buildContactName(contact.properties);

const normalizeCommunicationChannel = (channel: string | null): string | null => {
  if (!channel?.trim()) {
    return null;
  }

  return channel.trim().toUpperCase();
};

const communicationTypeLabel = (channel: string | null): string => {
  const normalizedChannel = normalizeCommunicationChannel(channel);

  if (normalizedChannel === "SMS") {
    return "SMS";
  }

  if (normalizedChannel === "WHATS_APP" || normalizedChannel === "WHATSAPP") {
    return "WhatsApp";
  }

  if (normalizedChannel === "LINKEDIN_MESSAGE") {
    return "LinkedIn";
  }

  if (normalizedChannel === "FACEBOOK_MESSENGER") {
    return "Messenger";
  }

  return normalizedChannel ? normalizedChannel.replaceAll("_", " ") : "Message";
};

const toHistoryItem = (
  type: HubSpotDealHistoryItem["type"],
  record: { id: string; properties: Record<string, string | null | undefined> },
): HubSpotDealHistoryItem => {
  if (type === "deal") {
    return {
      id: record.id,
      type,
      timestamp:
        readProperty(record.properties, "createdate") ??
        readProperty(record.properties, "hs_lastmodifieddate") ??
        readProperty(record.properties, "closedate"),
      title: readProperty(record.properties, "dealname") ?? `Deal ${record.id}`,
      body: "Creation du deal dans HubSpot.",
      metadata: {
        amount: readProperty(record.properties, "amount"),
        stage: readProperty(record.properties, "dealstage"),
        ownerId: readProperty(record.properties, "hubspot_owner_id"),
        probability: readProperty(record.properties, "hs_deal_stage_probability"),
        createdAt: readProperty(record.properties, "createdate"),
        closedAt: readProperty(record.properties, "closedate"),
        lastModifiedAt: readProperty(record.properties, "hs_lastmodifieddate"),
      },
    };
  }

  if (type === "note") {
    return {
      id: record.id,
      type,
      timestamp: readProperty(record.properties, "hs_timestamp"),
      title: `Note ${record.id}`,
      body: readProperty(record.properties, "hs_note_body"),
      metadata: {
        ownerId: readProperty(record.properties, "hubspot_owner_id"),
      },
    };
  }

  if (type === "call") {
    return {
      id: record.id,
      type,
      timestamp: readProperty(record.properties, "hs_timestamp"),
      title: readProperty(record.properties, "hs_call_title") ?? `Call ${record.id}`,
      body: readProperty(record.properties, "hs_call_body"),
      metadata: {
        status: readProperty(record.properties, "hs_call_status"),
        disposition: readProperty(record.properties, "hs_call_disposition"),
        ownerId: readProperty(record.properties, "hubspot_owner_id"),
      },
    };
  }

  if (type === "meeting") {
    return {
      id: record.id,
      type,
      timestamp: readProperty(record.properties, "hs_timestamp") ?? readProperty(record.properties, "hs_meeting_start_time"),
      title: readProperty(record.properties, "hs_meeting_title") ?? `Meeting ${record.id}`,
      body: readProperty(record.properties, "hs_meeting_body"),
      metadata: {
        startTime: readProperty(record.properties, "hs_meeting_start_time"),
        endTime: readProperty(record.properties, "hs_meeting_end_time"),
        ownerId: readProperty(record.properties, "hubspot_owner_id"),
      },
    };
  }

  if (type === "sms" || type === "communication") {
    const channel = readProperty(record.properties, "hs_communication_channel_type");

    return {
      id: record.id,
      type,
      timestamp: readProperty(record.properties, "hs_timestamp"),
      title: communicationTypeLabel(channel),
      body: readProperty(record.properties, "hs_communication_body"),
      metadata: {
        channel,
        ownerId: readProperty(record.properties, "hubspot_owner_id"),
      },
    };
  }

  if (type === "task") {
    return {
      id: record.id,
      type,
      timestamp: readProperty(record.properties, "hs_timestamp"),
      title: readProperty(record.properties, "hs_task_subject") ?? `Task ${record.id}`,
      body: readProperty(record.properties, "hs_task_body"),
      metadata: {
        status: readProperty(record.properties, "hs_task_status"),
        priority: readProperty(record.properties, "hs_task_priority"),
        taskType: readProperty(record.properties, "hs_task_type"),
        ownerId: readProperty(record.properties, "hubspot_owner_id"),
      },
    };
  }

  return {
    id: record.id,
    type,
    timestamp: readProperty(record.properties, "hs_timestamp"),
    title: readProperty(record.properties, "hs_email_subject") ?? `Email ${record.id}`,
    body: readProperty(record.properties, "hs_email_text"),
    metadata: {
      status: readProperty(record.properties, "hs_email_status"),
      direction: readProperty(record.properties, "hs_email_direction"),
      ownerId: readProperty(record.properties, "hubspot_owner_id"),
    },
  };
};

const computePriorityScore = (prospect: HubSpotProspectSyncItem): number => {
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

const assertHubSpotConfigured = (): void => {
  if (!env.hubspotClientId || !env.hubspotClientSecret || !env.hubspotRedirectUri) {
    throw new Error(
      "Configuration HubSpot incomplete. Renseigne HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET et HUBSPOT_REDIRECT_URI.",
    );
  }
};

const sleep = async (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

const createBatches = <T>(items: T[], batchSize: number): T[][] => {
  const batches: T[][] = [];

  for (let startIndex = 0; startIndex < items.length; startIndex += batchSize) {
    batches.push(items.slice(startIndex, startIndex + batchSize));
  }

  return batches;
};

const getRetryDelayMs = (response: Response, payload: HubSpotErrorPayload): number => {
  const retryAfterHeader = response.headers.get("retry-after");

  if (retryAfterHeader) {
    const retryAfterSeconds = Number(retryAfterHeader);

    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return retryAfterSeconds * 1000;
    }
  }

  if (payload.policyName === "TEN_SECONDLY_ROLLING") {
    return HUBSPOT_TEN_SECOND_ROLLING_WAIT_MS;
  }

  return 5_000;
};

const hubSpotFetch = async <T>(
  path: string,
  options: RequestInit & { accessToken?: string; maxRetries?: number } = {},
): Promise<T> => {
  const headers = new Headers(options.headers);

  if (options.accessToken) {
    headers.set("Authorization", `Bearer ${options.accessToken}`);
  }

  if (options.body && !headers.has("Content-Type")) {
    if (options.body instanceof URLSearchParams) {
      headers.set("Content-Type", "application/x-www-form-urlencoded");
    } else {
      headers.set("Content-Type", "application/json");
    }
  }

  let attempt = 0;
  const maxRetries = options.maxRetries ?? 0;

  while (true) {
    const response = await fetch(`${HUBSPOT_API_BASE_URL}${path}`, {
      ...options,
      headers,
    });

    if (response.ok) {
      return (await response.json()) as T;
    }

    const errorText = await response.text();
    let errorPayload: HubSpotErrorPayload = {};

    try {
      errorPayload = JSON.parse(errorText) as HubSpotErrorPayload;
    } catch {
      errorPayload = {
        message: errorText,
      };
    }

    if (response.status === 429 && attempt < maxRetries) {
      attempt += 1;
      await sleep(getRetryDelayMs(response, errorPayload));
      continue;
    }

    if (response.status === 429) {
      throw new Error(
        `HubSpot est temporairement rate-limite (${errorPayload.policyName ?? "RATE_LIMIT"}). Attends 10 secondes puis reessaie.`,
      );
    }

    throw new Error(`HubSpot API error (${response.status}): ${errorText}`);
  }
};

const fetchAllPages = async <T>(
  path: string,
  accessToken: string,
  limit = 100,
  maxRetries = HUBSPOT_DEFAULT_MAX_RETRIES,
): Promise<T[]> => {
  const results: T[] = [];
  let after: string | undefined;

  do {
    const searchParams = new URLSearchParams();
    searchParams.set("limit", String(limit));

    if (after) {
      searchParams.set("after", after);
    }

    const page = await hubSpotFetch<HubSpotCollectionResponse<T>>(
      `${path}${path.includes("?") ? "&" : "?"}${searchParams.toString()}`,
      {
        accessToken,
        maxRetries,
      },
    );

    results.push(...page.results);
    after = page.paging?.next?.after;
  } while (after);

  return results;
};

const searchDealsByOwner = async (
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

const searchContactsByName = async (
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

const fetchDealDetailsForContacts = async (
  accessToken: string,
  contacts: HubSpotContact[],
): Promise<HubSpotDeal[]> => {
  const nestedDealIds = await Promise.all(
    contacts.map((contact) => fetchAssociatedIds(accessToken, "contacts", contact.id, "deals")),
  );
  const dealIds = Array.from(new Set(nestedDealIds.flat()));

  return dealIds.length > 0 ? fetchDealDetailsByIds(accessToken, dealIds) : [];
};

const fetchDealDetailsByIds = async (accessToken: string, dealIds: string[]): Promise<HubSpotDeal[]> => {
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

const fetchContactsByIds = async (accessToken: string, contactIds: string[]): Promise<HubSpotContact[]> => {
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

const fetchCompaniesByIds = async (accessToken: string, companyIds: string[]): Promise<HubSpotCompany[]> => {
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

const fetchObjectById = async <T>(
  accessToken: string,
  objectType: string,
  objectId: string,
  properties: string[],
  associations?: string[],
): Promise<T> => {
  const query = new URLSearchParams();
  query.set("properties", properties.join(","));

  if (associations && associations.length > 0) {
    query.set("associations", associations.join(","));
  }

  return hubSpotFetch<T>(`/crm/v3/objects/${objectType}/${objectId}?${query.toString()}`, {
    accessToken,
    maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
  });
};

const fetchAssociatedIds = async (
  accessToken: string,
  fromObjectType: string,
  objectId: string,
  toObjectType: string,
): Promise<string[]> => {
  const ids: string[] = [];
  let after: string | undefined;

  do {
    const searchParams = new URLSearchParams();
    searchParams.set("limit", "500");

    if (after) {
      searchParams.set("after", after);
    }

    const response = await hubSpotFetch<HubSpotAssociationResponse>(
      `/crm/v4/objects/${fromObjectType}/${objectId}/associations/${toObjectType}?${searchParams.toString()}`,
      {
        accessToken,
        maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
      },
    );

    ids.push(
      ...(response.results ?? [])
        .map((result) =>
          typeof result.toObjectId === "string"
            ? result.toObjectId
            : typeof result.toObjectId === "number"
              ? String(result.toObjectId)
              : typeof result.toObjectIdStr === "string"
                ? result.toObjectIdStr
                : null,
        )
        .filter((value): value is string => Boolean(value)),
    );
    after = response.paging?.next?.after;
  } while (after);

  return Array.from(new Set(ids));
};

const fetchAssociatedIdsForMany = async (
  accessToken: string,
  fromObjectType: string,
  objectIds: string[],
  toObjectType: string,
): Promise<string[]> => {
  if (objectIds.length === 0) {
    return [];
  }

  const nestedIds = await Promise.all(
    objectIds.map((objectId) => fetchAssociatedIds(accessToken, fromObjectType, objectId, toObjectType)),
  );

  return Array.from(new Set(nestedIds.flat()));
};

const fetchAssociatedIdMapForMany = async (
  accessToken: string,
  fromObjectType: string,
  objectIds: string[],
  toObjectType: string,
): Promise<Map<string, string[]>> => {
  const associationIdsByObjectId = new Map(objectIds.map((objectId) => [objectId, [] as string[]]));

  for (const batch of createBatches(objectIds, HUBSPOT_BATCH_READ_LIMIT)) {
    const response = await hubSpotFetch<HubSpotBatchAssociationResponse>(
      `/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/read`,
      {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          inputs: batch.map((objectId) => ({
            id: objectId,
          })),
        }),
        maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
      },
    );

    for (const result of response.results ?? []) {
      const fromId =
        typeof result.from?.id === "number"
          ? String(result.from.id)
          : typeof result.from?.id === "string"
            ? result.from.id
            : null;

      if (!fromId) {
        continue;
      }

      associationIdsByObjectId.set(
        fromId,
        Array.from(
          new Set(
            (result.to ?? [])
              .map((associatedObject) =>
                typeof associatedObject.toObjectId === "number"
                  ? String(associatedObject.toObjectId)
                  : typeof associatedObject.toObjectId === "string"
                    ? associatedObject.toObjectId
                    : null,
              )
              .filter((value): value is string => Boolean(value)),
          ),
        ),
      );
    }
  }

  return associationIdsByObjectId;
};

const enrichTasksWithAssociations = async (
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

const fetchPrimaryAssociatedContactIdsByDealIds = async (
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

const fetchPrimaryAssociatedCompanyIdsByDealIds = async (
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

const fetchAssociatedIdsByDealIds = async (
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

const fetchBatchObjects = async <T extends { id: string; properties: Record<string, string | null | undefined> }>(
  accessToken: string,
  objectType: string,
  objectIds: string[],
  properties: string[],
): Promise<T[]> => {
  if (objectIds.length === 0) {
    return [];
  }

  const results: T[] = [];

  for (const batch of createBatches(objectIds, HUBSPOT_BATCH_READ_LIMIT)) {
    const payload = await hubSpotFetch<{ results: T[] }>(`/crm/v3/objects/${objectType}/batch/read`, {
      method: "POST",
      accessToken,
      body: JSON.stringify({
        inputs: batch.map((id) => ({ id })),
        properties,
      }),
      maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
    });

    results.push(...payload.results);
  }

  return results;
};

const activityFetchConfigByType: Record<HubSpotActivityType, { objectType: string; properties: string[] }> = {
  call: {
    objectType: "calls",
    properties: HUBSPOT_CALL_PROPERTIES,
  },
  communication: {
    objectType: "communications",
    properties: HUBSPOT_COMMUNICATION_PROPERTIES,
  },
  email: {
    objectType: "emails",
    properties: HUBSPOT_EMAIL_PROPERTIES,
  },
  note: {
    objectType: "notes",
    properties: HUBSPOT_NOTE_PROPERTIES,
  },
  meeting: {
    objectType: "meetings",
    properties: HUBSPOT_MEETING_PROPERTIES,
  },
};

const readActivityAssociationIds = (
  associations: HubSpotActivityAssociations | undefined,
  key: keyof HubSpotActivityAssociations,
): string[] => associations?.[key]?.results.map((item) => item.id).filter(Boolean) ?? [];

const communicationRecordToHistoryType = (
  record: { properties: Record<string, string | null | undefined> },
): "sms" | "communication" =>
  normalizeCommunicationChannel(readProperty(record.properties, "hs_communication_channel_type")) === "SMS"
    ? "sms"
    : "communication";

const activityTypeToHistoryType = (
  activityType: HubSpotActivityType,
  record?: { properties: Record<string, string | null | undefined> },
): HubSpotDealHistoryItem["type"] => {
  if (activityType === "communication") {
    return record ? communicationRecordToHistoryType(record) : "communication";
  }

  return activityType;
};

const toActivitySnapshot = (
  activityType: HubSpotActivityType,
  record: HubSpotActivityRecord,
): HubSpotActivitySnapshot => {
  const historyItem = toHistoryItem(activityTypeToHistoryType(activityType, record), record);
  const channel =
    activityType === "communication"
      ? readProperty(record.properties, "hs_communication_channel_type")
      : activityType;

  return {
    id: record.id,
    activityType,
    channel,
    occurredAt: historyItem.timestamp,
    title: historyItem.title,
    body: historyItem.body,
    metadata: historyItem.metadata,
    properties: toNullablePropertiesRecord(record.properties, activityFetchConfigByType[activityType].properties),
    associatedContactIds: readActivityAssociationIds(record.associations, "contacts"),
    associatedCompanyIds: readActivityAssociationIds(record.associations, "companies"),
    associatedDealIds: readActivityAssociationIds(record.associations, "deals"),
  };
};

const fetchDealPipelines = async (accessToken: string): Promise<HubSpotDealPipeline[]> => {
  const pipelineIndex = await hubSpotFetch<HubSpotCollectionResponse<HubSpotDealPipeline>>("/crm/v3/pipelines/deals", {
    accessToken,
    maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
  });

  const pipelineIds = (pipelineIndex.results ?? [])
    .map((pipeline) => pipeline.id ?? pipeline.pipelineId ?? null)
    .filter((pipelineId): pipelineId is string => Boolean(pipelineId));

  if (pipelineIds.length === 0) {
    return [];
  }

  return Promise.all(
    pipelineIds.map((pipelineId) =>
      hubSpotFetch<HubSpotDealPipeline>(`/crm/v3/pipelines/deals/${pipelineId}`, {
        accessToken,
        maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
      }),
    ),
  );
};

export const hubSpotService = {
  buildAuthorizationUrl(statePayload: Record<string, string>): string {
    assertHubSpotConfigured();

    const params = new URLSearchParams({
      client_id: env.hubspotClientId,
      redirect_uri: env.hubspotRedirectUri,
      scope: env.hubspotScopes,
      state: toBase64Url(JSON.stringify(statePayload)),
    });

    return `${HUBSPOT_OAUTH_BASE_URL}?${params.toString()}`;
  },

  decodeState(state: string): Record<string, string> {
    const decoded = fromBase64Url(state);
    const parsed = JSON.parse(decoded) as Record<string, string>;

    return parsed;
  },

  async exchangeCodeForToken(code: string): Promise<HubSpotTokenResponse> {
    assertHubSpotConfigured();

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: env.hubspotClientId,
      client_secret: env.hubspotClientSecret,
      redirect_uri: env.hubspotRedirectUri,
      code,
    });

    return hubSpotFetch<HubSpotTokenResponse>("/oauth/v1/token", {
      method: "POST",
      body,
      maxRetries: 2,
    });
  },

  async refreshAccessToken(refreshToken: string): Promise<HubSpotTokenResponse> {
    assertHubSpotConfigured();

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env.hubspotClientId,
      client_secret: env.hubspotClientSecret,
      refresh_token: refreshToken,
    });

    return hubSpotFetch<HubSpotTokenResponse>("/oauth/v1/token", {
      method: "POST",
      body,
      maxRetries: 2,
    });
  },

  async fetchTokenInfo(accessToken: string): Promise<HubSpotTokenInfoResponse> {
    return hubSpotFetch<HubSpotTokenInfoResponse>(`/oauth/v1/access-tokens/${encodeURIComponent(accessToken)}`, {
      maxRetries: 1,
    });
  },

  async fetchCrmSnapshot(accessToken: string): Promise<HubSpotCrmSyncSnapshot> {
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
  },

  async fetchProspects(accessToken: string): Promise<HubSpotProspectSyncItem[]> {
    const snapshot = await this.fetchCrmSnapshot(accessToken);

    return snapshot.prospects;
  },

  async fetchProspectsByContactNames(accessToken: string, contactNames: string[]): Promise<HubSpotProspectSyncItem[]> {
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
  },

  async fetchProspectsByOwner(
    accessToken: string,
    hubspotOwnerId: string,
    maxProspects = HUBSPOT_OWNER_PROSPECT_LIMIT,
  ): Promise<HubSpotProspectSyncItem[]> {
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
  },

  async fetchCrmSnapshotByOwners(
    accessToken: string,
    hubspotOwnerIds: string[],
  ): Promise<HubSpotCrmSyncSnapshot> {
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
  },

  async fetchDealHistory(accessToken: string, dealId: string): Promise<HubSpotDealHistory> {
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
  },

  // Historique date d'une propriete de deal via l'API HubSpot propertiesWithHistory.
  // Renvoie les versions de la valeur dans l'ordre chronologique croissant.
  async fetchDealPropertyHistory(
    accessToken: string,
    dealId: string,
    propertyName: string,
  ): Promise<HubSpotPropertyHistoryEntry[]> {
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
  },

  async fetchDealActivityDebug(accessToken: string, dealId: string): Promise<HubSpotDealActivityDebug> {
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
      this.fetchDealHistory(accessToken, dealId),
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
  },

  async fetchActivity(
    accessToken: string,
    activityType: HubSpotActivityType,
    activityId: string,
  ): Promise<HubSpotActivitySnapshot> {
    const config = activityFetchConfigByType[activityType];
    const record = await fetchObjectById<HubSpotActivityRecord>(
      accessToken,
      config.objectType,
      activityId,
      config.properties,
      ["contacts", "companies", "deals"],
    );

    return toActivitySnapshot(activityType, record);
  },

  async fetchAssociatedDealIdsForContact(accessToken: string, contactId: string): Promise<string[]> {
    return fetchAssociatedIds(accessToken, "contacts", contactId, "deals");
  },

  async fetchAssociatedDealIdsForCompany(accessToken: string, companyId: string): Promise<string[]> {
    return fetchAssociatedIds(accessToken, "companies", companyId, "deals");
  },

  // Activites commerciales (call/meeting/communication) directement associees a un deal.
  // Sert au backfill des deals clotures, que le flux temps-reel ne relie pas.
  async fetchDealSalesActivityIds(
    accessToken: string,
    dealId: string,
  ): Promise<{ call: string[]; meeting: string[]; communication: string[] }> {
    const [call, meeting, communication] = await Promise.all([
      fetchAssociatedIds(accessToken, "deals", dealId, "calls"),
      fetchAssociatedIds(accessToken, "deals", dealId, "meetings"),
      fetchAssociatedIds(accessToken, "deals", dealId, "communications"),
    ]);

    return { call, meeting, communication };
  },

  async fetchDealCount(accessToken: string): Promise<number> {
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
  },

  async fetchDealCountByOwner(accessToken: string, hubspotOwnerId: string): Promise<number> {
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
  },

  async fetchOwners(accessToken: string): Promise<HubSpotOwner[]> {
    try {
      return await fetchAllPages<HubSpotOwner>("/crm/v3/owners", accessToken);
    } catch (error) {
      if (error instanceof Error && error.message.includes("403")) {
        throw new Error(
          "HubSpot refuse la liste des owners. Ajoute le scope crm.objects.owners.read puis reconnecte HubSpot.",
        );
      }

      throw error;
    }
  },

  async fetchLeadsByOwner(accessToken: string, hubspotOwnerId: string, limit: number): Promise<HubSpotLeadRecord[]> {
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
  },

  async fetchContactsByIds(accessToken: string, contactIds: string[]): Promise<HubSpotContactSnapshotItem[]> {
    const contacts = await fetchContactsByIds(accessToken, contactIds);

    return contacts.map((contact) => ({
      id: contact.id,
      properties: toNullablePropertiesRecord(contact.properties, HUBSPOT_CONTACT_PROPERTIES),
    }));
  },

  async createTask(accessToken: string, input: CreateHubSpotTaskInput): Promise<CreatedHubSpotTask> {
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
  },

  async fetchTask(accessToken: string, taskId: string): Promise<HubSpotTask> {
    return hubSpotFetch<HubSpotTask>(
      `/crm/v3/objects/tasks/${taskId}?properties=hs_task_subject,hs_task_body,hs_task_status,hs_task_priority,hs_task_type,hs_timestamp,hubspot_owner_id,hs_createdate&associations=contacts,companies,deals`,
      {
        accessToken,
        maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
      },
    );
  },

  async fetchTaskListItem(accessToken: string, taskId: string): Promise<HubSpotTaskListItem> {
    const task = await this.fetchTask(accessToken, taskId);

    return mapHubSpotTaskListItem(task);
  },

  async fetchTasksByOwner(
    accessToken: string,
    hubspotOwnerId: string,
    limit = 500,
    includeCompleted = false,
  ): Promise<HubSpotTaskListItem[]> {
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
  },

  async updateTaskPriority(
    accessToken: string,
    taskId: string,
    priority: HubSpotTaskPriority | null,
  ): Promise<HubSpotTaskListItem> {
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

    return this.fetchTaskListItem(accessToken, updatedTask.id);
  },

  async markTaskCompleted(accessToken: string, taskId: string): Promise<void> {
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
  },

  async completeTask(accessToken: string, taskId: string): Promise<HubSpotTaskListItem> {
    await this.markTaskCompleted(accessToken, taskId);

    return this.fetchTaskListItem(accessToken, taskId);
  },

  computePriorityScore,
};
