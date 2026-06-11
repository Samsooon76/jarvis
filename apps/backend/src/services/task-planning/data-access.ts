import { getSupabaseAdmin } from "../../db/client.js";
import type {
  ActivityEventRow,
  NormalizedSalesActivityEventInput,
  ProspectRow,
  SalesActivityEvent,
  SalesTaskListItem,
  SalesTaskProspectSummary,
  SalesTaskRow,
  SalesTasksTodayPayload,
  UserRow,
} from "./types.js";
import {
  ACTIVE_TASK_STATUSES,
  EVENT_TYPE_META,
  addDays,
  getProspectDealName,
  normalizeIsoDate,
  sanitizeSource,
  setTime,
  toNumber,
} from "./shared.js";

export const isSupabaseSchemaUnavailableError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";

  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST205" ||
    message.includes("sales_tasks") && (message.includes("could not find") || message.includes("does not exist"))
  );
};

export const buildEmptySalesTasksTodayPayload = (userId: string, orgId: string, generatedAt = new Date().toISOString()): SalesTasksTodayPayload => ({
  userId,
  orgId,
  generatedAt,
  tasks: [],
  nowTask: null,
  nextTask: null,
  counts: {
    pending: 0,
    snoozed: 0,
    skipped: 0,
    done: 0,
  },
});

export const mapActivityEventRow = (row: ActivityEventRow, duplicate: boolean): SalesActivityEvent => ({
  id: row.id,
  orgId: row.org_id,
  userId: row.user_id,
  prospectId: row.prospect_id,
  eventType: row.event_type,
  channel: row.channel,
  direction: row.direction,
  occurredAt: row.occurred_at,
  hubspotContactId: row.hubspot_contact_id,
  hubspotDealId: row.hubspot_deal_id,
  source: row.source,
  externalEventId: row.external_event_id,
  duplicate,
});

export const mapSalesTaskRow = (
  row: SalesTaskRow,
  prospectById: Map<string, SalesTaskProspectSummary> = new Map(),
): SalesTaskListItem => ({
  id: row.id,
  orgId: row.org_id,
  userId: row.user_id,
  prospectId: row.prospect_id,
  sourceEventId: row.source_event_id,
  taskKey: row.task_key,
  taskType: row.task_type,
  title: row.title,
  context: row.context,
  reason: row.reason,
  scheduledAt: row.scheduled_at,
  estimatedDurationMinutes: Math.max(5, toNumber(row.estimated_duration_minutes) ?? 20),
  priorityScore: toNumber(row.priority_score) ?? 0,
  status: row.status,
  snoozedUntil: row.snoozed_until,
  completedAt: row.completed_at,
  skippedAt: row.skipped_at,
  canceledAt: row.canceled_at,
  hubspotContactId: row.hubspot_contact_id,
  hubspotDealId: row.hubspot_deal_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  prospect: row.prospect_id ? prospectById.get(row.prospect_id) ?? null : null,
});

export const getProspectSummary = (prospect: ProspectRow): SalesTaskProspectSummary => ({
  id: prospect.id,
  name: prospect.name,
  company: prospect.company,
  email: prospect.email,
  phone: prospect.phone,
  title: prospect.title,
  dealName: getProspectDealName(prospect.raw_data),
  dealStage: prospect.deal_stage,
  dealAmount: toNumber(prospect.deal_amount),
  closeProbability: prospect.close_probability,
});

export const loadProspectById = async (orgId: string, prospectId: string): Promise<ProspectRow | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("prospects")
    .select(
      "id, org_id, owner_user_id, hubspot_contact_id, hubspot_deal_id, name, company, title, email, phone, deal_stage, deal_amount, close_probability, last_contact_at, next_action, next_action_at, ai_summary, snoozed_until, skipped_at, raw_data, synced_at",
    )
    .eq("org_id", orgId)
    .eq("id", prospectId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le prospect: ${error.message}`);
  }

  return data as ProspectRow | null;
};

export const loadProspectByHubSpotDealId = async (orgId: string, hubspotDealId: string): Promise<ProspectRow | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("prospects")
    .select(
      "id, org_id, owner_user_id, hubspot_contact_id, hubspot_deal_id, name, company, title, email, phone, deal_stage, deal_amount, close_probability, last_contact_at, next_action, next_action_at, ai_summary, snoozed_until, skipped_at, raw_data, synced_at",
    )
    .eq("org_id", orgId)
    .eq("hubspot_deal_id", hubspotDealId)
    .order("ai_priority_score", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Impossible de charger le prospect par deal HubSpot: ${error.message}`);
  }

  return ((data ?? []) as ProspectRow[])[0] ?? null;
};

export const loadProspectByHubSpotContactId = async (orgId: string, hubspotContactId: string): Promise<ProspectRow | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("prospects")
    .select(
      "id, org_id, owner_user_id, hubspot_contact_id, hubspot_deal_id, name, company, title, email, phone, deal_stage, deal_amount, close_probability, last_contact_at, next_action, next_action_at, ai_summary, snoozed_until, skipped_at, raw_data, synced_at",
    )
    .eq("org_id", orgId)
    .eq("hubspot_contact_id", hubspotContactId)
    .order("ai_priority_score", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Impossible de charger le prospect par contact HubSpot: ${error.message}`);
  }

  return ((data ?? []) as ProspectRow[])[0] ?? null;
};

export const resolveProspect = async (input: NormalizedSalesActivityEventInput): Promise<ProspectRow | null> => {
  if (input.prospectId) {
    return loadProspectById(input.orgId, input.prospectId);
  }

  if (input.hubspotDealId) {
    const prospect = await loadProspectByHubSpotDealId(input.orgId, input.hubspotDealId);

    if (prospect) {
      return prospect;
    }
  }

  if (input.hubspotContactId) {
    return loadProspectByHubSpotContactId(input.orgId, input.hubspotContactId);
  }

  return null;
};

export const loadUserRecordById = async (userId: string): Promise<UserRow | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("users").select("id, org_id, hubspot_owner_id").eq("id", userId).maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le commercial: ${error.message}`);
  }

  return data as UserRow | null;
};

export const loadUserById = async (orgId: string, userId: string): Promise<UserRow | null> => {
  const user = await loadUserRecordById(userId);

  if (user && user.org_id !== orgId) {
    throw new Error("Le commercial ne fait pas partie de cette organisation.");
  }

  return user;
};

export const loadUserByHubSpotOwnerId = async (orgId: string, hubspotOwnerId: string): Promise<UserRow | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("users")
    .select("id, org_id, hubspot_owner_id")
    .eq("org_id", orgId)
    .eq("hubspot_owner_id", hubspotOwnerId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le commercial HubSpot: ${error.message}`);
  }

  return data as UserRow | null;
};

export const resolveUserId = async (
  input: NormalizedSalesActivityEventInput,
  prospect: ProspectRow | null,
): Promise<string | null> => {
  if (input.userId) {
    const user = await loadUserById(input.orgId, input.userId);

    if (!user) {
      throw new Error("Commercial introuvable.");
    }

    return user.id;
  }

  if (prospect?.owner_user_id) {
    return prospect.owner_user_id;
  }

  if (input.hubspotOwnerId) {
    const user = await loadUserByHubSpotOwnerId(input.orgId, input.hubspotOwnerId);

    return user?.id ?? null;
  }

  return null;
};

export const insertActivityEvent = async (
  input: NormalizedSalesActivityEventInput,
  prospect: ProspectRow | null,
  userId: string | null,
): Promise<SalesActivityEvent> => {
  const supabase = getSupabaseAdmin();
  const source = sanitizeSource(input.source);
  const payload = input.payload ?? {};

  if (input.externalEventId) {
    const { data: existing, error: existingError } = await supabase
      .from("activity_events")
      .select(
        "id, org_id, user_id, prospect_id, source, external_event_id, event_type, channel, direction, occurred_at, hubspot_contact_id, hubspot_deal_id",
      )
      .eq("org_id", input.orgId)
      .eq("source", source)
      .eq("external_event_id", input.externalEventId)
      .maybeSingle();

    if (existingError) {
      throw new Error(`Impossible de verifier l'evenement existant: ${existingError.message}`);
    }

    if (existing) {
      return mapActivityEventRow(existing as ActivityEventRow, true);
    }
  }

  const meta = EVENT_TYPE_META[input.eventType];
  const { data, error } = await supabase
    .from("activity_events")
    .insert({
      org_id: input.orgId,
      user_id: userId,
      prospect_id: prospect?.id ?? null,
      source,
      external_event_id: input.externalEventId ?? null,
      event_type: input.eventType,
      channel: meta.channel,
      direction: meta.direction,
      occurred_at: normalizeIsoDate(input.occurredAt, new Date()),
      hubspot_contact_id: input.hubspotContactId ?? prospect?.hubspot_contact_id ?? null,
      hubspot_deal_id: input.hubspotDealId ?? prospect?.hubspot_deal_id ?? null,
      payload,
    })
    .select(
      "id, org_id, user_id, prospect_id, source, external_event_id, event_type, channel, direction, occurred_at, hubspot_contact_id, hubspot_deal_id",
    )
    .single();

  if (error) {
    throw new Error(`Impossible de persister l'evenement: ${error.message}`);
  }

  return mapActivityEventRow(data as ActivityEventRow, false);
};

export const loadOpenTasksByProspect = async (prospectId: string): Promise<SalesTaskRow[]> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("sales_tasks")
    .select(
      "id, org_id, user_id, prospect_id, source_event_id, task_key, task_type, title, context, reason, scheduled_at, estimated_duration_minutes, priority_score, status, snoozed_until, completed_at, skipped_at, canceled_at, hubspot_contact_id, hubspot_deal_id, created_at, updated_at",
    )
    .eq("prospect_id", prospectId)
    .in("status", ACTIVE_TASK_STATUSES);

  if (error) {
    throw new Error(`Impossible de charger les taches actives: ${error.message}`);
  }

  return (data ?? []) as SalesTaskRow[];
};

export const loadOpenTasksByUser = async (userId: string, excludedTaskKey: string): Promise<SalesTaskRow[]> => {
  const supabase = getSupabaseAdmin();
  const now = new Date();
  const startOfToday = setTime(now, 0);
  const horizon = addDays(startOfToday, 14);
  const { data, error } = await supabase
    .from("sales_tasks")
    .select(
      "id, org_id, user_id, prospect_id, source_event_id, task_key, task_type, title, context, reason, scheduled_at, estimated_duration_minutes, priority_score, status, snoozed_until, completed_at, skipped_at, canceled_at, hubspot_contact_id, hubspot_deal_id, created_at, updated_at",
    )
    .eq("user_id", userId)
    .neq("task_key", excludedTaskKey)
    .in("status", ACTIVE_TASK_STATUSES)
    .gte("scheduled_at", startOfToday.toISOString())
    .lt("scheduled_at", horizon.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(500);

  if (error) {
    throw new Error(`Impossible de charger les taches du commercial: ${error.message}`);
  }

  return (data ?? []) as SalesTaskRow[];
};

export const loadProspectSummaries = async (prospectIds: string[]): Promise<Map<string, SalesTaskProspectSummary>> => {
  const uniqueProspectIds = Array.from(new Set(prospectIds));

  if (uniqueProspectIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("prospects")
    .select(
      "id, org_id, owner_user_id, hubspot_contact_id, hubspot_deal_id, name, company, title, email, phone, deal_stage, deal_amount, close_probability, last_contact_at, next_action, next_action_at, ai_summary, snoozed_until, skipped_at, raw_data, synced_at",
    )
    .in("id", uniqueProspectIds);

  if (error) {
    throw new Error(`Impossible de charger les prospects des taches: ${error.message}`);
  }

  return new Map(((data ?? []) as ProspectRow[]).map((prospect) => [prospect.id, getProspectSummary(prospect)]));
};

export const loadTasksByIds = async (taskIds: string[]): Promise<SalesTaskListItem[]> => {
  const uniqueTaskIds = Array.from(new Set(taskIds));

  if (uniqueTaskIds.length === 0) {
    return [];
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("sales_tasks")
    .select(
      "id, org_id, user_id, prospect_id, source_event_id, task_key, task_type, title, context, reason, scheduled_at, estimated_duration_minutes, priority_score, status, snoozed_until, completed_at, skipped_at, canceled_at, hubspot_contact_id, hubspot_deal_id, created_at, updated_at",
    )
    .in("id", uniqueTaskIds);

  if (error) {
    throw new Error(`Impossible de charger les taches: ${error.message}`);
  }

  const rows = (data ?? []) as SalesTaskRow[];
  const prospectById = await loadProspectSummaries(rows.map((row) => row.prospect_id).filter((id): id is string => Boolean(id)));

  return rows.map((row) => mapSalesTaskRow(row, prospectById));
};
