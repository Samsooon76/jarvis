import assert from "node:assert/strict";
import test from "node:test";
import { shouldUpdateClosedAtFromStageChange } from "./deal-property-sync.js";

test("sets closed_at when a deal first enters a closed stage", () => {
  assert.equal(
    shouldUpdateClosedAtFromStageChange(
      {
        deal_lifecycle_status: "pending",
        closed_at: null,
      },
      "won",
    ),
    true,
  );
});

test("keeps the signature date when a won deal moves from payment pending to payment received", () => {
  assert.equal(
    shouldUpdateClosedAtFromStageChange(
      {
        deal_lifecycle_status: "won",
        closed_at: "2026-05-20T09:00:00.000Z",
      },
      "won",
    ),
    false,
  );
});

test("repairs closed_at for already closed deals missing a signature date", () => {
  assert.equal(
    shouldUpdateClosedAtFromStageChange(
      {
        deal_lifecycle_status: "won",
        closed_at: null,
      },
      "won",
    ),
    true,
  );
});
