import {
  isPlaybookOverviewStale,
  PLAYBOOK_PLAY_CATEGORIES,
  type PlaybookDetail,
  type PlaybookOverview,
  type PlaybookOverviewResult,
  type PlaybookPlay,
} from "@jarvis/shared";
import { resolveProvider } from "../win-analysis/shared.js";
import { getPlaybookDetail, updatePlaybook } from "./playbook.service.js";
import { updatePlaybookRow } from "./data-access.js";
import type { PlaybookOverviewRow } from "./types.js";

export const MIN_PLAYS_FOR_OVERVIEW = 2;

const CATEGORY_LABELS: Record<(typeof PLAYBOOK_PLAY_CATEGORIES)[number], string> = {
  qualification: "Qualification",
  discovery: "Discovery",
  demo: "Demo",
  objection_handling: "Gestion d'objections",
  negotiation: "Negociation",
  closing: "Closing",
  follow_up: "Follow-up",
};

const selectSourcePlays = (plays: PlaybookPlay[]): PlaybookPlay[] => {
  const activePlays = plays.filter((play) => play.status === "active");

  if (activePlays.length > 0) {
    return activePlays.sort((left, right) => left.position - right.position);
  }

  return plays
    .filter((play) => play.status !== "archived")
    .sort((left, right) => left.position - right.position);
};

const buildPlaysSummary = (plays: PlaybookPlay[]): string =>
  plays
    .map((play) =>
      [
        `playId: ${play.id}`,
        `category: ${play.category}`,
        `status: ${play.status}`,
        `title: ${play.title}`,
        `trigger: ${play.triggerDescription}`,
        `execution: ${play.recommendedResponse}`,
      ].join("\n"),
    )
    .join("\n\n---\n\n");

const computeStructuralGaps = (plays: PlaybookPlay[], overviewGaps: string[]): string[] => {
  const categoriesWithPlays = new Set(plays.map((play) => play.category));
  const structuralGaps = PLAYBOOK_PLAY_CATEGORIES.filter((category) => !categoriesWithPlays.has(category)).map(
    (category) => `Aucun play pour l'etape ${CATEGORY_LABELS[category]}.`,
  );

  return Array.from(new Set([...overviewGaps, ...structuralGaps])).slice(0, 8);
};

const normalizeOverviewRow = (
  analysis: Awaited<ReturnType<Awaited<ReturnType<typeof resolveProvider>>["synthesizePlaybookOverview"]>>,
  sourcePlays: PlaybookPlay[],
): PlaybookOverviewRow => ({
  doctrine: analysis.doctrine,
  idealSequence: analysis.idealSequence,
  stages: analysis.stages,
  principles: analysis.principles,
  gaps: computeStructuralGaps(sourcePlays, analysis.gaps),
  confidence: analysis.confidence,
  synthesizedAt: new Date().toISOString(),
  sourceSnapshot: sourcePlays.map((play) => ({ playId: play.id, version: play.version })),
});

const attachOverview = (detail: PlaybookDetail, overview: PlaybookOverview | null): PlaybookDetail => ({
  ...detail,
  overview,
  overviewIsStale: isPlaybookOverviewStale(overview, detail.plays),
});

export const synthesizePlaybookOverview = async (
  orgId: string,
  playbookId: string,
): Promise<PlaybookOverviewResult> => {
  const detail = await getPlaybookDetail(orgId, playbookId);
  const sourcePlays = selectSourcePlays(detail.plays);

  if (sourcePlays.length < MIN_PLAYS_FOR_OVERVIEW) {
    throw new Error(
      `Il faut au moins ${MIN_PLAYS_FOR_OVERVIEW} plays pour synthetiser la vue globale (${sourcePlays.length} disponible(s)).`,
    );
  }

  const provider = await resolveProvider(orgId);
  const analysis = await provider.synthesizePlaybookOverview({
    playbookName: detail.name,
    playbookDescription: detail.description,
    playsSummary: buildPlaysSummary(sourcePlays),
    playCount: sourcePlays.length,
    activePlayCount: sourcePlays.filter((play) => play.status === "active").length,
    knownPlayIds: sourcePlays.map((play) => play.id),
  });

  const overview = normalizeOverviewRow(analysis, sourcePlays);
  await updatePlaybookRow(orgId, playbookId, { overview });

  if (!detail.description?.trim()) {
    await updatePlaybook(orgId, playbookId, { description: overview.doctrine });
  }

  const refreshed = await getPlaybookDetail(orgId, playbookId);

  return {
    playbook: attachOverview(refreshed, overview),
    overview,
  };
};

export const trySynthesizePlaybookOverview = async (orgId: string, playbookId: string): Promise<void> => {
  try {
    await synthesizePlaybookOverview(orgId, playbookId);
  } catch {
    // La synthese globale enrichit le playbook mais ne bloque pas les flows parents.
  }
};

export const mapStoredOverview = (value: PlaybookOverviewRow | null | undefined): PlaybookOverview | null => {
  if (!value || typeof value.doctrine !== "string" || typeof value.synthesizedAt !== "string") {
    return null;
  }

  return {
    doctrine: value.doctrine,
    idealSequence: Array.isArray(value.idealSequence) ? value.idealSequence : [],
    stages: Array.isArray(value.stages) ? value.stages : [],
    principles: Array.isArray(value.principles) ? value.principles : [],
    gaps: Array.isArray(value.gaps) ? value.gaps : [],
    confidence: value.confidence ?? "low",
    synthesizedAt: value.synthesizedAt,
    sourceSnapshot: Array.isArray(value.sourceSnapshot) ? value.sourceSnapshot : [],
  };
};

export const enrichPlaybookDetailOverview = (detail: PlaybookDetail, overview: PlaybookOverview | null): PlaybookDetail =>
  attachOverview(detail, overview);