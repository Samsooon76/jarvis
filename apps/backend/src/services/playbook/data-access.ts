import { getSupabaseAdmin } from "../../db/client.js";
import type {
  PlaybookActivityEvidenceRow,
  PlaybookPlayEvidenceRow,
  PlaybookPlayRow,
  PlaybookRow,
  PlaybookSuggestionRow,
} from "./types.js";

export const loadPlaybooks = async (orgId: string): Promise<PlaybookRow[]> => {
  const { data, error } = await getSupabaseAdmin()
    .from("playbooks")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Impossible de charger les playbooks: ${error.message}`);
  }

  return (data ?? []) as PlaybookRow[];
};

export const loadPlaybook = async (orgId: string, playbookId: string): Promise<PlaybookRow> => {
  const { data, error } = await getSupabaseAdmin()
    .from("playbooks")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", playbookId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le playbook: ${error.message}`);
  }

  if (!data) {
    throw new Error("Playbook introuvable.");
  }

  return data as PlaybookRow;
};

export const insertPlaybook = async (
  row: Pick<PlaybookRow, "org_id" | "name" | "description" | "created_by">,
): Promise<PlaybookRow> => {
  const { data, error } = await getSupabaseAdmin().from("playbooks").insert(row).select("*").single();

  if (error) {
    throw new Error(`Impossible de creer le playbook: ${error.message}`);
  }

  return data as PlaybookRow;
};

export const updatePlaybookRow = async (
  orgId: string,
  playbookId: string,
  patch: Partial<Pick<PlaybookRow, "name" | "description" | "status">>,
): Promise<PlaybookRow> => {
  const { data, error } = await getSupabaseAdmin()
    .from("playbooks")
    .update(patch)
    .eq("org_id", orgId)
    .eq("id", playbookId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Impossible de mettre a jour le playbook: ${error.message}`);
  }

  return data as PlaybookRow;
};

export const loadPlays = async (orgId: string, playbookIds: string[]): Promise<PlaybookPlayRow[]> => {
  if (playbookIds.length === 0) {
    return [];
  }

  const { data, error } = await getSupabaseAdmin()
    .from("playbook_plays")
    .select("*")
    .eq("org_id", orgId)
    .in("playbook_id", playbookIds)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Impossible de charger les plays: ${error.message}`);
  }

  return (data ?? []) as PlaybookPlayRow[];
};

export const loadActivePlays = async (orgId: string, playbookId: string): Promise<PlaybookPlayRow[]> => {
  const { data, error } = await getSupabaseAdmin()
    .from("playbook_plays")
    .select("*")
    .eq("org_id", orgId)
    .eq("playbook_id", playbookId)
    .eq("status", "active")
    .order("position", { ascending: true });

  if (error) {
    throw new Error(`Impossible de charger les plays actifs: ${error.message}`);
  }

  return (data ?? []) as PlaybookPlayRow[];
};

export const loadPlay = async (orgId: string, playId: string): Promise<PlaybookPlayRow> => {
  const { data, error } = await getSupabaseAdmin()
    .from("playbook_plays")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", playId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le play: ${error.message}`);
  }

  if (!data) {
    throw new Error("Play introuvable.");
  }

  return data as PlaybookPlayRow;
};

export const insertPlay = async (
  row: Pick<
    PlaybookPlayRow,
    "org_id" | "playbook_id" | "category" | "title" | "trigger_description" | "recommended_response" | "status" | "source" | "position"
  >,
): Promise<PlaybookPlayRow> => {
  const { data, error } = await getSupabaseAdmin().from("playbook_plays").insert(row).select("*").single();

  if (error) {
    throw new Error(`Impossible de creer le play: ${error.message}`);
  }

  return data as PlaybookPlayRow;
};

export const updatePlayRow = async (
  orgId: string,
  playId: string,
  patch: Partial<
    Pick<
      PlaybookPlayRow,
      "category" | "title" | "trigger_description" | "recommended_response" | "status" | "position" | "version"
    >
  >,
): Promise<PlaybookPlayRow> => {
  const { data, error } = await getSupabaseAdmin()
    .from("playbook_plays")
    .update(patch)
    .eq("org_id", orgId)
    .eq("id", playId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Impossible de mettre a jour le play: ${error.message}`);
  }

  return data as PlaybookPlayRow;
};

export const loadNextPlayPosition = async (orgId: string, playbookId: string): Promise<number> => {
  const { data, error } = await getSupabaseAdmin()
    .from("playbook_plays")
    .select("position")
    .eq("org_id", orgId)
    .eq("playbook_id", playbookId)
    .order("position", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Impossible de calculer la position du play: ${error.message}`);
  }

  const maxPosition = (data as Array<{ position: number }> | null)?.[0]?.position;

  return typeof maxPosition === "number" ? maxPosition + 1 : 0;
};

export const loadEvidence = async (orgId: string, playIds: string[]): Promise<PlaybookPlayEvidenceRow[]> => {
  if (playIds.length === 0) {
    return [];
  }

  const { data, error } = await getSupabaseAdmin()
    .from("playbook_play_evidence")
    .select("*")
    .eq("org_id", orgId)
    .in("play_id", playIds)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Impossible de charger les preuves: ${error.message}`);
  }

  return (data ?? []) as PlaybookPlayEvidenceRow[];
};

export const replacePlayEvidence = async (
  orgId: string,
  playId: string,
  evidence: Array<{ kind: string; refId: string; note: string | null }>,
): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const { error: deleteError } = await supabase
    .from("playbook_play_evidence")
    .delete()
    .eq("org_id", orgId)
    .eq("play_id", playId);

  if (deleteError) {
    throw new Error(`Impossible de remplacer les preuves: ${deleteError.message}`);
  }

  if (evidence.length === 0) {
    return;
  }

  const { error: insertError } = await supabase.from("playbook_play_evidence").insert(
    evidence.map((item) => ({
      org_id: orgId,
      play_id: playId,
      kind: item.kind,
      ref_id: item.refId,
      note: item.note,
    })),
  );

  if (insertError) {
    throw new Error(`Impossible d'enregistrer les preuves: ${insertError.message}`);
  }
};

export const loadPlaybookSuggestions = async (
  orgId: string,
  playbookId: string,
  status?: string,
): Promise<PlaybookSuggestionRow[]> => {
  let query = getSupabaseAdmin()
    .from("playbook_suggestions")
    .select("*")
    .eq("org_id", orgId)
    .eq("playbook_id", playbookId)
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Impossible de charger les suggestions playbook: ${error.message}`);
  }

  return (data ?? []) as PlaybookSuggestionRow[];
};

export const loadPlaybookSuggestion = async (
  orgId: string,
  playbookId: string,
  suggestionId: string,
): Promise<PlaybookSuggestionRow> => {
  const { data, error } = await getSupabaseAdmin()
    .from("playbook_suggestions")
    .select("*")
    .eq("org_id", orgId)
    .eq("playbook_id", playbookId)
    .eq("id", suggestionId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger la suggestion playbook: ${error.message}`);
  }

  if (!data) {
    throw new Error("Suggestion playbook introuvable.");
  }

  return data as PlaybookSuggestionRow;
};

export const insertPlaybookSuggestions = async (
  rows: Array<
    Pick<PlaybookSuggestionRow, "org_id" | "playbook_id" | "kind" | "payload" | "rationale" | "evidence"> &
      Partial<Pick<PlaybookSuggestionRow, "source" | "source_key" | "confidence" | "cooldown_until">>
  >,
): Promise<PlaybookSuggestionRow[]> => {
  if (rows.length === 0) {
    return [];
  }

  const { data, error } = await getSupabaseAdmin().from("playbook_suggestions").insert(rows).select("*");

  if (error) {
    throw new Error(`Impossible d'enregistrer les suggestions playbook: ${error.message}`);
  }

  return (data ?? []) as PlaybookSuggestionRow[];
};

export const loadRecentPlaybookActivityEvidence = async (
  orgId: string,
  sinceIso: string,
): Promise<PlaybookActivityEvidenceRow[]> => {
  const { data, error } = await getSupabaseAdmin()
    .from("activity_events")
    .select("id, hubspot_deal_id, event_type, channel, occurred_at, payload")
    .eq("org_id", orgId)
    .in("channel", ["call", "meeting", "note"])
    .gte("occurred_at", sinceIso)
    .order("occurred_at", { ascending: false })
    .limit(300);

  if (error) {
    throw new Error(`Impossible de charger les signaux d'activite playbook: ${error.message}`);
  }

  return (data ?? []) as PlaybookActivityEvidenceRow[];
};

export const resolvePlaybookSuggestionRow = async (
  orgId: string,
  playbookId: string,
  suggestionId: string,
  status: "accepted" | "rejected",
  resolvedBy: string | null,
): Promise<PlaybookSuggestionRow> => {
  const { data, error } = await getSupabaseAdmin()
    .from("playbook_suggestions")
    .update({ status, resolved_at: new Date().toISOString(), resolved_by: resolvedBy })
    .eq("org_id", orgId)
    .eq("playbook_id", playbookId)
    .eq("id", suggestionId)
    .eq("status", "pending")
    .select("*")
    .single();

  if (error) {
    throw new Error(`Impossible de resoudre la suggestion playbook: ${error.message}`);
  }

  return data as PlaybookSuggestionRow;
};

export const loadRecentCloseWonAnalyses = async (
  orgId: string,
  sinceIso: string,
): Promise<Array<{ hubspot_deal_id: string; analysis: unknown; generated_at: string }>> => {
  const { data, error } = await getSupabaseAdmin()
    .from("deal_ai_analyses")
    .select("hubspot_deal_id, analysis, generated_at")
    .eq("org_id", orgId)
    .eq("analysis_type", "close_won")
    .gte("generated_at", sinceIso)
    .order("generated_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`Impossible de charger les analyses close won: ${error.message}`);
  }

  return (data ?? []) as Array<{ hubspot_deal_id: string; analysis: unknown; generated_at: string }>;
};

export const loadRecentCloseLostAnalyses = async (
  orgId: string,
  sinceIso: string,
): Promise<Array<{ id: string; hubspot_deal_id: string; analysis: unknown; generated_at: string }>> => {
  const { data, error } = await getSupabaseAdmin()
    .from("close_lost_deal_analyses")
    .select("id, hubspot_deal_id, analysis, generated_at")
    .eq("org_id", orgId)
    .gte("generated_at", sinceIso)
    .order("generated_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`Impossible de charger les analyses close lost: ${error.message}`);
  }

  return (data ?? []) as Array<{ id: string; hubspot_deal_id: string; analysis: unknown; generated_at: string }>;
};
