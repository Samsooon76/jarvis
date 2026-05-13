import { env } from "../../../config/env.js";
import type {
  AnalyzeDealHistoryInput,
  AnalyzeDealActivityPlanInput,
  AnalyzeCloseLostDealInput,
  AnalyzeCloseLostPortfolioInput,
  AnalyzeDealIntelligenceInput,
  AnalyzeDealQualificationInput,
  CloseLostDealAnalysis,
  CloseLostPortfolioAnalysis,
  DealActivityPlanAnalysis,
  DealFullAnalysis,
  DealHistoryAnalysis,
  DealIntelligenceAnalysis,
  DealIntelligenceNextStep,
  DealQualificationAnalysis,
  FollowUpTaskRecommendation,
  LlmProvider,
  RecommendFollowUpTaskInput,
} from "../llm.provider.js";
import { buildDealActivityPlanPrompt, parseDealActivityPlan } from "../activity-plan.js";
import {
  buildCloseLostDealPrompt,
  buildCloseLostPortfolioPrompt,
  parseCloseLostDealAnalysis,
  parseCloseLostPortfolioAnalysis,
} from "../close-lost.js";
import { buildDealQualificationPrompt, parseDealQualification } from "../qualification.js";

type OpenAiChatResponse = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?:
        | string
        | null
        | Array<{
            text?: string;
            type?: string;
          }>;
      refusal?: string | null;
    };
  }>;
  usage?: {
    completion_tokens?: number;
    prompt_tokens?: number;
    total_tokens?: number;
  };
};

type ParsedDealHistoryAnalysis = {
  summary?: unknown;
  risks?: unknown;
  nextActions?: unknown;
  confidence?: unknown;
};

type ParsedDealIntelligenceAnalysis = {
  closeWonProbability?: unknown;
  dealHealth?: unknown;
  executiveSummary?: unknown;
  detailedAnalysis?: unknown;
  whyNow?: unknown;
  suggestedMove?: unknown;
  nextSteps?: unknown;
  risks?: unknown;
  positiveSignals?: unknown;
  missingData?: unknown;
  evidence?: unknown;
  confidence?: unknown;
};

type ParsedDealIntelligenceNextStep = {
  title?: unknown;
  rationale?: unknown;
  dueInDays?: unknown;
  priority?: unknown;
  createHubSpotTask?: unknown;
};

type ParsedFollowUpTaskRecommendation = {
  shouldCreateTask?: unknown;
  rationale?: unknown;
  title?: unknown;
  description?: unknown;
  dueInDays?: unknown;
  priority?: unknown;
  outreachDraft?: unknown;
};

type ParsedOutreachDraft = {
  channel?: unknown;
  subject?: unknown;
  body?: unknown;
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

const parseStringList = (value: unknown, maxItems: number, maxLength: number): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        const text = record.title ?? record.summary ?? record.rationale ?? record.evidence ?? record.detail;

        return typeof text === "string" ? text : null;
      }

      return null;
    })
    .filter((item): item is string => Boolean(item?.trim()))
    .map((item) => compactText(item, maxLength))
    .slice(0, maxItems);
};

const clampInteger = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const compactText = (value: string, maxLength: number): string => {
  const compacted = value.replace(/\s+/g, " ").trim();

  if (compacted.length <= maxLength) {
    return compacted;
  }

  return `${compacted.slice(0, maxLength - 1).trim()}…`;
};

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

const parseJsonObject = <T>(value: string, label: string): T => {
  try {
    return JSON.parse(normalizeJsonResponse(value)) as T;
  } catch {
    throw new Error(`OpenAI n'a pas renvoye un JSON valide pour ${label}. Extrait: ${value.slice(0, 240)}`);
  }
};

const buildDealHistoryPrompt = ({
  history,
  companyName,
  dealName,
  companyContext,
  dealContext,
  objective,
}: AnalyzeDealHistoryInput): string => `Analyse l'historique commercial suivant et reponds uniquement en json valide.

Schema JSON attendu:
{
  "summary": string,
  "risks": string[],
  "nextActions": string[],
  "confidence": "low" | "medium" | "high"
}

Regles:
- Resume factuel en francais, 220 caracteres maximum.
- 3 risques maximum, 120 caracteres chacun.
- 3 prochaines actions maximum, 120 caracteres chacune.
- Ne rien inventer si l'information n'est pas dans l'historique.

Contexte:
- Entreprise: ${companyName ?? "inconnue"}
- Contexte entreprise:
${companyContext ?? "non disponible"}
- Deal: ${dealName ?? "inconnu"}
- Contexte deal:
${dealContext ?? "non disponible"}
- Objectif: ${objective ?? "qualifier la situation du deal"}

Historique:
${history}`;

const buildDealIntelligencePrompt = ({
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
}: AnalyzeDealIntelligenceInput): string => `Tu es Jarvis, un sales copilot B2B. Analyse ce deal HubSpot et reponds uniquement en json valide.

Schema JSON exact:
{
  "closeWonProbability": number,
  "dealHealth": "strong" | "medium" | "at_risk" | "blocked" | "unknown",
  "executiveSummary": string,
  "detailedAnalysis": string[],
  "whyNow": string,
  "suggestedMove": string,
  "nextSteps": [
    {
      "title": string,
      "rationale": string,
      "dueInDays": number,
      "priority": "low" | "medium" | "high",
      "createHubSpotTask": boolean
    }
  ],
  "risks": string[],
  "positiveSignals": string[],
  "missingData": string[],
  "evidence": string[],
  "confidence": "low" | "medium" | "high"
}

Regles:
- L'historique est trie du plus ancien au plus recent. Analyse d'abord la trajectoire chronologique, puis donne plus de poids aux evenements les plus recents.
- closeWonProbability est un entier 0-100: estime la probabilite commerciale de signature a partir du stage, du close date, des signaux recents, des prochaines etapes, des blocages et de la probabilite HubSpot existante.
- Ne donne pas un score extreme (<10 ou >90) sans preuves explicites dans l'historique recent. Un score <10 exige un blocage majeur, une perte explicite, un silence long ou un refus clair.
- Si le deal est en phase de signature, POC valide, devis/proposition acceptee, validation finale ou next step daté tres proche, le score doit rester eleve sauf blocage explicite plus recent.
- Un risque RGPD, legal, technique ou integration baisse le score seulement s'il bloque explicitement la signature; sinon traite-le comme risque a suivre.
- Si des signaux se contredisent, explique l'arbitrage dans evidence et whyNow en citant les faits les plus recents.
- executiveSummary: 1 phrase, 220 caracteres maximum.
- detailedAnalysis: 2 bullets maximum, 140 caracteres maximum par bullet, sans repeter executiveSummary.
- whyNow: 1 phrase, 180 caracteres maximum.
- suggestedMove: 1 phrase imperative, 140 caracteres maximum.
- nextSteps: 1 a 3 actions maximum, dueInDays entre 0 et 30.
- evidence: 2 a 4 faits observes, 120 caracteres maximum chacun.
- Ne confonds pas probabilite HubSpot, montant, date technique et signal commercial; la probabilite HubSpot est un input, pas une verite absolue.
- Aujourd'hui est la date de reference absolue. Compare toutes les dates a cette date, avec l'annee.
- Un evenement date avant aujourd'hui est passe: ne le presente jamais comme prochain pas ou prochaine echeance.
- Calcule dueInDays depuis aujourd'hui, pas depuis la date du dernier evenement.
- Ne rien inventer; liste les infos manquantes si necessaire.
- Contenu en francais, tres concis, factuel et actionnable.

Contexte:
- Entreprise: ${companyName ?? "inconnue"}
- Contacts: ${contactNames && contactNames.length > 0 ? contactNames.join(", ") : "inconnus"}
- Contexte entreprise:
${companyContext ?? "non disponible"}
- Deal: ${dealName ?? "inconnu"}
- Contexte deal:
${dealContext ?? "non disponible"}
- Stage: ${dealStage ?? "inconnu"}
- Montant: ${dealAmount ?? "inconnu"}
- Probabilite actuelle: ${currentCloseProbability ?? "inconnue"}
- Aujourd'hui: ${today ?? new Date().toISOString()}
- Dernier contact connu: ${lastContactAt ?? "inconnu"}
- Prochaine action deja stockee: ${nextAction ?? "aucune"}
- Objectif: ${objective ?? "prioriser le deal et planifier les prochaines actions"}

Historique chronologique HubSpot (ancien -> recent):
${history}`;

const buildDealFullPrompt = (input: AnalyzeDealActivityPlanInput): string => `Tu es Jarvis, un sales copilot B2B. Analyse ce deal HubSpot une seule fois et produis les 3 blocs JSON demandes.

Reponds uniquement en JSON valide avec ce schema exact:
{
  "intelligence": {
    "closeWonProbability": number,
    "dealHealth": "strong" | "medium" | "at_risk" | "blocked" | "unknown",
    "executiveSummary": string,
    "detailedAnalysis": string[],
    "whyNow": string,
    "suggestedMove": string,
    "nextSteps": [
      {
        "title": string,
        "rationale": string,
        "dueInDays": number,
        "priority": "low" | "medium" | "high",
        "createHubSpotTask": boolean
      }
    ],
    "risks": string[],
    "positiveSignals": string[],
    "missingData": string[],
    "evidence": string[],
    "confidence": "low" | "medium" | "high"
  },
  "qualification": {
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
    "risks": [{ "title": string, "severity": "low" | "medium" | "high", "evidence": string }],
    "strengths": [{ "title": string, "rationale": string }],
    "missingForWin": [{ "title": string, "rationale": string }],
    "confidence": "low" | "medium" | "high"
  },
  "activityPlan": {
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
    "notesAndInsights": [{ "title": string, "detail": string }],
    "recommendation": {
      "priority": "low" | "medium" | "high",
      "summary": string,
      "nextBestAction": { "title": string, "rationale": string, "dueInDays": number }
    },
    "confidence": "low" | "medium" | "high"
  }
}

Regles:
- Reutilise les memes faits pour les 3 blocs; ne fais pas trois analyses contradictoires.
- Contenu en francais, concis, factuel, actionnable.
- Ne rien inventer. Si une info manque, indique-la dans missingData, gap ou missingForWin.
- L'historique est trie du plus ancien au plus recent. Analyse la trajectoire chronologique avant de conclure.
- Pour intelligence.closeWonProbability, donne plus de poids aux evenements les plus recents qu'aux anciens risques deja traites.
- Ne donne pas un score extreme (<10 ou >90) sans preuves explicites dans l'historique recent. Un score <10 exige un blocage majeur, une perte explicite, un silence long ou un refus clair.
- Si le deal est en phase de signature, POC valide, devis/proposition acceptee, validation finale ou next step daté tres proche, le score doit rester eleve sauf blocage explicite plus recent.
- Un risque RGPD, legal, technique ou integration baisse le score seulement s'il bloque explicitement la signature; sinon traite-le comme risque a suivre.
- Si des signaux se contredisent, explique l'arbitrage dans intelligence.evidence et intelligence.whyNow en citant les faits les plus recents.
- Aujourd'hui est la date de reference absolue. Un evenement avant aujourd'hui est passe.
- upcomingDeadlines ne contient que des echeances futures ou null si la date est inconnue.
- MEDDICC doit contenir les 8 criteres exactement une fois.
- Limites: nextSteps 1-3, risques 3 max, signaux 3 max, buyingCommittee 6 max, mutualActionPlan 6 max.

Contexte:
- Entreprise: ${input.companyName ?? "inconnue"}
- Contacts: ${input.contactNames && input.contactNames.length > 0 ? input.contactNames.join(", ") : "inconnus"}
- Contexte entreprise:
${input.companyContext ?? "non disponible"}
- Deal: ${input.dealName ?? "inconnu"}
- Contexte deal:
${input.dealContext ?? "non disponible"}
- Stage: ${input.dealStage ?? "inconnu"}
- Montant: ${input.dealAmount ?? "inconnu"}
- Probabilite actuelle: ${input.currentCloseProbability ?? "inconnue"}
- Close date: ${input.closeDate ?? "inconnue"}
- Owner: ${input.ownerName ?? "inconnu"}
- Aujourd'hui: ${input.today ?? new Date().toISOString()}
- Dernier contact connu: ${input.lastContactAt ?? "inconnu"}
- Prochaine action deja stockee: ${input.nextAction ?? "aucune"}
- Activites recentes:
${input.crmActivitySummary ?? "non disponible"}
- Actions ouvertes:
${input.pendingActionsSummary ?? "non disponible"}
- Engagement par canal:
${input.channelEngagementSummary ?? "non disponible"}

Historique chronologique HubSpot (ancien -> recent):
${input.history}`;

const buildFollowUpPrompt = ({
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
}: RecommendFollowUpTaskInput): string => `Tu es un sales copilot B2B. Decide s'il faut creer une tache de relance HubSpot et reponds uniquement en json valide.

Schema JSON exact:
{
  "shouldCreateTask": boolean,
  "rationale": string,
  "title": string,
  "description": string,
  "dueInDays": number,
  "priority": "low" | "medium" | "high",
  "outreachDraft": {
    "channel": "email" | "sms",
    "subject": string | null,
    "body": string
  } | null
}

Regles:
- Cree une tache seulement si l'historique montre une action commerciale explicite ou fortement implicite.
- N'invente jamais une promesse, un prix, une fonctionnalite ou une contrainte absente de l'historique.
- Aujourd'hui est la date de reference absolue. Compare toutes les dates a cette date, avec l'annee.
- Un evenement date avant aujourd'hui est passe et ne doit pas etre traite comme une tache future.
- dueInDays est un entier entre 0 et 30, calcule depuis aujourd'hui.
- Si shouldCreateTask vaut false, explique brievement pourquoi.

Contexte:
- Entreprise: ${companyName ?? "inconnue"}
- Contacts: ${contactNames && contactNames.length > 0 ? contactNames.join(", ") : "inconnus"}
- Contexte entreprise:
${companyContext ?? "non disponible"}
- Deal: ${dealName ?? "inconnu"}
- Contexte deal:
${dealContext ?? "non disponible"}
- Deal stage: ${dealStage ?? "inconnu"}
- Objectif: ${objective ?? "determiner s'il faut relancer commercialement"}
- Aujourd'hui: ${today ?? new Date().toISOString()}
- Dernier contact connu: ${lastContactAt ?? "inconnu"}
- Prochaine action deja stockee: ${nextAction ?? "aucune"}

Historique:
${history}`;

const parseAnalysis = (value: string): DealHistoryAnalysis => {
  const parsed = parseJsonObject<ParsedDealHistoryAnalysis>(value, "l'analyse du deal");

  if (
    typeof parsed.summary !== "string" ||
    !isStringArray(parsed.risks) ||
    !isStringArray(parsed.nextActions) ||
    (parsed.confidence !== "low" && parsed.confidence !== "medium" && parsed.confidence !== "high")
  ) {
    throw new Error("OpenAI a renvoye un JSON invalide pour l'analyse du deal.");
  }

  return {
    summary: compactText(parsed.summary, 220),
    risks: parsed.risks.map((item) => compactText(item, 120)).slice(0, 3),
    nextActions: parsed.nextActions.map((item) => compactText(item, 120)).slice(0, 3),
    confidence: parsed.confidence,
  };
};

const parseNextSteps = (value: unknown): DealIntelligenceNextStep[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 3).map((item) => {
    const step = item as ParsedDealIntelligenceNextStep;

    if (
      typeof step.title !== "string" ||
      typeof step.rationale !== "string" ||
      !isInteger(step.dueInDays) ||
      (step.priority !== "low" && step.priority !== "medium" && step.priority !== "high") ||
      typeof step.createHubSpotTask !== "boolean"
    ) {
      throw new Error("OpenAI a renvoye une action nextStep invalide.");
    }

    return {
      title: compactText(step.title, 90),
      rationale: compactText(step.rationale, 120),
      dueInDays: clampInteger(step.dueInDays, 0, 30),
      priority: step.priority,
      createHubSpotTask: step.createHubSpotTask,
    };
  });
};

const parseDealIntelligence = (value: string): DealIntelligenceAnalysis => {
  const parsed = parseJsonObject<ParsedDealIntelligenceAnalysis>(value, "l'intelligence deal");

  if (
    typeof parsed.closeWonProbability !== "number" ||
    (parsed.dealHealth !== "strong" &&
      parsed.dealHealth !== "medium" &&
      parsed.dealHealth !== "at_risk" &&
      parsed.dealHealth !== "blocked" &&
      parsed.dealHealth !== "unknown") ||
    typeof parsed.executiveSummary !== "string" ||
    typeof parsed.whyNow !== "string" ||
    typeof parsed.suggestedMove !== "string" ||
    (parsed.confidence !== "low" && parsed.confidence !== "medium" && parsed.confidence !== "high")
  ) {
    throw new Error("OpenAI a renvoye un JSON invalide pour l'intelligence deal.");
  }

  const executiveSummary = compactText(parsed.executiveSummary, 220);
  const whyNow = compactText(parsed.whyNow, 180);
  const nextSteps = parseNextSteps(parsed.nextSteps);

  return {
    closeWonProbability: clampInteger(Math.round(parsed.closeWonProbability), 0, 100),
    dealHealth: parsed.dealHealth,
    executiveSummary,
    detailedAnalysis: parseStringList(parsed.detailedAnalysis, 2, 140)
      .filter((item) => item !== executiveSummary && item !== whyNow)
      .slice(0, 2),
    whyNow,
    suggestedMove: compactText(parsed.suggestedMove, 140),
    nextSteps: nextSteps.length > 0
      ? nextSteps
      : [
          {
            title: compactText(parsed.suggestedMove, 90),
            rationale: "Action recommandee depuis l'analyse du deal.",
            dueInDays: 1,
            priority: "medium",
            createHubSpotTask: true,
          },
        ],
    risks: parseStringList(parsed.risks, 3, 120),
    positiveSignals: parseStringList(parsed.positiveSignals, 3, 120),
    missingData: parseStringList(parsed.missingData, 3, 120),
    evidence: parseStringList(parsed.evidence, 4, 120),
    confidence: parsed.confidence,
  };
};

const parseDealFull = (value: string): DealFullAnalysis => {
  const parsed = parseJsonObject<{
    intelligence?: unknown;
    qualification?: unknown;
    activityPlan?: unknown;
  }>(value, "l'analyse complete du deal");

  if (!parsed.intelligence || !parsed.qualification || !parsed.activityPlan) {
    throw new Error("OpenAI a renvoye un JSON invalide pour l'analyse complete du deal.");
  }

  return {
    intelligence: parseDealIntelligence(JSON.stringify(parsed.intelligence)),
    qualification: parseDealQualification(JSON.stringify(parsed.qualification), "OpenAI"),
    activityPlan: parseDealActivityPlan(JSON.stringify(parsed.activityPlan), "OpenAI"),
  };
};

const parseFollowUpRecommendation = (value: string): FollowUpTaskRecommendation => {
  const parsed = parseJsonObject<ParsedFollowUpTaskRecommendation>(value, "la recommandation de relance");

  if (
    typeof parsed.shouldCreateTask !== "boolean" ||
    typeof parsed.rationale !== "string" ||
    typeof parsed.title !== "string" ||
    typeof parsed.description !== "string" ||
    !isInteger(parsed.dueInDays) ||
    (parsed.priority !== "low" && parsed.priority !== "medium" && parsed.priority !== "high")
  ) {
    throw new Error("OpenAI a renvoye un JSON invalide pour la recommandation de relance.");
  }

  let outreachDraft: FollowUpTaskRecommendation["outreachDraft"] = null;

  if (parsed.outreachDraft !== null && parsed.outreachDraft !== undefined) {
    if (typeof parsed.outreachDraft !== "object") {
      throw new Error("OpenAI a renvoye un outreachDraft invalide.");
    }

    const draft = parsed.outreachDraft as ParsedOutreachDraft;

    if (
      (draft.channel !== "email" && draft.channel !== "sms") ||
      (draft.subject !== null && draft.subject !== undefined && typeof draft.subject !== "string") ||
      typeof draft.body !== "string"
    ) {
      throw new Error("OpenAI a renvoye un outreachDraft invalide.");
    }

    outreachDraft = {
      channel: draft.channel,
      subject: draft.channel === "email" ? (typeof draft.subject === "string" ? draft.subject.trim() : null) : null,
      body: draft.body.trim(),
    };
  }

  return {
    shouldCreateTask: parsed.shouldCreateTask,
    rationale: compactText(parsed.rationale, 240),
    title: compactText(parsed.title, 90),
    description: compactText(parsed.description, 400),
    dueInDays: clampInteger(parsed.dueInDays, 0, 30),
    priority: parsed.priority,
    outreachDraft: outreachDraft?.body ? outreachDraft : null,
  };
};

export class OpenAiProvider implements LlmProvider {
  readonly providerName = "openai";
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey = env.openaiApiKey, model = env.openaiModel, baseUrl = env.openaiBaseUrl) {
    if (!apiKey) {
      throw new Error("Configuration OpenAI manquante. Renseigne OPENAI_API_KEY.");
    }

    this.apiKey = apiKey;
    this.modelName = model;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async analyzeDealHistory(input: AnalyzeDealHistoryInput): Promise<DealHistoryAnalysis> {
    return parseAnalysis(await this.completeJson(buildDealHistoryPrompt(input), 4_000));
  }

  async analyzeDealIntelligence(input: AnalyzeDealIntelligenceInput): Promise<DealIntelligenceAnalysis> {
    return parseDealIntelligence(await this.completeJson(buildDealIntelligencePrompt(input), 8_000));
  }

  async analyzeDealFull(input: AnalyzeDealActivityPlanInput): Promise<DealFullAnalysis> {
    return parseDealFull(await this.completeJson(buildDealFullPrompt(input), 12_000));
  }

  async analyzeDealQualification(input: AnalyzeDealQualificationInput): Promise<DealQualificationAnalysis> {
    return parseDealQualification(await this.completeJson(buildDealQualificationPrompt(input), 6_000), "OpenAI");
  }

  async analyzeDealActivityPlan(input: AnalyzeDealActivityPlanInput): Promise<DealActivityPlanAnalysis> {
    return parseDealActivityPlan(await this.completeJson(buildDealActivityPlanPrompt(input), 6_000), "OpenAI");
  }

  async analyzeCloseLostDeal(input: AnalyzeCloseLostDealInput): Promise<CloseLostDealAnalysis> {
    return parseCloseLostDealAnalysis(await this.completeJson(buildCloseLostDealPrompt(input), 5_000), "OpenAI");
  }

  async analyzeCloseLostPortfolio(input: AnalyzeCloseLostPortfolioInput): Promise<CloseLostPortfolioAnalysis> {
    return parseCloseLostPortfolioAnalysis(
      await this.completeJson(buildCloseLostPortfolioPrompt(input), 4_000),
      "OpenAI",
    );
  }

  async recommendFollowUpTask(input: RecommendFollowUpTaskInput): Promise<FollowUpTaskRecommendation> {
    return parseFollowUpRecommendation(await this.completeJson(buildFollowUpPrompt(input), 4_000));
  }

  private async completeJson(prompt: string, maxTokens: number): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.modelName,
        messages: [
          {
            role: "system",
            content:
              "Tu reponds uniquement en json valide, sans markdown. Tu n'inventes pas de faits absents des donnees fournies.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        response_format: {
          type: "json_object",
        },
        reasoning_effort: "minimal",
        max_completion_tokens: maxTokens,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(`OpenAI error (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as OpenAiChatResponse;
    const choice = payload.choices?.[0];
    const message = choice?.message;
    const rawContent = message?.content;
    const content =
      typeof rawContent === "string"
        ? rawContent.trim()
        : Array.isArray(rawContent)
          ? rawContent
              .map((item) => item.text ?? "")
              .join("")
              .trim()
          : "";

    if (!content) {
      const refusal = message?.refusal ? ` Refus: ${message.refusal}` : "";
      const tokenSummary = payload.usage
        ? ` Tokens: completion=${payload.usage.completion_tokens ?? "?"}, total=${payload.usage.total_tokens ?? "?"}.`
        : "";

      throw new Error(
        `OpenAI n'a renvoye aucun contenu exploitable. finish_reason=${choice?.finish_reason ?? "unknown"}.${tokenSummary}${refusal}`,
      );
    }

    return content;
  }
}
