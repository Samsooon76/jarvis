import { compactText } from "../../lib/text.js";
import { createHash } from "node:crypto";
import type { JsonObject, JsonValue, PlaybookDriftRunResult, PlaybookPlayInput, PlaybookSuggestion } from "@jarvis/shared";
import { generatePulseNotificationsForPlaybookSuggestion } from "../pulse.service.js";
import {
  insertPlaybookSuggestions,
  loadActivePlays,
  loadPlaybook,
  loadPlaybookSuggestions,
  loadRecentCloseLostAnalyses,
  loadRecentCloseWonAnalyses,
  loadRecentPlaybookActivityEvidence,
} from "./data-access.js";
import { mapSuggestionRow, validatePlayInput } from "./shared.js";

const DEFAULT_LOOKBACK_DAYS = 45;
const DEFAULT_MIN_EVIDENCE = 3;
const DEFAULT_COOLDOWN_DAYS = 14;
const MAX_DRIFT_SUGGESTIONS = 10;

type DriftSignal = {
  source: "close_won" | "close_lost" | "call_insight" | "pending_suggestion";
  refId: string;
  dealId: string | null;
  title: string;
  text: string;
  occurredAt: string;
};

type DriftCandidate = {
  key: string;
  play: Awaited<ReturnType<typeof loadActivePlays>>[number];
  signals: DriftSignal[];
  payload: PlaybookPlayInput & { targetPlayId: string };
  rationale: string;
};

export type RunPlaybookDriftOptions = {
  lookbackDays?: number;
  minEvidence?: number;
  cooldownDays?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const sinceIso = (lookbackDays: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - lookbackDays);

  return date.toISOString();
};

const addDaysIso = (days: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString();
};

const stableUuid = (value: string): string => {
  const hash = createHash("sha256").update(value, "utf8").digest("hex");

  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};

const tokenize = (value: string): Set<string> => {
  const ignored = new Set(["avec", "dans", "pour", "that", "this", "have", "from", "deal", "play"]);
  const tokens = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]{4,}/g);

  return new Set((tokens ?? []).filter((token) => !ignored.has(token)));
};

const overlapScore = (playText: string, signalText: string): number => {
  const playTokens = tokenize(playText);
  const signalTokens = tokenize(signalText);

  if (playTokens.size === 0 || signalTokens.size === 0) {
    return 0;
  }

  let common = 0;

  for (const token of playTokens) {
    if (signalTokens.has(token)) {
      common += 1;
    }
  }

  return common / Math.min(playTokens.size, signalTokens.size);
};

const readPayloadText = (payload: JsonObject): string | null => {
  const fields = ["summary", "transcript", "body", "text", "note", "title", "description", "outcome"];
  const parts = fields.map((field) => readText(payload[field])).filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(". ") : null;
};

const collectSignals = async (orgId: string, playbookId: string, lookbackDays: number): Promise<DriftSignal[]> => {
  const since = sinceIso(lookbackDays);
  const [wonRows, lostRows, activityRows, pendingSuggestions] = await Promise.all([
    loadRecentCloseWonAnalyses(orgId, since),
    loadRecentCloseLostAnalyses(orgId, since),
    loadRecentPlaybookActivityEvidence(orgId, since),
    loadPlaybookSuggestions(orgId, playbookId, "pending"),
  ]);
  const signals: DriftSignal[] = [];

  for (const row of wonRows) {
    if (!isRecord(row.analysis)) {
      continue;
    }

    const texts = [
      readText(row.analysis.summary),
      readText(row.analysis.primaryWinFactor),
      ...(Array.isArray(row.analysis.replicablePlays)
        ? row.analysis.replicablePlays
            .filter(isRecord)
            .map((item) => [readText(item.play), readText(item.when)].filter(Boolean).join(". "))
        : []),
    ].filter((text): text is string => Boolean(text));

    for (const text of texts) {
      signals.push({
        source: "close_won",
        refId: row.hubspot_deal_id,
        dealId: row.hubspot_deal_id,
        title: "Analyse win-loss: close-won",
        text,
        occurredAt: row.generated_at,
      });
    }
  }

  for (const row of lostRows) {
    if (!isRecord(row.analysis)) {
      continue;
    }

    const texts = [
      readText(row.analysis.summary),
      readText(row.analysis.primaryLossReason),
      ...(Array.isArray(row.analysis.playbook)
        ? row.analysis.playbook
            .filter(isRecord)
            .map((item) => [readText(item.title), readText(item.timing), readText(item.rationale)].filter(Boolean).join(". "))
        : []),
    ].filter((text): text is string => Boolean(text));

    for (const text of texts) {
      signals.push({
        source: "close_lost",
        refId: row.id,
        dealId: row.hubspot_deal_id,
        title: "Analyse win-loss: close-lost",
        text,
        occurredAt: row.generated_at,
      });
    }
  }

  for (const row of activityRows) {
    const text = readPayloadText(row.payload);

    if (!text) {
      continue;
    }

    signals.push({
      source: "call_insight",
      refId: row.id,
      dealId: row.hubspot_deal_id,
      title: `${row.channel} ${row.event_type}`,
      text,
      occurredAt: row.occurred_at,
    });
  }

  for (const row of pendingSuggestions) {
    const text = [readText(row.rationale), readText(row.payload.title), readText(row.payload.triggerDescription)].filter(Boolean).join(". ");

    if (!text) {
      continue;
    }

    signals.push({
      source: "pending_suggestion",
      refId: row.id,
      dealId: null,
      title: "Suggestion playbook pending",
      text,
      occurredAt: row.created_at,
    });
  }

  return signals;
};

const buildCandidate = (
  play: Awaited<ReturnType<typeof loadActivePlays>>[number],
  signals: DriftSignal[],
): DriftCandidate | null => {
  const sortedSignals = signals.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  const dominantSource = sortedSignals[0]?.source ?? "call_insight";
  const sourceLabel = dominantSource === "close_won"
    ? "wins recentes"
    : dominantSource === "close_lost"
      ? "pertes recentes"
      : "retours terrain recents";
  const strongestSignal = sortedSignals[0];

  if (!strongestSignal) {
    return null;
  }

  const targetResponse = `${play.recommended_response}\n\nAjustement propose: ${compactText(strongestSignal.text, 700)}`;
  const payload = validatePlayInput({
    category: play.category,
    title: play.title,
    triggerDescription: compactText(play.trigger_description, 600),
    recommendedResponse: compactText(targetResponse, 4000),
    status: "draft",
    evidence: sortedSignals.slice(0, 5).map((signal) => ({
      kind: signal.source === "call_insight" ? "call" : "analysis",
      refId: signal.refId,
      note: signal.title,
    })),
  });
  const payloadWithTarget: PlaybookPlayInput & { targetPlayId: string } = {
    ...payload,
    targetPlayId: play.id,
  };

  return {
    key: `drift:${play.id}:${dominantSource}:${Array.from(tokenize(strongestSignal.text)).sort().slice(0, 3).join("-") || "signal"}`,
    play,
    signals: sortedSignals,
    payload: payloadWithTarget,
    rationale: `Drift detecte sur "${play.title}": ${sortedSignals.length} signaux ${sourceLabel} convergent vers un ajustement.`,
  };
};

export const runPlaybookDrift = async (
  orgId: string,
  playbookId: string,
  options: RunPlaybookDriftOptions = {},
): Promise<PlaybookDriftRunResult> => {
  await loadPlaybook(orgId, playbookId);

  const lookbackDays = Math.max(7, Math.min(options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS, 180));
  const minEvidence = Math.max(2, Math.min(options.minEvidence ?? DEFAULT_MIN_EVIDENCE, 10));
  const cooldownDays = Math.max(1, Math.min(options.cooldownDays ?? DEFAULT_COOLDOWN_DAYS, 90));
  const [plays, signals, existingSuggestions] = await Promise.all([
    loadActivePlays(orgId, playbookId),
    collectSignals(orgId, playbookId, lookbackDays),
    loadPlaybookSuggestions(orgId, playbookId),
  ]);
  const now = new Date();
  const blockedKeys = new Set(
    existingSuggestions
      .filter((row) => row.source_key && row.status !== "rejected")
      .filter((row) => !row.cooldown_until || new Date(row.cooldown_until).getTime() > now.getTime())
      .map((row) => row.source_key as string),
  );
  const candidates: DriftCandidate[] = [];
  let skippedCooldownCount = 0;

  for (const play of plays) {
    const playText = `${play.title}. ${play.trigger_description}. ${play.recommended_response}`;
    const matchedSignals = signals.filter((signal) => overlapScore(playText, signal.text) >= 0.12);

    if (matchedSignals.length < minEvidence) {
      continue;
    }

    const candidate = buildCandidate(play, matchedSignals);

    if (!candidate) {
      continue;
    }

    if (blockedKeys.has(candidate.key)) {
      skippedCooldownCount += 1;
      continue;
    }

    blockedKeys.add(candidate.key);
    candidates.push(candidate);

    if (candidates.length >= MAX_DRIFT_SUGGESTIONS) {
      break;
    }
  }

  const inserted = await insertPlaybookSuggestions(
    candidates.map((candidate) => ({
      org_id: orgId,
      playbook_id: playbookId,
      kind: "update_play",
      payload: candidate.payload as unknown as JsonObject,
      rationale: candidate.rationale,
      evidence: candidate.signals.slice(0, 5).map((signal) => ({
        title: signal.title,
        sourceId: signal.refId,
        quote: compactText(signal.text, 500),
      })) as JsonValue[],
      source: "drift",
      source_key: candidate.key,
      confidence: Math.min(0.95, 0.45 + candidate.signals.length * 0.1),
      cooldown_until: addDaysIso(cooldownDays),
    })),
  );
  const suggestions = inserted.map(mapSuggestionRow);

  await Promise.all(
    suggestions.map((suggestion) =>
      generatePulseNotificationsForPlaybookSuggestion({
        orgId,
        sourceEventId: stableUuid(`pulse:playbook_suggestion:${suggestion.id}`),
        playbookId,
        suggestionTitle: suggestion.title,
        rationale: suggestion.rationale,
        occurredAt: suggestion.createdAt,
      }),
    ),
  );

  return {
    playbookId,
    scannedPlayCount: plays.length,
    evidenceCount: signals.length,
    candidateCount: candidates.length,
    generatedCount: suggestions.length,
    skippedCooldownCount,
    suggestions: suggestions as PlaybookSuggestion[],
  };
};
