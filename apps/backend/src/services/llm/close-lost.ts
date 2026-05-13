import type {
  AnalyzeCloseLostDealInput,
  AnalyzeCloseLostPortfolioInput,
  CloseLostDealAnalysis,
  CloseLostHealthDimension,
  CloseLostPortfolioAnalysis,
  CloseLostPortfolioFactor,
  CloseLostPortfolioRecommendation,
  CloseLostReasonCategory,
  CloseLostReactivationAction,
  CloseLostRiskSignal,
} from "./llm.provider.js";

type ParsedCloseLostDealAnalysis = {
  summary?: unknown;
  primaryLossReason?: unknown;
  secondaryLossReason?: unknown;
  lossReasonCategory?: unknown;
  competitorName?: unknown;
  whatHappened?: unknown;
  healthBeforeLoss?: unknown;
  riskSignals?: unknown;
  reactivationScore?: unknown;
  reactivationRationale?: unknown;
  playbook?: unknown;
  evidence?: unknown;
  confidence?: unknown;
};

type ParsedCloseLostHealthDimension = {
  label?: unknown;
  score?: unknown;
  status?: unknown;
  detail?: unknown;
};

type ParsedCloseLostRiskSignal = {
  title?: unknown;
  severity?: unknown;
  detail?: unknown;
};

type ParsedCloseLostReactivationAction = {
  title?: unknown;
  timing?: unknown;
  rationale?: unknown;
};

type ParsedCloseLostPortfolioAnalysis = {
  keyInsight?: unknown;
  executiveSummary?: unknown;
  topFactors?: unknown;
  recurringPatterns?: unknown;
  recommendations?: unknown;
  confidence?: unknown;
};

type ParsedCloseLostPortfolioFactor = {
  title?: unknown;
  impact?: unknown;
  dealShare?: unknown;
  rationale?: unknown;
};

type ParsedCloseLostPortfolioRecommendation = {
  title?: unknown;
  rationale?: unknown;
  priority?: unknown;
};

const LOSS_REASON_CATEGORIES = [
  "pricing",
  "timing",
  "competition",
  "product_gap",
  "budget",
  "authority",
  "no_decision",
  "other",
] as const satisfies readonly CloseLostReasonCategory[];

const compactText = (value: string, maxLength: number): string => {
  const compacted = value.replace(/\s+/g, " ").trim();

  if (compacted.length <= maxLength) {
    return compacted;
  }

  return `${compacted.slice(0, maxLength - 1).trim()}...`;
};

const clampInteger = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value)));

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

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

const isConfidence = (value: unknown): value is CloseLostDealAnalysis["confidence"] =>
  value === "low" || value === "medium" || value === "high";

const isPriority = (value: unknown): value is CloseLostPortfolioRecommendation["priority"] =>
  value === "low" || value === "medium" || value === "high";

const isImpact = (value: unknown): value is CloseLostPortfolioFactor["impact"] =>
  value === "low" || value === "medium" || value === "high";

const isSeverity = (value: unknown): value is CloseLostRiskSignal["severity"] =>
  value === "low" || value === "medium" || value === "high";

const isHealthStatus = (value: unknown): value is CloseLostHealthDimension["status"] =>
  value === "weak" || value === "average" || value === "strong";

const isLossReasonCategory = (value: unknown): value is CloseLostReasonCategory =>
  typeof value === "string" && LOSS_REASON_CATEGORIES.includes(value as CloseLostReasonCategory);

const parseNullableText = (value: unknown, maxLength: number): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("Champ texte nullable invalide dans l'analyse close lost.");
  }

  const text = compactText(value, maxLength);

  return text ? text : null;
};

const parseHealthBeforeLoss = (value: unknown, providerName: string): CloseLostHealthDimension[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${providerName} a renvoye une sante avant perte invalide.`);
  }

  return value.slice(0, 5).map((item) => {
    if (!isRecord(item)) {
      throw new Error(`${providerName} a renvoye une dimension de sante invalide.`);
    }

    const dimension = item as ParsedCloseLostHealthDimension;

    if (
      typeof dimension.label !== "string" ||
      !isInteger(dimension.score) ||
      !isHealthStatus(dimension.status) ||
      typeof dimension.detail !== "string"
    ) {
      throw new Error(`${providerName} a renvoye une dimension de sante non conforme.`);
    }

    return {
      label: compactText(dimension.label, 70),
      score: clampInteger(dimension.score, 0, 100),
      status: dimension.status,
      detail: compactText(dimension.detail, 140),
    };
  });
};

const parseRiskSignals = (value: unknown, providerName: string): CloseLostRiskSignal[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${providerName} a renvoye des signaux de risque invalides.`);
  }

  return value.slice(0, 6).map((item) => {
    if (!isRecord(item)) {
      throw new Error(`${providerName} a renvoye un signal de risque invalide.`);
    }

    const signal = item as ParsedCloseLostRiskSignal;

    if (typeof signal.title !== "string" || !isSeverity(signal.severity) || typeof signal.detail !== "string") {
      throw new Error(`${providerName} a renvoye un signal de risque non conforme.`);
    }

    return {
      title: compactText(signal.title, 90),
      severity: signal.severity,
      detail: compactText(signal.detail, 160),
    };
  });
};

const parsePlaybook = (value: unknown, providerName: string): CloseLostReactivationAction[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${providerName} a renvoye un playbook de reactivation invalide.`);
  }

  return value.slice(0, 5).map((item) => {
    if (!isRecord(item)) {
      throw new Error(`${providerName} a renvoye une action de reactivation invalide.`);
    }

    const action = item as ParsedCloseLostReactivationAction;

    if (typeof action.title !== "string" || typeof action.timing !== "string" || typeof action.rationale !== "string") {
      throw new Error(`${providerName} a renvoye une action de reactivation non conforme.`);
    }

    return {
      title: compactText(action.title, 100),
      timing: compactText(action.timing, 50),
      rationale: compactText(action.rationale, 180),
    };
  });
};

const parsePortfolioFactors = (value: unknown, providerName: string): CloseLostPortfolioFactor[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${providerName} a renvoye des facteurs close lost invalides.`);
  }

  return value.slice(0, 6).map((item) => {
    if (!isRecord(item)) {
      throw new Error(`${providerName} a renvoye un facteur close lost invalide.`);
    }

    const factor = item as ParsedCloseLostPortfolioFactor;

    if (
      typeof factor.title !== "string" ||
      !isImpact(factor.impact) ||
      !isInteger(factor.dealShare) ||
      typeof factor.rationale !== "string"
    ) {
      throw new Error(`${providerName} a renvoye un facteur close lost non conforme.`);
    }

    return {
      title: compactText(factor.title, 90),
      impact: factor.impact,
      dealShare: clampInteger(factor.dealShare, 0, 100),
      rationale: compactText(factor.rationale, 160),
    };
  });
};

const parsePortfolioRecommendations = (
  value: unknown,
  providerName: string,
): CloseLostPortfolioRecommendation[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${providerName} a renvoye des recommandations close lost invalides.`);
  }

  return value.slice(0, 6).map((item) => {
    if (!isRecord(item)) {
      throw new Error(`${providerName} a renvoye une recommandation close lost invalide.`);
    }

    const recommendation = item as ParsedCloseLostPortfolioRecommendation;

    if (
      typeof recommendation.title !== "string" ||
      typeof recommendation.rationale !== "string" ||
      !isPriority(recommendation.priority)
    ) {
      throw new Error(`${providerName} a renvoye une recommandation close lost non conforme.`);
    }

    return {
      title: compactText(recommendation.title, 100),
      rationale: compactText(recommendation.rationale, 180),
      priority: recommendation.priority,
    };
  });
};

export const buildCloseLostDealPrompt = ({
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
}: AnalyzeCloseLostDealInput): string => `Tu es Jarvis, un sales copilot B2B. Analyse un deal HubSpot deja perdu et reponds uniquement en JSON valide.

Schema JSON exact:
{
  "summary": string,
  "primaryLossReason": string,
  "secondaryLossReason": string | null,
  "lossReasonCategory": "pricing" | "timing" | "competition" | "product_gap" | "budget" | "authority" | "no_decision" | "other",
  "competitorName": string | null,
  "whatHappened": string[],
  "healthBeforeLoss": [
    {
      "label": string,
      "score": number,
      "status": "weak" | "average" | "strong",
      "detail": string
    }
  ],
  "riskSignals": [
    {
      "title": string,
      "severity": "low" | "medium" | "high",
      "detail": string
    }
  ],
  "reactivationScore": number,
  "reactivationRationale": string,
  "playbook": [
    {
      "title": string,
      "timing": string,
      "rationale": string
    }
  ],
  "evidence": string[],
  "confidence": "low" | "medium" | "high"
}

Regles strictes:
- Utilise uniquement le CRM et l'historique fournis; n'invente jamais un concurrent, prix, participant ou evenement.
- Si le concurrent gagnant n'est pas explicite, competitorName doit etre null.
- summary: 1 phrase factuelle, 260 caracteres maximum.
- primaryLossReason et secondaryLossReason: libelles courts, 80 caracteres maximum.
- lossReasonCategory: choisis une seule categorie canonique parmi l'enum, jamais un libelle hybride; par exemple timing, engagement client tardif et timing/engagement client doivent rester "timing".
- whatHappened: 2 a 4 points maximum, chronologiques si possible.
- healthBeforeLoss: 3 a 5 dimensions maximum, score entier 0-100.
- riskSignals: 3 a 6 signaux observables avant perte.
- reactivationScore: entier 0-100; 0 si aucune reactivation credible dans les donnees.
- playbook: 2 a 5 actions maximum, orientees win-back ou prevention future.
- evidence: 2 a 5 faits CRM observes, sans citer de donnees sensibles inutiles.
- Si l'historique est pauvre, mets confidence a low et explique l'incertitude.
- Contenu en francais, concis, actionnable pour un manager Sales.

Contexte:
- Entreprise: ${companyName ?? "inconnue"}
- Contacts connus: ${contactNames && contactNames.length > 0 ? contactNames.join(", ") : "inconnus"}
- Deal: ${dealName ?? "inconnu"}
- Owner: ${ownerName ?? "inconnu"}
- Stage perdu: ${dealStage ?? "inconnu"}
- Montant perdu: ${dealAmount ?? "inconnu"}
- Date de perte: ${closedAt ?? "inconnue"}
- Aujourd'hui: ${today ?? new Date().toISOString()}

Contexte entreprise:
${companyContext ?? "non disponible"}

Contexte deal:
${dealContext ?? "non disponible"}

Historique HubSpot:
${history}`;

export const buildCloseLostPortfolioPrompt = ({
  dealsSummary,
  dateFrom,
  dateTo,
  scopeLabel,
  lostDealCount,
  totalLostValue,
  analyzedDealCount,
}: AnalyzeCloseLostPortfolioInput): string => `Tu es Jarvis, un analyste revenue operations B2B. Synthese des deals perdus deja analyses.

Reponds uniquement en JSON valide avec ce schema exact:
{
  "keyInsight": string,
  "executiveSummary": string,
  "topFactors": [
    {
      "title": string,
      "impact": "low" | "medium" | "high",
      "dealShare": number,
      "rationale": string
    }
  ],
  "recurringPatterns": string[],
  "recommendations": [
    {
      "title": string,
      "rationale": string,
      "priority": "low" | "medium" | "high"
    }
  ],
  "confidence": "low" | "medium" | "high"
}

Regles:
- Ne synthese que les analyses fournies ci-dessous.
- keyInsight: 1 phrase, 180 caracteres maximum.
- executiveSummary: 1 paragraphe, 320 caracteres maximum.
- topFactors: 3 a 6 facteurs maximum; dealShare est un entier 0-100.
- recurringPatterns: 3 a 6 patterns maximum, 120 caracteres chacun.
- recommendations: 3 a 6 recommandations manager, directement actionnables.
- Si moins de 5 deals sont analyses, garde confidence a low ou medium.

Contexte:
- Periode: ${dateFrom} -> ${dateTo}
- Scope: ${scopeLabel}
- Deals perdus: ${lostDealCount}
- Deals analyses: ${analyzedDealCount}
- Valeur perdue totale: ${totalLostValue}

Analyses compactes:
${dealsSummary}`;

export const parseCloseLostDealAnalysis = (value: string, providerName: string): CloseLostDealAnalysis => {
  const parsed = parseJsonObject<ParsedCloseLostDealAnalysis>(value, providerName, "l'analyse close lost du deal");

  if (
    typeof parsed.summary !== "string" ||
    typeof parsed.primaryLossReason !== "string" ||
    !isLossReasonCategory(parsed.lossReasonCategory) ||
    !isStringArray(parsed.whatHappened) ||
    !isInteger(parsed.reactivationScore) ||
    typeof parsed.reactivationRationale !== "string" ||
    !isStringArray(parsed.evidence) ||
    !isConfidence(parsed.confidence)
  ) {
    throw new Error(`${providerName} a renvoye un JSON invalide pour l'analyse close lost du deal.`);
  }

  return {
    summary: compactText(parsed.summary, 260),
    primaryLossReason: compactText(parsed.primaryLossReason, 80),
    secondaryLossReason: parseNullableText(parsed.secondaryLossReason, 80),
    lossReasonCategory: parsed.lossReasonCategory,
    competitorName: parseNullableText(parsed.competitorName, 80),
    whatHappened: parsed.whatHappened.map((item) => compactText(item, 140)).slice(0, 4),
    healthBeforeLoss: parseHealthBeforeLoss(parsed.healthBeforeLoss, providerName),
    riskSignals: parseRiskSignals(parsed.riskSignals, providerName),
    reactivationScore: clampInteger(parsed.reactivationScore, 0, 100),
    reactivationRationale: compactText(parsed.reactivationRationale, 180),
    playbook: parsePlaybook(parsed.playbook, providerName),
    evidence: parsed.evidence.map((item) => compactText(item, 140)).slice(0, 5),
    confidence: parsed.confidence,
  };
};

export const parseCloseLostPortfolioAnalysis = (value: string, providerName: string): CloseLostPortfolioAnalysis => {
  const parsed = parseJsonObject<ParsedCloseLostPortfolioAnalysis>(
    value,
    providerName,
    "l'analyse close lost globale",
  );

  if (
    typeof parsed.keyInsight !== "string" ||
    typeof parsed.executiveSummary !== "string" ||
    !isStringArray(parsed.recurringPatterns) ||
    !isConfidence(parsed.confidence)
  ) {
    throw new Error(`${providerName} a renvoye un JSON invalide pour l'analyse close lost globale.`);
  }

  return {
    keyInsight: compactText(parsed.keyInsight, 180),
    executiveSummary: compactText(parsed.executiveSummary, 320),
    topFactors: parsePortfolioFactors(parsed.topFactors, providerName),
    recurringPatterns: parsed.recurringPatterns.map((item) => compactText(item, 120)).slice(0, 6),
    recommendations: parsePortfolioRecommendations(parsed.recommendations, providerName),
    confidence: parsed.confidence,
  };
};
