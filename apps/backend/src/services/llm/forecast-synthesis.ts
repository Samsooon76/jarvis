import { compactText } from "../../lib/text.js";
import type {
  AnalyzeForecastSynthesisInput,
  ForecastSynthesisAction,
  ForecastSynthesisAnalysis,
  ForecastSynthesisCategory,
  ForecastSynthesisDealVerdict,
} from "./llm.provider.js";

type ParsedForecastSynthesisAnalysis = {
  headline?: unknown;
  confidence?: unknown;
  dealVerdicts?: unknown;
  actionPlan?: unknown;
};

type ParsedForecastSynthesisDealVerdict = {
  hubspotDealId?: unknown;
  category?: unknown;
  reason?: unknown;
  recommendedAction?: unknown;
};

type ParsedForecastSynthesisAction = {
  title?: unknown;
  rationale?: unknown;
  priority?: unknown;
  relatedDealIds?: unknown;
};

const FORECAST_SYNTHESIS_CATEGORIES = [
  "commit",
  "bestCase",
  "atRisk",
  "slipping",
] as const satisfies readonly ForecastSynthesisCategory[];

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

const isConfidence = (value: unknown): value is ForecastSynthesisAnalysis["confidence"] =>
  value === "low" || value === "medium" || value === "high";

const isPriority = (value: unknown): value is ForecastSynthesisAction["priority"] =>
  value === "low" || value === "medium" || value === "high";

const isCategory = (value: unknown): value is ForecastSynthesisCategory =>
  typeof value === "string" && FORECAST_SYNTHESIS_CATEGORIES.includes(value as ForecastSynthesisCategory);

const parseNullableText = (value: unknown, maxLength: number): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const text = compactText(value, maxLength);

  return text ? text : null;
};

const parseDealVerdicts = (
  value: unknown,
  knownDealIds: Set<string>,
  providerName: string,
): ForecastSynthesisDealVerdict[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${providerName} a renvoye des verdicts forecast invalides.`);
  }

  const verdicts: ForecastSynthesisDealVerdict[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const verdict = item as ParsedForecastSynthesisDealVerdict;

    if (typeof verdict.hubspotDealId !== "string" || !isCategory(verdict.category) || typeof verdict.reason !== "string") {
      continue;
    }

    const hubspotDealId = verdict.hubspotDealId.trim();

    // On ignore les verdicts qui referencent un deal absent du portefeuille fourni
    // ou un deal deja classe (le LLM peut halluciner ou dupliquer un id).
    if (!knownDealIds.has(hubspotDealId) || seen.has(hubspotDealId)) {
      continue;
    }

    seen.add(hubspotDealId);
    verdicts.push({
      hubspotDealId,
      category: verdict.category,
      reason: compactText(verdict.reason, 140),
      recommendedAction: parseNullableText(verdict.recommendedAction, 140),
    });
  }

  return verdicts;
};

const parseActionPlan = (
  value: unknown,
  knownDealIds: Set<string>,
  providerName: string,
): ForecastSynthesisAction[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${providerName} a renvoye un plan d'action forecast invalide.`);
  }

  return value
    .slice(0, 6)
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const action = item as ParsedForecastSynthesisAction;

      if (typeof action.title !== "string" || typeof action.rationale !== "string" || !isPriority(action.priority)) {
        return null;
      }

      const relatedDealIds = Array.isArray(action.relatedDealIds)
        ? action.relatedDealIds
            .filter((id): id is string => typeof id === "string")
            .map((id) => id.trim())
            .filter((id) => knownDealIds.has(id))
        : [];

      return {
        title: compactText(action.title, 100),
        rationale: compactText(action.rationale, 200),
        priority: action.priority,
        relatedDealIds: Array.from(new Set(relatedDealIds)).slice(0, 6),
      };
    })
    .filter((action): action is ForecastSynthesisAction => action !== null);
};

export const buildForecastSynthesisPrompt = ({
  dealsSummary,
  dateFrom,
  dateTo,
  scopeLabel,
  openDealCount,
  totalOpenAmount,
  signedAmount,
  landingAmount,
  objectiveAmount,
  gapToObjective,
  today,
  winBenchmarkSummary,
}: AnalyzeForecastSynthesisInput): string => `Tu es Jarvis, un analyste revenue operations B2B. Tu fais la synthese forecast d'un portefeuille de deals ouverts deja analyses individuellement par l'IA.

Reponds uniquement en JSON valide avec ce schema exact:
{
  "headline": string,
  "confidence": "low" | "medium" | "high",
  "dealVerdicts": [
    {
      "hubspotDealId": string,
      "category": "commit" | "bestCase" | "atRisk" | "slipping",
      "reason": string,
      "recommendedAction": string | null
    }
  ],
  "actionPlan": [
    {
      "title": string,
      "rationale": string,
      "priority": "low" | "medium" | "high",
      "relatedDealIds": string[]
    }
  ]
}

Definition des categories:
- "commit": tu es convaincu que le deal se close dans la periode (proba IA elevee, sante solide, close date dans la periode, peu de risques).
- "bestCase": closing credible mais pas garanti (upside a aller chercher).
- "atRisk": signaux negatifs, risques bloquants ou silence; le deal peut tomber sans action.
- "slipping": le closing va probablement glisser hors de la periode (close date trop tardive, process pas engage).

Regles strictes:
- Classe CHAQUE deal fourni ci-dessous en utilisant son hubspotDealId EXACT; ne classe que des deals presents dans la liste, n'en invente aucun.
- Appuie-toi sur la proba IA, la sante (dealHealth), la close date vs la fin de periode (${dateTo}), les risques et le suggestedMove de chaque deal. N'invente aucun fait absent des donnees.
- reason: 1 phrase factuelle justifiant la categorie, 140 caracteres maximum.
- recommendedAction: action concrete pour faire avancer ce deal, ou null si rien de pertinent; 140 caracteres maximum.
- headline: 1 phrase qui resume comment se presente la periode (combien on va closer, ou est le risque), 180 caracteres maximum.
- actionPlan: 3 a 6 actions priorisees pour securiser le forecast et combler le gap a l'objectif; relatedDealIds reference les deals concernes (peut etre vide).
- Priorise les actions a fort impact sur le gap a l'objectif.
- Contenu en francais, concis, actionnable pour un AE et son manager.

Contexte de la periode:
- Periode forecast: ${dateFrom} -> ${dateTo}
- Scope: ${scopeLabel}
- Aujourd'hui: ${today}
- Deals ouverts a classer: ${openDealCount}
- Pipe ouvert brut: ${totalOpenAmount}
- Deja securise (signe): ${signedAmount}
- Atterrissage pondere actuel: ${landingAmount}
- Objectif: ${objectiveAmount ?? "non defini"}
- Gap a l'objectif: ${gapToObjective ?? "non defini"}
${winBenchmarkSummary ? `\nBenchmark des deals gagnes (patterns de victoire observes, a utiliser pour juger l'avancement des deals):\n${winBenchmarkSummary}\n` : ""}
Deals ouverts analyses (un par ligne):
${dealsSummary}`;

export const parseForecastSynthesisAnalysis = (
  value: string,
  knownDealIds: string[],
  providerName: string,
): ForecastSynthesisAnalysis => {
  const parsed = parseJsonObject<ParsedForecastSynthesisAnalysis>(value, providerName, "la synthese forecast");

  if (typeof parsed.headline !== "string" || !isConfidence(parsed.confidence)) {
    throw new Error(`${providerName} a renvoye un JSON invalide pour la synthese forecast.`);
  }

  const knownDealIdSet = new Set(knownDealIds);

  return {
    headline: compactText(parsed.headline, 180),
    confidence: parsed.confidence,
    dealVerdicts: parseDealVerdicts(parsed.dealVerdicts, knownDealIdSet, providerName),
    actionPlan: parseActionPlan(parsed.actionPlan, knownDealIdSet, providerName),
  };
};
