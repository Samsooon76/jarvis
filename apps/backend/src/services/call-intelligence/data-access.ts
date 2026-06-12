import { getSupabaseAdmin } from "../../db/client.js";
import type { Json } from "../../db/database.types.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../lib/errors.js";
import type { AuthContext } from "../app-auth.service.js";
import { analyzeCallDeterministically, buildCallInputHash } from "./analysis.js";
import type { CallAiAnalysis, CallAnalysisRow, CallAnalysisRunRow, CallSource } from "./types.js";

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

export type CallAnalysisListItem = {
  callId: string;
  orgId: string;
  userId: string | null;
  prospectId: string | null;
  startedAt: string | null;
  durationSeconds: number | null;
  sourceKind: CallSource["sourceKind"] | null;
  analyzedAt: string | null;
  provider: string | null;
  model: string | null;
  summary: string | null;
  sentiment: CallAiAnalysis["sentiment"] | null;
  riskLevel: CallAiAnalysis["riskLevel"] | null;
  confidence: CallAiAnalysis["confidence"] | null;
};

export type CallAnalysisDetail = CallAnalysisListItem & {
  analysis: CallAiAnalysis | null;
  cached: boolean;
};

export type CallInsightSummary = {
  orgId: string;
  generatedAt: string;
  totalAnalyzed: number;
  sentiment: Record<CallAiAnalysis["sentiment"], number>;
  riskLevel: Record<CallAiAnalysis["riskLevel"], number>;
  topObjections: Array<{ label: string; count: number }>;
  topCoachingTips: Array<{ label: string; count: number }>;
};

const DEFAULT_PROVIDER = "deterministic";
const DEFAULT_MODEL = "call-intelligence-v1";

const asCallAnalysis = (value: Json): CallAiAnalysis => value as unknown as CallAiAnalysis;

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

const buildFallbackNotes = (
  call: CallRow,
  prospect: ProspectNoteRow | null,
  activity: HubSpotCallActivityRow | null,
): string => {
  const parts = [
    activity?.body?.trim() ? activity.body.trim() : null,
    activity?.title?.trim() ? `Titre: ${activity.title.trim()}` : null,
    activity?.disposition?.trim() ? `Disposition: ${activity.disposition.trim()}` : null,
    call.ai_summary?.trim() ? `Resume IA: ${call.ai_summary.trim()}` : null,
    prospect?.ai_summary?.trim() ? `Resume prospect: ${prospect.ai_summary.trim()}` : null,
    prospect?.next_action?.trim() ? `Prochaine action: ${prospect.next_action.trim()}` : null,
    buildCallMetadataLine(call, prospect, activity),
  ].filter((part): part is string => Boolean(part?.trim()));

  return parts.join("\n");
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

  return data as HubSpotCallActivityRow | null;
};

const mapCallSource = (
  call: CallRow,
  prospect: ProspectNoteRow | null,
  activity: HubSpotCallActivityRow | null,
): CallSource => {
  const fallbackNotes = buildFallbackNotes(call, prospect, activity);
  const transcript = call.transcript?.trim() || null;
  const sourceText = transcript ?? fallbackNotes ?? call.ai_summary?.trim() ?? "";
  const sourceKind: CallSource["sourceKind"] = transcript ? "transcript" : fallbackNotes ? "notes" : "summary";

  return {
    callId: call.id,
    orgId: call.org_id,
    userId: call.user_id,
    prospectId: call.prospect_id,
    startedAt: call.started_at,
    durationSeconds: call.duration_seconds,
    direction: call.direction,
    status: call.status,
    transcript,
    fallbackNotes,
    sourceText,
    sourceKind,
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

  let prospect: ProspectNoteRow | null = null;

  if (call.prospect_id) {
    const { data: prospectData, error: prospectError } = await supabase
      .from("prospects")
      .select("ai_summary, next_action, name, company, deal_stage")
      .eq("id", call.prospect_id)
      .maybeSingle();

    if (prospectError) {
      throw new Error(`Impossible de charger les notes prospect: ${prospectError.message}`);
    }

    prospect = prospectData as ProspectNoteRow | null;
  }

  const activity = await loadHubSpotCallActivity(call.org_id, call.external_call_id);
  const source = mapCallSource(call, prospect, activity);

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
      return mapAnalysisDetail(source, cached, true);
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
  }, false);
};

export const listCallAnalyses = async (
  auth: AuthContext,
  query: { orgId?: string | null; userId?: string | null; limit?: number },
): Promise<CallAnalysisListItem[]> => {
  const orgId = query.orgId ?? auth.orgId;

  if (!orgId) {
    throw new ValidationError("orgId est obligatoire pour lister les analyses calls.");
  }

  ensureOrgScope(auth, orgId);

  let callQuery = getSupabaseAdmin()
    .from("calls")
    .select("id, org_id, user_id, prospect_id, direction, status, duration_seconds, started_at, transcript, ai_summary, created_at")
    .eq("org_id", orgId)
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(query.limit ?? 50);

  if (auth.role === "sales" && auth.appUserId) {
    callQuery = callQuery.eq("user_id", auth.appUserId);
  } else if (query.userId) {
    callQuery = callQuery.eq("user_id", query.userId);
  }

  const { data: callsData, error: callsError } = await callQuery;

  if (callsError) {
    throw new Error(`Impossible de lister les calls: ${callsError.message}`);
  }

  const calls = (callsData ?? []) as CallRow[];
  const callIds = calls.map((call) => call.id);

  if (callIds.length === 0) {
    return [];
  }

  const { data: analysisData, error: analysisError } = await getSupabaseAdmin()
    .from("call_ai_analyses")
    .select("*")
    .in("call_id", callIds)
    .order("generated_at", { ascending: false });

  if (analysisError) {
    throw new Error(`Impossible de lister les analyses calls: ${analysisError.message}`);
  }

  const latestByCallId = new Map<string, CallAnalysisRow>();

  for (const row of (analysisData ?? []) as CallAnalysisRow[]) {
    if (!latestByCallId.has(row.call_id)) {
      latestByCallId.set(row.call_id, row);
    }
  }

  return calls.map((call) => mapListItem(call, latestByCallId.get(call.id) ?? null));
};

export const getCallAnalysisDetail = async (callId: string, auth: AuthContext): Promise<CallAnalysisDetail> => {
  const source = await loadCallSource(callId, auth);
  const { data, error } = await getSupabaseAdmin()
    .from("call_ai_analyses")
    .select("*")
    .eq("call_id", callId)
    .order("generated_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Impossible de charger l'analyse call: ${error.message}`);
  }

  const row = ((data ?? []) as CallAnalysisRow[])[0] ?? null;

  return row ? mapAnalysisDetail(source, row, true) : mapAnalysisDetail(source, null, false);
};

export const getCallInsights = async (auth: AuthContext, orgIdInput?: string | null): Promise<CallInsightSummary> => {
  const orgId = orgIdInput ?? auth.orgId;

  if (!orgId) {
    throw new ValidationError("orgId est obligatoire pour charger les insights calls.");
  }

  ensureOrgScope(auth, orgId);

  let query = getSupabaseAdmin()
    .from("call_ai_analyses")
    .select("*")
    .eq("org_id", orgId)
    .order("generated_at", { ascending: false })
    .limit(500);

  if (auth.role === "sales" && auth.appUserId) {
    query = query.eq("user_id", auth.appUserId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Impossible de charger les insights calls: ${error.message}`);
  }

  const latestByCallId = new Map<string, CallAnalysisRow>();

  for (const row of (data ?? []) as CallAnalysisRow[]) {
    if (!latestByCallId.has(row.call_id)) {
      latestByCallId.set(row.call_id, row);
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

  let query = getSupabaseAdmin()
    .from("calls")
    .select("id")
    .eq("org_id", orgId)
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (auth.role === "sales" && auth.appUserId) {
    query = query.eq("user_id", auth.appUserId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Impossible de charger les calls a analyser: ${error.message}`);
  }

  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
};

const mapAnalysisDetail = (
  source: CallSource,
  row: CallAnalysisRow | null,
  cached: boolean,
): CallAnalysisDetail => ({
  callId: source.callId,
  orgId: source.orgId,
  userId: source.userId,
  prospectId: source.prospectId,
  startedAt: source.startedAt,
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
  cached,
});

const mapListItem = (call: CallRow, row: CallAnalysisRow | null): CallAnalysisListItem => ({
  callId: call.id,
  orgId: call.org_id,
  userId: call.user_id,
  prospectId: call.prospect_id,
  startedAt: call.started_at,
  durationSeconds: call.duration_seconds,
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
