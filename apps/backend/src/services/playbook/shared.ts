import type {
  JsonObject,
  Playbook,
  PlaybookOverview,
  PlaybookSuggestion,
  PlaybookEvidenceKind,
  PlaybookPlay,
  PlaybookPlayCategory,
  PlaybookPlayEvidence,
  PlaybookPlayInput,
  PlaybookPlayStatus,
} from "@jarvis/shared";
import { isPlaybookOverviewStale } from "@jarvis/shared";
import { PLAYBOOK_PLAY_CATEGORIES } from "@jarvis/shared";
import type { PlaybookPlayEvidenceRow, PlaybookPlayRow, PlaybookRow, PlaybookSuggestionRow } from "./types.js";

export const MAX_NAME_LENGTH = 120;
export const MAX_TITLE_LENGTH = 160;
export const MAX_TRIGGER_LENGTH = 600;
export const MAX_RESPONSE_LENGTH = 4000;
export const MAX_EVIDENCE_PER_PLAY = 20;

const PLAY_STATUSES: PlaybookPlayStatus[] = ["draft", "active", "archived"];
const EVIDENCE_KINDS: PlaybookEvidenceKind[] = ["call", "deal", "analysis"];

export const isPlayCategory = (value: unknown): value is PlaybookPlayCategory =>
  typeof value === "string" && (PLAYBOOK_PLAY_CATEGORIES as string[]).includes(value);

export const isPlayStatus = (value: unknown): value is PlaybookPlayStatus =>
  typeof value === "string" && (PLAY_STATUSES as string[]).includes(value);

export const isEvidenceKind = (value: unknown): value is PlaybookEvidenceKind =>
  typeof value === "string" && (EVIDENCE_KINDS as string[]).includes(value);

const cleanText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export const validatePlaybookName = (name: unknown): string => {
  const cleaned = cleanText(name);

  if (!cleaned) {
    throw new Error("Le nom du playbook est requis.");
  }

  if (cleaned.length > MAX_NAME_LENGTH) {
    throw new Error(`Le nom du playbook depasse ${MAX_NAME_LENGTH} caracteres.`);
  }

  return cleaned;
};

// Valide et normalise un play envoye par le client (creation).
export const validatePlayInput = (input: PlaybookPlayInput): PlaybookPlayInput => {
  if (!isPlayCategory(input.category)) {
    throw new Error("Categorie de play invalide.");
  }

  const title = cleanText(input.title);
  const triggerDescription = cleanText(input.triggerDescription);
  const recommendedResponse = cleanText(input.recommendedResponse);

  if (!title || !triggerDescription || !recommendedResponse) {
    throw new Error("Un play requiert un titre, un declencheur et une reponse recommandee.");
  }

  if (title.length > MAX_TITLE_LENGTH) {
    throw new Error(`Le titre du play depasse ${MAX_TITLE_LENGTH} caracteres.`);
  }

  if (triggerDescription.length > MAX_TRIGGER_LENGTH) {
    throw new Error(`Le declencheur du play depasse ${MAX_TRIGGER_LENGTH} caracteres.`);
  }

  if (recommendedResponse.length > MAX_RESPONSE_LENGTH) {
    throw new Error(`La reponse recommandee depasse ${MAX_RESPONSE_LENGTH} caracteres.`);
  }

  if (input.status !== undefined && !isPlayStatus(input.status)) {
    throw new Error("Statut de play invalide.");
  }

  const evidence = (input.evidence ?? []).map((item) => {
    if (!isEvidenceKind(item.kind)) {
      throw new Error("Type de preuve invalide (call, deal ou analysis attendu).");
    }

    const refId = cleanText(item.refId);

    if (!refId) {
      throw new Error("Chaque preuve requiert un identifiant de source.");
    }

    return { kind: item.kind, refId, note: cleanText(item.note) || null };
  });

  if (evidence.length > MAX_EVIDENCE_PER_PLAY) {
    throw new Error(`Un play ne peut pas porter plus de ${MAX_EVIDENCE_PER_PLAY} preuves.`);
  }

  return {
    category: input.category,
    title,
    triggerDescription,
    recommendedResponse,
    status: input.status ?? "draft",
    evidence,
  };
};

export const mapEvidenceRow = (row: PlaybookPlayEvidenceRow): PlaybookPlayEvidence => ({
  id: row.id,
  kind: row.kind,
  refId: row.ref_id,
  note: row.note,
  createdAt: row.created_at,
});

export const mapPlayRow = (row: PlaybookPlayRow, evidence: PlaybookPlayEvidenceRow[]): PlaybookPlay => ({
  id: row.id,
  playbookId: row.playbook_id,
  category: row.category,
  title: row.title,
  triggerDescription: row.trigger_description,
  recommendedResponse: row.recommended_response,
  status: row.status,
  source: row.source,
  position: row.position,
  version: row.version,
  evidence: evidence.map(mapEvidenceRow),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapPlaybookRow = (
  row: PlaybookRow,
  playCount: number,
  activePlayCount: number,
  plays: PlaybookPlay[] = [],
  overview: PlaybookOverview | null = null,
): Playbook => {
  const resolvedOverview = overview;

  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    description: row.description,
    overview: resolvedOverview,
    overviewIsStale: isPlaybookOverviewStale(resolvedOverview, plays),
    status: row.status,
    createdBy: row.created_by,
    playCount,
    activePlayCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const suggestionText = (payload: Record<string, unknown>, key: string): string =>
  typeof payload[key] === "string" ? (payload[key] as string) : "";

const mapSuggestionEvidence = (
  evidence: PlaybookSuggestionRow["evidence"],
): Array<{ title: string; sourceId: string; quote?: string | null }> =>
  evidence
    .filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      title: suggestionText(item, "label") || suggestionText(item, "title") || suggestionText(item, "kind") || "Preuve",
      sourceId: suggestionText(item, "refId") || suggestionText(item, "sourceId"),
      quote: suggestionText(item, "note") || suggestionText(item, "quote") || null,
    }));

export const mapSuggestionRow = (row: PlaybookSuggestionRow): PlaybookSuggestion => ({
  id: row.id,
  orgId: row.org_id,
  playbookId: row.playbook_id,
  kind: row.kind,
  category: suggestionText(row.payload, "category") as PlaybookSuggestion["category"],
  title: suggestionText(row.payload, "title"),
  triggerDescription: suggestionText(row.payload, "triggerDescription"),
  recommendedResponse: suggestionText(row.payload, "recommendedResponse"),
  payload: row.payload,
  rationale: row.rationale,
  evidence: mapSuggestionEvidence(row.evidence),
  status: row.status,
  createdAt: row.created_at,
  resolvedAt: row.resolved_at,
  resolvedBy: row.resolved_by,
});
