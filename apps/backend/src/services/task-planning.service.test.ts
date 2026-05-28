import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSalesTaskPlanForEvent,
  normalizeWorkSlot,
  scoreSalesTask,
  type TaskPlanProspectSnapshot,
} from "./task-planning.service.js";

const now = new Date("2026-05-25T09:00:00.000Z");

const prospect: TaskPlanProspectSnapshot = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Ada Lovelace",
  company: "ACME",
  dealAmount: 25_000,
  closeProbability: 75,
  closeDate: "2026-05-29T12:00:00.000Z",
  lastContactAt: "2026-05-20T09:00:00.000Z",
  hubspotContactId: "123",
  hubspotDealId: "456",
};

test("incoming client responses cancel follow-up and create an urgent response task", () => {
  const plan = buildSalesTaskPlanForEvent({
    now,
    event: {
      id: "event-1",
      eventType: "email.received",
      occurredAt: "2026-05-25T09:05:00.000Z",
    },
    prospect,
  });

  assert.equal(plan.cancellations.length, 1);
  assert.equal(plan.cancellations[0]?.taskKey, `${prospect.id}:follow_up`);
  assert.equal(plan.upserts.length, 1);
  assert.equal(plan.upserts[0]?.taskType, "respond_to_client");
  assert.ok((plan.upserts[0]?.priorityScore ?? 0) >= 80);
});

test("outbound messages create deterministic follow-up tasks", () => {
  const plan = buildSalesTaskPlanForEvent({
    now,
    event: {
      id: "event-2",
      eventType: "email.sent",
      occurredAt: "2026-05-25T10:00:00.000Z",
    },
    prospect,
  });

  assert.equal(plan.cancellations[0]?.taskKey, `${prospect.id}:respond_to_client`);
  assert.equal(plan.upserts[0]?.taskType, "follow_up");
  assert.match(plan.upserts[0]?.reason ?? "", /email envoye/);
  assert.ok(new Date(plan.upserts[0]?.scheduledAt ?? "").getTime() > now.getTime());
});

test("snoozed and skipped tasks lose priority deterministically", () => {
  const baseInput = {
    taskType: "respond_to_client" as const,
    scheduledAt: "2026-05-25T09:05:00.000Z",
    dealAmount: 25_000,
    closeProbability: 80,
    closeDate: "2026-05-29T12:00:00.000Z",
    lastContactAt: "2026-05-20T09:00:00.000Z",
    hasIncomingClientResponse: true,
  };
  const pendingScore = scoreSalesTask({ ...baseInput, status: "pending" }, now);
  const snoozedScore = scoreSalesTask(
    {
      ...baseInput,
      status: "snoozed",
      snoozedUntil: "2026-05-26T09:00:00.000Z",
    },
    now,
  );
  const skippedScore = scoreSalesTask({ ...baseInput, status: "skipped" }, now);

  assert.ok(pendingScore > snoozedScore);
  assert.equal(skippedScore, 0);
});

test("normalizes task starts to sales working hours", () => {
  const localNow = new Date(2026, 4, 25, 9, 0, 0, 0);

  assert.equal(
    normalizeWorkSlot(new Date(2026, 4, 25, 8, 30, 0, 0), localNow, 20).toISOString(),
    new Date(2026, 4, 25, 9, 30, 0, 0).toISOString(),
  );
  assert.equal(
    normalizeWorkSlot(new Date(2026, 4, 25, 12, 20, 0, 0), localNow, 20).toISOString(),
    new Date(2026, 4, 25, 14, 0, 0, 0).toISOString(),
  );
  assert.equal(
    normalizeWorkSlot(new Date(2026, 4, 25, 17, 50, 0, 0), localNow, 20).toISOString(),
    new Date(2026, 4, 26, 9, 30, 0, 0).toISOString(),
  );
});
