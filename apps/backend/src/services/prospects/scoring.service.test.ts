import assert from "node:assert/strict";
import test from "node:test";
import { scoreProspect } from "./scoring.service.js";

test("scores high probability deals as urgent with backend-owned queue fields", () => {
  const result = scoreProspect({
    dealAmount: 25_000,
    closeProbability: 85,
    dealStage: "contractsent",
    lastContactAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    dealName: "ACME Expansion",
  });

  assert.equal(result.priority, "urgent");
  assert.equal(result.next_action, "Faire avancer le deal vers la prochaine etape");
  assert.match(result.reason, /ACME Expansion/);
  assert.ok(result.ai_priority_score >= 80);
});

test("sets skipped prospects to routine with zero score", () => {
  const result = scoreProspect({
    dealAmount: 100_000,
    closeProbability: 100,
    dealStage: "decisionmakerboughtin",
    lastContactAt: null,
    skippedAt: new Date().toISOString(),
  });

  assert.equal(result.ai_priority_score, 0);
  assert.equal(result.priority, "routine");
  assert.equal(result.reason, "Prospect ignore dans la queue.");
});
