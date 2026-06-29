import assert from "node:assert/strict";
import test from "node:test";
import { periodIncludesDate, periodIncludesToday } from "./shared.js";

test("periodIncludesDate matches inclusive UTC date bounds", () => {
  assert.equal(periodIncludesDate("2026-06-01", "2026-06-30", "2026-06-15"), true);
  assert.equal(periodIncludesDate("2026-06-01", "2026-06-30", "2026-05-31"), false);
  assert.equal(periodIncludesDate("2026-06-01", "2026-06-30", "2026-07-01"), false);
});

test("periodIncludesToday only matches periods covering the reference day", () => {
  const referenceDate = new Date("2026-06-29T12:00:00.000Z");

  assert.equal(periodIncludesToday("2026-06-01", "2026-06-30", referenceDate), true);
  assert.equal(periodIncludesToday("2026-07-01", "2026-07-31", referenceDate), false);
  assert.equal(periodIncludesToday("2026-05-01", "2026-05-31", referenceDate), false);
});