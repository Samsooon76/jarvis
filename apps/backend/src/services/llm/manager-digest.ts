import { compactText } from "../../lib/text.js";
import type {
  AnalyzeManagerDigestInput,
  ManagerDigestAnalysis,
  ManagerDigestAssistDeal,
  ManagerDigestAtRiskDeal,
  ManagerDigestHighlight,
  ManagerDigestHighlightType,
} from "./llm.provider.js";

type ParsedManagerDigestAnalysis = {
  headline?: unknown;
  highlights?: unknown;
  atRiskDeals?: unknown;
  assistDeals?: unknown;
  teamPulse?: unknown;
  confidence?: unknown;
};

type ParsedManagerDigestHighlight = {
  type?: unknown;
  dealId?: unknown;
  text?: unknown;
};

type ParsedManagerDigestAtRiskDeal = {
  dealId?: unknown;
  dealName?: unknown;
  reason?: unknown;
  suggestedAction?: unknown;
};

type ParsedManagerDigestAssistDeal = {
  dealId?: unknown;
  dealName?: unknown;
  whyHelp?: unknown;
  coachingHint?: unknown;
};

const MAX_AT_RISK_DEALS = 3;
const MAX_ASSIST_DEALS = 2;
const MAX_HIGHLIGHTS = 6;

const HIGHLIGHT_TYPES = ["win", "risk", "movement"] as const satisfies readonly ManagerDigestHighlightType[];

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
    throw new Error(`${providerName} n'a pas renvoye un JSON valide pour le digest manager. Extrait: ${value.slice(0, 240)}`);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isConfidence = (value: unknown): value is ManagerDigestAnalysis["confidence"] =>
  value === "low" || value === "medium" || value === "high";

const isHighlightType = (value: unknown): value is ManagerDigestHighlightType =>
  typeof value === "string" && HIGHLIGHT_TYPES.includes(value as ManagerDigestHighlightType);

const parseKnownDealId = (value: unknown, knownDealIds: Set<string>): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const dealId = value.trim();

  return knownDealIds.has(dealId) ? dealId : null;
};

const parseHighlights = (value: unknown, knownDealIds: Set<string>): ManagerDigestHighlight[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_HIGHLIGHTS)
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const highlight = item as ParsedManagerDigestHighlight;

      if (!isHighlightType(highlight.type) || typeof highlight.text !== "string" || !highlight.text.trim()) {
        return null;
      }

      return {
        type: highlight.type,
        dealId: parseKnownDealId(highlight.dealId, knownDealIds),
        text: compactText(highlight.text, 180),
      };
    })
    .filter((highlight): highlight is ManagerDigestHighlight => highlight !== null);
};

const parseAtRiskDeals = (value: unknown, knownDealIds: Set<string>): ManagerDigestAtRiskDeal[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const deals: ManagerDigestAtRiskDeal[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (deals.length >= MAX_AT_RISK_DEALS || !isRecord(item)) {
      continue;
    }

    const deal = item as ParsedManagerDigestAtRiskDeal;
    const dealId = parseKnownDealId(deal.dealId, knownDealIds);

    if (
      !dealId ||
      seen.has(dealId) ||
      typeof deal.dealName !== "string" ||
      typeof deal.reason !== "string" ||
      typeof deal.suggestedAction !== "string"
    ) {
      continue;
    }

    seen.add(dealId);
    deals.push({
      dealId,
      dealName: compactText(deal.dealName, 90),
      reason: compactText(deal.reason, 160),
      suggestedAction: compactText(deal.suggestedAction, 160),
    });
  }

  return deals;
};

const parseAssistDeals = (value: unknown, knownDealIds: Set<string>): ManagerDigestAssistDeal[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const deals: ManagerDigestAssistDeal[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (deals.length >= MAX_ASSIST_DEALS || !isRecord(item)) {
      continue;
    }

    const deal = item as ParsedManagerDigestAssistDeal;
    const dealId = parseKnownDealId(deal.dealId, knownDealIds);

    if (
      !dealId ||
      seen.has(dealId) ||
      typeof deal.dealName !== "string" ||
      typeof deal.whyHelp !== "string" ||
      typeof deal.coachingHint !== "string"
    ) {
      continue;
    }

    seen.add(dealId);
    deals.push({
      dealId,
      dealName: compactText(deal.dealName, 90),
      whyHelp: compactText(deal.whyHelp, 160),
      coachingHint: compactText(deal.coachingHint, 160),
    });
  }

  return deals;
};

export const buildManagerDigestPrompt = ({
  movementsSummary,
  atRiskSummary,
  kpisSummary,
  period,
  dateFrom,
  dateTo,
  teamScopeLabel,
}: AnalyzeManagerDigestInput): string => `Tu es Jarvis, un assistant revenue operations B2B. Tu rediges le digest ${period === "daily" ? "quotidien" : "hebdomadaire"} d'un manager commercial: une synthese de "ce qui a bouge" sur son perimetre, a partir de donnees deja calculees (mouvements CRM, verdicts forecast IA en cache, KPIs d'activite).

Reponds uniquement en JSON valide avec ce schema exact:
{
  "headline": string,
  "highlights": [
    { "type": "win" | "risk" | "movement", "dealId": string | null, "text": string }
  ],
  "atRiskDeals": [
    { "dealId": string, "dealName": string, "reason": string, "suggestedAction": string }
  ],
  "assistDeals": [
    { "dealId": string, "dealName": string, "whyHelp": string, "coachingHint": string }
  ],
  "teamPulse": string,
  "confidence": "low" | "medium" | "high"
}

Regles strictes:
- headline: 1 phrase qui resume la periode pour le manager (ce qui a bouge, ou est le risque), 180 caracteres maximum.
- highlights: 3 a 6 faits marquants de la periode (type "win" pour un signal positif, "risk" pour un signal negatif, "movement" pour un mouvement notable); dealId reference l'id EXACT d'un deal present dans les donnees, ou null si le fait n'est pas lie a un deal precis; text 180 caracteres maximum.
- atRiskDeals: les 3 deals maximum les plus a risque, choisis UNIQUEMENT parmi les deals a risque fournis; reason et suggestedAction factuelles, 160 caracteres maximum chacune.
- assistDeals: 2 deals maximum ou un coup de main du manager debloquerait la situation (deal important, negociation, silence prolonge); whyHelp explique pourquoi intervenir, coachingHint donne l'angle de coaching pour l'AE; 160 caracteres maximum chacun.
- teamPulse: 1 a 2 phrases sur l'activite de l'equipe (volume d'appels, emails, meetings, deals bouges), 240 caracteres maximum.
- N'invente aucun deal ni aucun fait absent des donnees; utilise les dealId EXACTS fournis.
- Si une section de donnees est vide, renvoie un tableau vide pour la section correspondante.
- Contenu en francais, concis, actionnable pour un manager.

Contexte:
- Periode: ${dateFrom} -> ${dateTo} (${period === "daily" ? "digest quotidien" : "digest hebdomadaire"})
- Scope: ${teamScopeLabel}

Mouvements de la periode (un deal par ligne, agrege):
${movementsSummary || "Aucun mouvement sur la periode."}

Deals a risque selon la derniere synthese forecast IA (un par ligne):
${atRiskSummary || "Aucun deal a risque identifie."}

Activite de l'equipe sur la periode:
${kpisSummary || "Aucune donnee d'activite disponible."}`;

export const parseManagerDigestAnalysis = (
  value: string,
  knownDealIds: string[],
  providerName: string,
): ManagerDigestAnalysis => {
  const parsed = parseJsonObject<ParsedManagerDigestAnalysis>(value, providerName);

  if (
    typeof parsed.headline !== "string" ||
    typeof parsed.teamPulse !== "string" ||
    !isConfidence(parsed.confidence)
  ) {
    throw new Error(`${providerName} a renvoye un JSON invalide pour le digest manager.`);
  }

  const knownDealIdSet = new Set(knownDealIds);

  return {
    headline: compactText(parsed.headline, 180),
    highlights: parseHighlights(parsed.highlights, knownDealIdSet),
    atRiskDeals: parseAtRiskDeals(parsed.atRiskDeals, knownDealIdSet),
    assistDeals: parseAssistDeals(parsed.assistDeals, knownDealIdSet),
    teamPulse: compactText(parsed.teamPulse, 240),
    confidence: parsed.confidence,
  };
};
