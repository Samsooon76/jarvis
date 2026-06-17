import { compactText } from "../../lib/text.js";
import type {
  LeadContactRankingAnalysis,
  LeadContactRankingContactInput,
  RankLeadContactsInput,
} from "./llm.provider.js";

type ParsedLeadContactRanking = {
  contacts?: unknown;
};

type ParsedLeadContactRankingContact = {
  hubspotContactId?: unknown;
  aiScore?: unknown;
  reason?: unknown;
  recommendedAction?: unknown;
  confidence?: unknown;
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

const parseJsonObject = <T>(value: string, providerName: string): T => {
  try {
    return JSON.parse(normalizeJsonResponse(value)) as T;
  } catch {
    throw new Error(`${providerName} n'a pas renvoye un JSON valide pour le ranking des contacts. Extrait: ${value.slice(0, 240)}`);
  }
};

const clampScore = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const isConfidence = (value: unknown): value is LeadContactRankingAnalysis["contacts"][number]["confidence"] =>
  value === "low" || value === "medium" || value === "high";

const formatContact = (contact: LeadContactRankingContactInput): string =>
  [
    `- Contact ID: ${contact.hubspotContactId}`,
    `Nom: ${contact.name || "inconnu"}`,
    `Titre: ${contact.title || "inconnu"}`,
    `Email: ${contact.email ? "oui" : "non"}`,
    `Telephone: ${contact.phone ? "oui" : "non"}`,
    `Derniere activite: ${contact.lastActivityAt ?? "inconnue"}`,
    `Lifecycle: ${contact.lifecycleStage ?? "inconnu"}`,
    `Lead status: ${contact.leadStatus ?? "inconnu"}`,
    `Score regles: ${contact.deterministicScore}`,
    `Raison regles: ${contact.deterministicReason}`,
  ].join(" | ");

export const buildLeadContactRankingPrompt = ({
  lead,
  contacts,
  today,
}: RankLeadContactsInput): string => `Tu es Jarvis, un sales copilot B2B. Tu dois classer les contacts d'un compte HubSpot pour aider un AE a choisir qui appeler en premier.

Reponds uniquement en JSON valide avec ce schema exact:
{
  "contacts": [
    {
      "hubspotContactId": string,
      "aiScore": number,
      "reason": string,
      "recommendedAction": string,
      "confidence": "low" | "medium" | "high"
    }
  ]
}

Regles strictes:
- Retourne exactement les contacts fournis, sans en inventer.
- aiScore est un entier 0-100.
- Favorise les contacts joignables par telephone, decisionnaires, champions, responsables metier ou contacts recents.
- Penalise les contacts sans telephone et sans email, les titres non renseignes et les donnees trop faibles.
- Ne deduis pas un role senior si le titre ne le montre pas.
- La raison doit etre courte, factuelle et en francais.
- recommendedAction doit etre une action d'appel ou de qualification concrete pour l'AE.
- Si les donnees sont faibles, garde confidence a "low" et explique la limite.

Contexte compte:
- Lead HubSpot: ${lead.name}
- Societe: ${lead.companyName ?? "non renseignee"}
- Phase: ${lead.phaseLabel ?? lead.phaseId ?? "non renseignee"}
- Pipeline: ${lead.pipelineLabel ?? "non renseigne"}
- Derniere activite compte: ${lead.lastActivityAt ?? "inconnue"}
- Aujourd'hui: ${today ?? new Date().toISOString()}

Contacts:
${contacts.map(formatContact).join("\n")}`;

export const parseLeadContactRanking = (value: string, providerName: string): LeadContactRankingAnalysis => {
  const parsed = parseJsonObject<ParsedLeadContactRanking>(value, providerName);

  if (!Array.isArray(parsed.contacts)) {
    throw new Error(`${providerName} a renvoye une liste de contacts invalide pour le ranking.`);
  }

  return {
    contacts: parsed.contacts.map((item) => {
      const contact = item as ParsedLeadContactRankingContact;

      if (
        typeof contact.hubspotContactId !== "string" ||
        typeof contact.aiScore !== "number" ||
        typeof contact.reason !== "string" ||
        typeof contact.recommendedAction !== "string" ||
        !isConfidence(contact.confidence)
      ) {
        throw new Error(`${providerName} a renvoye un contact non conforme pour le ranking.`);
      }

      return {
        hubspotContactId: contact.hubspotContactId,
        aiScore: clampScore(contact.aiScore),
        reason: compactText(contact.reason, 220),
        recommendedAction: compactText(contact.recommendedAction, 160),
        confidence: contact.confidence,
      };
    }),
  };
};
