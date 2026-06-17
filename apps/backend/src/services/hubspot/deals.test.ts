import assert from "node:assert/strict";
import test from "node:test";
import { buildDealContextSummary } from "./deals.js";
import type { HubSpotDeal } from "./types.js";
import type { HubSpotDealStageDefinition } from "./pipelines.js";

const buildDeal = (properties: Record<string, string | null>): HubSpotDeal => ({
  id: "123",
  properties,
});

test("buildDealContextSummary resolves HubSpot stage ids to labels", () => {
  const dealStageLookup = new Map<string, HubSpotDealStageDefinition>([
    [
      "375918016",
      {
        pipelineId: "default",
        pipelineLabel: "Pipeline ventes",
        label: "Proposition envoyee",
        displayOrder: 3,
        isClosed: false,
        probability: 0.8,
      },
    ],
  ]);

  const summary = buildDealContextSummary(
    buildDeal({
      dealname: "ACME - Licence",
      dealstage: "375918016",
      amount: "1043.7",
      hs_deal_stage_probability: "0.8",
      closedate: "2026-06-30",
      hs_lastmodifieddate: "2026-06-10",
    }),
    dealStageLookup,
  );

  assert.match(summary ?? "", /Stage: Proposition envoyee/);
  assert.doesNotMatch(summary ?? "", /375918016/);
  assert.match(summary ?? "", /Probabilite: 80%/);
});