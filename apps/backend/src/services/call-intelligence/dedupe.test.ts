import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canMergeCalls, groupDuplicateCalls, type DedupeCall } from "./dedupe.js";

const makeCall = (overrides: Partial<DedupeCall> & { id: string }): DedupeCall => ({
  startedAt: "2026-06-12T15:25:00.000Z",
  durationSeconds: 170,
  prospectId: "prospect-1",
  userId: "user-1",
  richness: 0,
  ...overrides,
});

describe("call dedupe", () => {
  it("fusionne un log Onoff et un log Modjo du meme appel (starts decales, durees proches)", () => {
    // Cas reel: Onoff logge a 15:25 (2m50), Modjo a 15:28 (2m49).
    const onoff = makeCall({ id: "onoff", startedAt: "2026-06-12T15:25:00.000Z", durationSeconds: 170, richness: 50 });
    const modjo = makeCall({ id: "modjo", startedAt: "2026-06-12T15:28:00.000Z", durationSeconds: 169, richness: 900 });

    assert.equal(canMergeCalls(onoff, modjo), true);

    const groups = groupDuplicateCalls([onoff, modjo]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.canonicalId, "modjo");
    assert.deepEqual([...(groups[0]?.memberIds ?? [])].sort(), ["modjo", "onoff"]);
    assert.equal(groups[0]?.durationSeconds, 170);
    assert.equal(groups[0]?.startedAt, "2026-06-12T15:25:00.000Z");
  });

  it("ne fusionne pas un message vocal suivi d'un vrai call (durees incompatibles)", () => {
    const voicemail = makeCall({ id: "voicemail", durationSeconds: 5 });
    const realCall = makeCall({ id: "real", startedAt: "2026-06-12T15:26:00.000Z", durationSeconds: 170 });

    assert.equal(canMergeCalls(voicemail, realCall), false);
    assert.equal(groupDuplicateCalls([voicemail, realCall]).length, 2);
  });

  it("ne fusionne pas deux appels d'owners differents", () => {
    const repA = makeCall({ id: "rep-a", userId: "user-1" });
    const repB = makeCall({ id: "rep-b", userId: "user-2" });

    assert.equal(canMergeCalls(repA, repB), false);
  });

  it("ne fusionne pas deux appels de prospects differents", () => {
    const first = makeCall({ id: "first", prospectId: "prospect-1" });
    const second = makeCall({ id: "second", prospectId: "prospect-2" });

    assert.equal(canMergeCalls(first, second), false);
  });

  it("tolere un prospect manquant d'un cote (Modjo n'associe pas toujours le contact)", () => {
    const onoff = makeCall({ id: "onoff", prospectId: "prospect-1" });
    const modjo = makeCall({ id: "modjo", startedAt: "2026-06-12T15:26:30.000Z", prospectId: null, richness: 500 });

    assert.equal(canMergeCalls(onoff, modjo), true);
  });

  it("ne fusionne pas deux appels eloignes dans le temps malgre des durees identiques", () => {
    const morning = makeCall({ id: "morning", startedAt: "2026-06-12T09:00:00.000Z" });
    const afternoon = makeCall({ id: "afternoon", startedAt: "2026-06-12T15:00:00.000Z" });

    assert.equal(canMergeCalls(morning, afternoon), false);
  });

  it("fusionne Onoff au debut et Modjo a la fin quand l'ecart entre logs ~= duree de l'appel", () => {
    // Cas reel: Onoff 15:52 (691 s), Modjo 16:03 (691 s) pour le meme appel.
    const onoff = makeCall({
      id: "onoff",
      startedAt: "2026-05-21T15:52:16.000Z",
      durationSeconds: 691,
      prospectId: null,
      richness: 120,
    });
    const modjo = makeCall({
      id: "modjo",
      startedAt: "2026-05-21T16:03:47.000Z",
      durationSeconds: 691,
      prospectId: null,
      richness: 40,
    });

    assert.equal(canMergeCalls(onoff, modjo), true);

    const groups = groupDuplicateCalls([onoff, modjo]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.canonicalId, "onoff");
    assert.equal(groups[0]?.durationSeconds, 691);
    assert.equal(groups[0]?.startedAt, "2026-05-21T15:52:16.000Z");
  });

  it("ne fusionne jamais sans horodatage", () => {
    const dated = makeCall({ id: "dated" });
    const undated = makeCall({ id: "undated", startedAt: null });

    assert.equal(canMergeCalls(dated, undated), false);
  });

  it("garde deux messages vocaux rapproches comme un seul groupe et deux espaces comme deux", () => {
    // Deux tentatives a 18 minutes d'ecart = deux appels distincts.
    const firstTry = makeCall({ id: "try-1", startedAt: "2026-06-12T17:37:00.000Z", durationSeconds: 5 });
    const secondTry = makeCall({ id: "try-2", startedAt: "2026-06-12T17:55:00.000Z", durationSeconds: 5 });

    assert.equal(groupDuplicateCalls([firstTry, secondTry]).length, 2);
  });

  it("trie les groupes du plus recent au plus ancien", () => {
    const older = makeCall({ id: "older", startedAt: "2026-06-12T10:00:00.000Z" });
    const newer = makeCall({ id: "newer", startedAt: "2026-06-12T16:00:00.000Z" });

    const groups = groupDuplicateCalls([older, newer]);

    assert.deepEqual(groups.map((group) => group.canonicalId), ["newer", "older"]);
  });
});
