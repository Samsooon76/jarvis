import { compactText } from "../../lib/text.js";
import type {
  ActivityPlanAction,
  ActivityPlanDeadline,
  ActivityPlanInsight,
  ActivityPlanRecommendation,
  AnalyzeDealActivityPlanInput,
  DealActivityPlanAnalysis,
} from "./llm.provider.js";

type ParsedActivityPlanAnalysis = {
  mutualActionPlan?: unknown;
  upcomingDeadlines?: unknown;
  notesAndInsights?: unknown;
  recommendation?: unknown;
  confidence?: unknown;
};

type ParsedAction = {
  title?: unknown;
  ownerName?: unknown;
  dueDate?: unknown;
  status?: unknown;
  priority?: unknown;
  rationale?: unknown;
};

type ParsedDeadline = {
  title?: unknown;
  date?: unknown;
  timeWindow?: unknown;
  ownerName?: unknown;
  description?: unknown;
};

type ParsedInsight = {
  title?: unknown;
  detail?: unknown;
};

type ParsedRecommendation = {
  priority?: unknown;
  summary?: unknown;
  nextBestAction?: unknown;
};

type ParsedNextBestAction = {
  title?: unknown;
  rationale?: unknown;
  dueInDays?: unknown;
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

const parseJsonObject = <T>(value: string, providerName: string): T => {
  try {
    return JSON.parse(normalizeJsonResponse(value)) as T;
  } catch {
    throw new Error(`${providerName} n'a pas renvoye un JSON valide pour le plan d'action. Extrait: ${value.slice(0, 240)}`);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isConfidence = (value: unknown): value is DealActivityPlanAnalysis["confidence"] =>
  value === "low" || value === "medium" || value === "high";

const isPriority = (value: unknown): value is ActivityPlanAction["priority"] =>
  value === "low" || value === "medium" || value === "high";

const isActionStatus = (value: unknown): value is ActivityPlanAction["status"] =>
  value === "todo" || value === "in_progress" || value === "planned" || value === "done";

const parseDueInDays = (value: unknown, providerName: string): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampInteger(value, 0, 30);
  }

  if (typeof value === "string") {
    const trimmedValue = value.trim();

    if (/^-?\d+(?:\.\d+)?$/.test(trimmedValue)) {
      return clampInteger(Number(trimmedValue), 0, 30);
    }
  }

  throw new Error(`${providerName} a renvoye une prochaine meilleure action avec une echeance non conforme.`);
};

const parseNullableText = (value: unknown, maxLength: number): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("Champ texte nullable invalide dans le plan d'action.");
  }

  const text = compactText(value, maxLength);

  return text ? text : null;
};

const parseActions = (value: unknown, providerName: string): ActivityPlanAction[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${providerName} a renvoye un plan d'action invalide.`);
  }

  return value.slice(0, 6).map((item) => {
    if (!isRecord(item)) {
      throw new Error(`${providerName} a renvoye une action invalide.`);
    }

    const action = item as ParsedAction;

    if (
      typeof action.title !== "string" ||
      !isActionStatus(action.status) ||
      !isPriority(action.priority) ||
      typeof action.rationale !== "string"
    ) {
      throw new Error(`${providerName} a renvoye une action non conforme.`);
    }

    return {
      title: compactText(action.title, 100),
      ownerName: parseNullableText(action.ownerName, 80),
      dueDate: parseNullableText(action.dueDate, 40),
      status: action.status,
      priority: action.priority,
      rationale: compactText(action.rationale, 160),
    };
  });
};

const parseDeadlines = (value: unknown, providerName: string): ActivityPlanDeadline[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${providerName} a renvoye des echeances invalides.`);
  }

  return value.slice(0, 5).map((item) => {
    if (!isRecord(item)) {
      throw new Error(`${providerName} a renvoye une echeance invalide.`);
    }

    const deadline = item as ParsedDeadline;

    if (typeof deadline.title !== "string" || typeof deadline.description !== "string") {
      throw new Error(`${providerName} a renvoye une echeance non conforme.`);
    }

    return {
      title: compactText(deadline.title, 100),
      date: parseNullableText(deadline.date, 40),
      timeWindow: parseNullableText(deadline.timeWindow, 40),
      ownerName: parseNullableText(deadline.ownerName, 80),
      description: compactText(deadline.description, 160),
    };
  });
};

const parseInsights = (value: unknown, providerName: string): ActivityPlanInsight[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${providerName} a renvoye des notes invalides.`);
  }

  return value.slice(0, 5).map((item) => {
    if (!isRecord(item)) {
      throw new Error(`${providerName} a renvoye une note invalide.`);
    }

    const insight = item as ParsedInsight;

    if (typeof insight.title !== "string" || typeof insight.detail !== "string") {
      throw new Error(`${providerName} a renvoye une note non conforme.`);
    }

    return {
      title: compactText(insight.title, 100),
      detail: compactText(insight.detail, 180),
    };
  });
};

const parseRecommendation = (value: unknown, providerName: string): ActivityPlanRecommendation => {
  if (!isRecord(value)) {
    throw new Error(`${providerName} a renvoye une recommandation invalide.`);
  }

  const recommendation = value as ParsedRecommendation;

  if (!isPriority(recommendation.priority) || typeof recommendation.summary !== "string" || !isRecord(recommendation.nextBestAction)) {
    throw new Error(`${providerName} a renvoye une recommandation non conforme.`);
  }

  const nextBestAction = recommendation.nextBestAction as ParsedNextBestAction;

  if (
    typeof nextBestAction.title !== "string" ||
    typeof nextBestAction.rationale !== "string"
  ) {
    throw new Error(`${providerName} a renvoye une prochaine meilleure action non conforme.`);
  }

  const dueInDays = parseDueInDays(nextBestAction.dueInDays, providerName);

  return {
    priority: recommendation.priority,
    summary: compactText(recommendation.summary, 220),
    nextBestAction: {
      title: compactText(nextBestAction.title, 100),
      rationale: compactText(nextBestAction.rationale, 180),
      dueInDays,
    },
  };
};

export const buildDealActivityPlanPrompt = ({
  history,
  companyName,
  dealName,
  companyContext,
  dealContext,
  dealStage,
  objective,
  today,
  lastContactAt,
  nextAction,
  contactNames,
  currentCloseProbability,
  dealAmount,
  closeDate,
  ownerName,
  crmActivitySummary,
  pendingActionsSummary,
  channelEngagementSummary,
}: AnalyzeDealActivityPlanInput): string => `Tu es Jarvis, un sales copilot B2B. Analyse l'activite CRM HubSpot et produis un plan d'action mutualise.

Reponds uniquement en JSON valide avec ce schema exact:
{
  "mutualActionPlan": [
    {
      "title": string,
      "ownerName": string | null,
      "dueDate": string | null,
      "status": "todo" | "in_progress" | "planned" | "done",
      "priority": "low" | "medium" | "high",
      "rationale": string
    }
  ],
  "upcomingDeadlines": [
    {
      "title": string,
      "date": string | null,
      "timeWindow": string | null,
      "ownerName": string | null,
      "description": string
    }
  ],
  "notesAndInsights": [
    {
      "title": string,
      "detail": string
    }
  ],
  "recommendation": {
    "priority": "low" | "medium" | "high",
    "summary": string,
    "nextBestAction": {
      "title": string,
      "rationale": string,
      "dueInDays": number
    }
  },
  "confidence": "low" | "medium" | "high"
}

Regles strictes:
- Utilise uniquement les donnees CRM et l'historique fournis.
- N'invente jamais une reunion, un participant, une date, un budget ou une action deja faite.
- Aujourd'hui est la date de reference absolue. Compare toutes les dates a cette date, avec l'annee.
- Un evenement date avant aujourd'hui est passe et ne doit jamais apparaitre dans upcomingDeadlines.
- Ne transforme pas une note, un call, un email ou un SMS passe en prochaine echeance.
- mutualActionPlan: 3 a 6 actions maximum, melange actions CRM existantes et actions deduites si elles sont clairement justifiees.
- upcomingDeadlines: uniquement des echeances futures explicites, avec une date >= aujourd'hui; sinon [].
- dueDate et date doivent etre ISO 8601 avec annee complete si une date precise est connue, sinon null.
- notesAndInsights: 3 a 5 signaux utiles issus de l'activite et des notes.
- recommendation.summary: 1 phrase, 220 caracteres maximum.
- nextBestAction.dueInDays: entier 0-30 depuis aujourd'hui.
- Contenu en francais, concis, directement exploitable par un AE.

Contexte:
- Entreprise: ${companyName ?? "inconnue"}
- Contacts connus: ${contactNames && contactNames.length > 0 ? contactNames.join(", ") : "inconnus"}
- Deal: ${dealName ?? "inconnu"}
- Owner: ${ownerName ?? "inconnu"}
- Stage: ${dealStage ?? "inconnu"}
- Montant: ${dealAmount ?? "inconnu"}
- Probabilite actuelle: ${currentCloseProbability ?? "inconnue"}
- Date de cloture: ${closeDate ?? "inconnue"}
- Aujourd'hui: ${today ?? new Date().toISOString()}
- Dernier contact connu: ${lastContactAt ?? "inconnu"}
- Prochaine action deja stockee: ${nextAction ?? "aucune"}
- Objectif: ${objective ?? "construire l'activite recente, le plan d'action et la recommandation"}

Resume activite CRM:
${crmActivitySummary ?? "non disponible"}

Actions deja stockees:
${pendingActionsSummary ?? "aucune"}

Engagement par canal:
${channelEngagementSummary ?? "non disponible"}

Contexte entreprise:
${companyContext ?? "non disponible"}

Contexte deal:
${dealContext ?? "non disponible"}

Historique HubSpot:
${history}`;

export const parseDealActivityPlan = (value: string, providerName: string): DealActivityPlanAnalysis => {
  const parsed = parseJsonObject<ParsedActivityPlanAnalysis>(value, providerName);

  if (!isConfidence(parsed.confidence)) {
    throw new Error(`${providerName} a renvoye une confiance invalide pour le plan d'action.`);
  }

  return {
    mutualActionPlan: parseActions(parsed.mutualActionPlan, providerName),
    upcomingDeadlines: parseDeadlines(parsed.upcomingDeadlines, providerName),
    notesAndInsights: parseInsights(parsed.notesAndInsights, providerName),
    recommendation: parseRecommendation(parsed.recommendation, providerName),
    confidence: parsed.confidence,
  };
};
