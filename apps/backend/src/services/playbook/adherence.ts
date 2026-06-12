import { createHash } from "node:crypto";
import type { PlaybookAdherencePlayResult, PlaybookAdherenceResult } from "@jarvis/shared";
import type { Json } from "../../db/database.types.js";
import { getSupabaseAdmin } from "../../db/client.js";
import { ValidationError } from "../../lib/errors.js";
import type { AuthContext } from "../app-auth.service.js";
import { loadCallSource } from "../call-intelligence/data-access.js";
import { loadActivePlays, loadPlaybook } from "./data-access.js";
import type { PlaybookPlayRow } from "./types.js";

const DEFAULT_PROVIDER = "deterministic";
const DEFAULT_MODEL = "playbook-adherence-v1";
const MAX_KEYWORDS_PER_FIELD = 10;
const MAX_SNIPPETS_PER_PLAY = 3;
const MAX_SNIPPET_LENGTH = 180;

const STOPWORDS = new Set([
  "avec",
  "dans",
  "pour",
  "vous",
  "nous",
  "votre",
  "notre",
  "plus",
  "mais",
  "donc",
  "comme",
  "chez",
  "sans",
  "sur",
  "that",
  "this",
  "with",
  "from",
  "your",
  "have",
  "will",
  "what",
  "when",
  "then",
  "than",
  "play",
  "deal",
]);

type PlaybookAdherenceRow = {
  id: string;
  org_id: string;
  playbook_id: string;
  call_id: string;
  user_id: string | null;
  prospect_id: string | null;
  provider: string;
  model: string;
  input_hash: string;
  score: number;
  scanned_play_count: number;
  matched_play_count: number;
  missing_opportunity_count: number;
  matched_plays: Json;
  missing_opportunities: Json;
  evidence: Json;
  generated_at: string;
  created_at: string;
};

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const compact = (value: string, maxLength: number): string => {
  const normalized = value.replace(/\s+/g, " ").trim();

  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trim()}...`;
};

const tokenize = (value: string): string[] => {
  const tokens = normalize(value).match(/[a-z0-9]{4,}/g) ?? [];
  const unique = new Set(tokens.filter((token) => !STOPWORDS.has(token)));

  return Array.from(unique);
};

const extractKeywords = (value: string): string[] =>
  tokenize(value)
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .slice(0, MAX_KEYWORDS_PER_FIELD);

const findMatchedKeywords = (text: string, keywords: string[]): string[] => {
  const normalizedText = normalize(text);

  return keywords.filter((keyword) => normalizedText.includes(keyword));
};

const extractSnippet = (transcript: string, keyword: string): string | null => {
  const normalizedTranscript = normalize(transcript);
  const index = normalizedTranscript.indexOf(keyword);

  if (index < 0) {
    return null;
  }

  const start = Math.max(0, index - 70);
  const end = Math.min(transcript.length, index + keyword.length + 90);

  return compact(transcript.slice(start, end), MAX_SNIPPET_LENGTH);
};

const buildPlayResult = (play: PlaybookPlayRow, transcript: string): PlaybookAdherencePlayResult => {
  const triggerKeywords = extractKeywords(play.trigger_description);
  const responseKeywords = extractKeywords(play.recommended_response);
  const matchedTriggerKeywords = findMatchedKeywords(transcript, triggerKeywords);
  const matchedResponseKeywords = findMatchedKeywords(transcript, responseKeywords);
  const triggerMatched = matchedTriggerKeywords.length > 0;
  const responseMatched = matchedResponseKeywords.length > 0;
  const status: PlaybookAdherencePlayResult["status"] =
    triggerMatched && responseMatched ? "matched" : triggerMatched ? "missing_opportunity" : "no_signal";
  const snippetKeywords = [...matchedTriggerKeywords, ...matchedResponseKeywords];
  const evidenceSnippets = Array.from(
    new Set(snippetKeywords.map((keyword) => extractSnippet(transcript, keyword)).filter((snippet): snippet is string => Boolean(snippet))),
  ).slice(0, MAX_SNIPPETS_PER_PLAY);

  return {
    playId: play.id,
    title: play.title,
    category: play.category,
    triggerMatched,
    responseMatched,
    triggerKeywords: matchedTriggerKeywords,
    responseKeywords: matchedResponseKeywords,
    evidenceSnippets,
    status,
  };
};

const buildInputHash = (input: { transcript: string; plays: PlaybookPlayRow[] }): string => {
  const playFingerprint = input.plays
    .map((play) => `${play.id}:${play.version}:${play.updated_at}`)
    .sort()
    .join("|");

  return createHash("sha256").update(`${input.transcript}\n${playFingerprint}`, "utf8").digest("hex");
};

const mapRow = (row: PlaybookAdherenceRow): PlaybookAdherenceResult => ({
  id: row.id,
  orgId: row.org_id,
  playbookId: row.playbook_id,
  callId: row.call_id,
  score: row.score,
  scannedPlayCount: row.scanned_play_count,
  matchedPlayCount: row.matched_play_count,
  missingOpportunityCount: row.missing_opportunity_count,
  matchedPlays: row.matched_plays as unknown as PlaybookAdherencePlayResult[],
  missingOpportunities: row.missing_opportunities as unknown as PlaybookAdherencePlayResult[],
  generatedAt: row.generated_at,
});

export const measurePlaybookAdherenceForCall = async (
  orgId: string,
  playbookId: string,
  callId: string,
  auth: AuthContext,
): Promise<PlaybookAdherenceResult> => {
  const [playbook, source] = await Promise.all([loadPlaybook(orgId, playbookId), loadCallSource(callId, auth)]);

  if (playbook.org_id !== source.orgId) {
    throw new ValidationError("Ce call n'appartient pas a l'organisation du playbook.");
  }

  if (!source.transcript?.trim()) {
    throw new ValidationError("Un transcript est obligatoire pour mesurer l'adherence au playbook.");
  }

  const plays = await loadActivePlays(orgId, playbookId);
  const results = plays.map((play) => buildPlayResult(play, source.transcript ?? ""));
  const matchedPlays = results.filter((result) => result.status === "matched");
  const missingOpportunities = results.filter((result) => result.status === "missing_opportunity");
  const opportunityCount = matchedPlays.length + missingOpportunities.length;
  const score = opportunityCount === 0 ? 100 : Math.round((matchedPlays.length / opportunityCount) * 100);
  const generatedAt = new Date().toISOString();
  const inputHash = buildInputHash({ transcript: source.transcript, plays });
  const evidence = results
    .filter((result) => result.status !== "no_signal")
    .map((result) => ({
      playId: result.playId,
      status: result.status,
      snippets: result.evidenceSnippets,
    }));

  const { data, error } = await getSupabaseAdmin()
    .from("playbook_call_adherence")
    .upsert(
      {
        org_id: orgId,
        playbook_id: playbookId,
        call_id: callId,
        user_id: source.userId,
        prospect_id: source.prospectId,
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        input_hash: inputHash,
        score,
        scanned_play_count: plays.length,
        matched_play_count: matchedPlays.length,
        missing_opportunity_count: missingOpportunities.length,
        matched_plays: matchedPlays as unknown as Json,
        missing_opportunities: missingOpportunities as unknown as Json,
        evidence: evidence as unknown as Json,
        generated_at: generatedAt,
      },
      { onConflict: "call_id,playbook_id,input_hash" },
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(`Impossible d'enregistrer l'adherence playbook: ${error.message}`);
  }

  return mapRow(data as PlaybookAdherenceRow);
};
