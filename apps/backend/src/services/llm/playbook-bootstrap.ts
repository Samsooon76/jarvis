import { compactText } from "../../lib/text.js";
import { PLAYBOOK_PLAY_CATEGORIES, type PlaybookPlayCategory } from "@jarvis/shared";
import type { AnalyzePlaybookBootstrapInput, PlaybookBootstrapAnalysis, PlaybookBootstrapPlay } from "./llm.provider.js";

type ParsedPlaybookBootstrapAnalysis = {
  name?: unknown;
  description?: unknown;
  plays?: unknown;
  confidence?: unknown;
};

type ParsedPlaybookBootstrapPlay = {
  category?: unknown;
  title?: unknown;
  triggerDescription?: unknown;
  recommendedResponse?: unknown;
  sourceDealIds?: unknown;
};

const MAX_PLAYS = 12;
export const PLAYBOOK_BOOTSTRAP_MIN_PLAYS = 3;
export const PLAYBOOK_BOOTSTRAP_TARGET_PLAYS = 8;
export const PLAYBOOK_BOOTSTRAP_MIN_CATEGORIES = 4;

export const PLAYBOOK_CYCLE_CATEGORY_ORDER: PlaybookPlayCategory[] = [
  "qualification",
  "discovery",
  "demo",
  "objection_handling",
  "negotiation",
  "closing",
  "follow_up",
];

const normalizeJsonResponse = (value: string): string => {
  const trimmedValue = value.trim();
  const withoutCodeFence = trimmedValue.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  if (withoutCodeFence.startsWith("{") && withoutCodeFence.endsWith("}")) {
    return withoutCodeFence;
  }

  const firstBraceIndex = withoutCodeFence.indexOf("{");
  const lastBraceIndex = withoutCodeFence.lastIndexOf("}");

  if (firstBraceIndex >= 0 && lastBraceIndex > firstBraceIndex) {
    return withoutCodeFence.slice(firstBraceIndex, lastBraceIndex + 1);
  }

  return withoutCodeFence;
};

const parseJsonObject = <T>(value: string, providerName: string, label: string): T => {
  try {
    return JSON.parse(normalizeJsonResponse(value)) as T;
  } catch {
    throw new Error(`${providerName} n'a pas renvoye un JSON valide pour ${label}. Extrait: ${value.slice(0, 240)}`);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isConfidence = (value: unknown): value is PlaybookBootstrapAnalysis["confidence"] =>
  value === "low" || value === "medium" || value === "high";

const isPlayCategory = (value: unknown): value is PlaybookPlayCategory =>
  typeof value === "string" && (PLAYBOOK_PLAY_CATEGORIES as string[]).includes(value);

const parseStringList = (value: unknown, maxItems: number): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, maxItems)
    .map((item) => item.trim());
};

const parsePlays = (value: unknown, knownDealIds: Set<string>): PlaybookBootstrapPlay[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_PLAYS)
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const parsed = item as ParsedPlaybookBootstrapPlay;

      if (
        !isPlayCategory(parsed.category) ||
        typeof parsed.title !== "string" ||
        typeof parsed.triggerDescription !== "string" ||
        typeof parsed.recommendedResponse !== "string"
      ) {
        return null;
      }

      const sourceDealIds = parseStringList(parsed.sourceDealIds, 5).filter((dealId) => knownDealIds.has(dealId));

      return {
        category: parsed.category,
        title: compactText(parsed.title, 160),
        triggerDescription: compactText(parsed.triggerDescription, 600),
        recommendedResponse: compactText(parsed.recommendedResponse, 4000),
        sourceDealIds,
      };
    })
    .filter((play): play is PlaybookBootstrapPlay => play !== null);
};

export const sortPlaysBySalesCycle = (plays: PlaybookBootstrapPlay[]): PlaybookBootstrapPlay[] =>
  [...plays].sort(
    (left, right) =>
      PLAYBOOK_CYCLE_CATEGORY_ORDER.indexOf(left.category) - PLAYBOOK_CYCLE_CATEGORY_ORDER.indexOf(right.category),
  );

export const countDistinctPlayCategories = (plays: PlaybookBootstrapPlay[]): number =>
  new Set(plays.map((play) => play.category)).size;

const formatOptionalList = (label: string, items: string[] | undefined): string =>
  items && items.length > 0 ? `${label}:\n${items.map((item) => `- ${item}`).join("\n")}` : "";

export const buildPlaybookBootstrapPrompt = ({
  dealsSummary,
  portfolioSummary,
  analyzedDealCount,
  dateFrom,
  dateTo,
  keyInsight,
  winningPatterns,
  idealSequence,
}: AnalyzePlaybookBootstrapInput): string => `Tu es Jarvis, un architecte de playbook sales B2B. A partir d'analyses de deals GAGNES, tu construis un PLAYBOOK DE VENTE (process + sequence), pas une liste de battle cards.

Un playbook = etapes du cycle de vente, criteres de passage, objectifs par stage, et gestes reproductibles.
Une battle card = reponse reactive a une objection ponctuelle. NE PAS produire uniquement des battle cards.

Reponds uniquement en JSON valide avec ce schema exact:
{
  "name": string,
  "description": string,
  "plays": [
    {
      "category": "qualification" | "discovery" | "demo" | "objection_handling" | "negotiation" | "closing" | "follow_up",
      "title": string,
      "triggerDescription": string,
      "recommendedResponse": string,
      "sourceDealIds": string[]
    }
  ],
  "confidence": "low" | "medium" | "high"
}

Regles strictes:
- name: nom court du playbook (ex: "Playbook AE — cycle gagnant"), 120 caracteres maximum.
- description: 1-2 phrases sur la DOCTRINE commerciale (sequence, priorites, ce qui fait gagner), 300 caracteres maximum.
- plays: ${PLAYBOOK_BOOTSTRAP_TARGET_PLAYS} a ${MAX_PLAYS} plays couvrant au moins ${PLAYBOOK_BOOTSTRAP_MIN_CATEGORIES} categories DIFFERENTES du cycle de vente.
- Maximum 2 plays en category "objection_handling". Les objections ne doivent pas dominer le playbook.
- Chaque play = une etape ou un geste structure du cycle, pas une simple reponse a une objection.
- triggerDescription: QUAND appliquer ce play dans le cycle (stage HubSpot, signal d'avancement, prerequis). Pas seulement "le prospect dit X". 600 caracteres maximum.
- recommendedResponse: COMMENT executer le play, structuree en sections courtes:
  Objectif: ...
  Etapes: ...
  Questions / script: ...
  Signaux de succes: ...
  Next step: ...
  4000 caracteres maximum.
- sourceDealIds: IDs HubSpot des deals qui justifient ce play (parmi ceux fournis); au moins 1 par play quand possible.
- Si une sequence gagnante type est fournie ci-dessous, aligne les plays sur cette sequence (1 play minimum par grande etape).
- Dedoublonne les tactiques similaires; privilegie les patterns recurrents observes sur plusieurs deals.
- N'invente aucun fait absent des analyses. Si les donnees sont pauvres, confidence "low" et moins de plays.
- Contenu en francais, concret, oriente terrain.

Contexte:
- Periode: ${dateFrom} -> ${dateTo}
- Deals analyses: ${analyzedDealCount}

Synthese portefeuille (patterns transverses):
${portfolioSummary}
${keyInsight ? `\nInsight cle: ${keyInsight}` : ""}
${formatOptionalList("Sequence gagnante type (a transformer en plays)", idealSequence)}
${formatOptionalList("Patterns recurrents", winningPatterns)}

Analyses individuelles des deals gagnes (une par bloc):
${dealsSummary}`;

export const parsePlaybookBootstrapAnalysis = (
  value: string,
  providerName: string,
  knownDealIds: string[],
): PlaybookBootstrapAnalysis => {
  const parsed = parseJsonObject<ParsedPlaybookBootstrapAnalysis>(value, providerName, "la generation de playbook");
  const knownDealIdSet = new Set(knownDealIds);
  const plays = sortPlaysBySalesCycle(parsePlays(parsed.plays, knownDealIdSet));

  if (typeof parsed.name !== "string" || typeof parsed.description !== "string" || !isConfidence(parsed.confidence)) {
    throw new Error(`${providerName} a renvoye un JSON invalide pour la generation de playbook.`);
  }

  if (plays.length < PLAYBOOK_BOOTSTRAP_MIN_PLAYS) {
    throw new Error(
      `${providerName} n'a pas genere assez de plays pour le playbook (${plays.length}/${PLAYBOOK_BOOTSTRAP_MIN_PLAYS}).`,
    );
  }

  return {
    name: compactText(parsed.name, 120),
    description: compactText(parsed.description, 300),
    plays,
    confidence: parsed.confidence,
  };
};