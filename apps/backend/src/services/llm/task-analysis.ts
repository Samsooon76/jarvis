import { compactText } from "../../lib/text.js";
import type { AnalyzeTaskInput, TaskAnalysis, TaskAnalysisRecommendation, TaskAnalysisType } from "./llm.provider.js";

type ParsedTaskAnalysis = {
  taskType?: unknown;
  recommendation?: unknown;
  priority?: unknown;
  shouldReschedule?: unknown;
  suggestedDueInDays?: unknown;
  suggestedAction?: unknown;
  rationale?: unknown;
  outreachAngle?: unknown;
  evidence?: unknown;
  missingData?: unknown;
  confidence?: unknown;
};

const TASK_TYPES = new Set<TaskAnalysisType>([
  "cold_call",
  "deal_follow_up",
  "post_meeting_follow_up",
  "no_show_recovery",
  "admin_crm",
  "renewal_or_upsell",
  "obsolete",
  "unknown",
]);

const RECOMMENDATIONS = new Set<TaskAnalysisRecommendation>([
  "do_now",
  "reschedule",
  "keep_planned",
  "skip",
  "merge",
  "clarify",
]);

const clampInteger = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

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

const parseStringList = (value: unknown, maxItems: number, maxLength: number): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => compactText(item, maxLength))
    .slice(0, maxItems);
};

export const buildTaskAnalysisPrompt = ({
  taskTitle,
  taskBody,
  taskStatus,
  taskPriority,
  taskType,
  dueAt,
  createdAt,
  today,
  contactName,
  contactEmail,
  companyName,
  dealName,
  dealStage,
  dealAmount,
  closeProbability,
  lastContactAt,
  nextAction,
  history,
  winBenchmarkSummary,
}: AnalyzeTaskInput): string => `Tu es Jarvis, un sales copilot B2B. Analyse cette tache CRM et reponds uniquement en JSON valide.

Schema JSON exact:
{
  "taskType": "cold_call" | "deal_follow_up" | "post_meeting_follow_up" | "no_show_recovery" | "admin_crm" | "renewal_or_upsell" | "obsolete" | "unknown",
  "recommendation": "do_now" | "reschedule" | "keep_planned" | "skip" | "merge" | "clarify",
  "priority": "low" | "medium" | "high",
  "shouldReschedule": boolean,
  "suggestedDueInDays": number | null,
  "suggestedAction": string,
  "rationale": string,
  "outreachAngle": string | null,
  "evidence": string[],
  "missingData": string[],
  "confidence": "low" | "medium" | "high"
}

Regles:
- Classifie la tache selon le contexte reel: cold_call si aucun contact commercial n'est visible; deal_follow_up si un deal actif est lie; post_meeting_follow_up apres meeting/demo; no_show_recovery apres rendez-vous manque; admin_crm si c'est surtout hygiene CRM; obsolete si la tache n'a plus de valeur.
- Aujourd'hui est la date de reference absolue. Compare dueAt a aujourd'hui avec l'annee.
- Si dueAt est passe et que la tache reste pertinente, recommande do_now ou reschedule.
- suggestedDueInDays est null sauf si shouldReschedule vaut true. Si present, entier 0-30 depuis aujourd'hui.
- Ne propose pas de supprimer une tache liee a un deal actif sans preuve qu'elle est obsolete ou dupliquee.
- N'invente pas de contact, promesse, prix, contrainte ou interaction absente du contexte.
- suggestedAction: une action concrete pour le sales, 160 caracteres maximum.
- rationale: pourquoi, 220 caracteres maximum.
- outreachAngle: angle court de prise de contact, ou null si non pertinent.
- evidence: 1 a 4 faits observes, 120 caracteres maximum chacun.
- missingData: 0 a 3 informations qui manquent.
- Tout le contenu est en francais, concis et actionnable.

Tache:
- Titre: ${taskTitle}
- Description: ${taskBody ?? "non disponible"}
- Statut HubSpot: ${taskStatus ?? "inconnu"}
- Priorite HubSpot: ${taskPriority ?? "inconnue"}
- Type HubSpot: ${taskType ?? "inconnu"}
- Echeance: ${dueAt ?? "non renseignee"}
- Creee le: ${createdAt ?? "inconnu"}

Contexte:
- Aujourd'hui: ${today ?? new Date().toISOString()}
- Contact: ${contactName ?? "inconnu"}
- Email contact: ${contactEmail ?? "inconnu"}
- Societe: ${companyName ?? "inconnue"}
- Deal: ${dealName ?? "inconnu"}
- Stage deal: ${dealStage ?? "inconnu"}
- Montant deal: ${dealAmount ?? "inconnu"}
- Probabilite close: ${closeProbability ?? "inconnue"}
- Dernier contact connu: ${lastContactAt ?? "inconnu"}
- Prochaine action Jarvis: ${nextAction ?? "aucune"}
${winBenchmarkSummary ? `\nBenchmark des deals gagnes (pour situer ce deal vs le pattern gagnant):\n${winBenchmarkSummary}\n` : ""}
Historique commercial utile:
${history?.trim() || "non disponible"}`;

export const parseTaskAnalysis = (value: string, providerLabel: string): TaskAnalysis => {
  let parsed: ParsedTaskAnalysis;

  try {
    parsed = JSON.parse(normalizeJsonResponse(value)) as ParsedTaskAnalysis;
  } catch {
    throw new Error(`${providerLabel} n'a pas renvoye un JSON valide pour l'analyse de tache. Extrait: ${value.slice(0, 240)}`);
  }

  if (
    typeof parsed.taskType !== "string" ||
    !TASK_TYPES.has(parsed.taskType as TaskAnalysisType) ||
    typeof parsed.recommendation !== "string" ||
    !RECOMMENDATIONS.has(parsed.recommendation as TaskAnalysisRecommendation) ||
    (parsed.priority !== "low" && parsed.priority !== "medium" && parsed.priority !== "high") ||
    typeof parsed.shouldReschedule !== "boolean" ||
    typeof parsed.suggestedAction !== "string" ||
    typeof parsed.rationale !== "string" ||
    (parsed.outreachAngle !== null && parsed.outreachAngle !== undefined && typeof parsed.outreachAngle !== "string") ||
    (parsed.confidence !== "low" && parsed.confidence !== "medium" && parsed.confidence !== "high")
  ) {
    throw new Error(`${providerLabel} a renvoye un JSON invalide pour l'analyse de tache.`);
  }

  let suggestedDueInDays: number | null = null;

  if (parsed.suggestedDueInDays !== null && parsed.suggestedDueInDays !== undefined) {
    if (typeof parsed.suggestedDueInDays !== "number" || !Number.isInteger(parsed.suggestedDueInDays)) {
      throw new Error(`${providerLabel} a renvoye une suggestedDueInDays invalide.`);
    }

    suggestedDueInDays = clampInteger(parsed.suggestedDueInDays, 0, 30);
  }

  return {
    taskType: parsed.taskType as TaskAnalysisType,
    recommendation: parsed.recommendation as TaskAnalysisRecommendation,
    priority: parsed.priority,
    shouldReschedule: parsed.shouldReschedule,
    suggestedDueInDays: parsed.shouldReschedule ? suggestedDueInDays ?? 1 : null,
    suggestedAction: compactText(parsed.suggestedAction, 160),
    rationale: compactText(parsed.rationale, 220),
    outreachAngle: typeof parsed.outreachAngle === "string" && parsed.outreachAngle.trim()
      ? compactText(parsed.outreachAngle, 160)
      : null,
    evidence: parseStringList(parsed.evidence, 4, 120),
    missingData: parseStringList(parsed.missingData, 3, 120),
    confidence: parsed.confidence,
  };
};
