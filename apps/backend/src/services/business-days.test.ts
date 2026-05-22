import assert from "node:assert/strict";
import test from "node:test";
import { buildBusinessDueAtFromDays } from "./business-days.js";

test("keeps weekday due dates at 09:00 UTC", () => {
  assert.equal(
    buildBusinessDueAtFromDays(1, new Date("2026-05-18T12:00:00.000Z")),
    "2026-05-19T09:00:00.000Z",
  );
});

test("moves Saturday due dates to Monday", () => {
  assert.equal(
    buildBusinessDueAtFromDays(1, new Date("2026-05-22T12:00:00.000Z")),
    "2026-05-25T09:00:00.000Z",
  );
});

test("moves Sunday due dates to Monday", () => {
  assert.equal(
    buildBusinessDueAtFromDays(2, new Date("2026-05-22T12:00:00.000Z")),
    "2026-05-25T09:00:00.000Z",
  );
});

test("moves same-day weekend tasks to the next Monday", () => {
  assert.equal(
    buildBusinessDueAtFromDays(0, new Date("2026-05-23T12:00:00.000Z")),
    "2026-05-25T09:00:00.000Z",
  );
});
