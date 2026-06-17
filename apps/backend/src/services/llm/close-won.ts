import { compactText } from "../../lib/text.js";
import type {
  AnalyzeCloseWonDealInput,
  AnalyzeCloseWonPortfolioInput,
  CloseLostPortfolioRecommendation,
  CloseWonDealAnalysis,
  CloseWonFactorCategory,
  CloseWonKeyMoment,
  CloseWonPortfolioAnalysis,
  CloseWonReplicablePlay,
} from "./llm.provider.js";

// Miroir du close-lost: analyse des deals GAGNES pour extraire les patterns de
// victoire et des tactiques replicables.

type ParsedCloseWonDealAnalysis = {
  summary?: unknown;
  primaryWinFactor?: unknown;
  winFactorCategory?: unknown;
  keyMoments?: unknown;
  replicablePlays?: unknown;
  confidence?: unknown;
};

type ParsedCloseWonPortfolioAnalysis = {
  keyInsight?: unknown;
  executiveSummary?: unknown;
  winningPatterns?: unknown;
  idealSequence?: unknown;
  recommendations?: unknown;
  confidence?: unknown;
};

const WIN_FACTOR_CATEGORIES: readonly CloseWonFactorCategory[] = [
  "champion",
  "timing",
  "product_fit",
  "pricing",
  "process",
  "relationship",
  "other",
];

const MAX_KEY_MOMENTS = 5;
const MAX_REPLICABLE_PLAYS = 4;
const MAX_PATTERNS = 6;
const MAX_RECOMMENDATIONS = 5;

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

const isConfidence = (value: unknown): value is CloseWonDealAnalysis["confidence"] =>
  value === "low" || value === "medium" || value === "high";

const isWinFactorCategory = (value: unknown): value is CloseWonFactorCategory =>
  typeof value === "string" && WIN_FACTOR_CATEGORIES.includes(value as CloseWonFactorCategory);

const isPriority = (value: unknown): value is CloseLostPortfolioRecommendation["priority"] =>
  value === "low" || value === "medium" || value === "high";

const parseStringList = (value: unknown, maxItems: number, maxLength: number): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, maxItems)
    .map((item) => compactText(item, maxLength));
};

const parseKeyMoments = (value: unknown): CloseWonKeyMoment[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_KEY_MOMENTS)
    .map((item) => {
      if (!isRecord(item) || typeof item.moment !== "string" || typeof item.impact !== "string") {
        return null;
      }

      return {
        moment: compactText(item.moment, 160),
        stage: typeof item.stage === "string" && item.stage.trim() ? compactText(item.stage, 60) : null,
        impact: compactText(item.impact, 160),
      };
    })
    .filter((moment): moment is CloseWonKeyMoment => moment !== null);
};

const parseReplicablePlays = (value: unknown): CloseWonReplicablePlay[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_REPLICABLE_PLAYS)
    .map((item) => {
      if (!isRecord(item) || typeof item.play !== "string" || typeof item.when !== "string") {
        return null;
      }

      return {
        play: compactText(item.play, 180),
        when: compactText(item.when, 120),
      };
    })
    .filter((play): play is CloseWonReplicablePlay => play !== null);
};

const parseRecommendations = (value: unknown): CloseLostPortfolioRecommendation[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_RECOMMENDATIONS)
    .map((item) => {
      if (!isRecord(item) || typeof item.title !== "string" || typeof item.rationale !== "string" || !isPriority(item.priority)) {
        return null;
      }

      return {
        title: compactText(item.title, 100),
        rationale: compactText(item.rationale, 200),
        priority: item.priority,
      };
    })
    .filter((recommendation): recommendation is CloseLostPortfolioRecommendation => recommendation !== null);
};

export const buildCloseWonDealPrompt = ({
  history,
  companyName,
  dealName,
  companyContext,
  dealContext,
  dealStage,
  dealAmount,
  closedAt,
  ownerName,
  contactNames,
  today,
}: AnalyzeCloseWonDealInput): string => `Tu es Jarvis, un analyste sales B2B. Tu analyses un deal GAGNE pour comprendre pourquoi il a ete gagne et extraire des tactiques replicables pour le reste de l'equipe.

Reponds uniquement en JSON valide avec ce schema exact:
{
  "summary": string,
  "primaryWinFactor": string,
  "winFactorCategory": "champion" | "timing" | "product_fit" | "pricing" | "process" | "relationship" | "other",
  "keyMoments": [
    { "moment": string, "stage": string | null, "impact": string }
  ],
  "replicablePlays": [
    { "play": string, "when": string }
  ],
  "confidence": "low" | "medium" | "high"
}

Regles strictes:
- summary: 1-2 phrases resumant comment le deal a ete gagne, 240 caracteres maximum.
- primaryWinFactor: LE facteur decisif de la victoire, factuel, 160 caracteres maximum.
- winFactorCategory: la categorie qui correspond le mieux au facteur principal.
- keyMoments: 2 a 5 moments cles qui ont fait basculer le deal (demo, intro du champion, negociation...); stage = le stage du funnel si identifiable, sinon null; impact = en quoi ce moment a aide.
- replicablePlays: 2 a 4 tactiques REUTILISABLES sur d'autres deals; play = la tactique concrete, when = a quel moment du cycle l'appliquer.
- Appuie-toi UNIQUEMENT sur l'historique fourni; n'invente aucun fait. Si l'historique est pauvre, confidence "low".
- Contenu en francais, concis, actionnable.

Contexte du deal:
- Deal: ${dealName ?? "inconnu"}
- Entreprise: ${companyName ?? "inconnue"}
- Stage final: ${dealStage ?? "inconnu"}
- Montant: ${dealAmount ?? "inconnu"}
- Gagne le: ${closedAt ?? "inconnu"}
- Owner: ${ownerName ?? "inconnu"}
- Contacts: ${contactNames && contactNames.length > 0 ? contactNames.join(", ") : "inconnus"}
- Aujourd'hui: ${today ?? "inconnu"}
${companyContext ? `- Contexte entreprise: ${companyContext}` : ""}
${dealContext ? `- Contexte deal: ${dealContext}` : ""}

Historique HubSpot du deal:
${history}`;

export const parseCloseWonDealAnalysis = (value: string, providerName: string): CloseWonDealAnalysis => {
  const parsed = parseJsonObject<ParsedCloseWonDealAnalysis>(value, providerName, "l'analyse close won");

  if (
    typeof parsed.summary !== "string" ||
    typeof parsed.primaryWinFactor !== "string" ||
    !isWinFactorCategory(parsed.winFactorCategory) ||
    !isConfidence(parsed.confidence)
  ) {
    throw new Error(`${providerName} a renvoye un JSON invalide pour l'analyse close won.`);
  }

  return {
    summary: compactText(parsed.summary, 240),
    primaryWinFactor: compactText(parsed.primaryWinFactor, 160),
    winFactorCategory: parsed.winFactorCategory,
    keyMoments: parseKeyMoments(parsed.keyMoments),
    replicablePlays: parseReplicablePlays(parsed.replicablePlays),
    confidence: parsed.confidence,
  };
};

export const buildCloseWonPortfolioPrompt = ({
  dealsSummary,
  dateFrom,
  dateTo,
  scopeLabel,
  wonDealCount,
  totalWonValue,
  analyzedDealCount,
}: AnalyzeCloseWonPortfolioInput): string => `Tu es Jarvis, un analyste revenue operations B2B. Tu synthetises les analyses de deals GAGNES d'un portefeuille pour en extraire les patterns de victoire et la sequence gagnante type.

Reponds uniquement en JSON valide avec ce schema exact:
{
  "keyInsight": string,
  "executiveSummary": string,
  "winningPatterns": string[],
  "idealSequence": string[],
  "recommendations": [
    { "title": string, "rationale": string, "priority": "low" | "medium" | "high" }
  ],
  "confidence": "low" | "medium" | "high"
}

Regles strictes:
- keyInsight: LA lecon principale des victoires de la periode, 1 phrase, 180 caracteres maximum.
- executiveSummary: 2-3 phrases pour la direction, 400 caracteres maximum.
- winningPatterns: 3 a 6 patterns recurrents observes dans les deals gagnes (factuels, tires des donnees).
- idealSequence: la sequence type d'un deal gagnant, etape par etape (4 a 6 etapes, chronologiques).
- recommendations: 3 a 5 actions pour repliquer ces patterns sur le pipe ouvert, priorisees.
- N'invente aucun fait absent des donnees. Attention au biais de survivant: formule des hypotheses, pas des certitudes.
- Contenu en francais, concis, actionnable pour un manager sales.

Contexte:
- Periode: ${dateFrom} -> ${dateTo}
- Scope: ${scopeLabel}
- Deals gagnes: ${wonDealCount} (valeur totale: ${totalWonValue})
- Deals analyses individuellement: ${analyzedDealCount}

Analyses des deals gagnes (un par ligne):
${dealsSummary}`;

export const parseCloseWonPortfolioAnalysis = (value: string, providerName: string): CloseWonPortfolioAnalysis => {
  const parsed = parseJsonObject<ParsedCloseWonPortfolioAnalysis>(value, providerName, "la synthese close won");

  if (
    typeof parsed.keyInsight !== "string" ||
    typeof parsed.executiveSummary !== "string" ||
    !isConfidence(parsed.confidence)
  ) {
    throw new Error(`${providerName} a renvoye un JSON invalide pour la synthese close won.`);
  }

  return {
    keyInsight: compactText(parsed.keyInsight, 180),
    executiveSummary: compactText(parsed.executiveSummary, 400),
    winningPatterns: parseStringList(parsed.winningPatterns, MAX_PATTERNS, 180),
    idealSequence: parseStringList(parsed.idealSequence, 6, 160),
    recommendations: parseRecommendations(parsed.recommendations),
    confidence: parsed.confidence,
  };
};
