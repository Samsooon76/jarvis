import type {
  HubSpotAssociationResponse,
  HubSpotBatchAssociationResponse,
  HubSpotCollectionResponse,
  HubSpotErrorPayload,
  HubSpotTaskPriority,
} from "./types.js";

export const HUBSPOT_API_BASE_URL = "https://api.hubapi.com";
export const HUBSPOT_OAUTH_BASE_URL = "https://app.hubspot.com/oauth/authorize";
export const HUBSPOT_TEN_SECOND_ROLLING_WAIT_MS = 11_000;
export const HUBSPOT_DEFAULT_MAX_RETRIES = 3;
export const HUBSPOT_BATCH_READ_LIMIT = 100;
export const HUBSPOT_OWNER_PROSPECT_LIMIT = 100;
export const HUBSPOT_OWNER_LEAD_LIMIT = 500;
export const HUBSPOT_DETAIL_CONCURRENCY = 10;
export const HUBSPOT_ASSOCIATION_CONCURRENCY = 25;
export const HUBSPOT_CONTACT_PROPERTIES = [
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
export const HUBSPOT_LEAD_OBJECT_TYPE = "0-136";
export const HUBSPOT_LEAD_PROPERTIES = [
  "hs_lead_name",
  "hs_pipeline",
  "hs_pipeline_stage",
  "hubspot_owner_id",
  "hs_createdate",
  "hs_lastmodifieddate",
];
export const HUBSPOT_DEAL_PROPERTIES = [
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
export const HUBSPOT_COMPANY_PROPERTIES = [
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
export const HUBSPOT_NOTE_PROPERTIES = ["hs_timestamp", "hs_note_body", "hubspot_owner_id"];
export const HUBSPOT_CALL_PROPERTIES = [
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
export const HUBSPOT_MEETING_PROPERTIES = [
  "hs_timestamp",
  "hs_meeting_title",
  "hs_meeting_body",
  "hs_meeting_start_time",
  "hs_meeting_end_time",
  "hubspot_owner_id",
];
export const HUBSPOT_EMAIL_PROPERTIES = [
  "hs_timestamp",
  "hs_email_subject",
  "hs_email_text",
  "hs_email_html",
  "hs_email_status",
  "hs_email_direction",
  "hubspot_owner_id",
];
export const HUBSPOT_COMMUNICATION_PROPERTIES = [
  "hs_timestamp",
  "hs_communication_channel_type",
  "hs_communication_logged_from",
  "hs_communication_body",
  "hubspot_owner_id",
];
export const HUBSPOT_TASK_PROPERTIES = [
  "hs_timestamp",
  "hs_task_subject",
  "hs_task_body",
  "hs_task_status",
  "hs_task_priority",
  "hs_task_type",
  "hubspot_owner_id",
];
export const HUBSPOT_TASK_ASSOCIATION_TYPE_IDS = {
  contact: 204,
  company: 192,
  deal: 216,
} as const;

export const HUBSPOT_TASK_PRIORITY_BY_LEVEL = {
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
} as const;

export const HUBSPOT_TASK_LEVEL_BY_PRIORITY = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
} as const satisfies Record<string, HubSpotTaskPriority>;

export const isHubSpotCompanyScopeError = (error: unknown): boolean =>
  error instanceof Error &&
  error.message.includes("MISSING_SCOPES") &&
  error.message.includes("crm.objects.companies");

export const isHubSpotLeadScopeError = (error: unknown): boolean =>
  error instanceof Error &&
  error.message.includes("MISSING_SCOPES") &&
  error.message.includes("crm.objects.leads");

export const sleep = async (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

export const createBatches = <T>(items: T[], batchSize: number): T[][] => {
  const batches: T[][] = [];

  for (let startIndex = 0; startIndex < items.length; startIndex += batchSize) {
    batches.push(items.slice(startIndex, startIndex + batchSize));
  }

  return batches;
};

export const getRetryDelayMs = (response: Response, payload: HubSpotErrorPayload): number => {
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

export const hubSpotFetch = async <T>(
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

export const fetchAllPages = async <T>(
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

export const fetchObjectById = async <T>(
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

export const fetchAssociatedIds = async (
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

export const fetchAssociatedIdsForMany = async (
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

export const fetchAssociatedIdMapForMany = async (
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

export const fetchBatchObjects = async <T extends { id: string; properties: Record<string, string | null | undefined> }>(
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
