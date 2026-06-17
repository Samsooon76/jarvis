import type { Playbook, PlaybookDetail, PlaybookPlay, PlaybookPlayInput } from "@jarvis/shared";
import { enrichPlaybookDetailOverview, mapStoredOverview } from "./overview.js";
import {
  insertPlay,
  insertPlaybook,
  loadEvidence,
  loadNextPlayPosition,
  loadPlay,
  loadPlaybook,
  loadPlaybooks,
  loadPlays,
  replacePlayEvidence,
  updatePlaybookRow,
  updatePlayRow,
} from "./data-access.js";
import {
  isPlayCategory,
  isPlayStatus,
  mapPlaybookRow,
  mapPlayRow,
  validatePlaybookName,
  validatePlayInput,
} from "./shared.js";
import type { CreatePlaybookInput, PlaybookPlayEvidenceRow, UpdatePlaybookInput, UpdatePlayInput } from "./types.js";

const groupEvidenceByPlayId = (rows: PlaybookPlayEvidenceRow[]): Map<string, PlaybookPlayEvidenceRow[]> => {
  const byPlayId = new Map<string, PlaybookPlayEvidenceRow[]>();

  for (const row of rows) {
    const existing = byPlayId.get(row.play_id);

    if (existing) {
      existing.push(row);
    } else {
      byPlayId.set(row.play_id, [row]);
    }
  }

  return byPlayId;
};

export const listPlaybooks = async (orgId: string): Promise<Playbook[]> => {
  const rows = await loadPlaybooks(orgId);
  const plays = await loadPlays(orgId, rows.map((row) => row.id));
  const countsByPlaybookId = new Map<string, { total: number; active: number }>();

  for (const play of plays) {
    const counts = countsByPlaybookId.get(play.playbook_id) ?? { total: 0, active: 0 };

    if (play.status !== "archived") {
      counts.total += 1;
    }

    if (play.status === "active") {
      counts.active += 1;
    }

    countsByPlaybookId.set(play.playbook_id, counts);
  }

  const playsByPlaybookId = new Map<string, PlaybookPlay[]>();

  for (const play of plays) {
    const mappedPlay = mapPlayRow(play, []);
    const existing = playsByPlaybookId.get(play.playbook_id) ?? [];
    existing.push(mappedPlay);
    playsByPlaybookId.set(play.playbook_id, existing);
  }

  return rows.map((row) => {
    const counts = countsByPlaybookId.get(row.id) ?? { total: 0, active: 0 };
    const playbookPlays = playsByPlaybookId.get(row.id) ?? [];
    const overview = mapStoredOverview(row.overview);

    return mapPlaybookRow(row, counts.total, counts.active, playbookPlays, overview);
  });
};

export const getPlaybookDetail = async (orgId: string, playbookId: string): Promise<PlaybookDetail> => {
  const row = await loadPlaybook(orgId, playbookId);
  const playRows = await loadPlays(orgId, [playbookId]);
  const evidenceByPlayId = groupEvidenceByPlayId(await loadEvidence(orgId, playRows.map((play) => play.id)));
  const plays = playRows.map((play) => mapPlayRow(play, evidenceByPlayId.get(play.id) ?? []));
  const visiblePlays = plays.filter((play) => play.status !== "archived");
  const overview = mapStoredOverview(row.overview);

  return enrichPlaybookDetailOverview(
    {
      ...mapPlaybookRow(
        row,
        visiblePlays.length,
        visiblePlays.filter((play) => play.status === "active").length,
        plays,
        overview,
      ),
      plays,
    },
    overview,
  );
};

export const createPlaybook = async (input: CreatePlaybookInput): Promise<Playbook> => {
  const row = await insertPlaybook({
    org_id: input.orgId,
    name: validatePlaybookName(input.name),
    description: input.description?.trim() || null,
    created_by: input.createdBy ?? null,
  });

  return mapPlaybookRow(row, 0, 0);
};

export const updatePlaybook = async (
  orgId: string,
  playbookId: string,
  input: UpdatePlaybookInput,
): Promise<Playbook> => {
  const patch: Record<string, unknown> = {};

  if (input.name !== undefined) {
    patch.name = validatePlaybookName(input.name);
  }

  if (input.description !== undefined) {
    patch.description = input.description?.trim() || null;
  }

  if (input.status !== undefined) {
    if (input.status !== "active" && input.status !== "archived") {
      throw new Error("Statut de playbook invalide.");
    }

    patch.status = input.status;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error("Aucune modification fournie.");
  }

  const row = await updatePlaybookRow(orgId, playbookId, patch);
  const detail = await getPlaybookDetail(orgId, row.id);

  return detail;
};

export const createPlay = async (
  orgId: string,
  playbookId: string,
  input: PlaybookPlayInput,
  source: "manual" | "ai_suggested" = "manual",
): Promise<PlaybookPlay> => {
  // Verifie l'appartenance org du playbook avant d'ecrire.
  await loadPlaybook(orgId, playbookId);
  const validated = validatePlayInput(input);
  const position = await loadNextPlayPosition(orgId, playbookId);
  const row = await insertPlay({
    org_id: orgId,
    playbook_id: playbookId,
    category: validated.category,
    title: validated.title,
    trigger_description: validated.triggerDescription,
    recommended_response: validated.recommendedResponse,
    status: validated.status ?? "draft",
    source,
    position,
  });

  if (validated.evidence && validated.evidence.length > 0) {
    await replacePlayEvidence(
      orgId,
      row.id,
      validated.evidence.map((item) => ({ kind: item.kind, refId: item.refId, note: item.note ?? null })),
    );
  }

  const evidenceRows = await loadEvidence(orgId, [row.id]);

  return mapPlayRow(row, evidenceRows);
};

export const updatePlay = async (
  orgId: string,
  playbookId: string,
  playId: string,
  input: UpdatePlayInput,
): Promise<PlaybookPlay> => {
  const existing = await loadPlay(orgId, playId);

  if (existing.playbook_id !== playbookId) {
    throw new Error("Ce play n'appartient pas a ce playbook.");
  }

  const patch: Record<string, unknown> = {};

  if (input.category !== undefined) {
    if (!isPlayCategory(input.category)) {
      throw new Error("Categorie de play invalide.");
    }

    patch.category = input.category;
  }

  if (input.status !== undefined) {
    if (!isPlayStatus(input.status)) {
      throw new Error("Statut de play invalide.");
    }

    patch.status = input.status;
  }

  // Reutilise la validation complete en fusionnant avec l'existant.
  const contentChanged =
    input.title !== undefined || input.triggerDescription !== undefined || input.recommendedResponse !== undefined;

  if (contentChanged) {
    const validated = validatePlayInput({
      category: (input.category ?? existing.category),
      title: input.title ?? existing.title,
      triggerDescription: input.triggerDescription ?? existing.trigger_description,
      recommendedResponse: input.recommendedResponse ?? existing.recommended_response,
    });

    patch.title = validated.title;
    patch.trigger_description = validated.triggerDescription;
    patch.recommended_response = validated.recommendedResponse;
    // Toute modification de contenu incremente la version (historique de doctrine).
    patch.version = existing.version + 1;
  }

  if (Object.keys(patch).length === 0 && input.evidence === undefined) {
    throw new Error("Aucune modification fournie.");
  }

  const row = Object.keys(patch).length > 0 ? await updatePlayRow(orgId, playId, patch) : existing;

  if (input.evidence !== undefined) {
    const validated = validatePlayInput({
      category: row.category,
      title: row.title,
      triggerDescription: row.trigger_description,
      recommendedResponse: row.recommended_response,
      evidence: input.evidence,
    });

    await replacePlayEvidence(
      orgId,
      playId,
      (validated.evidence ?? []).map((item) => ({ kind: item.kind, refId: item.refId, note: item.note ?? null })),
    );
  }

  const evidenceRows = await loadEvidence(orgId, [playId]);

  return mapPlayRow(row, evidenceRows);
};

export const reorderPlays = async (
  orgId: string,
  playbookId: string,
  orderedPlayIds: string[],
): Promise<void> => {
  if (orderedPlayIds.length === 0) {
    return;
  }

  const plays = await loadPlays(orgId, [playbookId]);
  const knownIds = new Set(plays.map((play) => play.id));

  for (const playId of orderedPlayIds) {
    if (!knownIds.has(playId)) {
      throw new Error("Un des plays a reordonner n'appartient pas a ce playbook.");
    }
  }

  await Promise.all(
    orderedPlayIds.map((playId, index) => updatePlayRow(orgId, playId, { position: index })),
  );
};
