import { compactText } from "../../lib/text.js";
import { PLAYBOOK_PLAY_CATEGORIES, type PlaybookPlayCategory } from "@jarvis/shared";
import type { AnalyzePlaybookOverviewInput, PlaybookOverviewAnalysis } from "./llm.provider.js";

type ParsedPlaybookOverviewAnalysis = {
  doctrine?: unknown;
  idealSequence?: unknown;
  stages?: unknown;
  principles?: unknown;
  gaps?: unknown;
  confidence?: unknown;
};

type ParsedPlaybookOverviewStage = {
  category?: unknown;
  objective?: unknown;
  exitCriteria?: unknown;
  playIds?: unknown;
};

const MAX_SEQUENCE_STEPS = 8;
const MAX_PRINCIPLES = 6;
const MAX_GAPS = 6;
const MAX_STAGES = 7;

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

const isConfidence = (value: unknown): value is PlaybookOverviewAnalysis["confidence"] =>
  value === "low" || value === "medium" || value === "high";

const isPlayCategory = (value: unknown): value is PlaybookPlayCategory =>
  typeof value === "string" && (PLAYBOOK_PLAY_CATEGORIES as string[]).includes(value);

const parseStringList = (value: unknown, maxItems: number, maxLength: number): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, maxItems)
    .map((item) => compactText(item, maxLength));
};

const parseStages = (
  value: unknown,
  knownPlayIds: Set<string>,
): PlaybookOverviewAnalysis["stages"] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_STAGES)
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const parsed = item as ParsedPlaybookOverviewStage;

      if (
        !isPlayCategory(parsed.category) ||
        typeof parsed.objective !== "string" ||
        typeof parsed.exitCriteria !== "string"
      ) {
        return null;
      }

      const playIds = parseStringList(parsed.playIds, 8, 80).filter((playId) => knownPlayIds.has(playId));

      return {
        category: parsed.category,
        objective: compactText(parsed.objective, 300),
        exitCriteria: compactText(parsed.exitCriteria, 300),
        playIds,
      };
    })
    .filter((stage): stage is PlaybookOverviewAnalysis["stages"][number] => stage !== null);
};

export const buildPlaybookOverviewPrompt = ({
  playbookName,
  playbookDescription,
  playsSummary,
  playCount,
  activePlayCount,
}: AnalyzePlaybookOverviewInput): string => `Tu es Jarvis, un architecte de playbook sales B2B. A partir de PLAYS deja valides ou en brouillon, tu construis la VUE GLOBALE du playbook: doctrine, sequence du cycle, objectifs par etape, et principes transverses.

Ce n'est PAS une battle card. Ne reformule pas chaque play mot pour mot: tu SYNTHESES et STRUCTURES.

Reponds uniquement en JSON valide avec ce schema exact:
{
  "doctrine": string,
  "idealSequence": string[],
  "stages": [
    {
      "category": "qualification" | "discovery" | "demo" | "objection_handling" | "negotiation" | "closing" | "follow_up",
      "objective": string,
      "exitCriteria": string,
      "playIds": string[]
    }
  ],
  "principles": string[],
  "gaps": string[],
  "confidence": "low" | "medium" | "high"
}

Regles strictes:
- doctrine: 2-3 phrases sur la doctrine commerciale de l'equipe, 400 caracteres maximum.
- idealSequence: 4 a ${MAX_SEQUENCE_STEPS} etapes chronologiques du cycle gagnant type.
- stages: une entree par grande etape du cycle representee dans les plays; regroupe les plays par category via playIds (IDs fournis).
- objective: ce que l'equipe doit accomplir a cette etape, 300 caracteres maximum.
- exitCriteria: signaux/criteres pour passer a l'etape suivante, 300 caracteres maximum.
- playIds: uniquement des IDs presents dans les plays fournis; au moins 1 par stage quand des plays existent pour cette category.
- principles: 3 a ${MAX_PRINCIPLES} principes transverses observes dans plusieurs plays.
- gaps: 0 a ${MAX_GAPS} manques structurels (etapes sans play, dependances non couvertes, risques).
- N'invente aucun play absent de la liste. Si peu de plays, confidence "low".
- Contenu en francais, oriente manager et onboarding equipe.

Contexte playbook:
- Nom: ${playbookName}
- Description actuelle: ${playbookDescription ?? "n/a"}
- Plays disponibles: ${playCount} (${activePlayCount} actif(s))

Plays source (un bloc par play):
${playsSummary}`;

export const parsePlaybookOverviewAnalysis = (
  value: string,
  providerName: string,
  knownPlayIds: string[],
): PlaybookOverviewAnalysis => {
  const parsed = parseJsonObject<ParsedPlaybookOverviewAnalysis>(value, providerName, "la synthese playbook globale");
  const knownPlayIdSet = new Set(knownPlayIds);

  if (typeof parsed.doctrine !== "string" || !isConfidence(parsed.confidence)) {
    throw new Error(`${providerName} a renvoye un JSON invalide pour la synthese playbook globale.`);
  }

  const stages = parseStages(parsed.stages, knownPlayIdSet);
  const idealSequence = parseStringList(parsed.idealSequence, MAX_SEQUENCE_STEPS, 160);
  const principles = parseStringList(parsed.principles, MAX_PRINCIPLES, 200);
  const gaps = parseStringList(parsed.gaps, MAX_GAPS, 200);

  if (idealSequence.length < 3) {
    throw new Error(`${providerName} n'a pas produit une sequence exploitable pour le playbook global.`);
  }

  return {
    doctrine: compactText(parsed.doctrine, 400),
    idealSequence,
    stages,
    principles,
    gaps,
    confidence: parsed.confidence,
  };
};