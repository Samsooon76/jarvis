import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeCallDeterministically, extractConversationalText, isBoilerplateLine } from "./analysis.js";
import type { CallSource } from "./types.js";

const makeSource = (sourceText: string): CallSource => ({
  callId: "call-1",
  orgId: "org-1",
  userId: "user-1",
  prospectId: "prospect-1",
  startedAt: "2026-06-12T15:25:00.000Z",
  durationSeconds: 170,
  direction: "outbound",
  status: "completed",
  transcript: null,
  fallbackNotes: sourceText,
  sourceText,
  sourceKind: "notes",
  memberCallIds: ["call-1"],
});

describe("call analysis - filtrage du boilerplate", () => {
  it("identifie les lignes de plomberie Onoff/Modjo/HubSpot", () => {
    assert.equal(isBoilerplateLine("Appel sortant répondu de Samantha brebant (+33 7 44 31 01 06) / Onoff Business"), true);
    assert.equal(isBoilerplateLine("Destinataire de l'appel: Marianne Le Person"), true);
    assert.equal(isBoilerplateLine("Disposition: f240bbac-87c9-4f6e-bf70-924b57d47db7"), true);
    assert.equal(isBoilerplateLine("Would like to go deeper into the call: Ask anything to Modjo AI"), true);
    assert.equal(isBoilerplateLine("This call on Modjo: Appel sortant"), true);
    assert.equal(isBoilerplateLine("Tags on this call: AE - Cold Call"), true);
    assert.equal(isBoilerplateLine("Samantha a rappelé Marianne pour faire le point sur le partenariat."), false);
    assert.equal(isBoilerplateLine("Participants : Samantha (OnOff Business) et Marianne"), false);
  });

  it("le resume s'appuie sur le contenu conversationnel, pas sur le log telephonique", () => {
    const source = makeSource(
      [
        "Appel sortant répondu de Samantha brebant (+33 7 44 31 01 06) / Onoff Business",
        "Destinataire de l'appel: Marianne Le Person",
        "Would like to go deeper into the call: Ask anything to Modjo AI",
        "Résumé de la conversation",
        "Samantha a rappelé Marianne pour faire le point sur le partenariat discuté début juin.",
        "Marianne souhaite une démo avec son équipe avant de valider le budget.",
      ].join("\n"),
    );

    const analysis = analyzeCallDeterministically(source);

    assert.match(analysis.summary, /Samantha a rappelé Marianne|Résumé de la conversation/);
    assert.equal(analysis.summary.includes("+33"), false);
    assert.equal(
      analysis.customerSignals.some((signal) => signal.includes("Onoff Business") || signal.includes("Modjo AI")),
      false,
    );
  });

  it("signale l'absence de contenu conversationnel (log telephonique seul)", () => {
    const source = makeSource(
      ["Appel sortant répondu de Samantha brebant / Onoff Business", "Date: 2026-06-12 13:25:22 UTC"].join("\n"),
    );

    const analysis = analyzeCallDeterministically(source);

    assert.match(analysis.summary, /Pas de contenu conversationnel/);
    assert.deepEqual(analysis.customerSignals, []);
    assert.equal(analysis.confidence, "low");
  });

  it("extractConversationalText ne garde que les lignes utiles", () => {
    const text = extractConversationalText(
      ["Titre: Appel sortant", "Samantha a présenté l'offre.", "Disposition: abc-123"].join("\n"),
    );

    assert.equal(text, "Samantha a présenté l'offre.");
  });
});
