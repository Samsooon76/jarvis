import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPlayCategory,
  isPlayStatus,
  mapPlaybookRow,
  mapPlayRow,
  MAX_TITLE_LENGTH,
  validatePlaybookName,
  validatePlayInput,
} from "./shared.js";
import type { PlaybookPlayEvidenceRow, PlaybookPlayRow, PlaybookRow } from "./types.js";

const basePlayInput = {
  category: "discovery" as const,
  title: "Cartographier le comite d'achat",
  triggerDescription: "Premier call discovery avec un seul interlocuteur identifie.",
  recommendedResponse: "Demander qui d'autre est implique dans la decision et proposer un call elargi.",
};

describe("playbook shared", () => {
  it("valide et normalise un play correct", () => {
    const validated = validatePlayInput({
      ...basePlayInput,
      title: `  ${basePlayInput.title}  `,
      evidence: [{ kind: "deal", refId: " 12345 ", note: "" }],
    });

    assert.equal(validated.title, basePlayInput.title);
    assert.equal(validated.status, "draft");
    assert.deepEqual(validated.evidence, [{ kind: "deal", refId: "12345", note: null }]);
  });

  it("rejette une categorie inconnue", () => {
    assert.throws(
      () => validatePlayInput({ ...basePlayInput, category: "improvisation" as never }),
      /Categorie de play invalide/,
    );
  });

  it("rejette un play sans declencheur", () => {
    assert.throws(() => validatePlayInput({ ...basePlayInput, triggerDescription: "  " }), /declencheur/);
  });

  it("rejette un titre trop long", () => {
    assert.throws(
      () => validatePlayInput({ ...basePlayInput, title: "x".repeat(MAX_TITLE_LENGTH + 1) }),
      /depasse/,
    );
  });

  it("rejette une preuve sans refId", () => {
    assert.throws(
      () => validatePlayInput({ ...basePlayInput, evidence: [{ kind: "call", refId: " " }] }),
      /identifiant de source/,
    );
  });

  it("valide les noms de playbook", () => {
    assert.equal(validatePlaybookName("  Playbook AE  "), "Playbook AE");
    assert.throws(() => validatePlaybookName(""), /requis/);
    assert.throws(() => validatePlaybookName(123), /requis/);
  });

  it("expose des gardes de type coherents", () => {
    assert.equal(isPlayCategory("objection_handling"), true);
    assert.equal(isPlayCategory("unknown"), false);
    assert.equal(isPlayStatus("active"), true);
    assert.equal(isPlayStatus("paused"), false);
  });

  it("mappe les rows snake_case vers les contrats camelCase", () => {
    const playRow: PlaybookPlayRow = {
      id: "play-1",
      org_id: "org-1",
      playbook_id: "pb-1",
      category: "demo",
      title: "Demo personnalisee",
      trigger_description: "Objection pricing en demo",
      recommended_response: "Pivoter vers une demo ciblee sur le ROI.",
      status: "active",
      source: "manual",
      position: 2,
      version: 3,
      created_at: "2026-06-12T10:00:00Z",
      updated_at: "2026-06-12T11:00:00Z",
    };
    const evidenceRow: PlaybookPlayEvidenceRow = {
      id: "ev-1",
      org_id: "org-1",
      play_id: "play-1",
      kind: "deal",
      ref_id: "999",
      note: null,
      created_at: "2026-06-12T10:00:00Z",
    };

    const play = mapPlayRow(playRow, [evidenceRow]);

    assert.equal(play.triggerDescription, playRow.trigger_description);
    assert.equal(play.evidence[0]?.refId, "999");
    assert.equal(play.version, 3);

    const playbookRow: PlaybookRow = {
      id: "pb-1",
      org_id: "org-1",
      name: "Playbook AE",
      description: null,
      status: "active",
      created_by: null,
      created_at: "2026-06-12T10:00:00Z",
      updated_at: "2026-06-12T10:00:00Z",
    };
    const playbook = mapPlaybookRow(playbookRow, 5, 3);

    assert.equal(playbook.playCount, 5);
    assert.equal(playbook.activePlayCount, 3);
  });
});
