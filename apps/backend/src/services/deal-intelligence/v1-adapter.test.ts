import assert from "node:assert/strict";
import test from "node:test";
import type { DealAnalysisV1 } from "@jarvis/shared";
import {
  mapDealAnalysisV1ToActivityPlan,
  mapDealAnalysisV1ToIntelligence,
  mapDealAnalysisV1ToQualification,
} from "./v1-adapter.js";

const buildMinimalAnalysis = (): DealAnalysisV1 => ({
  identifiers: {
    hubspotDealId: "deal-1",
    orgId: "org-1",
    hubspotOwnerId: null,
    primaryContactId: null,
    primaryCompanyId: null,
    prospectId: null,
  },
  metadata: {
    generatedAt: "2026-06-15T12:00:00.000Z",
    lastUpdated: "2026-06-15T12:00:00.000Z",
    modelUsed: "gpt-4.1",
    provider: "OpenAI",
    analysisVersion: "1.0",
    confidence: "medium",
    cache: {
      inputHash: "hash",
      sourceSyncedAt: null,
      analysisType: "deal_full",
      lifecycleStatus: "open",
    },
  },
  company: {
    name: "Acme",
    industry: null,
    size: null,
    country: null,
    currentTools: [],
    crmUrl: null,
  },
  dealOverview: {
    summary: "Deal en bonne progression.",
    stage: "Validation",
    pipeline: "Sales",
    amount: 10000,
    currency: "EUR",
    expectedCloseDate: null,
    closingProbability: 62,
    confidenceLevel: "medium",
    dealHealth: "medium",
    executiveSummary: "Le deal avance avec un champion actif.",
    whyNow: "Decision attendue ce trimestre.",
    mainObjective: null,
    businessImpact: null,
    urgencyLevel: "medium",
    strategicImportance: null,
  },
  stakeholders: [
    {
      name: "Marie",
      role: "Head of Sales",
      influenceLevel: "high",
      sentiment: "positive",
      buyerRole: "champion",
      mainConcerns: [],
      evidence: [{ activityId: null, activityType: "email", occurredAt: null, title: null, quote: "Marie relance", confidence: "high" }],
    },
  ],
  signals: [
    {
      id: "risk-1",
      kind: "risk",
      title: "Budget non confirme",
      severity: "medium",
      status: "active",
      objectionType: null,
      businessImpact: null,
      responseGiven: null,
      remainingConcern: null,
      evidence: [{ activityId: null, activityType: "note", occurredAt: null, title: null, quote: "Budget a valider", confidence: "medium" }],
      lastUpdated: null,
    },
  ],
  qualification: {
    meddicc: [
      {
        id: "champion",
        label: "Champion",
        status: "confirmed",
        score: 80,
        evidence: [{ activityId: null, activityType: "email", occurredAt: null, title: null, quote: "Champion identifie", confidence: "high" }],
        gap: null,
      },
    ],
    decisionProcess: {
      status: "partial",
      decisionMakers: [],
      champions: ["Marie"],
      blockers: [],
      influencers: [],
      approvalSteps: [],
      legalProcurementRequired: false,
      technicalValidationRequired: true,
      legalStatus: "unknown",
      purchaseProcess: "to_confirm",
      timeline: null,
      evidence: [],
    },
    budget: {
      status: "unclear",
      amount: null,
      currency: "EUR",
      budgetOwner: null,
      pricingSensitivity: "medium",
      evidence: [],
    },
    competition: {
      status: "unknown",
      competitors: [],
      currentSolution: null,
      competitiveRisks: [],
      positioningAngle: null,
      evidence: [],
    },
    productFit: {
      fitScore: 70,
      strongFitReasons: ["Fit process"],
      weakFitReasons: [],
      missingFeatures: [],
      technicalConstraints: [],
      integrationRequirements: [],
      securityCompliance: [],
      evidence: [],
    },
    multiThreading: {
      status: "partial",
      contactedRoles: ["Sales"],
      missingRoles: ["Finance"],
      evidence: [],
    },
    confidence: "medium",
  },
  activitySignals: {
    lastTouchAt: null,
    daysSinceLastTouch: null,
    touchpointCount30d: null,
    callsCountByStage: {},
    emailsCountByStage: {},
    meetingsCountByStage: {},
    benchmarkGaps: [],
    engagementTrend: "stable",
    stageAgeDays: null,
  },
  forecast: {
    forecastCategory: "best_case",
    probability: 62,
    mainPositiveSignals: ["Champion actif"],
    mainNegativeSignals: ["Budget"],
    dealMomentum: "stable",
    riskOfSlippage: "medium",
    reasoningSummary: "Bon engagement mais budget a confirmer.",
    confidence: "medium",
  },
  actionPlan: {
    nextSteps: [
      {
        action: "Valider le budget",
        owner: "sales_rep",
        dueDate: null,
        priority: "high",
        status: "pending",
        createCrmTask: true,
        evidence: [],
      },
    ],
    mutualActionPlan: [],
    upcomingDeadlines: [],
    salesStrategy: {
      recommendedAction: "Confirmer le budget avec le sponsor",
      managerAdvice: null,
      bestAngle: "ROI",
      whatToAvoid: [],
      suggestedMessage: null,
      talkingPoints: ["ROI", "Champion"],
    },
  },
  lifecycle: { kind: "open" },
  timeline: {
    firstContactDate: null,
    lastInteractionDate: null,
    keyEvents: [],
  },
  dataQuality: {
    missingInformation: ["Budget owner"],
    uncertainAssumptions: [],
    fieldsRequiringHumanReview: [],
  },
});

test("maps DealAnalysisV1 to legacy intelligence slice", () => {
  const intelligence = mapDealAnalysisV1ToIntelligence(buildMinimalAnalysis());

  assert.equal(intelligence.closeWonProbability, 62);
  assert.equal(intelligence.dealHealth, "medium");
  assert.equal(intelligence.nextSteps.length, 1);
  assert.equal(intelligence.risks[0], "Budget non confirme");
});

test("maps DealAnalysisV1 to legacy qualification slice", () => {
  const qualification = mapDealAnalysisV1ToQualification(buildMinimalAnalysis());

  assert.equal(qualification.buyingCommittee[0]?.name, "Marie");
  assert.equal(qualification.meddicc[0]?.id, "champion");
  assert.equal(qualification.decisionProcess.budgetStatus, "blocked");
});

test("maps DealAnalysisV1 to legacy activity plan slice", () => {
  const activityPlan = mapDealAnalysisV1ToActivityPlan(buildMinimalAnalysis());

  assert.equal(activityPlan.recommendation.nextBestAction.title, "Valider le budget");
  assert.equal(activityPlan.notesAndInsights.length, 1);
});