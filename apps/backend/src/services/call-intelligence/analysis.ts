import { createHash } from "node:crypto";
import type { CallAiActionItem, CallAiAnalysis, CallSource } from "./types.js";

const POSITIVE_PATTERNS = [
  "interesse",
  "intéresse",
  "budget valide",
  "go",
  "ok",
  "demo",
  "démo",
  "prochaine etape",
  "prochaine étape",
  "decision",
  "décision",
  "accord",
];

const NEGATIVE_PATTERNS = [
  "trop cher",
  "pas le budget",
  "concurrent",
  "pas interesse",
  "pas intéressé",
  "reporter",
  "plus tard",
  "bloque",
  "bloqué",
  "annule",
  "annulé",
  "pas prioritaire",
];

const OBJECTION_PATTERNS: Array<{ label: string; patterns: string[] }> = [
  { label: "Budget ou prix a clarifier", patterns: ["budget", "prix", "cher", "cout", "coût"] },
  { label: "Timing ou priorite incertaine", patterns: ["plus tard", "timing", "prioritaire", "reporter", "trimestre"] },
  { label: "Concurrence mentionnee", patterns: ["concurrent", "alternative", "deja equipe", "déjà équipé"] },
  { label: "Decisionnaire absent ou a confirmer", patterns: ["decisionnaire", "décisionnaire", "comite", "comité", "direction"] },
];

const NEXT_STEP_PATTERNS: Array<{ title: string; patterns: string[]; priority: CallAiActionItem["priority"] }> = [
  { title: "Envoyer un recapitulatif et confirmer la prochaine etape", patterns: ["envoyer", "recap", "récap", "mail"], priority: "medium" },
  { title: "Planifier une demo ou un rendez-vous de suivi", patterns: ["demo", "démo", "rendez-vous", "rdv", "meeting"], priority: "high" },
  { title: "Confirmer le budget et le processus de decision", patterns: ["budget", "decision", "décision", "process"], priority: "high" },
  { title: "Relancer le prospect avec un angle valeur concret", patterns: ["relance", "rappeler", "plus tard"], priority: "medium" },
];

// Lignes de plomberie Onoff/Modjo/HubSpot sans valeur conversationnelle:
// elles polluent le resume et les signaux client si on les laisse passer.
const BOILERPLATE_LINE_PATTERNS: RegExp[] = [
  /^appel (sortant|entrant)/i,
  /^destinataire de l'appel/i,
  /^date\s*:/i,
  /^dur[eé]e\s*:?/i,
  /^duration\s*:/i,
  /^titre\s*:/i,
  /^disposition\s*:/i,
  /^contexte\s*:/i,
  /^etape deal\s*:/i,
  /^resume ia\s*:/i,
  /^resume prospect\s*:/i,
  /^prochaine action\s*:/i,
  /^notes\s*:/i,
  /^\(ajoutez vos notes ici\)/i,
  /^would like to go deeper/i,
  /^this call on modjo/i,
  /^tags on this call/i,
  /^statut (hubspot )?/i,
];

export const isBoilerplateLine = (line: string): boolean => {
  const cleaned = line.trim();

  return cleaned.length === 0 || BOILERPLATE_LINE_PATTERNS.some((pattern) => pattern.test(cleaned));
};

// Ne garde que les lignes a valeur conversationnelle (resume Modjo, transcript, notes).
export const extractConversationalText = (text: string): string =>
  text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => !isBoilerplateLine(line))
    .join("\n");

const compact = (value: string, maxLength: number): string => {
  const compacted = value.replace(/\s+/g, " ").trim();

  return compacted.length <= maxLength ? compacted : `${compacted.slice(0, maxLength - 1).trim()}…`;
};

const includesAny = (text: string, patterns: string[]): boolean => patterns.some((pattern) => text.includes(pattern));

const scoreMatches = (text: string, patterns: string[]): number =>
  patterns.reduce((count, pattern) => count + (text.includes(pattern) ? 1 : 0), 0);

const splitSentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => compact(sentence, 220))
    .filter(Boolean)
    .slice(0, 6);

export const buildCallInputHash = (source: CallSource): string =>
  createHash("sha256")
    .update([source.callId, source.sourceKind, source.sourceText, source.startedAt ?? "", source.durationSeconds ?? ""].join("\n"))
    .digest("hex");

export const analyzeCallDeterministically = (source: CallSource): CallAiAnalysis => {
  // Le resume et les signaux client se construisent sur le contenu conversationnel
  // uniquement; le scoring de patterns garde le texte complet (plus de matiere).
  const conversational = extractConversationalText(source.sourceText);
  const text = conversational || source.sourceText;
  const normalized = source.sourceText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const positiveScore = scoreMatches(normalized, POSITIVE_PATTERNS);
  const negativeScore = scoreMatches(normalized, NEGATIVE_PATTERNS);
  const sentences = splitSentences(text);
  const objections = OBJECTION_PATTERNS.filter((item) => includesAny(normalized, item.patterns)).map((item) => item.label);
  const nextSteps = NEXT_STEP_PATTERNS.filter((item) => includesAny(normalized, item.patterns))
    .map<CallAiActionItem>((item) => ({
      title: item.title,
      owner: "sales",
      dueInDays: item.priority === "high" ? 1 : 3,
      priority: item.priority,
    }))
    .slice(0, 4);

  if (nextSteps.length === 0) {
    nextSteps.push({
      title: "Relire le call et definir une prochaine action CRM explicite",
      owner: "sales",
      dueInDays: 2,
      priority: "medium",
    });
  }

  const sentiment = positiveScore > negativeScore ? "positive" : negativeScore > positiveScore ? "negative" : "neutral";
  const closeProbabilityDelta = Math.max(-20, Math.min(20, (positiveScore - negativeScore) * 5));
  const riskLevel = negativeScore >= 3 || objections.length >= 3 ? "high" : negativeScore > positiveScore || objections.length >= 2 ? "medium" : "low";

  return {
    summary: conversational
      ? sentences[0] ?? "Call disponible mais contenu insuffisant pour produire un resume fiable."
      : "Pas de contenu conversationnel pour cet appel (log telephonique uniquement).",
    sentiment,
    objections,
    nextSteps,
    risks:
      riskLevel === "low"
        ? []
        : [
            objections[0] ?? "Risque commercial detecte dans le contenu du call.",
            ...(negativeScore > positiveScore ? ["Le sentiment du call est defavorable ou incertain."] : []),
          ].slice(0, 3),
    opportunities:
      positiveScore > 0
        ? ["Des signaux positifs justifient une relance rapide.", "Capitaliser sur l'interet exprime pendant le call."].slice(
            0,
            Math.min(2, positiveScore),
          )
        : [],
    coachingTips:
      objections.length > 0
        ? ["Reformuler l'objection principale et obtenir un critere de decision mesurable."]
        : ["Ajouter dans le CRM une prochaine action datee et verifiable."],
    customerSignals: conversational ? sentences.slice(1, 5) : [],
    closeProbabilityDelta,
    riskLevel,
    confidence: conversational.length >= 1200 ? "high" : conversational.length >= 350 ? "medium" : "low",
  };
};
