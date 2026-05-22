import assert from "node:assert/strict";
import test from "node:test";
import { parseDealActivityPlan } from "./activity-plan.js";

const buildActivityPlanJson = (dueInDays: unknown): string =>
  JSON.stringify({
    mutualActionPlan: [
      {
        title: "Relancer le sponsor",
        ownerName: "AE",
        dueDate: null,
        status: "todo",
        priority: "high",
        rationale: "Le deal attend une confirmation du sponsor.",
      },
    ],
    upcomingDeadlines: [],
    notesAndInsights: [
      {
        title: "Signal recent",
        detail: "Le dernier echange montre un interet actif.",
      },
    ],
    recommendation: {
      priority: "high",
      summary: "Relancer le sponsor pour confirmer la prochaine etape.",
      nextBestAction: {
        title: "Appeler le sponsor",
        rationale: "Clarifier la decision attendue et verrouiller la suite.",
        dueInDays,
      },
    },
    confidence: "medium",
  });

test("parses numeric-string next best action due dates from LLM output", () => {
  const analysis = parseDealActivityPlan(buildActivityPlanJson("2"), "OpenAI");

  assert.equal(analysis.recommendation.nextBestAction.dueInDays, 2);
});

test("rounds and clamps finite next best action due dates", () => {
  const analysis = parseDealActivityPlan(buildActivityPlanJson(45.4), "OpenAI");

  assert.equal(analysis.recommendation.nextBestAction.dueInDays, 30);
});

test("rejects non-numeric next best action due dates", () => {
  assert.throws(
    () => parseDealActivityPlan(buildActivityPlanJson("demain"), "OpenAI"),
    /echeance non conforme/,
  );
});
