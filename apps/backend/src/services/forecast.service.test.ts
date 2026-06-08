import assert from "node:assert/strict";
import test from "node:test";
import {
  buildForecastSynthesisInputHash,
  enrichForecastSynthesis,
  getForecastDealStatus,
  summarizeForecastDeals,
  type ForecastDeal,
} from "./forecast.service.js";
import { parseForecastSynthesisAnalysis } from "./llm/forecast-synthesis.js";

const buildDeal = (overrides: Partial<ForecastDeal>): ForecastDeal => ({
  hubspotDealId: "deal-1",
  dealName: "Deal test",
  companyName: "Acme",
  contactName: null,
  ownerName: null,
  ownerHubSpotId: null,
  amount: 10_000,
  stage: "Testing",
  closeDate: "2026-05-20T00:00:00.000Z",
  syncedAt: "2026-05-20T10:00:00.000Z",
  forecastBucket: "openForecast",
  aiProbability: 50,
  crmProbability: 40,
  forecastAmount: 5_000,
  impactAmount: 5_000,
  analysisStatus: "fresh",
  analyzedAt: "2026-05-20T11:00:00.000Z",
  confidence: "medium",
  dealHealth: "medium",
  summary: null,
  suggestedMove: null,
  risks: [],
  positiveSignals: [],
  ...overrides,
});

test("classifies signed payment pending and payment received as close won forecast buckets", () => {
  assert.equal(
    getForecastDealStatus({
      deal_stage: null,
      deal_stage_label: "Deal Signed/Payment Pending",
      deal_lifecycle_status: "pending",
      is_closed_deal: false,
    }),
    "signedPaymentPending",
  );
  assert.equal(
    getForecastDealStatus({
      deal_stage: null,
      deal_stage_label: "Payment Received",
      deal_lifecycle_status: "pending",
      is_closed_deal: false,
    }),
    "paymentReceived",
  );
});

test("keeps contract validation open and excludes closed lost", () => {
  assert.equal(
    getForecastDealStatus({
      deal_stage: null,
      deal_stage_label: "Contract Validation",
      deal_lifecycle_status: "won",
      is_closed_deal: true,
    }),
    "openForecast",
  );
  assert.equal(
    getForecastDealStatus({
      deal_stage: null,
      deal_stage_label: "Closed Lost",
      deal_lifecycle_status: "lost",
      is_closed_deal: true,
    }),
    "closedLost",
  );
});

test("summarizes signed revenue at 100 percent plus weighted open forecast", () => {
  const summary = summarizeForecastDeals([
    buildDeal({
      hubspotDealId: "signed-pending",
      amount: 12_000,
      forecastAmount: 12_000,
      impactAmount: 12_000,
      forecastBucket: "signedPaymentPending",
      aiProbability: 100,
      crmProbability: 100,
      analysisStatus: "closed_won",
    }),
    buildDeal({
      hubspotDealId: "paid",
      amount: 8_000,
      forecastAmount: 8_000,
      impactAmount: 8_000,
      forecastBucket: "paymentReceived",
      aiProbability: 100,
      crmProbability: 100,
      analysisStatus: "closed_won",
    }),
    buildDeal({
      hubspotDealId: "open",
      amount: 10_000,
      forecastAmount: 4_000,
      impactAmount: 4_000,
      forecastBucket: "openForecast",
      aiProbability: 40,
      crmProbability: 30,
    }),
  ]);

  assert.equal(summary.signedAmount, 20_000);
  assert.equal(summary.signedPaymentPendingAmount, 12_000);
  assert.equal(summary.paymentReceivedAmount, 8_000);
  assert.equal(summary.openPipelineAmount, 10_000);
  assert.equal(summary.openForecastAmount, 4_000);
  assert.equal(summary.landingAmount, 24_000);
  assert.equal(summary.pipelineAmount, 30_000);
});

test("parseForecastSynthesisAnalysis drops verdicts for unknown deals and bounds lengths", () => {
  const longReason = "x".repeat(300);
  const raw = JSON.stringify({
    headline: "y".repeat(300),
    confidence: "medium",
    dealVerdicts: [
      { hubspotDealId: "deal-1", category: "commit", reason: longReason, recommendedAction: "Relancer le sponsor" },
      { hubspotDealId: "ghost", category: "commit", reason: "Deal hallucine", recommendedAction: null },
      { hubspotDealId: "deal-1", category: "atRisk", reason: "Doublon ignore", recommendedAction: null },
      { hubspotDealId: "deal-2", category: "bogus", reason: "Categorie invalide", recommendedAction: null },
    ],
    actionPlan: [
      { title: "Pousser deal-1", rationale: "Gros montant proche du close", priority: "high", relatedDealIds: ["deal-1", "ghost"] },
      { title: "Action invalide", rationale: "x", priority: "urgent", relatedDealIds: [] },
    ],
  });

  const analysis = parseForecastSynthesisAnalysis(raw, ["deal-1", "deal-2"], "Test");

  // Verdicts: ghost (inconnu) et doublon deal-1 ignores; deal-2 (categorie invalide) ignore.
  assert.equal(analysis.dealVerdicts.length, 1);
  assert.equal(analysis.dealVerdicts[0]?.hubspotDealId, "deal-1");
  assert.equal(analysis.dealVerdicts[0]?.category, "commit");
  assert.ok(analysis.dealVerdicts[0]?.reason.endsWith("..."));
  assert.ok((analysis.dealVerdicts[0]?.reason.length ?? 0) <= 142);
  assert.ok(analysis.headline.endsWith("..."));
  assert.ok(analysis.headline.length <= 182);
  // ActionPlan: action a priorite invalide ignoree; relatedDealIds filtre les ids inconnus.
  assert.equal(analysis.actionPlan.length, 1);
  assert.deepEqual(analysis.actionPlan[0]?.relatedDealIds, ["deal-1"]);
});

test("enrichForecastSynthesis joins verdicts to deals and aggregates per category", () => {
  const deals = [
    buildDeal({ hubspotDealId: "deal-1", amount: 10_000, forecastAmount: 8_000 }),
    buildDeal({ hubspotDealId: "deal-2", amount: 6_000, forecastAmount: 1_000, aiProbability: 20, dealHealth: "at_risk" }),
    buildDeal({ hubspotDealId: "deal-3", amount: 4_000, forecastAmount: 2_000 }),
  ];

  const synthesis = enrichForecastSynthesis({
    analysis: {
      headline: "Mois solide cote commit",
      confidence: "high",
      dealVerdicts: [
        { hubspotDealId: "deal-1", category: "commit", reason: "Proche signature", recommendedAction: "Envoyer le bon de commande" },
        { hubspotDealId: "deal-2", category: "atRisk", reason: "Budget non valide", recommendedAction: null },
      ],
      actionPlan: [],
    },
    analyzedOpenDeals: deals,
    objectiveAmount: 30_000,
    gapToObjective: 10_000,
    signedAmount: 12_000,
    dateTo: "2026-06-30",
    provider: "Test",
    model: "test-model",
    generatedAt: "2026-06-08T00:00:00.000Z",
    status: "fresh",
  });

  // deal-3 non couvert par l'IA -> classe par le fallback deterministe (proba 50 -> bestCase).
  const byCategory = new Map(synthesis.categories.map((category) => [category.category, category]));
  assert.equal(byCategory.get("commit")?.dealCount, 1);
  assert.equal(byCategory.get("commit")?.amount, 10_000);
  assert.equal(byCategory.get("atRisk")?.dealCount, 1);
  assert.equal(byCategory.get("bestCase")?.dealCount, 1);
  assert.equal(synthesis.deals.find((deal) => deal.hubspotDealId === "deal-3")?.category, "bestCase");
  // projectedCloseAmount = signe + montant des deals "commit".
  assert.equal(synthesis.projectedCloseAmount, 22_000);
  assert.equal(synthesis.analyzedDealCount, 3);
});

test("buildForecastSynthesisInputHash is stable regardless of deal order and changes with analysis", () => {
  const dealA = buildDeal({ hubspotDealId: "deal-1", analyzedAt: "2026-06-01T00:00:00.000Z" });
  const dealB = buildDeal({ hubspotDealId: "deal-2", analyzedAt: "2026-06-02T00:00:00.000Z" });

  const hash1 = buildForecastSynthesisInputHash([dealA, dealB], 30_000, "2026-06-01", "2026-06-30");
  const hash2 = buildForecastSynthesisInputHash([dealB, dealA], 30_000, "2026-06-01", "2026-06-30");
  const hashChangedAnalysis = buildForecastSynthesisInputHash(
    [dealA, buildDeal({ hubspotDealId: "deal-2", analyzedAt: "2026-06-05T00:00:00.000Z" })],
    30_000,
    "2026-06-01",
    "2026-06-30",
  );

  assert.equal(hash1, hash2);
  assert.notEqual(hash1, hashChangedAnalysis);
});
