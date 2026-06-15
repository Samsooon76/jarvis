import type { AskJarvisResult } from "@jarvis/shared";

type ParsedAskJarvisResponse = {
  answer?: unknown;
  confidence?: unknown;
  sources?: unknown;
};

const isConfidence = (value: unknown): value is AskJarvisResult["confidence"] =>
  value === "low" || value === "medium" || value === "high";

const sanitizeSources = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 8);
};

export const buildAskJarvisSystemPrompt = (): string =>
  [
    "Tu es Jarvis, un sales copilot B2B.",
    "Tu reponds en francais, de facon concise et actionnable.",
    "Tu t'appuies uniquement sur le contexte fourni.",
    "Si une information manque, dis-le explicitement.",
    "Tu reponds uniquement en json valide, sans markdown.",
  ].join(" ");

export const buildAskJarvisUserPrompt = (input: {
  question: string;
  contextBlock: string;
}): string => `Question utilisateur:
${input.question.trim()}

Contexte Jarvis:
${input.contextBlock}

Reponds avec ce schema json strict:
{
  "answer": "reponse actionnable en francais",
  "confidence": "low|medium|high",
  "sources": ["source 1", "source 2"]
}`;

export const parseAskJarvisResponse = (raw: string, providerName: string): Pick<AskJarvisResult, "answer" | "confidence" | "sources"> => {
  let parsed: ParsedAskJarvisResponse;

  try {
    parsed = JSON.parse(raw) as ParsedAskJarvisResponse;
  } catch {
    throw new Error(`${providerName} a renvoye une reponse Ask Jarvis invalide.`);
  }

  const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";

  if (!answer) {
    throw new Error(`${providerName} a renvoye une reponse Ask Jarvis vide.`);
  }

  return {
    answer,
    confidence: isConfidence(parsed.confidence) ? parsed.confidence : "medium",
    sources: sanitizeSources(parsed.sources),
  };
};