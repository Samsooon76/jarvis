import { compactText } from "../../lib/text.js";
import type { JsonObject, JsonValue, PlaybookPlayInput, PlaybookSuggestion } from "@jarvis/shared";
import {
  createPlay,
  updatePlay,
} from "./playbook.service.js";
import {
  insertPlaybookSuggestions,
  loadPlaybook,
  loadPlaybookSuggestion,
  loadPlaybookSuggestions,
  loadRecentCloseLostAnalyses,
  loadRecentCloseWonAnalyses,
  resolvePlaybookSuggestionRow,
} from "./data-access.js";
import { mapSuggestionRow, validatePlayInput } from "./shared.js";

const MAX_GENERATED_SUGGESTIONS = 20;
const DEFAULT_LOOKBACK_DAYS = 90;

type GeneratedSuggestion = {
  payload: PlaybookPlayInput;
  rationale: string;
  evidence: JsonValue[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const suggestionKey = (input: PlaybookPlayInput): string =>
  `${input.category}:${input.title}:${input.triggerDescription}`.toLowerCase();

const sinceIso = (lookbackDays: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - lookbackDays);

  return date.toISOString();
};

const buildCloseWonSuggestions = async (orgId: string, lookbackDays: number): Promise<GeneratedSuggestion[]> => {
  const rows = await loadRecentCloseWonAnalyses(orgId, sinceIso(lookbackDays));
  const suggestions: GeneratedSuggestion[] = [];

  for (const row of rows) {
    if (!isRecord(row.analysis) || !Array.isArray(row.analysis.replicablePlays)) {
      continue;
    }

    for (const item of row.analysis.replicablePlays) {
      if (!isRecord(item)) {
        continue;
      }

      const play = readText(item.play);
      const when = readText(item.when);

      if (!play || !when) {
        continue;
      }

      suggestions.push({
        payload: validatePlayInput({
          category: "discovery",
          title: compactText(play, 120),
          triggerDescription: compactText(when, 600),
          recommendedResponse: compactText(play, 4000),
          status: "draft",
          evidence: [{ kind: "deal", refId: row.hubspot_deal_id, note: "Analyse close-won" }],
        }),
        rationale: "Play recurrent identifie dans une analyse de deal gagne.",
        evidence: [
          {
            kind: "deal",
            refId: row.hubspot_deal_id,
            label: `Deal gagne ${row.hubspot_deal_id}`,
            note: "Source: replicablePlays close-won",
          },
        ],
      });
    }
  }

  return suggestions;
};

const buildCloseLostSuggestions = async (orgId: string, lookbackDays: number): Promise<GeneratedSuggestion[]> => {
  const rows = await loadRecentCloseLostAnalyses(orgId, sinceIso(lookbackDays));
  const suggestions: GeneratedSuggestion[] = [];

  for (const row of rows) {
    if (!isRecord(row.analysis) || !Array.isArray(row.analysis.playbook)) {
      continue;
    }

    const primaryLossReason = readText(row.analysis.primaryLossReason);

    for (const item of row.analysis.playbook) {
      if (!isRecord(item)) {
        continue;
      }

      const title = readText(item.title);
      const timing = readText(item.timing);
      const rationale = readText(item.rationale);

      if (!title || !timing || !rationale) {
        continue;
      }

      suggestions.push({
        payload: validatePlayInput({
          category: "objection_handling",
          title: compactText(title, 120),
          triggerDescription: compactText(primaryLossReason ? `${timing}. Signal: ${primaryLossReason}` : timing, 600),
          recommendedResponse: compactText(rationale, 4000),
          status: "draft",
          evidence: [
            { kind: "deal", refId: row.hubspot_deal_id, note: "Analyse close-lost" },
            { kind: "analysis", refId: row.id, note: "Playbook close-lost" },
          ],
        }),
        rationale: "Play de gestion de risque extrait d'une analyse close-lost.",
        evidence: [
          {
            kind: "deal",
            refId: row.hubspot_deal_id,
            label: `Deal perdu ${row.hubspot_deal_id}`,
            note: primaryLossReason,
          },
          {
            kind: "analysis",
            refId: row.id,
            label: "Analyse close-lost",
            note: "Source: playbook close-lost",
          },
        ],
      });
    }
  }

  return suggestions;
};

export const listSuggestions = async (
  orgId: string,
  playbookId: string,
  status = "pending",
): Promise<PlaybookSuggestion[]> => {
  await loadPlaybook(orgId, playbookId);
  const rows = await loadPlaybookSuggestions(orgId, playbookId, status);

  return rows.map(mapSuggestionRow);
};

export const generateSuggestions = async (
  orgId: string,
  playbookId: string,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): Promise<{ generatedCount: number; suggestions: PlaybookSuggestion[] }> => {
  await loadPlaybook(orgId, playbookId);
  const existing = await loadPlaybookSuggestions(orgId, playbookId);
  const existingKeys = new Set(
    existing
      .filter((row) => row.status !== "rejected")
      .map((row) => suggestionKey(row.payload as PlaybookPlayInput)),
  );
  const candidates = [
    ...(await buildCloseWonSuggestions(orgId, lookbackDays)),
    ...(await buildCloseLostSuggestions(orgId, lookbackDays)),
  ];
  const selected: GeneratedSuggestion[] = [];

  for (const candidate of candidates) {
    const key = suggestionKey(candidate.payload);

    if (existingKeys.has(key)) {
      continue;
    }

    existingKeys.add(key);
    selected.push(candidate);

    if (selected.length >= MAX_GENERATED_SUGGESTIONS) {
      break;
    }
  }

  const inserted = await insertPlaybookSuggestions(
    selected.map((suggestion) => ({
      org_id: orgId,
      playbook_id: playbookId,
      kind: "new_play",
      payload: suggestion.payload as unknown as JsonObject,
      rationale: suggestion.rationale,
      evidence: suggestion.evidence,
    })),
  );

  return { generatedCount: inserted.length, suggestions: inserted.map(mapSuggestionRow) };
};

const suggestionPayloadToPlayInput = (payload: JsonObject, override?: PlaybookPlayInput): PlaybookPlayInput =>
  validatePlayInput(override ?? (payload as unknown as PlaybookPlayInput));

export const acceptSuggestion = async (
  orgId: string,
  playbookId: string,
  suggestionId: string,
  resolvedBy: string | null,
  override?: PlaybookPlayInput,
): Promise<{ suggestion: PlaybookSuggestion; play: Awaited<ReturnType<typeof createPlay>> | null }> => {
  const suggestion = await loadPlaybookSuggestion(orgId, playbookId, suggestionId);

  if (suggestion.status !== "pending") {
    throw new Error("Cette suggestion a deja ete traitee.");
  }

  let play: Awaited<ReturnType<typeof createPlay>> | null = null;

  if (suggestion.kind === "new_play") {
    const input = suggestionPayloadToPlayInput(suggestion.payload, override);
    play = await createPlay(orgId, playbookId, { ...input, status: "active" }, "ai_suggested");
  } else if (suggestion.kind === "update_play") {
    const targetPlayId = readText(suggestion.payload.targetPlayId);

    if (!targetPlayId) {
      throw new Error("Suggestion de mise a jour sans play cible.");
    }

    const input = suggestionPayloadToPlayInput(suggestion.payload, override);
    play = await updatePlay(orgId, playbookId, targetPlayId, input);
  } else if (suggestion.kind === "retire_play") {
    const targetPlayId = readText(suggestion.payload.targetPlayId);

    if (!targetPlayId) {
      throw new Error("Suggestion d'archivage sans play cible.");
    }

    play = await updatePlay(orgId, playbookId, targetPlayId, { status: "archived" });
  }

  const resolved = await resolvePlaybookSuggestionRow(orgId, playbookId, suggestionId, "accepted", resolvedBy);

  return { suggestion: mapSuggestionRow(resolved), play };
};

export const rejectSuggestion = async (
  orgId: string,
  playbookId: string,
  suggestionId: string,
  resolvedBy: string | null,
): Promise<{ suggestion: PlaybookSuggestion }> => {
  const suggestion = await loadPlaybookSuggestion(orgId, playbookId, suggestionId);

  if (suggestion.status !== "pending") {
    throw new Error("Cette suggestion a deja ete traitee.");
  }

  const resolved = await resolvePlaybookSuggestionRow(orgId, playbookId, suggestionId, "rejected", resolvedBy);

  return { suggestion: mapSuggestionRow(resolved) };
};
