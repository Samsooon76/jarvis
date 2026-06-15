import assert from "node:assert/strict";
import test from "node:test";
import { parseAskJarvisResponse } from "./ask.js";

test("parseAskJarvisResponse accepte une reponse json valide", () => {
  const parsed = parseAskJarvisResponse(
    JSON.stringify({
      answer: "Relancer le champion cette semaine.",
      confidence: "high",
      sources: ["historique CRM"],
    }),
    "openai",
  );

  assert.equal(parsed.answer, "Relancer le champion cette semaine.");
  assert.equal(parsed.confidence, "high");
  assert.deepEqual(parsed.sources, ["historique CRM"]);
});

test("parseAskJarvisResponse rejette une reponse vide", () => {
  assert.throws(
    () =>
      parseAskJarvisResponse(
        JSON.stringify({
          answer: "",
          confidence: "low",
          sources: [],
        }),
        "openai",
      ),
    /vide/,
  );
});