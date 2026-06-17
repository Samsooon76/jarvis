import assert from "node:assert/strict";
import test from "node:test";
import { assembleDealAnalysisV1, parseDealAnalysisV1 } from "./deal-analysis-v1.js";
import type { AnalyzeDealAnalysisV1Input } from "./llm.provider.js";

const baseInput: AnalyzeDealAnalysisV1Input = {
  orgId: "org-1",
  hubspotDealId: "deal-1",
  lifecycleStatus: "open",
  history: "Note: le prospect veut avancer.",
  dealName: "Acme rollout",
  companyName: "Acme",
  hubspotOwnerId: "owner-1",
  inputHash: "hash-1",
  sourceSyncedAt: "2026-06-15T10:00:00.000Z",
};

const buildOpenDealJson = (): string =>
  JSON.stringify({
    confidence: "medium",
    company: {
      name: "Acme",
      industry: "SaaS",
      size: "50-200",
      country: "France",
      currentTools: ["HubSpot"],
      crmUrl: null,
    },
    dealOverview: {
      summary: "Deal en phase de validation technique avec un bon engagement recent.",
      stage: "Validation",
      pipeline: "Sales",
      amount: 12000,
      currency: "EUR",
      expectedCloseDate: "2026-07-01",
      closingProbability: 65,
      confidenceLevel: "medium",
      dealHealth: "medium",
      executiveSummary: "Le deal progresse mais depend encore d'une validation technique.",
      whyNow: "Le sponsor veut trancher avant la fin du trimestre.",
      mainObjective: "Automatiser le suivi commercial",
      businessImpact: "Gain de temps equipe sales",
      urgencyLevel: "medium",
      strategicImportance: "Logo mid-market strategique",
    },
    stakeholders: [
      {
        name: "Marie Dupont",
        role: "Head of Sales",
        influenceLevel: "high",
        sentiment: "positive",
        buyerRole: "champion",
        mainConcerns: ["integration"],
        evidence: [{ quote: "Marie demande une demo integration", activityType: "email", confidence: "high" }],
      },
    ],
    signals: [
      {
        id: "signal-1",
        kind: "risk",
        title: "Validation technique non finalisee",
        severity: "medium",
        status: "active",
        objectionType: null,
        businessImpact: "Peut retarder la signature",
        responseGiven: null,
        remainingConcern: "Besoin d'un call IT",
        evidence: [{ quote: "IT doit valider l'API", activityType: "note", confidence: "medium" }],
        lastUpdated: null,
      },
    ],
    qualification: {
      meddicc: [
        {
          id: "metrics",
          label: "Metrics",
          status: "partial",
          score: 50,
          evidence: [{ quote: "Objectif de gain de temps evoque", activityType: "call", confidence: "medium" }],
          gap: "Quantifier le ROI",
        },
        {
          id: "economicBuyer",
          label: "Economic buyer",
          status: "unclear",
          score: 20,
          evidence: [],
          gap: "Identifier le budget owner",
        },
        {
          id: "decisionCriteria",
          label: "Decision criteria",
          status: "partial",
          score: 40,
          evidence: [{ quote: "Integration et support sont cites", activityType: "email", confidence: "medium" }],
          gap: null,
        },
        {
          id: "decisionProcess",
          label: "Decision process",
          status: "partial",
          score: 45,
          evidence: [{ quote: "Validation IT puis comite", activityType: "note", confidence: "medium" }],
          gap: null,
        },
        {
          id: "paperProcess",
          label: "Paper process",
          status: "missing",
          score: 0,
          evidence: [],
          gap: "Process legal inconnu",
        },
        {
          id: "identifyPain",
          label: "Identify pain",
          status: "confirmed",
          score: 70,
          evidence: [{ quote: "Suivi commercial trop manuel", activityType: "call", confidence: "high" }],
          gap: null,
        },
        {
          id: "champion",
          label: "Champion",
          status: "confirmed",
          score: 75,
          evidence: [{ quote: "Marie pousse le projet", activityType: "email", confidence: "high" }],
          gap: null,
        },
        {
          id: "competition",
          label: "Competition",
          status: "unclear",
          score: 10,
          evidence: [],
          gap: "Aucun concurrent identifie",
        },
      ],
      decisionProcess: {
        status: "partial",
        decisionMakers: ["CFO"],
        champions: ["Marie Dupont"],
        blockers: [],
        influencers: ["IT"],
        approvalSteps: ["Validation IT", "Comite direction"],
        legalProcurementRequired: false,
        technicalValidationRequired: true,
        legalStatus: "unknown",
        purchaseProcess: "to_confirm",
        timeline: "Decision visée en juillet",
        evidence: [{ quote: "Validation IT avant signature", activityType: "note", confidence: "medium" }],
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
        strongFitReasons: ["Fit process sales"],
        weakFitReasons: [],
        missingFeatures: [],
        technicalConstraints: ["API"],
        integrationRequirements: ["HubSpot"],
        securityCompliance: [],
        evidence: [{ quote: "Integration HubSpot indispensable", activityType: "email", confidence: "high" }],
      },
      multiThreading: {
        status: "partial",
        contactedRoles: ["Sales", "IT"],
        missingRoles: ["Finance"],
        evidence: [],
      },
      confidence: "medium",
    },
    activitySignals: {
      lastTouchAt: "2026-06-14T09:00:00.000Z",
      daysSinceLastTouch: 1,
      touchpointCount30d: 6,
      callsCountByStage: { Validation: 1 },
      emailsCountByStage: { Validation: 2 },
      meetingsCountByStage: { Discovery: 1 },
      benchmarkGaps: [],
      engagementTrend: "stable",
      stageAgeDays: 12,
    },
    forecast: {
      forecastCategory: "best_case",
      probability: 65,
      mainPositiveSignals: ["Champion actif"],
      mainNegativeSignals: ["Budget non confirme"],
      dealMomentum: "stable",
      riskOfSlippage: "medium",
      reasoningSummary: "Bon engagement mais dependances IT et budget.",
      confidence: "medium",
    },
    actionPlan: {
      nextSteps: [
        {
          action: "Organiser call IT",
          owner: "sales_rep",
          dueDate: null,
          priority: "high",
          status: "pending",
          createCrmTask: true,
          evidence: [{ quote: "Validation IT demandee", activityType: "note", confidence: "high" }],
        },
      ],
      mutualActionPlan: [],
      upcomingDeadlines: [],
      salesStrategy: {
        recommendedAction: "Securiser la validation IT cette semaine",
        managerAdvice: null,
        bestAngle: "Gain de temps equipe sales",
        whatToAvoid: ["Presser la signature sans IT"],
        suggestedMessage: null,
        talkingPoints: ["Integration HubSpot", "ROI gain de temps"],
      },
    },
    lifecycle: { kind: "open" },
    timeline: {
      firstContactDate: "2026-05-01",
      lastInteractionDate: "2026-06-14",
      keyEvents: [
        {
          date: "2026-06-14",
          event: "Email de relance integration",
          impact: "positive",
          evidence: [{ quote: "Marie confirme l'interet", activityType: "email", confidence: "high" }],
        },
      ],
    },
    dataQuality: {
      missingInformation: ["Budget owner"],
      uncertainAssumptions: [],
      fieldsRequiringHumanReview: [],
    },
  });

test("parseDealAnalysisV1 assembles identifiers and metadata from backend input", () => {
  const analysis = parseDealAnalysisV1(buildOpenDealJson(), "OpenAI", baseInput, {
    provider: "OpenAI",
    model: "gpt-4.1",
    inputHash: "hash-1",
    sourceSyncedAt: "2026-06-15T10:00:00.000Z",
    analysisType: "deal_full",
    generatedAt: "2026-06-15T12:00:00.000Z",
  });

  assert.equal(analysis.identifiers.hubspotDealId, "deal-1");
  assert.equal(analysis.metadata.cache.inputHash, "hash-1");
  assert.equal(analysis.lifecycle.kind, "open");
  assert.equal(analysis.qualification.meddicc.length, 8);
  assert.equal(analysis.signals[0]?.kind, "risk");
  assert.equal(analysis.forecast.forecastCategory, "best_case");
});

test("parseDealAnalysisV1 preserves lifecycle lost extension", () => {
  const analysis = parseDealAnalysisV1(
    JSON.stringify({
      ...JSON.parse(buildOpenDealJson()),
      lifecycle: {
        kind: "lost",
        primaryLossReason: "Budget gele",
        secondaryLossReason: null,
        lossReasonCategory: "budget",
        whatHappened: ["Financement reporte"],
        reactivationScore: 20,
        reactivationRationale: "Recontact possible Q4",
        reactivationPlaybook: [{ title: "Relance Q4", timing: "2026-10-01", rationale: "Nouveau budget" }],
      },
    }),
    "OpenAI",
    { ...baseInput, lifecycleStatus: "lost" },
    {
      provider: "OpenAI",
      model: "gpt-4.1",
      inputHash: "hash-1",
      sourceSyncedAt: null,
      analysisType: "close_lost",
      generatedAt: "2026-06-15T12:00:00.000Z",
    },
  );

  assert.equal(analysis.lifecycle.kind, "lost");
  if (analysis.lifecycle.kind === "lost") {
    assert.equal(analysis.lifecycle.lossReasonCategory, "budget");
  }
});

test("assembleDealAnalysisV1 injects backend metadata", () => {
  const parsed = parseDealAnalysisV1(buildOpenDealJson(), "OpenAI", baseInput, {
    provider: "OpenAI",
    model: "gpt-4.1",
    inputHash: "hash-1",
    sourceSyncedAt: null,
    analysisType: "deal_full",
    generatedAt: "2026-06-15T12:00:00.000Z",
  });

  const assembled = assembleDealAnalysisV1(
    baseInput,
    {
      company: parsed.company,
      dealOverview: parsed.dealOverview,
      stakeholders: parsed.stakeholders,
      signals: parsed.signals,
      qualification: parsed.qualification,
      activitySignals: parsed.activitySignals,
      forecast: parsed.forecast,
      actionPlan: parsed.actionPlan,
      lifecycle: parsed.lifecycle,
      timeline: parsed.timeline,
      dataQuality: parsed.dataQuality,
    },
    {
      provider: "OpenAI",
      model: "gpt-4.1",
      inputHash: "hash-1",
      sourceSyncedAt: null,
      analysisType: "deal_full",
      generatedAt: "2026-06-15T12:00:00.000Z",
    },
    "medium",
  );

  assert.equal(assembled.metadata.analysisVersion, "1.0");
  assert.equal(assembled.dealOverview.summary.length > 0, true);
});