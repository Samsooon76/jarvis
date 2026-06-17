import { compactText } from "../../lib/text.js";
import type {
  AnalyzeRepCoachingInput,
  RepCoachingAction,
  RepCoachingAnalysis,
  RepCoachingLossPattern,
  RepCoachingStrength,
  RepCoachingWeakness,
} from "./llm.provider.js";

type ParsedRepCoachingAnalysis = {
  headline?: unknown;
  strengths?: unknown;
  weaknesses?: unknown;
  lossPatterns?: unknown;
  coachingActions?: unknown;
  trend?: unknown;
  confidence?: unknown;
};

const MAX_STRENGTHS = 3;
const MAX_WEAKNESSES = 3;
const MAX_LOSS_PATTERNS = 4;
const MAX_COACHING_ACTIONS = 4;

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

const parseJsonObject = <T>(value: string, providerName: string): T => {
  try {
    return JSON.parse(normalizeJsonResponse(value)) as T;
  } catch {
    throw new Error(`${providerName} n'a pas renvoye un JSON valide pour le coaching commercial. Extrait: ${value.slice(0, 240)}`);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isConfidence = (value: unknown): value is RepCoachingAnalysis["confidence"] =>
  value === "low" || value === "medium" || value === "high";

const isTrend = (value: unknown): value is RepCoachingAnalysis["trend"] =>
  value === "improving" || value === "stable" || value === "declining";

const isFrequency = (value: unknown): value is RepCoachingLossPattern["frequency"] =>
  value === "rare" || value === "recurrent" || value === "systematic";

const isActionPriority = (value: unknown): value is RepCoachingAction["priority"] =>
  value === "high" || value === "medium";

const parseStrengths = (value: unknown): RepCoachingStrength[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_STRENGTHS)
    .map((item) => {
      if (!isRecord(item) || typeof item.title !== "string" || typeof item.evidence !== "string") {
        return null;
      }

      return {
        title: compactText(item.title, 90),
        evidence: compactText(item.evidence, 180),
      };
    })
    .filter((strength): strength is RepCoachingStrength => strength !== null);
};

const parseWeaknesses = (value: unknown): RepCoachingWeakness[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_WEAKNESSES)
    .map((item) => {
      if (!isRecord(item) || typeof item.title !== "string" || typeof item.evidence !== "string") {
        return null;
      }

      return {
        title: compactText(item.title, 90),
        evidence: compactText(item.evidence, 180),
        stage: typeof item.stage === "string" && item.stage.trim() ? compactText(item.stage, 60) : null,
      };
    })
    .filter((weakness): weakness is RepCoachingWeakness => weakness !== null);
};

const parseLossPatterns = (value: unknown): RepCoachingLossPattern[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_LOSS_PATTERNS)
    .map((item) => {
      if (!isRecord(item) || typeof item.pattern !== "string" || !isFrequency(item.frequency)) {
        return null;
      }

      return {
        pattern: compactText(item.pattern, 160),
        frequency: item.frequency,
      };
    })
    .filter((pattern): pattern is RepCoachingLossPattern => pattern !== null);
};

const parseCoachingActions = (value: unknown): RepCoachingAction[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_COACHING_ACTIONS)
    .map((item) => {
      if (
        !isRecord(item) ||
        typeof item.action !== "string" ||
        !isActionPriority(item.priority) ||
        typeof item.expectedImpact !== "string"
      ) {
        return null;
      }

      return {
        action: compactText(item.action, 180),
        priority: item.priority,
        expectedImpact: compactText(item.expectedImpact, 160),
      };
    })
    .filter((action): action is RepCoachingAction => action !== null);
};

export const buildRepCoachingPrompt = ({
  repName,
  statsSummary,
  lossPatternsSummary,
  forecastVerdictsSummary,
  teamBenchmarkSummary,
  dateFrom,
  dateTo,
}: AnalyzeRepCoachingInput): string => `Tu es Jarvis, un coach commercial B2B bienveillant et factuel. Tu construis le profil de coaching d'un commercial pour son manager, a partir de stats deja calculees et d'analyses IA existantes. Objectif: aider le manager a preparer un 1:1 constructif, jamais juger ni classer la personne.

Reponds uniquement en JSON valide avec ce schema exact:
{
  "headline": string,
  "strengths": [
    { "title": string, "evidence": string }
  ],
  "weaknesses": [
    { "title": string, "evidence": string, "stage": string | null }
  ],
  "lossPatterns": [
    { "pattern": string, "frequency": "rare" | "recurrent" | "systematic" }
  ],
  "coachingActions": [
    { "action": string, "priority": "high" | "medium", "expectedImpact": string }
  ],
  "trend": "improving" | "stable" | "declining",
  "confidence": "low" | "medium" | "high"
}

Regles strictes:
- headline: 1 phrase qui resume le profil (ex: "Convertit bien en demo mais perd en negociation, souvent sur le prix"), 180 caracteres maximum.
- strengths: 3 forces maximum, chacune appuyee par une evidence chiffree tiree des donnees (90/180 caracteres maximum).
- weaknesses: 3 axes de progression maximum; stage = le stage du funnel concerne si identifiable, sinon null; formulation constructive, jamais accusatoire.
- lossPatterns: motifs de perte recurrents (prix, timing, concurrence...) avec leur frequence reelle dans les donnees; tableau vide si aucune perte analysee.
- coachingActions: 2 a 4 actions concretes pour le manager (jeu de role, ecoute d'un call, revue de proposition...), priorisees par impact attendu.
- trend: tendance de performance sur la periode si lisible dans les donnees, sinon "stable".
- confidence: "low" si les volumes sont faibles (moins de 10 deals fermes), sinon selon la solidite des donnees.
- N'invente aucun chiffre ni aucun fait absent des donnees fournies.
- Ton: coaching constructif, oriente progression; ne compare jamais nominativement a un autre commercial (le benchmark equipe est anonyme).
- Contenu en francais, concis, actionnable.

Commercial analyse: ${repName}
Periode: ${dateFrom} -> ${dateTo}

Stats du commercial (deterministes):
${statsSummary || "Aucune stat disponible."}

Patterns de pertes (issus des analyses close-lost IA en cache):
${lossPatternsSummary || "Aucune analyse de deal perdu disponible."}

Verdicts forecast IA sur son portefeuille ouvert:
${forecastVerdictsSummary || "Aucun verdict forecast disponible."}

Benchmark equipe (mediane anonyme):
${teamBenchmarkSummary || "Aucun benchmark disponible."}`;

export const parseRepCoachingAnalysis = (value: string, providerName: string): RepCoachingAnalysis => {
  const parsed = parseJsonObject<ParsedRepCoachingAnalysis>(value, providerName);

  if (typeof parsed.headline !== "string" || !isConfidence(parsed.confidence) || !isTrend(parsed.trend)) {
    throw new Error(`${providerName} a renvoye un JSON invalide pour le coaching commercial.`);
  }

  return {
    headline: compactText(parsed.headline, 180),
    strengths: parseStrengths(parsed.strengths),
    weaknesses: parseWeaknesses(parsed.weaknesses),
    lossPatterns: parseLossPatterns(parsed.lossPatterns),
    coachingActions: parseCoachingActions(parsed.coachingActions),
    trend: parsed.trend,
    confidence: parsed.confidence,
  };
};
