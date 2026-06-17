import { compactText, normalizeText } from "../../../lib/text.js";
import { env } from "../../../config/env.js";
import type {
  AnalyzeDealHistoryInput,
  AnalyzeDealActivityPlanInput,
  AnalyzeCloseLostDealInput,
  AnalyzeCloseLostPortfolioInput,
  AnalyzeCloseWonDealInput,
  AnalyzeCloseWonPortfolioInput,
  AnalyzePlaybookBootstrapInput,
  AnalyzePlaybookOverviewInput,
  AnalyzeDealAnalysisV1Input,
  AnalyzeDealIntelligenceInput,
  AnalyzeDealQualificationInput,
  AnalyzeForecastSynthesisInput,
  AnalyzeManagerDigestInput,
  AnalyzeRepCoachingInput,
  AnalyzeTaskInput,
  CloseLostDealAnalysis,
  CloseLostPortfolioAnalysis,
  CloseWonDealAnalysis,
  CloseWonPortfolioAnalysis,
  PlaybookBootstrapAnalysis,
  PlaybookOverviewAnalysis,
  DealActivityPlanAnalysis,
  DealFullAnalysis,
  DealHistoryAnalysis,
  DealIntelligenceAnalysis,
  DealIntelligenceNextStep,
  DealQualificationAnalysis,
  ForecastSynthesisAnalysis,
  FollowUpTaskRecommendation,
  LeadContactRankingAnalysis,
  LlmProvider,
  ManagerDigestAnalysis,
  RankLeadContactsInput,
  RepCoachingAnalysis,
  RecommendFollowUpTaskInput,
  TaskAnalysis,
} from "../llm.provider.js";
import { buildLeadContactRankingPrompt, parseLeadContactRanking } from "../lead-contact-ranking.js";
import { buildDealActivityPlanPrompt, parseDealActivityPlan } from "../activity-plan.js";
import {
  buildDealAnalysisV1Enrichment,
  buildDealAnalysisV1UserPrompt,
  parseDealAnalysisV1,
} from "../deal-analysis-v1.js";
import {
  buildCloseLostDealPrompt,
  buildCloseLostPortfolioPrompt,
  parseCloseLostDealAnalysis,
  parseCloseLostPortfolioAnalysis,
} from "../close-lost.js";
import { buildForecastSynthesisPrompt, parseForecastSynthesisAnalysis } from "../forecast-synthesis.js";
import {
  buildCloseWonDealPrompt,
  buildCloseWonPortfolioPrompt,
  parseCloseWonDealAnalysis,
  parseCloseWonPortfolioAnalysis,
} from "../close-won.js";
import { buildPlaybookBootstrapPrompt, parsePlaybookBootstrapAnalysis } from "../playbook-bootstrap.js";
import { buildPlaybookOverviewPrompt, parsePlaybookOverviewAnalysis } from "../playbook-overview.js";
import { buildManagerDigestPrompt, parseManagerDigestAnalysis } from "../manager-digest.js";
import { buildRepCoachingPrompt, parseRepCoachingAnalysis } from "../rep-coaching.js";
import { buildDealQualificationPrompt, parseDealQualification } from "../qualification.js";
import { buildTaskAnalysisPrompt, parseTaskAnalysis } from "../task-analysis.js";

type DeepSeekChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
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
    throw new Error(`DeepSeek n'a pas renvoye un JSON valide pour ${label}. Extrait: ${value.slice(0, 240)}`);
  }
};

const clampInteger = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

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
- Sois factuel, concret, en francais.
- Utilise uniquement les informations visibles dans l'historique et le contexte.
- Si une information manque, signale l'incertitude au lieu d'inventer.
- 3 risques maximum et 3 prochaines actions maximum.

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

Regles d'analyse:
- L'historique est trie du plus ancien au plus recent. Analyse d'abord la trajectoire chronologique, puis donne plus de poids aux evenements les plus recents.
- closeWonProbability est un entier 0-100: estime la probabilite commerciale de signature a partir du stage, du close date, des signaux recents, des prochaines etapes, des blocages et de la probabilite HubSpot existante.
- Ne donne pas un score extreme (<10 ou >90) sans preuves explicites dans l'historique recent. Un score <10 exige un blocage majeur, une perte explicite, un silence long ou un refus clair.
- Si le deal est en phase de signature, POC valide, devis/proposition acceptee, validation finale ou next step daté tres proche, le score doit rester eleve sauf blocage explicite plus recent.
- Un risque RGPD, legal, technique ou integration baisse le score seulement s'il bloque explicitement la signature; sinon traite-le comme risque a suivre.
- Si des signaux se contredisent, explique l'arbitrage dans evidence et whyNow en citant les faits les plus recents.
- Ne confonds pas probabilite HubSpot, montant, date technique et signal commercial; la probabilite HubSpot est un input, pas une verite absolue.
- executiveSummary: 2-4 phrases completes, sans troncature.
- detailedAnalysis: 2 bullets maximum, phrases completes, sans repeter executiveSummary.
- whyNow: 1-2 phrases completes, raison concrete d'agir maintenant.
- suggestedMove: 1-3 phrases imperatives completes, actionnable et sans troncature.
- nextSteps contient 1 a 3 actions maximum, avec dueInDays entre 0 et 30.
- Chaque nextStep.title reste court; rationale doit etre une phrase complete sans troncature.
- createHubSpotTask vaut true seulement pour une action claire qu'un sales peut executer.
- evidence cite 2 a 4 faits observes, 120 caracteres maximum chacun, sans inventer de verbatim.
- missingData liste 3 informations maximum qui empechent une meilleure decision.
- Aujourd'hui est la date de reference absolue. Compare toutes les dates a cette date, avec l'annee.
- Un evenement date avant aujourd'hui est passe: ne le presente jamais comme prochain pas ou prochaine echeance.
- Calcule dueInDays depuis aujourd'hui, pas depuis la date du dernier evenement.
- Si l'historique est pauvre, reduis confidence et garde les recommandations prudentes.
- Le contenu doit etre en francais, tres concis, non repetitif et directement utilisable.

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
- dueInDays est un entier entre 0 et 30, calcule depuis aujourd'hui.
- Aujourd'hui est la date de reference absolue. Compare toutes les dates a cette date, avec l'annee.
- Un evenement date avant aujourd'hui est passe et ne doit pas etre traite comme une tache future.
- Si une relance parait deja en retard, dueInDays doit valoir 0 ou 1.
- Si shouldCreateTask vaut false, explique brievement pourquoi.
- outreachDraft reste null si le contexte est sensible, incomplet, contractuel, technique ou pricing complexe.

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
    throw new Error("DeepSeek a renvoye un JSON invalide pour l'analyse du deal.");
  }

  return {
    summary: parsed.summary.trim(),
    risks: parsed.risks.slice(0, 3),
    nextActions: parsed.nextActions.slice(0, 3),
    confidence: parsed.confidence,
  };
};

const parseNextSteps = (value: unknown): DealIntelligenceNextStep[] => {
  if (!Array.isArray(value)) {
    throw new Error("DeepSeek a renvoye des nextSteps invalides.");
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
      throw new Error("DeepSeek a renvoye une action nextStep invalide.");
    }

    return {
      title: compactText(step.title, 120),
      rationale: normalizeText(step.rationale),
      dueInDays: clampInteger(step.dueInDays, 0, 30),
      priority: step.priority,
      createHubSpotTask: step.createHubSpotTask,
    };
  });
};

const parseDealIntelligence = (value: string): DealIntelligenceAnalysis => {
  const parsed = parseJsonObject<ParsedDealIntelligenceAnalysis>(value, "l'intelligence deal");

  if (
    !isInteger(parsed.closeWonProbability) ||
    (parsed.dealHealth !== "strong" &&
      parsed.dealHealth !== "medium" &&
      parsed.dealHealth !== "at_risk" &&
      parsed.dealHealth !== "blocked" &&
      parsed.dealHealth !== "unknown") ||
    typeof parsed.executiveSummary !== "string" ||
    !isStringArray(parsed.detailedAnalysis) ||
    typeof parsed.whyNow !== "string" ||
    typeof parsed.suggestedMove !== "string" ||
    !isStringArray(parsed.risks) ||
    !isStringArray(parsed.positiveSignals) ||
    !isStringArray(parsed.missingData) ||
    !isStringArray(parsed.evidence) ||
    (parsed.confidence !== "low" && parsed.confidence !== "medium" && parsed.confidence !== "high")
  ) {
    throw new Error("DeepSeek a renvoye un JSON invalide pour l'intelligence deal.");
  }

  const executiveSummary = normalizeText(parsed.executiveSummary);
  const whyNow = normalizeText(parsed.whyNow);
  const detailedAnalysis = parsed.detailedAnalysis
    .map((item) => normalizeText(item))
    .filter((item) => item !== executiveSummary && item !== whyNow)
    .slice(0, 2);

  return {
    closeWonProbability: clampInteger(parsed.closeWonProbability, 0, 100),
    dealHealth: parsed.dealHealth,
    executiveSummary,
    detailedAnalysis,
    whyNow,
    suggestedMove: normalizeText(parsed.suggestedMove),
    nextSteps: parseNextSteps(parsed.nextSteps),
    risks: parsed.risks.map((item) => normalizeText(item)).slice(0, 3),
    positiveSignals: parsed.positiveSignals.map((item) => normalizeText(item)).slice(0, 3),
    missingData: parsed.missingData.map((item) => normalizeText(item)).slice(0, 3),
    evidence: parsed.evidence.map((item) => normalizeText(item)).slice(0, 4),
    confidence: parsed.confidence,
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
    throw new Error("DeepSeek a renvoye un JSON invalide pour la recommandation de relance.");
  }

  let outreachDraft: FollowUpTaskRecommendation["outreachDraft"] = null;

  if (parsed.outreachDraft !== null && parsed.outreachDraft !== undefined) {
    if (typeof parsed.outreachDraft !== "object") {
      throw new Error("DeepSeek a renvoye un outreachDraft invalide.");
    }

    const draft = parsed.outreachDraft as ParsedOutreachDraft;

    if (
      (draft.channel !== "email" && draft.channel !== "sms") ||
      (draft.subject !== null && draft.subject !== undefined && typeof draft.subject !== "string") ||
      typeof draft.body !== "string"
    ) {
      throw new Error("DeepSeek a renvoye un outreachDraft invalide.");
    }

    outreachDraft = {
      channel: draft.channel,
      subject: draft.channel === "email" ? (typeof draft.subject === "string" ? draft.subject.trim() : null) : null,
      body: draft.body.trim(),
    };
  }

  return {
    shouldCreateTask: parsed.shouldCreateTask,
    rationale: parsed.rationale.trim(),
    title: parsed.title.trim(),
    description: parsed.description.trim(),
    dueInDays: clampInteger(parsed.dueInDays, 0, 30),
    priority: parsed.priority,
    outreachDraft: outreachDraft?.body ? outreachDraft : null,
  };
};

export class DeepSeekProvider implements LlmProvider {
  readonly providerName = "deepseek";
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey = env.deepseekApiKey, model = env.deepseekModel, baseUrl = env.deepseekBaseUrl) {
    if (!apiKey) {
      throw new Error("Configuration LLM manquante. Renseigne DEEPSEEK_API_KEY.");
    }

    this.apiKey = apiKey;
    this.modelName = model;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async analyzeDealHistory(input: AnalyzeDealHistoryInput): Promise<DealHistoryAnalysis> {
    return parseAnalysis(await this.completeJson(buildDealHistoryPrompt(input), 1_500));
  }

  async analyzeDealIntelligence(input: AnalyzeDealIntelligenceInput): Promise<DealIntelligenceAnalysis> {
    return parseDealIntelligence(await this.completeJson(buildDealIntelligencePrompt(input), 2_800));
  }

  async analyzeDealFull(input: AnalyzeDealActivityPlanInput): Promise<DealFullAnalysis> {
    const [intelligence, qualification, activityPlan] = await Promise.all([
      this.analyzeDealIntelligence(input),
      this.analyzeDealQualification(input),
      this.analyzeDealActivityPlan(input),
    ]);

    return {
      intelligence,
      qualification,
      activityPlan,
    };
  }

  async analyzeDealQualification(input: AnalyzeDealQualificationInput): Promise<DealQualificationAnalysis> {
    return parseDealQualification(await this.completeJson(buildDealQualificationPrompt(input), 3_800), "DeepSeek");
  }

  async analyzeDealActivityPlan(input: AnalyzeDealActivityPlanInput): Promise<DealActivityPlanAnalysis> {
    return parseDealActivityPlan(await this.completeJson(buildDealActivityPlanPrompt(input), 3_800), "DeepSeek");
  }

  async analyzeDealAnalysisV1(input: AnalyzeDealAnalysisV1Input) {
    const generatedAt = new Date().toISOString();

    return parseDealAnalysisV1(
      await this.completeJson(buildDealAnalysisV1UserPrompt(input), 8_000),
      "DeepSeek",
      input,
      buildDealAnalysisV1Enrichment(input, this.providerName, this.modelName, generatedAt),
    );
  }

  async analyzeCloseLostDeal(input: AnalyzeCloseLostDealInput): Promise<CloseLostDealAnalysis> {
    return parseCloseLostDealAnalysis(
      await this.completeJson(buildCloseLostDealPrompt(input), 3_800),
      "DeepSeek",
      input.sourceActivities,
    );
  }

  async analyzeCloseLostPortfolio(input: AnalyzeCloseLostPortfolioInput): Promise<CloseLostPortfolioAnalysis> {
    return parseCloseLostPortfolioAnalysis(
      await this.completeJson(buildCloseLostPortfolioPrompt(input), 2_800),
      "DeepSeek",
    );
  }

  async analyzeCloseWonDeal(input: AnalyzeCloseWonDealInput): Promise<CloseWonDealAnalysis> {
    return parseCloseWonDealAnalysis(await this.completeJson(buildCloseWonDealPrompt(input), 3_800), "DeepSeek");
  }

  async analyzeCloseWonPortfolio(input: AnalyzeCloseWonPortfolioInput): Promise<CloseWonPortfolioAnalysis> {
    return parseCloseWonPortfolioAnalysis(await this.completeJson(buildCloseWonPortfolioPrompt(input), 2_800), "DeepSeek");
  }

  async generatePlaybookBootstrap(input: AnalyzePlaybookBootstrapInput): Promise<PlaybookBootstrapAnalysis> {
    return parsePlaybookBootstrapAnalysis(
      await this.completeJson(buildPlaybookBootstrapPrompt(input), 6_000),
      "DeepSeek",
      input.knownDealIds,
    );
  }

  async synthesizePlaybookOverview(input: AnalyzePlaybookOverviewInput): Promise<PlaybookOverviewAnalysis> {
    return parsePlaybookOverviewAnalysis(
      await this.completeJson(buildPlaybookOverviewPrompt(input), 4_000),
      "DeepSeek",
      input.knownPlayIds,
    );
  }

  async analyzeForecastSynthesis(input: AnalyzeForecastSynthesisInput): Promise<ForecastSynthesisAnalysis> {
    return parseForecastSynthesisAnalysis(
      await this.completeJson(buildForecastSynthesisPrompt(input), 3_500),
      input.knownDealIds,
      "DeepSeek",
    );
  }

  async analyzeManagerDigest(input: AnalyzeManagerDigestInput): Promise<ManagerDigestAnalysis> {
    return parseManagerDigestAnalysis(
      await this.completeJson(buildManagerDigestPrompt(input), 2_800),
      input.knownDealIds,
      "DeepSeek",
    );
  }

  async analyzeRepCoaching(input: AnalyzeRepCoachingInput): Promise<RepCoachingAnalysis> {
    return parseRepCoachingAnalysis(await this.completeJson(buildRepCoachingPrompt(input), 2_800), "DeepSeek");
  }

  async recommendFollowUpTask(input: RecommendFollowUpTaskInput): Promise<FollowUpTaskRecommendation> {
    return parseFollowUpRecommendation(await this.completeJson(buildFollowUpPrompt(input), 1_800));
  }

  async analyzeTask(input: AnalyzeTaskInput): Promise<TaskAnalysis> {
    return parseTaskAnalysis(await this.completeJson(buildTaskAnalysisPrompt(input), 1_800), "DeepSeek");
  }

  async rankLeadContacts(input: RankLeadContactsInput): Promise<LeadContactRankingAnalysis> {
    return parseLeadContactRanking(await this.completeJson(buildLeadContactRankingPrompt(input), 1_500), "DeepSeek");
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
        temperature: 0.1,
        max_tokens: maxTokens,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(`DeepSeek error (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as DeepSeekChatResponse;
    const content = payload.choices?.[0]?.message?.content?.trim();

    if (!content) {
      throw new Error("DeepSeek n'a renvoye aucun contenu exploitable.");
    }

    return content;
  }
}
