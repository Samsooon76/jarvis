import { createHash } from "node:crypto";
import type { ProspectPriority } from "@jarvis/shared";
import { getSupabaseAdmin } from "../db/client.js";
import { createLlmProvider } from "./llm/provider.factory.js";
import type { LeadContactRankingAnalysis } from "./llm/llm.provider.js";

export type LeadContactScoringLeadInput = {
  orgId: string;
  hubspotLeadId: string;
  name: string;
  companyName: string | null;
  pipelineLabel: string | null;
  phaseId: string | null;
  phaseLabel: string | null;
  hubspotOwnerId: string | null;
  lastActivityAt: string | null;
};

export type LeadContactScoringContactInput = {
  hubspotContactId: string;
  hubspotOwnerId: string | null;
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  lifecycleStage: string | null;
  leadStatus: string | null;
  lastActivityAt: string | null;
};

export type LeadContactScore = {
  hubspotContactId: string;
  deterministicScore: number;
  aiScore: number | null;
  finalScore: number;
  priority: ProspectPriority;
  reason: string;
  recommendedAction: string;
  confidence: "low" | "medium" | "high" | null;
  inputHash: string;
  source: "deterministic" | "ai_cached";
};

export type ScoredLeadContact = LeadContactScoringContactInput & LeadContactScore;

type CachedScoreRow = {
  hubspot_contact_id: string;
  ai_score: number | null;
  final_score: number;
  priority: ProspectPriority;
  reason: string;
  recommended_action: string;
  confidence: "low" | "medium" | "high" | null;
  input_hash: string;
  provider: string | null;
  model: string | null;
  expires_at: string | null;
};

export type LeadContactCachedScore = CachedScoreRow;

type ScoreUpsertRow = {
  org_id: string;
  hubspot_lead_id: string;
  hubspot_contact_id: string;
  deterministic_score: number;
  ai_score: number | null;
  final_score: number;
  priority: ProspectPriority;
  reason: string;
  recommended_action: string;
  confidence: "low" | "medium" | "high" | null;
  input_hash: string;
  provider: string | null;
  model: string | null;
  expires_at: string | null;
  analyzed_at: string | null;
};

const MS_PER_DAY = 86_400_000;
const AI_CACHE_TTL_HOURS = 24;

const compactText = (value: string, maxLength: number): string => {
  const compacted = value.replace(/\s+/g, " ").trim();

  if (compacted.length <= maxLength) {
    return compacted;
  }

  return `${compacted.slice(0, maxLength - 1).trim()}...`;
};

const daysSince = (value: string | null, fallbackDays: number): number => {
  if (!value) {
    return fallbackDays;
  }

  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return fallbackDays;
  }

  return Math.max(0, Math.floor((Date.now() - timestamp) / MS_PER_DAY));
};

const clampScore = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const getPriority = (score: number): ProspectPriority => {
  if (score >= 80) {
    return "urgent";
  }

  if (score >= 55) {
    return "important";
  }

  return "routine";
};

const getRoleScore = (title: string | null): number => {
  const normalizedTitle = title?.toLowerCase() ?? "";

  if (!normalizedTitle) {
    return -8;
  }

  if (/(chief|ceo|coo|cfo|cto|cio|cmo|founder|fondateur|president|presidente|directeur|directrice|vp|head of|country manager)/i.test(normalizedTitle)) {
    return 24;
  }

  if (/(manager|responsable|lead|owner|sales|business|operations|ops|finance|achat|procurement|it|si|rh|hr)/i.test(normalizedTitle)) {
    return 14;
  }

  if (/(assistant|stagiaire|intern|alternant|junior)/i.test(normalizedTitle)) {
    return -6;
  }

  return 6;
};

const getPhaseScore = (phaseLabel: string | null, phaseId: string | null): number => {
  const phase = `${phaseLabel ?? ""} ${phaseId ?? ""}`.toLowerCase();

  if (phase.includes("meeting booked") || phase.includes("qualifi")) {
    return 18;
  }

  if (phase.includes("connect") || phase.includes("recontact")) {
    return 14;
  }

  if (phase.includes("tentative") || phase.includes("no show")) {
    return 10;
  }

  if (phase.includes("nouveau") || phase.includes("new")) {
    return 8;
  }

  return 4;
};

const getLifecycleScore = (lifecycleStage: string | null, leadStatus: string | null): number => {
  const lifecycle = lifecycleStage?.toLowerCase() ?? "";
  const status = leadStatus?.toLowerCase() ?? "";

  if (lifecycle.includes("opportunity") || status.includes("qualified")) {
    return 10;
  }

  if (lifecycle.includes("salesqualifiedlead") || lifecycle.includes("marketingqualifiedlead")) {
    return 7;
  }

  if (status.includes("open") || status.includes("new")) {
    return 4;
  }

  return 0;
};

const buildDeterministicReason = (
  contact: LeadContactScoringContactInput,
  scoreParts: string[],
): string => {
  if (scoreParts.length === 0) {
    return `${contact.name ?? "Contact"}: donnees CRM limitees, a qualifier avant priorisation.`;
  }

  return `${contact.name ?? "Contact"}: ${scoreParts.slice(0, 3).join(", ")}.`;
};

const buildRecommendedAction = (contact: LeadContactScoringContactInput, lead: LeadContactScoringLeadInput): string => {
  if (contact.phone) {
    return `Appeler ${contact.name ?? "ce contact"} pour qualifier le prochain pas sur ${lead.companyName ?? lead.name}.`;
  }

  if (contact.email) {
    return `Envoyer un email court a ${contact.name ?? "ce contact"} pour obtenir le bon interlocuteur a appeler.`;
  }

  return `Identifier les coordonnees de ${contact.name ?? "ce contact"} avant relance.`;
};

export const buildLeadContactInputHash = (
  lead: LeadContactScoringLeadInput,
  contact: LeadContactScoringContactInput,
): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        lead: {
          hubspotLeadId: lead.hubspotLeadId,
          name: lead.name,
          companyName: lead.companyName,
          phaseId: lead.phaseId,
          phaseLabel: lead.phaseLabel,
          pipelineLabel: lead.pipelineLabel,
          hubspotOwnerId: lead.hubspotOwnerId,
          lastActivityAt: lead.lastActivityAt,
        },
        contact,
      }),
    )
    .digest("hex");

export const scoreLeadContactDeterministically = (
  lead: LeadContactScoringLeadInput,
  contact: LeadContactScoringContactInput,
): LeadContactScore => {
  const daysSinceContact = daysSince(contact.lastActivityAt ?? lead.lastActivityAt, 30);
  const scoreParts: string[] = [];
  let score = 18;

  if (contact.phone) {
    score += 24;
    scoreParts.push("telephone disponible");
  }

  if (contact.email) {
    score += 12;
    scoreParts.push("email disponible");
  }

  if (!contact.phone && !contact.email) {
    score -= 22;
    scoreParts.push("coordonnees manquantes");
  }

  const roleScore = getRoleScore(contact.title);
  score += roleScore;
  if (roleScore >= 14) {
    scoreParts.push(`role exploitable (${contact.title})`);
  }

  const recencyScore = Math.max(0, 20 - Math.min(20, daysSinceContact));
  score += recencyScore;
  if (daysSinceContact <= 7) {
    scoreParts.push("activite recente");
  } else if (daysSinceContact >= 30) {
    score -= 8;
    scoreParts.push("activite ancienne");
  }

  score += getPhaseScore(lead.phaseLabel, lead.phaseId);
  score += getLifecycleScore(contact.lifecycleStage, contact.leadStatus);

  if (lead.hubspotOwnerId && contact.hubspotOwnerId && lead.hubspotOwnerId === contact.hubspotOwnerId) {
    score += 6;
    scoreParts.push("owner aligne");
  }

  const finalScore = clampScore(score);

  return {
    hubspotContactId: contact.hubspotContactId,
    deterministicScore: finalScore,
    aiScore: null,
    finalScore,
    priority: getPriority(finalScore),
    reason: compactText(buildDeterministicReason(contact, scoreParts), 220),
    recommendedAction: compactText(buildRecommendedAction(contact, lead), 160),
    confidence: null,
    inputHash: buildLeadContactInputHash(lead, contact),
    source: "deterministic",
  };
};

export const scoreLeadContacts = (
  lead: LeadContactScoringLeadInput,
  contacts: LeadContactScoringContactInput[],
): ScoredLeadContact[] =>
  contacts
    .map((contact) => ({
      ...contact,
      ...scoreLeadContactDeterministically(lead, contact),
    }))
    .sort((left, right) => right.finalScore - left.finalScore || (left.name ?? "").localeCompare(right.name ?? "", "fr"));

const isMissingScoreTableError = (error: { code?: string; message?: string }): boolean =>
  error.code === "PGRST205" || Boolean(error.message?.includes("hubspot_lead_contact_scores"));

const loadCachedScores = async (
  orgId: string,
  hubspotLeadId: string,
): Promise<Map<string, CachedScoreRow>> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("hubspot_lead_contact_scores")
    .select("hubspot_contact_id, ai_score, final_score, priority, reason, recommended_action, confidence, input_hash, provider, model, expires_at")
    .eq("org_id", orgId)
    .eq("hubspot_lead_id", hubspotLeadId);

  if (error) {
    if (isMissingScoreTableError(error)) {
      return new Map();
    }

    throw new Error(`Impossible de charger les scores contacts: ${error.message}`);
  }

  return new Map(((data ?? []) as CachedScoreRow[]).map((row) => [row.hubspot_contact_id, row]));
};

export const loadLeadContactScoreCacheForLeads = async (
  orgId: string,
  hubspotLeadIds: string[],
): Promise<Map<string, Map<string, LeadContactCachedScore>>> => {
  const cacheByLeadId = new Map<string, Map<string, LeadContactCachedScore>>();
  const uniqueLeadIds = Array.from(new Set(hubspotLeadIds.filter(Boolean)));

  if (uniqueLeadIds.length === 0) {
    return cacheByLeadId;
  }

  const supabase = getSupabaseAdmin();

  for (let index = 0; index < uniqueLeadIds.length; index += 80) {
    const batch = uniqueLeadIds.slice(index, index + 80);
    const { data, error } = await supabase
      .from("hubspot_lead_contact_scores")
      .select("hubspot_lead_id, hubspot_contact_id, ai_score, final_score, priority, reason, recommended_action, confidence, input_hash, provider, model, expires_at")
      .eq("org_id", orgId)
      .in("hubspot_lead_id", batch);

    if (error) {
      if (isMissingScoreTableError(error)) {
        return cacheByLeadId;
      }

      throw new Error(`Impossible de charger le cache des scores contacts: ${error.message}`);
    }

    for (const row of (data ?? []) as Array<LeadContactCachedScore & { hubspot_lead_id: string }>) {
      const leadCache = cacheByLeadId.get(row.hubspot_lead_id) ?? new Map<string, LeadContactCachedScore>();
      leadCache.set(row.hubspot_contact_id, row);
      cacheByLeadId.set(row.hubspot_lead_id, leadCache);
    }
  }

  return cacheByLeadId;
};

const persistScores = async (
  lead: LeadContactScoringLeadInput,
  scores: ScoredLeadContact[],
  analyzedAt: string | null,
): Promise<void> => {
  if (scores.length === 0) {
    return;
  }

  const rows: ScoreUpsertRow[] = scores.map((score) => ({
    org_id: lead.orgId,
    hubspot_lead_id: lead.hubspotLeadId,
    hubspot_contact_id: score.hubspotContactId,
    deterministic_score: score.deterministicScore,
    ai_score: score.aiScore,
    final_score: score.finalScore,
    priority: score.priority,
    reason: score.reason,
    recommended_action: score.recommendedAction,
    confidence: score.confidence,
    input_hash: score.inputHash,
    provider: score.source === "ai_cached" ? "openai" : null,
    model: null,
    expires_at: score.source === "ai_cached" ? new Date(Date.now() + AI_CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString() : null,
    analyzed_at: analyzedAt,
  }));
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("hubspot_lead_contact_scores").upsert(rows, {
    onConflict: "org_id,hubspot_lead_id,hubspot_contact_id",
  });

  if (error && !isMissingScoreTableError(error)) {
    throw new Error(`Impossible de sauvegarder les scores contacts: ${error.message}`);
  }
};

const mergeCachedScores = (
  deterministicScores: ScoredLeadContact[],
  cachedScores: Map<string, CachedScoreRow>,
): { scores: ScoredLeadContact[]; staleContactIds: string[] } => {
  const now = Date.now();
  const staleContactIds: string[] = [];
  const scores = deterministicScores.map((score) => {
    const cached = cachedScores.get(score.hubspotContactId);
    const expiresAt = cached?.expires_at ? new Date(cached.expires_at).getTime() : null;
    const isFresh =
      cached?.input_hash === score.inputHash &&
      cached.ai_score !== null &&
      expiresAt !== null &&
      !Number.isNaN(expiresAt) &&
      expiresAt > now;

    if (!isFresh) {
      staleContactIds.push(score.hubspotContactId);
      return score;
    }

    return {
      ...score,
      aiScore: Number(cached.ai_score),
      finalScore: Number(cached.final_score),
      priority: cached.priority,
      reason: cached.reason,
      recommendedAction: cached.recommended_action,
      confidence: cached.confidence,
      source: "ai_cached" as const,
    };
  });

  return {
    scores: scores.sort((left, right) => right.finalScore - left.finalScore || (left.name ?? "").localeCompare(right.name ?? "", "fr")),
    staleContactIds,
  };
};

const applyAiRanking = (
  deterministicScores: ScoredLeadContact[],
  analysis: LeadContactRankingAnalysis,
): ScoredLeadContact[] => {
  const aiByContactId = new Map(analysis.contacts.map((contact) => [contact.hubspotContactId, contact]));

  return deterministicScores
    .map((score) => {
      const ai = aiByContactId.get(score.hubspotContactId);

      if (!ai) {
        return score;
      }

      const finalScore = clampScore(score.deterministicScore * 0.65 + ai.aiScore * 0.35);

      return {
        ...score,
        aiScore: ai.aiScore,
        finalScore,
        priority: getPriority(finalScore),
        reason: ai.reason,
        recommendedAction: ai.recommendedAction,
        confidence: ai.confidence,
        source: "ai_cached" as const,
      };
    })
    .sort((left, right) => right.finalScore - left.finalScore || (left.name ?? "").localeCompare(right.name ?? "", "fr"));
};

const refreshLeadContactScoresWithAi = async (
  lead: LeadContactScoringLeadInput,
  scores: ScoredLeadContact[],
): Promise<void> => {
  const provider = createLlmProvider();
  const analysis = await provider.rankLeadContacts({
    lead: {
      hubspotLeadId: lead.hubspotLeadId,
      name: lead.name,
      companyName: lead.companyName,
      pipelineLabel: lead.pipelineLabel,
      phaseId: lead.phaseId,
      phaseLabel: lead.phaseLabel,
      lastActivityAt: lead.lastActivityAt,
    },
    contacts: scores.map((score) => ({
      hubspotContactId: score.hubspotContactId,
      name: score.name,
      title: score.title,
      email: score.email,
      phone: score.phone,
      lastActivityAt: score.lastActivityAt,
      lifecycleStage: score.lifecycleStage,
      leadStatus: score.leadStatus,
      deterministicScore: score.deterministicScore,
      deterministicReason: score.reason,
    })),
    today: new Date().toISOString(),
  });
  const refreshedScores = applyAiRanking(scores, analysis).map((score) => ({
    ...score,
    source: "ai_cached" as const,
  }));
  const expiresAt = new Date(Date.now() + AI_CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString();
  const rows: ScoreUpsertRow[] = refreshedScores.map((score) => ({
    org_id: lead.orgId,
    hubspot_lead_id: lead.hubspotLeadId,
    hubspot_contact_id: score.hubspotContactId,
    deterministic_score: score.deterministicScore,
    ai_score: score.aiScore,
    final_score: score.finalScore,
    priority: score.priority,
    reason: score.reason,
    recommended_action: score.recommendedAction,
    confidence: score.confidence,
    input_hash: score.inputHash,
    provider: provider.providerName,
    model: provider.modelName,
    expires_at: expiresAt,
    analyzed_at: new Date().toISOString(),
  }));
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("hubspot_lead_contact_scores").upsert(rows, {
    onConflict: "org_id,hubspot_lead_id,hubspot_contact_id",
  });

  if (error && !isMissingScoreTableError(error)) {
    throw new Error(`Impossible de sauvegarder le ranking IA des contacts: ${error.message}`);
  }
};

export const scoreLeadContactsWithCache = async (
  lead: LeadContactScoringLeadInput,
  contacts: LeadContactScoringContactInput[],
  options: {
    refreshAi?: boolean;
    onAiRefreshError?: (error: unknown) => void;
  } = {},
): Promise<ScoredLeadContact[]> => {
  const deterministicScores = scoreLeadContacts(lead, contacts);
  const cachedScores = await loadCachedScores(lead.orgId, lead.hubspotLeadId);
  const { scores, staleContactIds } = mergeCachedScores(deterministicScores, cachedScores);
  const staleContactIdSet = new Set(staleContactIds);
  const staleScores = deterministicScores.filter((score) => staleContactIdSet.has(score.hubspotContactId));

  await persistScores(lead, staleScores, null);

  if (options.refreshAi && staleContactIds.length > 0 && scores.length > 0) {
    void refreshLeadContactScoresWithAi(lead, deterministicScores).catch((error: unknown) => {
      options.onAiRefreshError?.(error);
    });
  }

  return scores;
};

export const scoreLeadContactsWithCachedScores = (
  lead: LeadContactScoringLeadInput,
  contacts: LeadContactScoringContactInput[],
  cachedScores: Map<string, LeadContactCachedScore> = new Map(),
): ScoredLeadContact[] => {
  const deterministicScores = scoreLeadContacts(lead, contacts);

  return mergeCachedScores(deterministicScores, cachedScores).scores;
};
