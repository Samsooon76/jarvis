import type {
  CallAnalysisDetail,
  CallAnalysisListItem,
  CallDirection,
  CallInsightSummary,
  CallPeriod,
} from "@jarvis/shared";
import { getSupabaseAdmin } from "../../db/client.js";
import type { Json } from "../../db/database.types.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../lib/errors.js";
import type { AuthContext } from "../app-auth.service.js";
import { analyzeCallDeterministically, buildCallInputHash, extractConversationalText } from "./analysis.js";
import { canMergeCalls, groupDuplicateCalls, type CallGroup, type DedupeCall } from "./dedupe.js";
import type { CallAiAnalysis, CallAnalysisRow, CallAnalysisRunRow, CallSource } from "./types.js";

export type { CallAnalysisDetail, CallAnalysisListItem, CallInsightSummary } from "@jarvis/shared";

type CallRow = {
  id: string;
  org_id: string;
  user_id: string | null;
  prospect_id: string | null;
  external_call_id: string | null;
  direction: string;
  status: string | null;
  duration_seconds: number | null;
  started_at: string | null;
  transcript: string | null;
  ai_summary: string | null;
  created_at: string;
};

type ProspectNoteRow = {
  ai_summary: string | null;
  next_action: string | null;
  name: string;
  company: string;
  deal_stage: string | null;
};

type HubSpotCallActivityRow = {
  title: string | null;
  body: string | null;
  direction: string | null;
  status: string | null;
  disposition: string | null;
};

const DEFAULT_PROVIDER = "deterministic";
const DEFAULT_MODEL = "call-intelligence-v1";

const asCallAnalysis = (value: Json): CallAiAnalysis => value as unknown as CallAiAnalysis;

// Duree minimale (secondes) pour considerer un appel comme reellement connecte.
const CONNECTED_MIN_DURATION_SECONDS = 45;

// En dessous de ce seuil (tentatives, messages vocaux), l'appel n'apparait ni
// dans la liste, ni dans les insights, ni dans le backfill d'analyses.
const MIN_DISPLAY_DURATION_SECONDS = 30;

const keepDisplayableGroups = (groups: CallGroup[]): CallGroup[] =>
  groups.filter((group) => (group.durationSeconds ?? 0) >= MIN_DISPLAY_DURATION_SECONDS);

const PERIOD_DAYS: Record<Exclude<CallPeriod, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

const periodToDateFrom = (period: CallPeriod | undefined): string | null => {
  if (!period || period === "all") {
    return null;
  }

  const days = PERIOD_DAYS[period];

  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
};

const normalizeDirection = (value: string | null | undefined): CallDirection =>
  value?.toLowerCase() === "inbound" ? "inbound" : "outbound";

const toDedupeCall = (call: CallRow, richness: number): DedupeCall => ({
  id: call.id,
  startedAt: call.started_at,
  durationSeconds: call.duration_seconds,
  prospectId: call.prospect_id,
  userId: call.user_id,
  richness,
});

// Score de richesse du contenu par call: le transcript prime, puis le body de
// l'activite HubSpot (resume Modjo), puis le resume IA local.
const loadCallRichness = async (orgId: string, calls: CallRow[]): Promise<Map<string, number>> => {
  const hubspotIdByCallId = new Map(
    calls
      .filter((call) => call.external_call_id?.startsWith("hubspot:"))
      .map((call) => [call.id, (call.external_call_id as string).slice("hubspot:".length)]),
  );
  const activityIds = Array.from(new Set(hubspotIdByCallId.values())).filter(Boolean);
  const bodyLengthByActivityId = new Map<string, number>();

  if (activityIds.length > 0) {
    const { data, error } = await getSupabaseAdmin()
      .from("hubspot_activities")
      .select("hubspot_activity_id, body")
      .eq("org_id", orgId)
      .eq("activity_type", "call")
      .in("hubspot_activity_id", activityIds);

    if (error) {
      throw new Error(`Impossible de charger les contenus d'activite calls: ${error.message}`);
    }

    for (const row of (data ?? []) as Array<{ hubspot_activity_id: string; body: string | null }>) {
      bodyLengthByActivityId.set(row.hubspot_activity_id, stripMarkup(row.body)?.length ?? 0);
    }
  }

  return new Map(
    calls.map((call) => {
      const hubspotId = hubspotIdByCallId.get(call.id);
      const bodyLength = hubspotId ? bodyLengthByActivityId.get(hubspotId) ?? 0 : 0;

      return [call.id, (call.transcript?.trim().length ?? 0) * 3 + bodyLength + (call.ai_summary?.trim().length ?? 0)];
    }),
  );
};

const loadDedupedCallGroups = async (orgId: string, calls: CallRow[]): Promise<CallGroup[]> => {
  if (calls.length === 0) {
    return [];
  }

  const richness = await loadCallRichness(orgId, calls);

  return groupDuplicateCalls(calls.map((call) => toDedupeCall(call, richness.get(call.id) ?? 0)));
};

type CallNameContext = {
  contactName: string | null;
  companyName: string | null;
  ownerName: string | null;
};

const GENERIC_CALL_TITLE_PATTERN = /^appel\s+(sortant|entrant)/i;

const extractContactNameFromCallActivity = (title: string | null, body: string | null): string | null => {
  const plainBody = stripMarkup(body) ?? "";
  const plainTitle = stripMarkup(title) ?? "";

  const recipientMatch = plainBody.match(/destinataire de l'appel:\s*([^(\n]+)/i);
  if (recipientMatch?.[1]?.trim()) {
    return recipientMatch[1].trim();
  }

  const titledMatch = plainTitle.match(/^appel avec\s+(.+)$/i);
  if (titledMatch?.[1]?.trim()) {
    return titledMatch[1].trim();
  }

  if (plainTitle && !GENERIC_CALL_TITLE_PATTERN.test(plainTitle)) {
    return plainTitle;
  }

  return null;
};

const loadCallActivityLabels = async (
  orgId: string,
  calls: Array<Pick<CallRow, "id" | "external_call_id">>,
): Promise<Map<string, { title: string | null; body: string | null }>> => {
  const hubspotActivityIdByCallId = new Map(
    calls
      .filter(
        (call): call is Pick<CallRow, "id" | "external_call_id"> & { external_call_id: string } =>
          Boolean(call.external_call_id?.startsWith("hubspot:")),
      )
      .map((call) => [call.id, call.external_call_id.slice("hubspot:".length)]),
  );
  const activityIds = Array.from(new Set(hubspotActivityIdByCallId.values())).filter(Boolean);

  if (activityIds.length === 0) {
    return new Map();
  }

  const labelsByCallId = new Map<string, { title: string | null; body: string | null }>();

  for (const chunk of chunkValues(activityIds, 100)) {
    const { data, error } = await getSupabaseAdmin()
      .from("hubspot_activities")
      .select("hubspot_activity_id, title, body")
      .eq("org_id", orgId)
      .eq("activity_type", "call")
      .in("hubspot_activity_id", chunk);

    if (error) {
      throw new Error(`Impossible de charger les libelles d'activite call: ${error.message}`);
    }

    const labelByActivityId = new Map(
      ((data ?? []) as Array<{ hubspot_activity_id: string; title: string | null; body: string | null }>).map(
        (row) => [row.hubspot_activity_id, { title: row.title, body: row.body }],
      ),
    );

    for (const [callId, activityId] of hubspotActivityIdByCallId.entries()) {
      const label = labelByActivityId.get(activityId);

      if (label) {
        labelsByCallId.set(callId, label);
      }
    }
  }

  return labelsByCallId;
};

const loadCallNameContexts = async (
  orgId: string,
  calls: Array<Pick<CallRow, "id" | "prospect_id" | "user_id" | "external_call_id">>,
): Promise<Map<string, CallNameContext>> => {
  const supabase = getSupabaseAdmin();
  const prospectIds = Array.from(
    new Set(calls.map((call) => call.prospect_id).filter((value): value is string => Boolean(value))),
  );
  const userIds = Array.from(
    new Set(calls.map((call) => call.user_id).filter((value): value is string => Boolean(value))),
  );

  const [prospectsResult, usersResult, activityLabels] = await Promise.all([
    prospectIds.length > 0
      ? supabase.from("prospects").select("id, name, company").eq("org_id", orgId).in("id", prospectIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length > 0
      ? supabase.from("users").select("id, name").eq("org_id", orgId).in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
    loadCallActivityLabels(orgId, calls),
  ]);

  const prospectById = new Map(
    ((prospectsResult.data ?? []) as Array<{ id: string; name: string | null; company: string | null }>).map(
      (prospect) => [prospect.id, prospect],
    ),
  );
  const userNameById = new Map(
    ((usersResult.data ?? []) as Array<{ id: string; name: string | null }>).map((user) => [user.id, user.name]),
  );

  return new Map(
    calls.map((call) => {
      const prospect = call.prospect_id ? prospectById.get(call.prospect_id) : null;
      const activityLabel = activityLabels.get(call.id);
      const activityContactName = activityLabel
        ? extractContactNameFromCallActivity(activityLabel.title, activityLabel.body)
        : null;

      return [
        call.id,
        {
          contactName: prospect?.name?.trim() || activityContactName,
          companyName: prospect?.company?.trim() || null,
          ownerName: (call.user_id ? userNameById.get(call.user_id) : null)?.trim() || null,
        },
      ];
    }),
  );
};

const loadHubSpotOwnerIdByCallId = async (
  orgId: string,
  calls: Array<Pick<CallRow, "id" | "external_call_id">>,
): Promise<Map<string, string>> => {
  const hubspotActivityIdByCallId = new Map(
    calls
      .filter(
        (call): call is Pick<CallRow, "id" | "external_call_id"> & { external_call_id: string } =>
          Boolean(call.external_call_id?.startsWith("hubspot:")),
      )
      .map((call) => [call.id, call.external_call_id.slice("hubspot:".length)]),
  );
  const activityIds = Array.from(new Set(hubspotActivityIdByCallId.values())).filter(Boolean);

  if (activityIds.length === 0) {
    return new Map();
  }

  const { data, error } = await getSupabaseAdmin()
    .from("hubspot_activities")
    .select("hubspot_activity_id, hubspot_owner_id")
    .eq("org_id", orgId)
    .eq("activity_type", "call")
    .in("hubspot_activity_id", activityIds);

  if (error) {
    throw new Error(`Impossible de charger les owners HubSpot des calls: ${error.message}`);
  }

  const ownerIdByActivityId = new Map(
    ((data ?? []) as Array<{ hubspot_activity_id: string; hubspot_owner_id: string | null }>)
      .filter((row) => row.hubspot_owner_id)
      .map((row) => [row.hubspot_activity_id, row.hubspot_owner_id as string]),
  );

  return new Map(
    [...hubspotActivityIdByCallId.entries()]
      .map(([callId, activityId]) => {
        const hubspotOwnerId = ownerIdByActivityId.get(activityId);

        return hubspotOwnerId ? ([callId, hubspotOwnerId] as const) : null;
      })
      .filter((entry): entry is readonly [string, string] => entry !== null),
  );
};

const loadUserIdByHubSpotOwnerId = async (orgId: string, hubspotOwnerIds: string[]): Promise<Map<string, string>> => {
  const uniqueOwnerIds = Array.from(new Set(hubspotOwnerIds.filter(Boolean)));

  if (uniqueOwnerIds.length === 0) {
    return new Map();
  }

  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("id, hubspot_owner_id")
    .eq("org_id", orgId)
    .in("hubspot_owner_id", uniqueOwnerIds);

  if (error) {
    throw new Error(`Impossible de charger les users lies aux owners HubSpot: ${error.message}`);
  }

  return new Map(
    ((data ?? []) as Array<{ id: string; hubspot_owner_id: string | null }>)
      .filter((user) => user.hubspot_owner_id)
      .map((user) => [user.hubspot_owner_id as string, user.id]),
  );
};

// Les calls historiques n'ont souvent pas user_id: on le derive de l'owner HubSpot
// de l'activite call avant filtrage manager et affichage du commercial.
const enrichCallsWithResolvedUserIds = async (orgId: string, calls: CallRow[]): Promise<CallRow[]> => {
  const callsMissingUserId = calls.filter((call) => !call.user_id);

  if (callsMissingUserId.length === 0) {
    return calls;
  }

  const hubspotOwnerIdByCallId = await loadHubSpotOwnerIdByCallId(orgId, callsMissingUserId);
  const userIdByHubSpotOwnerId = await loadUserIdByHubSpotOwnerId(
    orgId,
    Array.from(new Set(hubspotOwnerIdByCallId.values())),
  );

  return calls.map((call) => {
    if (call.user_id) {
      return call;
    }

    const hubspotOwnerId = hubspotOwnerIdByCallId.get(call.id);
    const resolvedUserId = hubspotOwnerId ? userIdByHubSpotOwnerId.get(hubspotOwnerId) ?? null : null;

    return resolvedUserId ? { ...call, user_id: resolvedUserId } : call;
  });
};

const filterCallsByUserId = (calls: CallRow[], userId: string): CallRow[] =>
  calls.filter((call) => call.user_id === userId);

const CALL_LIST_SELECT =
  "id, org_id, user_id, prospect_id, external_call_id, direction, status, duration_seconds, started_at, transcript, ai_summary, created_at";

const SCOPED_CALL_FETCH_LIMIT = 1000;

const chunkValues = <T>(values: T[], size: number): T[][] => {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
};

const sortCallsByStartedAtDesc = (calls: CallRow[]): CallRow[] =>
  [...calls].sort(
    (left, right) => new Date(right.started_at ?? 0).getTime() - new Date(left.started_at ?? 0).getTime(),
  );

const loadHubSpotOwnerIdForUser = async (orgId: string, userId: string): Promise<string | null> => {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("hubspot_owner_id")
    .eq("org_id", orgId)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger l'owner HubSpot du commercial: ${error.message}`);
  }

  return (data as { hubspot_owner_id: string | null } | null)?.hubspot_owner_id ?? null;
};

// Charge tous les calls d'un commercial sur la periode, y compris ceux dont user_id
// est encore null en base mais rattaches a son hubspot_owner_id.
const loadCallsForScopedUser = async (
  orgId: string,
  userId: string,
  options: {
    dateFrom: string | null;
    direction?: CallDirection | "all";
    maxRows?: number;
  },
): Promise<CallRow[]> => {
  const supabase = getSupabaseAdmin();
  const maxRows = options.maxRows ?? SCOPED_CALL_FETCH_LIMIT;
  const callsById = new Map<string, CallRow>();

  const appendCalls = (rows: CallRow[]): void => {
    for (const row of rows) {
      callsById.set(row.id, row);
    }
  };

  let directQuery = supabase
    .from("calls")
    .select(CALL_LIST_SELECT)
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(maxRows);

  if (options.dateFrom) {
    directQuery = directQuery.gte("started_at", options.dateFrom);
  }

  if (options.direction && options.direction !== "all") {
    directQuery = directQuery.eq("direction", options.direction);
  }

  const { data: directCalls, error: directError } = await directQuery;

  if (directError) {
    throw new Error(`Impossible de charger les calls du commercial: ${directError.message}`);
  }

  appendCalls((directCalls ?? []) as CallRow[]);

  const hubspotOwnerId = await loadHubSpotOwnerIdForUser(orgId, userId);

  if (!hubspotOwnerId) {
    return sortCallsByStartedAtDesc([...callsById.values()]);
  }

  let activityQuery = supabase
    .from("hubspot_activities")
    .select("hubspot_activity_id")
    .eq("org_id", orgId)
    .eq("activity_type", "call")
    .eq("hubspot_owner_id", hubspotOwnerId)
    .order("occurred_at", { ascending: false })
    .limit(maxRows);

  if (options.dateFrom) {
    activityQuery = activityQuery.gte("occurred_at", options.dateFrom);
  }

  const { data: activities, error: activityError } = await activityQuery;

  if (activityError) {
    throw new Error(`Impossible de charger les activites call du commercial: ${activityError.message}`);
  }

  const externalCallIds = Array.from(
    new Set(
      ((activities ?? []) as Array<{ hubspot_activity_id: string }>).map(
        (activity) => `hubspot:${activity.hubspot_activity_id}`,
      ),
    ),
  );

  for (const chunk of chunkValues(externalCallIds, 100)) {
    let callQuery = supabase.from("calls").select(CALL_LIST_SELECT).eq("org_id", orgId).in("external_call_id", chunk);

    if (options.dateFrom) {
      callQuery = callQuery.gte("started_at", options.dateFrom);
    }

    if (options.direction && options.direction !== "all") {
      callQuery = callQuery.eq("direction", options.direction);
    }

    const { data: linkedCalls, error: linkedError } = await callQuery;

    if (linkedError) {
      throw new Error(`Impossible de charger les calls lies au commercial: ${linkedError.message}`);
    }

    appendCalls((linkedCalls ?? []) as CallRow[]);
  }

  return sortCallsByStartedAtDesc([...callsById.values()]);
};

const ensureOrgScope = (auth: AuthContext, orgId: string): void => {
  if (auth.orgId && auth.orgId !== orgId) {
    throw new ForbiddenError("Cette session n'a pas acces a cette organisation.");
  }
};

const ensureOwnerScope = (auth: AuthContext, call: Pick<CallRow, "user_id">): void => {
  if (auth.role === "sales" && auth.appUserId && call.user_id !== auth.appUserId) {
    throw new ForbiddenError("Un commercial ne peut acceder qu'a ses propres calls.");
  }
};

// Les bodies d'activite HubSpot arrivent en HTML (<p>, <br>, entites): on les
// nettoie avant analyse et affichage, comme hubspot-activity-history.
const stripMarkup = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const stripped = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return stripped || null;
};

const formatCallDuration = (seconds: number | null): string | null => {
  if (!seconds || seconds <= 0) {
    return null;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;

  return minutes > 0 ? `${minutes} min ${remainder} s` : `${remainder} s`;
};

const buildCallMetadataLine = (
  call: CallRow,
  prospect: ProspectNoteRow | null,
  activity: HubSpotCallActivityRow | null,
): string => {
  const direction = call.direction === "inbound" ? "entrant" : "sortant";
  const duration = formatCallDuration(call.duration_seconds);
  const date = call.started_at
    ? new Date(call.started_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : null;
  const prospectLabel = prospect ? [prospect.name, prospect.company].filter(Boolean).join(" — ") : null;

  return [
    prospectLabel ? `Contexte: ${prospectLabel}` : null,
    prospect?.deal_stage ? `Etape deal: ${prospect.deal_stage}` : null,
    `Appel ${direction}`,
    duration ? `duree ${duration}` : null,
    date ? `le ${date}` : null,
    call.status ? `statut ${call.status}` : null,
    activity?.status?.trim() ? `statut HubSpot ${activity.status.trim()}` : null,
  ]
    .filter(Boolean)
    .join(", ")
    .concat(".");
};

// Fusionne les contenus de toutes les entrees du groupe (Onoff + Modjo): les
// bodies distincts sont concatenes, le resume Modjo etant generalement le plus riche.
const buildFallbackNotes = (
  call: CallRow,
  members: CallRow[],
  prospect: ProspectNoteRow | null,
  activities: HubSpotCallActivityRow[],
): string => {
  // Body le plus riche d'abord (resume Modjo avant le log telephonique Onoff).
  // Titre et disposition HubSpot sont volontairement ecartes: le titre duplique
  // le log Onoff et la disposition est un GUID illisible.
  const bodies = Array.from(
    new Set(
      activities
        .map((activity) => extractConversationalText(activity.body ?? ""))
        .filter((body): body is string => Boolean(body)),
    ),
  ).sort((left, right) => right.length - left.length);
  const aiSummary = members
    .map((member) => member.ai_summary?.trim())
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.length - left.length)[0] ?? null;
  const parts = [
    ...bodies,
    aiSummary ? `Resume IA: ${aiSummary}` : null,
    prospect?.ai_summary?.trim() ? `Resume prospect: ${prospect.ai_summary.trim()}` : null,
    prospect?.next_action?.trim() ? `Prochaine action: ${prospect.next_action.trim()}` : null,
    buildCallMetadataLine(call, prospect, activities[0] ?? null),
  ].filter((part): part is string => Boolean(part?.trim()));

  return parts.join("\n\n");
};

const loadHubSpotCallActivity = async (
  orgId: string,
  externalCallId: string | null,
): Promise<HubSpotCallActivityRow | null> => {
  if (!externalCallId?.startsWith("hubspot:")) {
    return null;
  }

  const hubspotActivityId = externalCallId.slice("hubspot:".length);

  if (!hubspotActivityId) {
    return null;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("hubspot_activities")
    .select("title, body, direction, status, disposition")
    .eq("org_id", orgId)
    .eq("activity_type", "call")
    .eq("hubspot_activity_id", hubspotActivityId)
    .maybeSingle();

  if (error) {
    return null;
  }

  const activity = data as HubSpotCallActivityRow | null;

  if (!activity) {
    return null;
  }

  return {
    title: stripMarkup(activity.title),
    body: stripMarkup(activity.body),
    direction: activity.direction,
    status: activity.status,
    disposition: stripMarkup(activity.disposition),
  };
};

const mapCallSource = (
  call: CallRow,
  members: CallRow[],
  prospect: ProspectNoteRow | null,
  activities: HubSpotCallActivityRow[],
): CallSource => {
  const fallbackNotes = buildFallbackNotes(call, members, prospect, activities);
  // Le transcript le plus long du groupe fait foi (Modjo si present).
  const transcript = members
    .map((member) => stripMarkup(member.transcript))
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.length - left.length)[0] ?? null;
  const sourceText = transcript ?? fallbackNotes ?? call.ai_summary?.trim() ?? "";
  const sourceKind: CallSource["sourceKind"] = transcript ? "transcript" : fallbackNotes ? "notes" : "summary";
  const durations = members
    .map((member) => member.duration_seconds)
    .filter((value): value is number => value !== null && value > 0);
  const startTimes = members
    .map((member) => (member.started_at ? new Date(member.started_at).getTime() : Number.NaN))
    .filter((time) => Number.isFinite(time));

  return {
    callId: call.id,
    orgId: call.org_id,
    userId: call.user_id ?? members.find((member) => member.user_id)?.user_id ?? null,
    prospectId: call.prospect_id ?? members.find((member) => member.prospect_id)?.prospect_id ?? null,
    startedAt: startTimes.length > 0 ? new Date(Math.min(...startTimes)).toISOString() : call.started_at,
    durationSeconds: durations.length > 0 ? Math.max(...durations) : call.duration_seconds,
    direction: call.direction,
    status: call.status,
    transcript,
    fallbackNotes,
    sourceText,
    sourceKind,
    memberCallIds: members.map((member) => member.id),
  };
};

export const loadCallSource = async (callId: string, auth: AuthContext): Promise<CallSource> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("calls")
    .select(
      "id, org_id, user_id, prospect_id, external_call_id, direction, status, duration_seconds, started_at, transcript, ai_summary, created_at",
    )
    .eq("id", callId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le call: ${error.message}`);
  }

  const call = data as CallRow | null;

  if (!call) {
    throw new NotFoundError("Call introuvable.");
  }

  ensureOrgScope(auth, call.org_id);
  ensureOwnerScope(auth, call);

  // Recupere les doublons potentiels du meme appel (Onoff + Modjo) dans une
  // fenetre de +/- 6 minutes, puis filtre avec la regle de dedoublonnage.
  let members: CallRow[] = [call];

  if (call.started_at) {
    const startTime = new Date(call.started_at).getTime();
    const { data: siblingData, error: siblingError } = await supabase
      .from("calls")
      .select(
        "id, org_id, user_id, prospect_id, external_call_id, direction, status, duration_seconds, started_at, transcript, ai_summary, created_at",
      )
      .eq("org_id", call.org_id)
      .neq("id", call.id)
      .gte("started_at", new Date(startTime - 6 * 60 * 1000).toISOString())
      .lte("started_at", new Date(startTime + 6 * 60 * 1000).toISOString());

    if (siblingError) {
      throw new Error(`Impossible de charger les doublons du call: ${siblingError.message}`);
    }

    const mergeable = ((siblingData ?? []) as CallRow[]).filter((sibling) =>
      canMergeCalls(toDedupeCall(call, 0), toDedupeCall(sibling, 0)),
    );

    members = [call, ...mergeable];
  }

  const prospectId = call.prospect_id ?? members.find((member) => member.prospect_id)?.prospect_id ?? null;
  let prospect: ProspectNoteRow | null = null;

  if (prospectId) {
    const { data: prospectData, error: prospectError } = await supabase
      .from("prospects")
      .select("ai_summary, next_action, name, company, deal_stage")
      .eq("id", prospectId)
      .maybeSingle();

    if (prospectError) {
      throw new Error(`Impossible de charger les notes prospect: ${prospectError.message}`);
    }

    prospect = prospectData as ProspectNoteRow | null;
  }

  const activities = (
    await Promise.all(members.map((member) => loadHubSpotCallActivity(call.org_id, member.external_call_id)))
  ).filter((activity): activity is HubSpotCallActivityRow => activity !== null);
  const source = mapCallSource(call, members, prospect, activities);

  if (!source.sourceText.trim()) {
    throw new ValidationError("Aucun transcript, resume ou notes exploitables pour ce call.");
  }

  return source;
};

export const analyzeCall = async (
  callId: string,
  auth: AuthContext,
  options: { refresh?: boolean } = {},
): Promise<CallAnalysisDetail> => {
  const supabase = getSupabaseAdmin();
  const source = await loadCallSource(callId, auth);
  const inputHash = buildCallInputHash(source);

  if (!options.refresh) {
    const { data: cachedRows, error: cachedError } = await supabase
      .from("call_ai_analyses")
      .select("*")
      .eq("call_id", callId)
      .eq("input_hash", inputHash)
      .order("generated_at", { ascending: false })
      .limit(1);

    if (cachedError) {
      throw new Error(`Impossible de charger l'analyse call en cache: ${cachedError.message}`);
    }

    const cached = ((cachedRows ?? []) as CallAnalysisRow[])[0];

    if (cached) {
      return mapAnalysisDetail(source, cached, true, await loadSourceNameContext(source));
    }
  }

  const analysis = analyzeCallDeterministically(source);
  const generatedAt = new Date().toISOString();
  const { data: savedRows, error: saveError } = await supabase
    .from("call_ai_analyses")
    .upsert(
      {
        org_id: source.orgId,
        call_id: source.callId,
        user_id: source.userId,
        prospect_id: source.prospectId,
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        input_hash: inputHash,
        source_kind: source.sourceKind,
        analysis: analysis as unknown as Json,
        generated_at: generatedAt,
      },
      { onConflict: "call_id,input_hash" },
    )
    .select("*");

  if (saveError) {
    throw new Error(`Impossible d'enregistrer l'analyse call: ${saveError.message}`);
  }

  const saved = ((savedRows ?? []) as CallAnalysisRow[])[0];
  const names = await loadSourceNameContext(source);

  return mapAnalysisDetail(source, saved ?? {
    id: "",
    org_id: source.orgId,
    call_id: source.callId,
    user_id: source.userId,
    prospect_id: source.prospectId,
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    input_hash: inputHash,
    source_kind: source.sourceKind,
    analysis: analysis as unknown as Json,
    generated_at: generatedAt,
    created_at: generatedAt,
  }, false, names);
};

export const listCallAnalyses = async (
  auth: AuthContext,
  query: {
    orgId?: string | null;
    userId?: string | null;
    limit?: number;
    period?: CallPeriod;
    direction?: CallDirection | "all";
  },
): Promise<CallAnalysisListItem[]> => {
  const orgId = query.orgId ?? auth.orgId;

  if (!orgId) {
    throw new ValidationError("orgId est obligatoire pour lister les analyses calls.");
  }

  ensureOrgScope(auth, orgId);

  const limit = query.limit ?? 50;
  const dateFrom = periodToDateFrom(query.period);
  const scopedUserId =
    auth.role === "sales" && auth.appUserId ? auth.appUserId : query.userId?.trim() || null;

  let calls: CallRow[];

  if (scopedUserId) {
    calls = await loadCallsForScopedUser(orgId, scopedUserId, {
      dateFrom,
      direction: query.direction,
      maxRows: SCOPED_CALL_FETCH_LIMIT,
    });
    calls = await enrichCallsWithResolvedUserIds(orgId, calls);
    calls = filterCallsByUserId(calls, scopedUserId);
  } else {
    // Vue equipe: on aligne la fenetre de lecture sur les insights (1000 lignes max).
    let callQuery = getSupabaseAdmin()
      .from("calls")
      .select(CALL_LIST_SELECT)
      .eq("org_id", orgId)
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(SCOPED_CALL_FETCH_LIMIT);

    if (dateFrom) {
      callQuery = callQuery.gte("started_at", dateFrom);
    }

    if (query.direction && query.direction !== "all") {
      callQuery = callQuery.eq("direction", query.direction);
    }

    const { data: callsData, error: callsError } = await callQuery;

    if (callsError) {
      throw new Error(`Impossible de lister les calls: ${callsError.message}`);
    }

    calls = await enrichCallsWithResolvedUserIds(orgId, (callsData ?? []) as CallRow[]);
  }

  if (calls.length === 0) {
    return [];
  }

  const callById = new Map(calls.map((call) => [call.id, call]));
  const groups = keepDisplayableGroups(await loadDedupedCallGroups(orgId, calls)).slice(0, limit);
  const allMemberRows = groups.flatMap((group) =>
    group.memberIds.map((id) => callById.get(id)).filter((row): row is CallRow => Boolean(row)),
  );
  // Le contexte de noms se calcule sur le membre le mieux renseigne du groupe.
  const nameLookupRows = groups.map((group) => {
    const members = group.memberIds.map((id) => callById.get(id)).filter((row): row is CallRow => Boolean(row));
    const canonical = callById.get(group.canonicalId) ?? members[0] ?? null;

    return {
      id: group.canonicalId,
      prospect_id: members.find((member) => member.prospect_id)?.prospect_id ?? null,
      user_id: members.find((member) => member.user_id)?.user_id ?? null,
      external_call_id: canonical?.external_call_id ?? null,
    };
  });
  const allMemberIds = groups.flatMap((group) => group.memberIds);
  const canonicalIdByMemberId = new Map(
    groups.flatMap((group) => group.memberIds.map((memberId) => [memberId, group.canonicalId] as const)),
  );

  const [nameContexts, activityLabels, analysisResult] = await Promise.all([
    loadCallNameContexts(orgId, nameLookupRows),
    loadCallActivityLabels(orgId, allMemberRows),
    getSupabaseAdmin()
      .from("call_ai_analyses")
      .select("*")
      .in("call_id", allMemberIds)
      .order("generated_at", { ascending: false }),
  ]);

  const resolvedNameContexts = new Map(
    groups.map((group) => {
      const base = nameContexts.get(group.canonicalId) ?? {
        contactName: null,
        companyName: null,
        ownerName: null,
      };

      if (base.contactName) {
        return [group.canonicalId, base] as const;
      }

      for (const memberId of group.memberIds) {
        const label = activityLabels.get(memberId);
        const contactName = label ? extractContactNameFromCallActivity(label.title, label.body) : null;

        if (contactName) {
          return [group.canonicalId, { ...base, contactName }] as const;
        }
      }

      return [group.canonicalId, base] as const;
    }),
  );

  if (analysisResult.error) {
    throw new Error(`Impossible de lister les analyses calls: ${analysisResult.error.message}`);
  }

  // Derniere analyse du groupe, quelle que soit l'entree (Onoff ou Modjo) analysee.
  const latestByCanonicalId = new Map<string, CallAnalysisRow>();

  for (const row of (analysisResult.data ?? []) as CallAnalysisRow[]) {
    const canonicalId = canonicalIdByMemberId.get(row.call_id);

    if (canonicalId && !latestByCanonicalId.has(canonicalId)) {
      latestByCanonicalId.set(canonicalId, row);
    }
  }

  return groups
    .map((group) => {
      const canonical = callById.get(group.canonicalId);

      if (!canonical) {
        return null;
      }

      return mapListItem(
        canonical,
        latestByCanonicalId.get(group.canonicalId) ?? null,
        resolvedNameContexts.get(group.canonicalId) ?? null,
        group,
      );
    })
    .filter((item): item is CallAnalysisListItem => item !== null);
};

export const getCallAnalysisDetail = async (callId: string, auth: AuthContext): Promise<CallAnalysisDetail> => {
  const source = await loadCallSource(callId, auth);
  // L'analyse a pu etre stockee sur n'importe quelle entree du groupe fusionne.
  const { data, error } = await getSupabaseAdmin()
    .from("call_ai_analyses")
    .select("*")
    .in("call_id", source.memberCallIds)
    .order("generated_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Impossible de charger l'analyse call: ${error.message}`);
  }

  const row = ((data ?? []) as CallAnalysisRow[])[0] ?? null;
  const names = await loadSourceNameContext(source);

  return row ? mapAnalysisDetail(source, row, true, names) : mapAnalysisDetail(source, null, false, names);
};

export const getCallInsights = async (
  auth: AuthContext,
  orgIdInput?: string | null,
  period?: CallPeriod,
  userId?: string | null,
): Promise<CallInsightSummary> => {
  const orgId = orgIdInput ?? auth.orgId;

  if (!orgId) {
    throw new ValidationError("orgId est obligatoire pour charger les insights calls.");
  }

  ensureOrgScope(auth, orgId);

  const dateFrom = periodToDateFrom(period);
  const scopedUserId = auth.role === "sales" && auth.appUserId ? auth.appUserId : userId?.trim() || null;
  let callRows: CallRow[];

  if (scopedUserId) {
    callRows = await loadCallsForScopedUser(orgId, scopedUserId, {
      dateFrom,
      maxRows: SCOPED_CALL_FETCH_LIMIT,
    });
    callRows = await enrichCallsWithResolvedUserIds(orgId, callRows);
    callRows = filterCallsByUserId(callRows, scopedUserId);
  } else {
    let callsQuery = getSupabaseAdmin()
      .from("calls")
      .select(CALL_LIST_SELECT)
      .eq("org_id", orgId)
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(SCOPED_CALL_FETCH_LIMIT);

    if (dateFrom) {
      callsQuery = callsQuery.gte("started_at", dateFrom);
    }

    const { data: callsData, error: callsError } = await callsQuery;

    if (callsError) {
      throw new Error(`Impossible de charger les volumes calls: ${callsError.message}`);
    }

    callRows = await enrichCallsWithResolvedUserIds(orgId, (callsData ?? []) as CallRow[]);
  }
  // Comptage par appel reel: les doublons Onoff/Modjo comptent pour un seul appel.
  // Le canonique n'importe pas ici, donc richesse 0 (pas de chargement des bodies).
  const groups = keepDisplayableGroups(groupDuplicateCalls(callRows.map((row) => toDedupeCall(row, 0))));
  const canonicalIdByMemberId = new Map(
    groups.flatMap((group) => group.memberIds.map((memberId) => [memberId, group.canonicalId] as const)),
  );
  const connectedCalls = groups.filter(
    (group) => (group.durationSeconds ?? 0) >= CONNECTED_MIN_DURATION_SECONDS,
  ).length;
  const totalDuration = groups.reduce((sum, group) => sum + (group.durationSeconds ?? 0), 0);

  let query = getSupabaseAdmin()
    .from("call_ai_analyses")
    .select("*")
    .eq("org_id", orgId)
    .order("generated_at", { ascending: false })
    .limit(500);

  if (auth.role === "sales" && auth.appUserId) {
    query = query.eq("user_id", auth.appUserId);
  } else if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Impossible de charger les insights calls: ${error.message}`);
  }

  const latestByCallId = new Map<string, CallAnalysisRow>();

  for (const row of (data ?? []) as CallAnalysisRow[]) {
    // On ne garde que les analyses des calls de la periode, une par appel reel.
    const canonicalId = canonicalIdByMemberId.get(row.call_id);

    if (!canonicalId) {
      continue;
    }

    if (!latestByCallId.has(canonicalId)) {
      latestByCallId.set(canonicalId, row);
    }
  }

  const analyses = [...latestByCallId.values()].map((row) => asCallAnalysis(row.analysis));
  const sentiment: CallInsightSummary["sentiment"] = { positive: 0, neutral: 0, negative: 0 };
  const riskLevel: CallInsightSummary["riskLevel"] = { low: 0, medium: 0, high: 0 };
  const objections = new Map<string, number>();
  const coachingTips = new Map<string, number>();

  for (const analysis of analyses) {
    sentiment[analysis.sentiment] += 1;
    riskLevel[analysis.riskLevel] += 1;
    for (const objection of analysis.objections) {
      objections.set(objection, (objections.get(objection) ?? 0) + 1);
    }
    for (const tip of analysis.coachingTips) {
      coachingTips.set(tip, (coachingTips.get(tip) ?? 0) + 1);
    }
  }

  return {
    orgId,
    generatedAt: new Date().toISOString(),
    totalCalls: groups.length,
    connectedCalls,
    averageDurationSeconds: groups.length > 0 ? Math.round(totalDuration / groups.length) : 0,
    totalAnalyzed: analyses.length,
    sentiment,
    riskLevel,
    topObjections: mapTopCounts(objections),
    topCoachingTips: mapTopCounts(coachingTips),
  };
};

export const createCallAnalysisRun = async (input: {
  orgId: string;
  requestedByUserId: string | null;
  scope: Json;
}): Promise<CallAnalysisRunRow> => {
  const { data, error } = await getSupabaseAdmin()
    .from("call_analysis_runs")
    .insert({
      org_id: input.orgId,
      requested_by_user_id: input.requestedByUserId,
      status: "queued",
      scope: input.scope,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Impossible de creer le run d'analyse calls: ${error.message}`);
  }

  return data as CallAnalysisRunRow;
};

export const updateCallAnalysisRun = async (
  runId: string,
  patch: Partial<
    Pick<
      CallAnalysisRunRow,
      "status" | "processed_count" | "analyzed_count" | "skipped_count" | "failed_count" | "error" | "finished_at"
    >
  >,
): Promise<void> => {
  const { error } = await getSupabaseAdmin()
    .from("call_analysis_runs")
    .update({
      status: patch.status,
      processed_count: patch.processed_count,
      analyzed_count: patch.analyzed_count,
      skipped_count: patch.skipped_count,
      failed_count: patch.failed_count,
      error: patch.error,
      finished_at: patch.finished_at,
    })
    .eq("id", runId);

  if (error) {
    throw new Error(`Impossible de mettre a jour le run d'analyse calls: ${error.message}`);
  }
};

export const listBackfillCallIds = async (auth: AuthContext, orgId: string, limit: number): Promise<string[]> => {
  ensureOrgScope(auth, orgId);

  // On surcharge la fenetre puis on dedoublonne: une seule analyse par appel reel,
  // lancee sur l'entree canonique (la plus riche, generalement Modjo).
  let query = getSupabaseAdmin()
    .from("calls")
    .select(
      "id, org_id, user_id, prospect_id, external_call_id, direction, status, duration_seconds, started_at, transcript, ai_summary, created_at",
    )
    .eq("org_id", orgId)
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(Math.min(1000, limit * 2));

  const { data, error } = await query;

  if (error) {
    throw new Error(`Impossible de charger les calls a analyser: ${error.message}`);
  }

  let calls = await enrichCallsWithResolvedUserIds(orgId, (data ?? []) as CallRow[]);

  if (auth.role === "sales" && auth.appUserId) {
    calls = filterCallsByUserId(calls, auth.appUserId);
  }

  const groups = keepDisplayableGroups(await loadDedupedCallGroups(orgId, calls));

  return groups.slice(0, limit).map((group) => group.canonicalId);
};

const loadSourceNameContext = async (source: CallSource): Promise<CallNameContext> => {
  const { data, error } = await getSupabaseAdmin()
    .from("calls")
    .select("id, external_call_id")
    .in("id", source.memberCallIds);

  if (error) {
    throw new Error(`Impossible de charger les metadonnees du call: ${error.message}`);
  }

  const memberRows = (data ?? []) as Array<Pick<CallRow, "id" | "external_call_id">>;
  const [contexts, activityLabels] = await Promise.all([
    loadCallNameContexts(source.orgId, [
      {
        id: source.callId,
        prospect_id: source.prospectId,
        user_id: source.userId,
        external_call_id:
          memberRows.find((row) => row.id === source.callId)?.external_call_id ??
          memberRows.find((row) => row.external_call_id)?.external_call_id ??
          null,
      },
    ]),
    loadCallActivityLabels(source.orgId, memberRows),
  ]);

  const base = contexts.get(source.callId) ?? { contactName: null, companyName: null, ownerName: null };

  if (base.contactName) {
    return base;
  }

  for (const member of memberRows) {
    const label = activityLabels.get(member.id);
    const contactName = label ? extractContactNameFromCallActivity(label.title, label.body) : null;

    if (contactName) {
      return { ...base, contactName };
    }
  }

  return base;
};

const mapAnalysisDetail = (
  source: CallSource,
  row: CallAnalysisRow | null,
  cached: boolean,
  names: CallNameContext,
): CallAnalysisDetail => ({
  callId: source.callId,
  orgId: source.orgId,
  userId: source.userId,
  prospectId: source.prospectId,
  contactName: names.contactName,
  companyName: names.companyName,
  ownerName: names.ownerName,
  direction: normalizeDirection(source.direction),
  status: source.status,
  startedAt: source.startedAt,
  mergedCallCount: source.memberCallIds.length,
  durationSeconds: source.durationSeconds,
  sourceKind: row?.source_kind ?? source.sourceKind,
  analyzedAt: row?.generated_at ?? null,
  provider: row?.provider ?? null,
  model: row?.model ?? null,
  summary: row ? asCallAnalysis(row.analysis).summary : null,
  sentiment: row ? asCallAnalysis(row.analysis).sentiment : null,
  riskLevel: row ? asCallAnalysis(row.analysis).riskLevel : null,
  confidence: row ? asCallAnalysis(row.analysis).confidence : null,
  analysis: row ? asCallAnalysis(row.analysis) : null,
  sourceText: source.sourceText.trim() || null,
  cached,
});

const mapListItem = (
  call: CallRow,
  row: CallAnalysisRow | null,
  names: CallNameContext | null,
  group: CallGroup | null,
): CallAnalysisListItem => ({
  callId: call.id,
  orgId: call.org_id,
  userId: call.user_id,
  prospectId: call.prospect_id,
  contactName: names?.contactName ?? null,
  companyName: names?.companyName ?? null,
  ownerName: names?.ownerName ?? null,
  direction: normalizeDirection(call.direction),
  status: call.status,
  startedAt: group?.startedAt ?? call.started_at,
  durationSeconds: group?.durationSeconds ?? call.duration_seconds,
  mergedCallCount: group?.memberIds.length ?? 1,
  sourceKind: row?.source_kind ?? null,
  analyzedAt: row?.generated_at ?? null,
  provider: row?.provider ?? null,
  model: row?.model ?? null,
  summary: row ? asCallAnalysis(row.analysis).summary : null,
  sentiment: row ? asCallAnalysis(row.analysis).sentiment : null,
  riskLevel: row ? asCallAnalysis(row.analysis).riskLevel : null,
  confidence: row ? asCallAnalysis(row.analysis).confidence : null,
});

const mapTopCounts = (counts: Map<string, number>): Array<{ label: string; count: number }> =>
  [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 10);
