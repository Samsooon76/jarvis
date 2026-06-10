import { env } from "../../../config/env.js";
import type {
  AnalyzeDealHistoryInput,
  AnalyzeDealActivityPlanInput,
  AnalyzeCloseLostDealInput,
  AnalyzeCloseLostPortfolioInput,
  AnalyzeCloseWonDealInput,
  AnalyzeCloseWonPortfolioInput,
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
  DealActivityPlanAnalysis,
  DealFullAnalysis,
  DealIntelligenceAnalysis,
  DealHistoryAnalysis,
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
import { buildDealActivityPlanPrompt, parseDealActivityPlan } from "../activity-plan.js";
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
import { buildManagerDigestPrompt, parseManagerDigestAnalysis } from "../manager-digest.js";
import { buildRepCoachingPrompt, parseRepCoachingAnalysis } from "../rep-coaching.js";
import { buildDealQualificationPrompt, parseDealQualification } from "../qualification.js";
import { buildLeadContactRankingPrompt, parseLeadContactRanking } from "../lead-contact-ranking.js";
import { buildTaskAnalysisPrompt, parseTaskAnalysis } from "../task-analysis.js";

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

type ParsedDealHistoryAnalysis = {
  summary?: unknown;
  risks?: unknown;
  nextActions?: unknown;
  confidence?: unknown;
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

const GEMINI_ENDPOINT = "https://aiplatform.googleapis.com/v1/publishers/google/models";

const buildPrompt = ({
  history,
  companyName,
  dealName,
  companyContext,
  dealContext,
  objective,
}: AnalyzeDealHistoryInput): string => `Analyse l'historique commercial suivant et reponds uniquement en JSON valide.

Schema JSON attendu:
{
  "summary": string,
  "risks": string[],
  "nextActions": string[],
  "confidence": "low" | "medium" | "high"
}

Contraintes:
- Resume factuel en francais.
- 3 risques maximum.
- 3 prochaines actions maximum.
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
}: RecommendFollowUpTaskInput): string => `Tu es un sales copilot B2B. Tu dois decider s'il faut creer une tache de relance HubSpot.

Reponds uniquement en JSON valide avec ce schema exact:
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
- Cree une tache seulement si l'historique montre qu'une relance commerciale explicite ou fortement implicite est necessaire.
- Exemples positifs: "reviens la semaine prochaine", "envoie la proposition", "relancer apres le salon", "pas de reponse depuis longtemps", "attend le pricing", "reprendre contact".
- Un deal closedwon ou closedlost n'interdit pas a lui seul une tache: onboarding, upsell, win-back, renouvellement ou relance differée peuvent rester pertinents si l'historique le justifie.
- Exemples negatifs: prospect demande explicitement de ne pas etre relance, pas de prochain pas commercial, suivi deja planifie tres clairement et recent, historique insuffisant.
- N'interprete jamais une date technique comme "date d'ouverture du deal" ou "dernier contact" sauf si le champ ou l'historique l'indique explicitement.
- Calcule dueInDays par rapport a la date du jour fournie ci-dessous, pas par rapport a la date du dernier evenement.
- Le titre doit etre court, actionnable, en francais, sans prefixe inutile.
- La description doit rappeler le contexte utile et l'action attendue, sans inventer de faits.
- dueInDays doit etre un entier entre 0 et 30.
- Si un email de follow-up, une proposition, un devis, un pricing ou une relance post-demo aurait deja du etre envoye et n'apparait pas comme fait dans l'historique recent, dueInDays doit valoir 0.
- Si le dernier contact commercial date deja de plusieurs jours et qu'aucune prochaine action executee n'apparait depuis, privilegie 0 ou 1 jour, pas 7, 10 ou 14 jours.
- priority = high seulement s'il y a urgence commerciale claire.
- Si shouldCreateTask vaut false, renseigne quand meme rationale, et mets un titre bref + une description courte expliquant pourquoi aucune tache n'est creee.
- outreachDraft est optionnel et doit rester null sauf si tu peux rediger un message simple, court, factuel et non risque a partir de l'historique.
- Genere un draft seulement pour un follow-up commercial standard, une relance simple, un recap bref ou une demande d'information peu sensible.
- Ne genere jamais de draft si la demande est technique, contractuelle, juridique, pricing complexe, multi-pays, negociable, sensible, ou si des informations manquent.
- Si channel = "email", renseigne un subject court. Si channel = "sms", subject doit valoir null.
- Le draft ne doit rien inventer et ne doit pas promettre un prix, un engagement, un SLA ou une fonctionnalite non visible dans l'historique.
- Si tu hesites, mets outreachDraft a null.

Contexte:
- Entreprise: ${companyName ?? "inconnue"}
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
- Contacts: ${contactNames && contactNames.length > 0 ? contactNames.join(", ") : "inconnus"}

Historique:
${history}`;

const extractText = (response: GeminiGenerateContentResponse): string => {
  const text = response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();

  if (!text) {
    throw new Error("Vertex AI n'a renvoye aucun contenu exploitable.");
  }

  return text;
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

const normalizeJsonResponse = (value: string): string => {
  const trimmedValue = value.trim();
  const withoutCodeFence = trimmedValue.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  if ((withoutCodeFence.startsWith("{") && withoutCodeFence.endsWith("}")) || withoutCodeFence === "null") {
    return withoutCodeFence;
  }

  const firstBraceIndex = withoutCodeFence.indexOf("{");
  const lastBraceIndex = withoutCodeFence.lastIndexOf("}");

  if (firstBraceIndex >= 0 && lastBraceIndex > firstBraceIndex) {
    return withoutCodeFence.slice(firstBraceIndex, lastBraceIndex + 1);
  }

  return withoutCodeFence;
};

const buildParseErrorSnippet = (value: string): string => normalizeJsonResponse(value).slice(0, 240);

const parseAnalysis = (value: string): DealHistoryAnalysis => {
  let parsed: ParsedDealHistoryAnalysis;

  try {
    parsed = JSON.parse(normalizeJsonResponse(value)) as ParsedDealHistoryAnalysis;
  } catch {
    throw new Error(`Vertex AI n'a pas renvoye un JSON valide. Extrait: ${buildParseErrorSnippet(value)}`);
  }

  if (
    typeof parsed.summary !== "string" ||
    !isStringArray(parsed.risks) ||
    !isStringArray(parsed.nextActions) ||
    (parsed.confidence !== "low" && parsed.confidence !== "medium" && parsed.confidence !== "high")
  ) {
    throw new Error("Vertex AI a renvoye un JSON invalide par rapport au schema attendu.");
  }

  return {
    summary: parsed.summary,
    risks: parsed.risks.slice(0, 3),
    nextActions: parsed.nextActions.slice(0, 3),
    confidence: parsed.confidence,
  };
};

const parseFollowUpRecommendation = (value: string): FollowUpTaskRecommendation => {
  let parsed: ParsedFollowUpTaskRecommendation;

  try {
    parsed = JSON.parse(normalizeJsonResponse(value)) as ParsedFollowUpTaskRecommendation;
  } catch {
    throw new Error(
      `Vertex AI n'a pas renvoye un JSON valide pour la recommandation de relance. Extrait: ${buildParseErrorSnippet(value)}`,
    );
  }

  if (
    typeof parsed.shouldCreateTask !== "boolean" ||
    typeof parsed.rationale !== "string" ||
    typeof parsed.title !== "string" ||
    typeof parsed.description !== "string" ||
    !isInteger(parsed.dueInDays) ||
    (parsed.priority !== "low" && parsed.priority !== "medium" && parsed.priority !== "high")
  ) {
    throw new Error("Vertex AI a renvoye un JSON invalide pour la recommandation de relance.");
  }

  let outreachDraft: FollowUpTaskRecommendation["outreachDraft"] = null;

  if (parsed.outreachDraft !== null && parsed.outreachDraft !== undefined) {
    if (typeof parsed.outreachDraft !== "object") {
      throw new Error("Vertex AI a renvoye un outreachDraft invalide pour la recommandation de relance.");
    }

    const draft = parsed.outreachDraft as ParsedOutreachDraft;

    if (
      (draft.channel !== "email" && draft.channel !== "sms") ||
      (draft.subject !== null && draft.subject !== undefined && typeof draft.subject !== "string") ||
      typeof draft.body !== "string"
    ) {
      throw new Error("Vertex AI a renvoye un outreachDraft invalide pour la recommandation de relance.");
    }

    outreachDraft = {
      channel: draft.channel,
      subject: draft.channel === "email" ? (typeof draft.subject === "string" ? draft.subject.trim() : null) : null,
      body: draft.body.trim(),
    };

    if (!outreachDraft.body) {
      outreachDraft = null;
    }
  }

  return {
    shouldCreateTask: parsed.shouldCreateTask,
    rationale: parsed.rationale.trim(),
    title: parsed.title.trim(),
    description: parsed.description.trim(),
    dueInDays: Math.max(0, Math.min(30, parsed.dueInDays)),
    priority: parsed.priority,
    outreachDraft,
  };
};

export class VertexGeminiProvider implements LlmProvider {
  readonly providerName = "vertex-gemini";
  private readonly apiKey: string;
  readonly modelName: string;

  constructor(apiKey = env.vertexAiApiKey, model = env.vertexAiModel) {
    if (!apiKey) {
      throw new Error("Configuration LLM manquante. Renseigne VERTEX_AI_API_KEY.");
    }

    this.apiKey = apiKey;
    this.modelName = model;
  }

  async analyzeDealHistory(input: AnalyzeDealHistoryInput): Promise<DealHistoryAnalysis> {
    const response = await fetch(`${GEMINI_ENDPOINT}/${this.modelName}:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildPrompt(input),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(`Vertex AI error (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;

    return parseAnalysis(extractText(payload));
  }

  async analyzeDealIntelligence(input: AnalyzeDealIntelligenceInput): Promise<DealIntelligenceAnalysis> {
    const basicAnalysis = await this.analyzeDealHistory(input);

    return {
      closeWonProbability: Math.max(0, Math.min(100, input.currentCloseProbability ?? 0)),
      dealHealth: basicAnalysis.confidence === "low" ? "unknown" : "medium",
      executiveSummary: basicAnalysis.summary,
      detailedAnalysis: [basicAnalysis.summary],
      whyNow: basicAnalysis.summary,
      suggestedMove: basicAnalysis.nextActions[0] ?? "Verifier le prochain pas commercial dans HubSpot.",
      nextSteps: basicAnalysis.nextActions.map((action) => ({
        title: action,
        rationale: "Action recommandee depuis l'analyse de l'historique HubSpot.",
        dueInDays: 1,
        priority: "medium",
        createHubSpotTask: true,
      })),
      risks: basicAnalysis.risks,
      positiveSignals: [],
      missingData: [],
      evidence: [],
      confidence: basicAnalysis.confidence,
    };
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
    const response = await fetch(`${GEMINI_ENDPOINT}/${this.modelName}:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildDealQualificationPrompt(input),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(`Vertex AI error (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;

    return parseDealQualification(extractText(payload), "Vertex AI");
  }

  async analyzeDealActivityPlan(input: AnalyzeDealActivityPlanInput): Promise<DealActivityPlanAnalysis> {
    const response = await fetch(`${GEMINI_ENDPOINT}/${this.modelName}:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildDealActivityPlanPrompt(input),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(`Vertex AI error (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;

    return parseDealActivityPlan(extractText(payload), "Vertex AI");
  }

  async analyzeCloseLostDeal(input: AnalyzeCloseLostDealInput): Promise<CloseLostDealAnalysis> {
    const response = await fetch(`${GEMINI_ENDPOINT}/${this.modelName}:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildCloseLostDealPrompt(input),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(`Vertex AI error (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;

    return parseCloseLostDealAnalysis(extractText(payload), "Vertex AI");
  }

  async analyzeCloseLostPortfolio(input: AnalyzeCloseLostPortfolioInput): Promise<CloseLostPortfolioAnalysis> {
    const response = await fetch(`${GEMINI_ENDPOINT}/${this.modelName}:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildCloseLostPortfolioPrompt(input),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(`Vertex AI error (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;

    return parseCloseLostPortfolioAnalysis(extractText(payload), "Vertex AI");
  }

  async analyzeCloseWonDeal(input: AnalyzeCloseWonDealInput): Promise<CloseWonDealAnalysis> {
    const response = await fetch(`${GEMINI_ENDPOINT}/${this.modelName}:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildCloseWonDealPrompt(input),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(`Vertex AI error (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;

    return parseCloseWonDealAnalysis(extractText(payload), "Vertex AI");
  }

  async analyzeCloseWonPortfolio(input: AnalyzeCloseWonPortfolioInput): Promise<CloseWonPortfolioAnalysis> {
    const response = await fetch(`${GEMINI_ENDPOINT}/${this.modelName}:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildCloseWonPortfolioPrompt(input),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(`Vertex AI error (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;

    return parseCloseWonPortfolioAnalysis(extractText(payload), "Vertex AI");
  }

  async analyzeForecastSynthesis(input: AnalyzeForecastSynthesisInput): Promise<ForecastSynthesisAnalysis> {
    const response = await fetch(`${GEMINI_ENDPOINT}/${this.modelName}:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildForecastSynthesisPrompt(input),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(`Vertex AI error (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;

    return parseForecastSynthesisAnalysis(extractText(payload), input.knownDealIds, "Vertex AI");
  }

  async analyzeManagerDigest(input: AnalyzeManagerDigestInput): Promise<ManagerDigestAnalysis> {
    const response = await fetch(`${GEMINI_ENDPOINT}/${this.modelName}:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildManagerDigestPrompt(input),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(`Vertex AI error (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;

    return parseManagerDigestAnalysis(extractText(payload), input.knownDealIds, "Vertex AI");
  }

  async analyzeRepCoaching(input: AnalyzeRepCoachingInput): Promise<RepCoachingAnalysis> {
    const response = await fetch(`${GEMINI_ENDPOINT}/${this.modelName}:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildRepCoachingPrompt(input),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(`Vertex AI error (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;

    return parseRepCoachingAnalysis(extractText(payload), "Vertex AI");
  }

  async recommendFollowUpTask(input: RecommendFollowUpTaskInput): Promise<FollowUpTaskRecommendation> {
    const response = await fetch(`${GEMINI_ENDPOINT}/${this.modelName}:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildFollowUpPrompt(input),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(`Vertex AI error (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;

    return parseFollowUpRecommendation(extractText(payload));
  }

  async analyzeTask(input: AnalyzeTaskInput): Promise<TaskAnalysis> {
    const response = await fetch(`${GEMINI_ENDPOINT}/${this.modelName}:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildTaskAnalysisPrompt(input),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(`Vertex AI error (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;

    return parseTaskAnalysis(extractText(payload), "Vertex AI");
  }

  async rankLeadContacts(input: RankLeadContactsInput): Promise<LeadContactRankingAnalysis> {
    const response = await fetch(`${GEMINI_ENDPOINT}/${this.modelName}:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildLeadContactRankingPrompt(input),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(`Vertex AI error (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;

    return parseLeadContactRanking(extractText(payload), "Vertex AI");
  }
}
