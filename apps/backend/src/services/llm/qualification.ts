import type {
  AnalyzeDealQualificationInput,
  BuyingCommitteeMember,
  DealQualificationAnalysis,
  DealQualificationDealRole,
  DealQualificationInfluence,
  DealQualificationSentiment,
  DealQualificationStatus,
  DecisionProcess,
  MeddiccCriterion,
  MeddiccCriterionId,
  QualificationInsight,
  QualificationRisk,
} from "./llm.provider.js";

type ParsedQualificationAnalysis = {
  buyingCommittee?: unknown;
  meddicc?: unknown;
  decisionProcess?: unknown;
  risks?: unknown;
  strengths?: unknown;
  missingForWin?: unknown;
  confidence?: unknown;
};

type ParsedBuyingCommitteeMember = {
  name?: unknown;
  role?: unknown;
  influence?: unknown;
  sentiment?: unknown;
  dealRole?: unknown;
  evidence?: unknown;
};

type ParsedMeddiccCriterion = {
  id?: unknown;
  label?: unknown;
  status?: unknown;
  score?: unknown;
  evidence?: unknown;
  gap?: unknown;
};

type ParsedDecisionProcess = {
  decisionCalendar?: unknown;
  budgetStatus?: unknown;
  purchaseProcess?: unknown;
  legalStatus?: unknown;
  nextGovernanceStep?: unknown;
};

type ParsedQualificationRisk = {
  title?: unknown;
  severity?: unknown;
  evidence?: unknown;
};

type ParsedQualificationInsight = {
  title?: unknown;
  rationale?: unknown;
};

const MEDDICC_CRITERION_IDS = [
  "metrics",
  "economicBuyer",
  "decisionCriteria",
  "decisionProcess",
  "paperProcess",
  "identifyPain",
  "champion",
  "competition",
] as const satisfies readonly MeddiccCriterionId[];

const MEDDICC_CRITERION_LABELS: Record<MeddiccCriterionId, string> = {
  champion: "Champion",
  competition: "Competition",
  decisionCriteria: "Decision criteria",
  decisionProcess: "Decision process",
  economicBuyer: "Economic buyer",
  identifyPain: "Identify pain",
  metrics: "Metrics",
  paperProcess: "Paper process",
};

const compactText = (value: string, maxLength: number): string => {
  const compacted = value.replace(/\s+/g, " ").trim();

  if (compacted.length <= maxLength) {
    return compacted;
  }

  return `${compacted.slice(0, maxLength - 1).trim()}…`;
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
    throw new Error(`${providerName} n'a pas renvoye un JSON valide pour la qualification du deal. Extrait: ${value.slice(0, 240)}`);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

const isConfidence = (value: unknown): value is DealQualificationAnalysis["confidence"] =>
  value === "low" || value === "medium" || value === "high";

const isInfluence = (value: unknown): value is DealQualificationInfluence =>
  value === "low" || value === "medium" || value === "high";

const isSentiment = (value: unknown): value is DealQualificationSentiment =>
  value === "positive" || value === "neutral" || value === "negative" || value === "unknown";

const isDealRole = (value: unknown): value is DealQualificationDealRole =>
  value === "champion" ||
  value === "decision_maker" ||
  value === "influencer" ||
  value === "blocker" ||
  value === "user" ||
  value === "unknown";

const isQualificationStatus = (value: unknown): value is DealQualificationStatus =>
  value === "confirmed" || value === "partial" || value === "weak" || value === "missing";

const isCriterionId = (value: unknown): value is MeddiccCriterionId =>
  typeof value === "string" && MEDDICC_CRITERION_IDS.includes(value as MeddiccCriterionId);

const isRiskSeverity = (value: unknown): value is QualificationRisk["severity"] =>
  value === "low" || value === "medium" || value === "high";

const isBudgetStatus = (value: unknown): value is DecisionProcess["budgetStatus"] =>
  value === "validated" || value === "to_confirm" || value === "blocked" || value === "unknown";

const isPurchaseProcess = (value: unknown): value is DecisionProcess["purchaseProcess"] =>
  value === "clear" || value === "to_confirm" || value === "blocked" || value === "unknown";

const isLegalStatus = (value: unknown): value is DecisionProcess["legalStatus"] =>
  value === "approved" || value === "in_review" || value === "blocked" || value === "unknown";

const parseNullableText = (value: unknown, maxLength: number): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("Champ texte nullable invalide dans la qualification du deal.");
  }

  const text = compactText(value, maxLength);

  return text ? text : null;
};

const parseCommittee = (value: unknown, providerName: string): BuyingCommitteeMember[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${providerName} a renvoye un comite d'achat invalide.`);
  }

  return value.slice(0, 6).map((item) => {
    if (!isRecord(item)) {
      throw new Error(`${providerName} a renvoye un membre du comite invalide.`);
    }

    const member = item as ParsedBuyingCommitteeMember;

    if (
      typeof member.name !== "string" ||
      typeof member.role !== "string" ||
      !isInfluence(member.influence) ||
      !isSentiment(member.sentiment) ||
      !isDealRole(member.dealRole) ||
      typeof member.evidence !== "string"
    ) {
      throw new Error(`${providerName} a renvoye un membre du comite non conforme.`);
    }

    return {
      name: compactText(member.name, 80),
      role: compactText(member.role, 90),
      influence: member.influence,
      sentiment: member.sentiment,
      dealRole: member.dealRole,
      evidence: compactText(member.evidence, 140),
    };
  });
};

const parseMeddicc = (value: unknown, providerName: string): MeddiccCriterion[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${providerName} a renvoye une qualification MEDDICC invalide.`);
  }

  const criteriaById = new Map<MeddiccCriterionId, MeddiccCriterion>();

  value.forEach((item) => {
    if (!isRecord(item)) {
      throw new Error(`${providerName} a renvoye un critere MEDDICC invalide.`);
    }

    const criterion = item as ParsedMeddiccCriterion;

    if (
      !isCriterionId(criterion.id) ||
      typeof criterion.label !== "string" ||
      !isQualificationStatus(criterion.status) ||
      !isInteger(criterion.score) ||
      typeof criterion.evidence !== "string" ||
      (criterion.gap !== null && criterion.gap !== undefined && typeof criterion.gap !== "string")
    ) {
      throw new Error(`${providerName} a renvoye un critere MEDDICC non conforme.`);
    }

    if (criteriaById.has(criterion.id)) {
      return;
    }

    criteriaById.set(criterion.id, {
      id: criterion.id,
      label: compactText(criterion.label, 50),
      status: criterion.status,
      score: clampInteger(criterion.score, 0, 100),
      evidence: compactText(criterion.evidence, 140),
      gap: parseNullableText(criterion.gap, 140),
    });
  });

  return MEDDICC_CRITERION_IDS.map(
    (id) =>
      criteriaById.get(id) ?? {
        id,
        label: MEDDICC_CRITERION_LABELS[id],
        status: "missing",
        score: 0,
        evidence: "Critere non renseigne par le provider.",
        gap: "Relancer l'analyse ou verifier l'historique CRM.",
      },
  );
};

const parseDecisionProcess = (value: unknown, providerName: string): DecisionProcess => {
  if (!isRecord(value)) {
    throw new Error(`${providerName} a renvoye un processus de decision invalide.`);
  }

  const process = value as ParsedDecisionProcess;

  if (
    !isBudgetStatus(process.budgetStatus) ||
    !isPurchaseProcess(process.purchaseProcess) ||
    !isLegalStatus(process.legalStatus)
  ) {
    throw new Error(`${providerName} a renvoye un processus de decision non conforme.`);
  }

  return {
    decisionCalendar: parseNullableText(process.decisionCalendar, 120),
    budgetStatus: process.budgetStatus,
    purchaseProcess: process.purchaseProcess,
    legalStatus: process.legalStatus,
    nextGovernanceStep: parseNullableText(process.nextGovernanceStep, 140),
  };
};

const parseRisks = (value: unknown, providerName: string): QualificationRisk[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${providerName} a renvoye des risques de qualification invalides.`);
  }

  return value.slice(0, 4).map((item) => {
    if (!isRecord(item)) {
      throw new Error(`${providerName} a renvoye un risque de qualification invalide.`);
    }

    const risk = item as ParsedQualificationRisk;

    if (typeof risk.title !== "string" || !isRiskSeverity(risk.severity) || typeof risk.evidence !== "string") {
      throw new Error(`${providerName} a renvoye un risque de qualification non conforme.`);
    }

    return {
      title: compactText(risk.title, 120),
      severity: risk.severity,
      evidence: compactText(risk.evidence, 160),
    };
  });
};

const parseInsights = (value: unknown, providerName: string, label: string): QualificationInsight[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${providerName} a renvoye ${label} invalides.`);
  }

  return value.slice(0, 4).map((item) => {
    if (!isRecord(item)) {
      throw new Error(`${providerName} a renvoye un insight ${label} invalide.`);
    }

    const insight = item as ParsedQualificationInsight;

    if (typeof insight.title !== "string" || typeof insight.rationale !== "string") {
      throw new Error(`${providerName} a renvoye un insight ${label} non conforme.`);
    }

    return {
      title: compactText(insight.title, 120),
      rationale: compactText(insight.rationale, 170),
    };
  });
};

export const buildDealQualificationPrompt = ({
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
}: AnalyzeDealQualificationInput): string => `Tu es Jarvis, un sales copilot B2B. Analyse le comite d'achat, MEDDICC et le processus de decision de ce deal HubSpot.

Reponds uniquement en JSON valide avec ce schema exact:
{
  "buyingCommittee": [
    {
      "name": string,
      "role": string,
      "influence": "low" | "medium" | "high",
      "sentiment": "positive" | "neutral" | "negative" | "unknown",
      "dealRole": "champion" | "decision_maker" | "influencer" | "blocker" | "user" | "unknown",
      "evidence": string
    }
  ],
  "meddicc": [
    {
      "id": "metrics" | "economicBuyer" | "decisionCriteria" | "decisionProcess" | "paperProcess" | "identifyPain" | "champion" | "competition",
      "label": string,
      "status": "confirmed" | "partial" | "weak" | "missing",
      "score": number,
      "evidence": string,
      "gap": string | null
    }
  ],
  "decisionProcess": {
    "decisionCalendar": string | null,
    "budgetStatus": "validated" | "to_confirm" | "blocked" | "unknown",
    "purchaseProcess": "clear" | "to_confirm" | "blocked" | "unknown",
    "legalStatus": "approved" | "in_review" | "blocked" | "unknown",
    "nextGovernanceStep": string | null
  },
  "risks": [
    {
      "title": string,
      "severity": "low" | "medium" | "high",
      "evidence": string
    }
  ],
  "strengths": [
    {
      "title": string,
      "rationale": string
    }
  ],
  "missingForWin": [
    {
      "title": string,
      "rationale": string
    }
  ],
  "confidence": "low" | "medium" | "high"
}

Regles strictes:
- Utilise uniquement le CRM, le contexte et l'historique fournis. Ne cree jamais de personne fictive.
- buyingCommittee contient uniquement des personnes nommees dans les donnees. Si aucune personne n'est exploitable, renvoie [].
- MEDDICC doit contenir exactement les 8 criteres listes dans le schema, une seule fois chacun, avec un score entier 0-100.
- N'utilise jamais deux fois le meme id MEDDICC; si un critere est incertain, garde son id unique et mets status a "missing" ou "weak".
- Mets "missing" et score 0 si le CRM ne permet pas de confirmer un critere.
- Ne deduis pas un DAF, un juriste ou un comite si ce role n'apparait pas dans les donnees.
- Les preuves doivent etre factuelles et courtes; pas de verbatim invente.
- Aujourd'hui est la date de reference absolue. Compare toutes les dates a cette date, avec l'annee.
- Un evenement date avant aujourd'hui est passe et ne doit pas etre presente comme prochaine etape de gouvernance.
- risks, strengths et missingForWin: 4 elements maximum chacun.
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
- Objectif: ${objective ?? "qualifier le comite d'achat, MEDDICC, le processus de decision et les blocages"}

Contexte entreprise:
${companyContext ?? "non disponible"}

Contexte deal:
${dealContext ?? "non disponible"}

Historique HubSpot:
${history}`;

export const parseDealQualification = (value: string, providerName: string): DealQualificationAnalysis => {
  const parsed = parseJsonObject<ParsedQualificationAnalysis>(value, providerName);

  if (!isConfidence(parsed.confidence)) {
    throw new Error(`${providerName} a renvoye une confiance invalide pour la qualification du deal.`);
  }

  return {
    buyingCommittee: parseCommittee(parsed.buyingCommittee, providerName),
    meddicc: parseMeddicc(parsed.meddicc, providerName),
    decisionProcess: parseDecisionProcess(parsed.decisionProcess, providerName),
    risks: parseRisks(parsed.risks, providerName),
    strengths: parseInsights(parsed.strengths, providerName, "des atouts du deal"),
    missingForWin: parseInsights(parsed.missingForWin, providerName, "des insights de gain"),
    confidence: parsed.confidence,
  };
};
