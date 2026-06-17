import type {
  DealAnalysisActionPlan,
  DealAnalysisActivitySignals,
  DealAnalysisBenchmarkGap,
  DealAnalysisCompany,
  DealAnalysisConfidence,
  DealAnalysisDataQuality,
  DealAnalysisEvidenceRef,
  DealAnalysisForecast,
  DealAnalysisLifecycleExtension,
  DealAnalysisMeddiccCriterion,
  DealAnalysisMeddiccCriterionId,
  DealAnalysisOverview,
  DealAnalysisPriority,
  DealAnalysisQualification,
  DealAnalysisSeverity,
  DealAnalysisSignal,
  DealAnalysisStakeholder,
  DealAnalysisTimeline,
  DealAnalysisV1,
  DealLifecycleStatus,
} from "@jarvis/shared";
import { compactText } from "../../lib/text.js";

type ParsedDealAnalysisV1 = {
  company?: unknown;
  dealOverview?: unknown;
  stakeholders?: unknown;
  signals?: unknown;
  qualification?: unknown;
  activitySignals?: unknown;
  forecast?: unknown;
  actionPlan?: unknown;
  lifecycle?: unknown;
  timeline?: unknown;
  dataQuality?: unknown;
  confidence?: unknown;
};

const MEDDICC_CRITERION_IDS = [
  "metrics",
  "economicBuyer",
  "decisionCriteria",
  "decisionProcess",
  "paperProcess",
  "identifyPain",
  "champion",
  "competition",
] as const satisfies readonly DealAnalysisMeddiccCriterionId[];

const MEDDICC_LABELS: Record<DealAnalysisMeddiccCriterionId, string> = {
  champion: "Champion",
  competition: "Competition",
  decisionCriteria: "Decision criteria",
  decisionProcess: "Decision process",
  economicBuyer: "Economic buyer",
  identifyPain: "Identify pain",
  metrics: "Metrics",
  paperProcess: "Paper process",
};

const clampInteger = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value)));

export const normalizeJsonResponse = (value: string): string => {
  const trimmedValue = value.trim();
  const withoutCodeFence = trimmedValue.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  if (withoutCodeFence.startsWith("{") && withoutCodeFence.endsWith("}")) {
    return withoutCodeFence;
  }

  const firstBraceIndex = withoutCodeFence.indexOf("{");
  const lastBraceIndex = withoutCodeFence.lastIndexOf("}");

  if (firstBraceIndex >= 0 && lastBraceIndex > firstBraceIndex) {
    return withoutCodeFence.slice(firstBraceIndex, lastBraceIndex + 1);
  }

  return withoutCodeFence;
};

export const parseJsonObject = <T>(value: string, providerName: string, label: string): T => {
  try {
    return JSON.parse(normalizeJsonResponse(value)) as T;
  } catch {
    throw new Error(`${providerName} n'a pas renvoye un JSON valide pour ${label}. Extrait: ${value.slice(0, 240)}`);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isConfidence = (value: unknown): value is DealAnalysisConfidence =>
  value === "low" || value === "medium" || value === "high";

const isSeverity = (value: unknown): value is DealAnalysisSeverity =>
  value === "low" || value === "medium" || value === "high";

const isPriority = (value: unknown): value is DealAnalysisPriority =>
  value === "low" || value === "medium" || value === "high";

const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

const parseNullableText = (value: unknown, maxLength: number): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const text = compactText(value, maxLength);

  return text || null;
};

const parseRequiredText = (value: unknown, maxLength: number, label: string, providerName: string): string => {
  const text = parseNullableText(value, maxLength);

  if (!text) {
    throw new Error(`${providerName} a renvoye un champ obligatoire invalide: ${label}.`);
  }

  return text;
};

const parseStringArray = (value: unknown, maxItems: number, maxLength: number): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .slice(0, maxItems)
    .map((item) => compactText(item, maxLength))
    .filter(Boolean);
};

const parseNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === "string" ? Number(value) : value;

  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
};

const parseEvidenceRefs = (value: unknown): DealAnalysisEvidenceRef[] => {
  if (typeof value === "string") {
    const quote = compactText(value, 220);

    return quote
      ? [
          {
            activityId: null,
            activityType: "crm_field",
            occurredAt: null,
            title: null,
            quote,
            confidence: "medium",
          },
        ]
      : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 6).flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const quote = parseNullableText(item.quote, 220);

    if (!quote) {
      return [];
    }

    const activityType = item.activityType;
    const normalizedType =
      activityType === "call" ||
      activityType === "email" ||
      activityType === "note" ||
      activityType === "meeting" ||
      activityType === "sms" ||
      activityType === "communication" ||
      activityType === "task" ||
      activityType === "deal" ||
      activityType === "crm_field" ||
      activityType === "transcript"
        ? activityType
        : "crm_field";

    return [
      {
        activityId: parseNullableText(item.activityId, 80),
        activityType: normalizedType,
        occurredAt: parseNullableText(item.occurredAt, 40),
        title: parseNullableText(item.title, 120),
        quote,
        confidence: isConfidence(item.confidence) ? item.confidence : "medium",
      },
    ];
  });
};

const parseCompany = (value: unknown, providerName: string): DealAnalysisCompany => {
  if (!isRecord(value)) {
    throw new Error(`${providerName} a renvoye un bloc company invalide.`);
  }

  return {
    name: parseNullableText(value.name, 120),
    industry: parseNullableText(value.industry, 80),
    size: parseNullableText(value.size, 80),
    country: parseNullableText(value.country, 80),
    currentTools: parseStringArray(value.currentTools, 8, 80),
    crmUrl: parseNullableText(value.crmUrl, 200),
  };
};

const parseDealOverview = (value: unknown, providerName: string): DealAnalysisOverview => {
  if (!isRecord(value)) {
    throw new Error(`${providerName} a renvoye un bloc dealOverview invalide.`);
  }

  const dealHealth = value.dealHealth;

  return {
    summary: parseRequiredText(value.summary, 500, "dealOverview.summary", providerName),
    stage: parseNullableText(value.stage, 80),
    pipeline: parseNullableText(value.pipeline, 80),
    amount: parseNullableNumber(value.amount),
    currency: parseNullableText(value.currency, 8) ?? "EUR",
    expectedCloseDate: parseNullableText(value.expectedCloseDate, 40),
    closingProbability: parseNullableNumber(value.closingProbability),
    confidenceLevel: isConfidence(value.confidenceLevel) ? value.confidenceLevel : "medium",
    dealHealth:
      dealHealth === "strong" ||
      dealHealth === "medium" ||
      dealHealth === "at_risk" ||
      dealHealth === "blocked" ||
      dealHealth === "unknown"
        ? dealHealth
        : "unknown",
    executiveSummary: parseRequiredText(value.executiveSummary, 700, "dealOverview.executiveSummary", providerName),
    whyNow: parseNullableText(value.whyNow, 400),
    mainObjective: parseNullableText(value.mainObjective, 220),
    businessImpact: parseNullableText(value.businessImpact, 220),
    urgencyLevel: isSeverity(value.urgencyLevel) ? value.urgencyLevel : "medium",
    strategicImportance: parseNullableText(value.strategicImportance, 220),
  };
};

const parseStakeholders = (value: unknown): DealAnalysisStakeholder[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 8).flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const name = parseNullableText(item.name, 80);

    if (!name) {
      return [];
    }

    const buyerRole = item.buyerRole;

    return [
      {
        name,
        role: parseNullableText(item.role, 90),
        influenceLevel: isSeverity(item.influenceLevel) ? item.influenceLevel : "medium",
        sentiment:
          item.sentiment === "positive" ||
          item.sentiment === "neutral" ||
          item.sentiment === "negative" ||
          item.sentiment === "unknown"
            ? item.sentiment
            : "unknown",
        buyerRole:
          buyerRole === "decision_maker" ||
          buyerRole === "champion" ||
          buyerRole === "blocker" ||
          buyerRole === "influencer" ||
          buyerRole === "user" ||
          buyerRole === "economic_buyer" ||
          buyerRole === "unknown"
            ? buyerRole
            : "unknown",
        mainConcerns: parseStringArray(item.mainConcerns, 4, 120),
        evidence: parseEvidenceRefs(item.evidence),
      },
    ];
  });
};

const parseSignals = (value: unknown): DealAnalysisSignal[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 12).flatMap((item, index) => {
    if (!isRecord(item)) {
      return [];
    }

    const kind = item.kind;
    const title = parseNullableText(item.title, 140);

    if (
      !title ||
      !(kind === "pain" || kind === "risk" || kind === "objection" || kind === "opportunity")
    ) {
      return [];
    }

    const objectionType = item.objectionType;

    return [
      {
        id: parseNullableText(item.id, 40) ?? `signal-${index + 1}`,
        kind,
        title,
        severity: isSeverity(item.severity) ? item.severity : "medium",
        status:
          item.status === "active" ||
          item.status === "resolved" ||
          item.status === "handled" ||
          item.status === "monitoring" ||
          item.status === "unclear"
            ? item.status
            : "unclear",
        objectionType:
          objectionType === "price" ||
          objectionType === "product" ||
          objectionType === "timing" ||
          objectionType === "trust" ||
          objectionType === "competitor" ||
          objectionType === "technical" ||
          objectionType === "security" ||
          objectionType === "other"
            ? objectionType
            : null,
        businessImpact: parseNullableText(item.businessImpact, 180),
        responseGiven: parseNullableText(item.responseGiven, 180),
        remainingConcern: parseNullableText(item.remainingConcern, 180),
        evidence: parseEvidenceRefs(item.evidence),
        lastUpdated: parseNullableText(item.lastUpdated, 40),
      },
    ];
  });
};

const parseMeddicc = (value: unknown): DealAnalysisMeddiccCriterion[] => {
  if (!Array.isArray(value)) {
    return MEDDICC_CRITERION_IDS.map((id) => ({
      id,
      label: MEDDICC_LABELS[id],
      status: "missing" as const,
      score: 0,
      evidence: [],
      gap: "Critere non renseigne par le provider.",
    }));
  }

  const byId = new Map<DealAnalysisMeddiccCriterionId, DealAnalysisMeddiccCriterion>();

  value.forEach((item) => {
    if (!isRecord(item) || typeof item.id !== "string") {
      return;
    }

    if (!MEDDICC_CRITERION_IDS.includes(item.id as DealAnalysisMeddiccCriterionId)) {
      return;
    }

    const id = item.id as DealAnalysisMeddiccCriterionId;
    const status = item.status;

    byId.set(id, {
      id,
      label: parseNullableText(item.label, 50) ?? MEDDICC_LABELS[id],
      status:
        status === "confirmed" ||
        status === "partial" ||
        status === "assumed" ||
        status === "unclear" ||
        status === "missing"
          ? status
          : "missing",
      score: isInteger(item.score) ? clampInteger(item.score, 0, 100) : 0,
      evidence: parseEvidenceRefs(item.evidence),
      gap: parseNullableText(item.gap, 180),
    });
  });

  return MEDDICC_CRITERION_IDS.map(
    (id) =>
      byId.get(id) ?? {
        id,
        label: MEDDICC_LABELS[id],
        status: "missing",
        score: 0,
        evidence: [],
        gap: "Critere non renseigne par le provider.",
      },
  );
};

const parseQualification = (value: unknown, providerName: string): DealAnalysisQualification => {
  if (!isRecord(value)) {
    throw new Error(`${providerName} a renvoye un bloc qualification invalide.`);
  }

  const decisionProcess = isRecord(value.decisionProcess) ? value.decisionProcess : {};
  const budget = isRecord(value.budget) ? value.budget : {};
  const competition = isRecord(value.competition) ? value.competition : {};
  const productFit = isRecord(value.productFit) ? value.productFit : {};
  const multiThreading = isRecord(value.multiThreading) ? value.multiThreading : {};

  return {
    meddicc: parseMeddicc(value.meddicc),
    decisionProcess: {
      status:
        decisionProcess.status === "clear" || decisionProcess.status === "partial" || decisionProcess.status === "unclear"
          ? decisionProcess.status
          : "unclear",
      decisionMakers: parseStringArray(decisionProcess.decisionMakers, 6, 80),
      champions: parseStringArray(decisionProcess.champions, 6, 80),
      blockers: parseStringArray(decisionProcess.blockers, 6, 80),
      influencers: parseStringArray(decisionProcess.influencers, 6, 80),
      approvalSteps: parseStringArray(decisionProcess.approvalSteps, 6, 120),
      legalProcurementRequired: decisionProcess.legalProcurementRequired === true,
      technicalValidationRequired: decisionProcess.technicalValidationRequired === true,
      legalStatus:
        decisionProcess.legalStatus === "approved" ||
        decisionProcess.legalStatus === "in_review" ||
        decisionProcess.legalStatus === "blocked" ||
        decisionProcess.legalStatus === "unknown"
          ? decisionProcess.legalStatus
          : "unknown",
      purchaseProcess:
        decisionProcess.purchaseProcess === "clear" ||
        decisionProcess.purchaseProcess === "to_confirm" ||
        decisionProcess.purchaseProcess === "blocked" ||
        decisionProcess.purchaseProcess === "unknown"
          ? decisionProcess.purchaseProcess
          : "unknown",
      timeline: parseNullableText(decisionProcess.timeline, 180),
      evidence: parseEvidenceRefs(decisionProcess.evidence),
    },
    budget: {
      status:
        budget.status === "confirmed" ||
        budget.status === "partial" ||
        budget.status === "assumed" ||
        budget.status === "unclear" ||
        budget.status === "missing"
          ? budget.status
          : "unclear",
      amount: parseNullableNumber(budget.amount),
      currency: parseNullableText(budget.currency, 8) ?? "EUR",
      budgetOwner: parseNullableText(budget.budgetOwner, 80),
      pricingSensitivity:
        budget.pricingSensitivity === "low" ||
        budget.pricingSensitivity === "medium" ||
        budget.pricingSensitivity === "high" ||
        budget.pricingSensitivity === "unknown"
          ? budget.pricingSensitivity
          : "unknown",
      evidence: parseEvidenceRefs(budget.evidence),
    },
    competition: {
      status:
        competition.status === "none" ||
        competition.status === "suspected" ||
        competition.status === "confirmed" ||
        competition.status === "unknown"
          ? competition.status
          : "unknown",
      competitors: parseStringArray(competition.competitors, 6, 80),
      currentSolution: parseNullableText(competition.currentSolution, 140),
      competitiveRisks: parseStringArray(competition.competitiveRisks, 4, 140),
      positioningAngle: parseNullableText(competition.positioningAngle, 180),
      evidence: parseEvidenceRefs(competition.evidence),
    },
    productFit: {
      fitScore: parseNullableNumber(productFit.fitScore),
      strongFitReasons: parseStringArray(productFit.strongFitReasons, 4, 140),
      weakFitReasons: parseStringArray(productFit.weakFitReasons, 4, 140),
      missingFeatures: parseStringArray(productFit.missingFeatures, 4, 120),
      technicalConstraints: parseStringArray(productFit.technicalConstraints, 4, 120),
      integrationRequirements: parseStringArray(productFit.integrationRequirements, 4, 120),
      securityCompliance: parseStringArray(productFit.securityCompliance, 4, 120),
      evidence: parseEvidenceRefs(productFit.evidence),
    },
    multiThreading: {
      status:
        multiThreading.status === "single_threaded" ||
        multiThreading.status === "partial" ||
        multiThreading.status === "multi_threaded" ||
        multiThreading.status === "unknown"
          ? multiThreading.status
          : "unknown",
      contactedRoles: parseStringArray(multiThreading.contactedRoles, 8, 80),
      missingRoles: parseStringArray(multiThreading.missingRoles, 8, 80),
      evidence: parseEvidenceRefs(multiThreading.evidence),
    },
    confidence: isConfidence(value.confidence) ? value.confidence : "medium",
  };
};

const parseBenchmarkGaps = (value: unknown): DealAnalysisBenchmarkGap[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 6).flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const metric = item.metric;
    const stage = parseNullableText(item.stage, 80);
    const actual = parseNullableNumber(item.actual);
    const benchmark = parseNullableNumber(item.benchmark);

    if (
      !stage ||
      actual === null ||
      benchmark === null ||
      !(metric === "calls" || metric === "emails" || metric === "meetings" || metric === "touchpoints" || metric === "days_in_stage")
    ) {
      return [];
    }

    return [
      {
        stage,
        metric,
        actual,
        benchmark,
        severity: isSeverity(item.severity) ? item.severity : "medium",
      },
    ];
  });
};

const parseActivitySignals = (value: unknown): DealAnalysisActivitySignals => {
  if (!isRecord(value)) {
    return {
      lastTouchAt: null,
      daysSinceLastTouch: null,
      touchpointCount30d: null,
      callsCountByStage: {},
      emailsCountByStage: {},
      meetingsCountByStage: {},
      benchmarkGaps: [],
      engagementTrend: "unknown",
      stageAgeDays: null,
    };
  }

  const recordCounts = (input: unknown): Record<string, number> => {
    if (!isRecord(input)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(input).flatMap(([key, count]) => {
        const parsed = parseNullableNumber(count);

        return parsed === null ? [] : [[compactText(key, 80), parsed] as const];
      }),
    );
  };

  return {
    lastTouchAt: parseNullableText(value.lastTouchAt, 40),
    daysSinceLastTouch: parseNullableNumber(value.daysSinceLastTouch),
    touchpointCount30d: parseNullableNumber(value.touchpointCount30d),
    callsCountByStage: recordCounts(value.callsCountByStage),
    emailsCountByStage: recordCounts(value.emailsCountByStage),
    meetingsCountByStage: recordCounts(value.meetingsCountByStage),
    benchmarkGaps: parseBenchmarkGaps(value.benchmarkGaps),
    engagementTrend:
      value.engagementTrend === "increasing" ||
      value.engagementTrend === "stable" ||
      value.engagementTrend === "decreasing" ||
      value.engagementTrend === "unknown"
        ? value.engagementTrend
        : "unknown",
    stageAgeDays: parseNullableNumber(value.stageAgeDays),
  };
};

const parseForecast = (value: unknown, providerName: string): DealAnalysisForecast => {
  if (!isRecord(value)) {
    throw new Error(`${providerName} a renvoye un bloc forecast invalide.`);
  }

  const category = value.forecastCategory;

  return {
    forecastCategory:
      category === "commit" ||
      category === "best_case" ||
      category === "pipeline" ||
      category === "at_risk" ||
      category === "slipping" ||
      category === "lost_risk"
        ? category
        : "pipeline",
    probability: parseNullableNumber(value.probability),
    mainPositiveSignals: parseStringArray(value.mainPositiveSignals, 5, 140),
    mainNegativeSignals: parseStringArray(value.mainNegativeSignals, 5, 140),
    dealMomentum:
      value.dealMomentum === "increasing" ||
      value.dealMomentum === "stable" ||
      value.dealMomentum === "decreasing" ||
      value.dealMomentum === "unknown"
        ? value.dealMomentum
        : "unknown",
    riskOfSlippage: isSeverity(value.riskOfSlippage) ? value.riskOfSlippage : "medium",
    reasoningSummary: parseRequiredText(value.reasoningSummary, 500, "forecast.reasoningSummary", providerName),
    confidence: isConfidence(value.confidence) ? value.confidence : "medium",
  };
};

const parseActionPlan = (value: unknown, providerName: string): DealAnalysisActionPlan => {
  if (!isRecord(value)) {
    throw new Error(`${providerName} a renvoye un bloc actionPlan invalide.`);
  }

  const salesStrategy = isRecord(value.salesStrategy) ? value.salesStrategy : {};

  return {
    nextSteps: Array.isArray(value.nextSteps)
      ? value.nextSteps.slice(0, 5).flatMap((item) => {
          if (!isRecord(item)) {
            return [];
          }

          const action = parseNullableText(item.action, 160);

          if (!action) {
            return [];
          }

          const owner = item.owner;

          return [
            {
              action,
              owner:
                owner === "sales_rep" ||
                owner === "prospect" ||
                owner === "customer_success" ||
                owner === "product" ||
                owner === "legal" ||
                owner === "other"
                  ? owner
                  : "sales_rep",
              dueDate: parseNullableText(item.dueDate, 40),
              priority: isPriority(item.priority) ? item.priority : "medium",
              status:
                item.status === "pending" ||
                item.status === "in_progress" ||
                item.status === "completed" ||
                item.status === "overdue"
                  ? item.status
                  : "pending",
              createCrmTask: item.createCrmTask === true,
              evidence: parseEvidenceRefs(item.evidence),
            },
          ];
        })
      : [],
    mutualActionPlan: Array.isArray(value.mutualActionPlan)
      ? value.mutualActionPlan.slice(0, 6).flatMap((item) => {
          if (!isRecord(item)) {
            return [];
          }

          const title = parseNullableText(item.title, 120);

          if (!title) {
            return [];
          }

          return [
            {
              title,
              ownerName: parseNullableText(item.ownerName, 80),
              dueDate: parseNullableText(item.dueDate, 40),
              status:
                item.status === "pending" ||
                item.status === "in_progress" ||
                item.status === "completed" ||
                item.status === "overdue"
                  ? item.status
                  : "pending",
              priority: isPriority(item.priority) ? item.priority : "medium",
              rationale: parseNullableText(item.rationale, 180) ?? "",
            },
          ];
        })
      : [],
    upcomingDeadlines: Array.isArray(value.upcomingDeadlines)
      ? value.upcomingDeadlines.slice(0, 5).flatMap((item) => {
          if (!isRecord(item)) {
            return [];
          }

          const title = parseNullableText(item.title, 120);

          if (!title) {
            return [];
          }

          return [
            {
              title,
              date: parseNullableText(item.date, 40),
              timeWindow: parseNullableText(item.timeWindow, 80),
              ownerName: parseNullableText(item.ownerName, 80),
              description: parseNullableText(item.description, 180) ?? "",
            },
          ];
        })
      : [],
    salesStrategy: {
      recommendedAction: parseRequiredText(
        salesStrategy.recommendedAction,
        220,
        "actionPlan.salesStrategy.recommendedAction",
        providerName,
      ),
      managerAdvice: parseNullableText(salesStrategy.managerAdvice, 220),
      bestAngle: parseNullableText(salesStrategy.bestAngle, 180),
      whatToAvoid: parseStringArray(salesStrategy.whatToAvoid, 4, 140),
      suggestedMessage: parseNullableText(salesStrategy.suggestedMessage, 400),
      talkingPoints: parseStringArray(salesStrategy.talkingPoints, 5, 140),
    },
  };
};

const parseLifecycle = (
  value: unknown,
  lifecycleStatus: DealLifecycleStatus,
  providerName: string,
): DealAnalysisLifecycleExtension => {
  if (!isRecord(value)) {
    return lifecycleStatus === "lost"
      ? {
          kind: "lost",
          primaryLossReason: "Raison de perte non determinee.",
          secondaryLossReason: null,
          lossReasonCategory: "other",
          whatHappened: [],
          reactivationScore: null,
          reactivationRationale: null,
          reactivationPlaybook: [],
        }
      : lifecycleStatus === "won"
        ? {
            kind: "won",
            primaryWinFactor: "Facteur de victoire non determine.",
            winFactorCategory: "other",
            keyMoments: [],
            replicablePlays: [],
          }
        : { kind: "open" };
  }

  const kind = value.kind;

  if (kind === "lost" || lifecycleStatus === "lost") {
    const category = value.lossReasonCategory;

    return {
      kind: "lost",
      primaryLossReason: parseRequiredText(value.primaryLossReason, 180, "lifecycle.primaryLossReason", providerName),
      secondaryLossReason: parseNullableText(value.secondaryLossReason, 180),
      lossReasonCategory:
        category === "pricing" ||
        category === "timing" ||
        category === "competition" ||
        category === "product_gap" ||
        category === "budget" ||
        category === "authority" ||
        category === "no_decision" ||
        category === "other"
          ? category
          : "other",
      whatHappened: parseStringArray(value.whatHappened, 5, 180),
      reactivationScore: parseNullableNumber(value.reactivationScore),
      reactivationRationale: parseNullableText(value.reactivationRationale, 220),
      reactivationPlaybook: Array.isArray(value.reactivationPlaybook)
        ? value.reactivationPlaybook.slice(0, 4).flatMap((item) => {
            if (!isRecord(item)) {
              return [];
            }

            const title = parseNullableText(item.title, 120);
            const timing = parseNullableText(item.timing, 80);
            const rationale = parseNullableText(item.rationale, 180);

            if (!title || !timing || !rationale) {
              return [];
            }

            return [{ title, timing, rationale }];
          })
        : [],
    };
  }

  if (kind === "won" || lifecycleStatus === "won") {
    const category = value.winFactorCategory;

    return {
      kind: "won",
      primaryWinFactor: parseRequiredText(value.primaryWinFactor, 180, "lifecycle.primaryWinFactor", providerName),
      winFactorCategory:
        category === "champion" ||
        category === "timing" ||
        category === "product_fit" ||
        category === "pricing" ||
        category === "process" ||
        category === "relationship" ||
        category === "other"
          ? category
          : "other",
      keyMoments: Array.isArray(value.keyMoments)
        ? value.keyMoments.slice(0, 5).flatMap((item) => {
            if (!isRecord(item)) {
              return [];
            }

            const moment = parseNullableText(item.moment, 180);

            if (!moment) {
              return [];
            }

            return [
              {
                date: parseNullableText(item.date, 40),
                moment,
                stage: parseNullableText(item.stage, 80),
                impact:
                  item.impact === "positive" || item.impact === "neutral" || item.impact === "negative"
                    ? item.impact
                    : "neutral",
                evidence: parseEvidenceRefs(item.evidence),
              },
            ];
          })
        : [],
      replicablePlays: Array.isArray(value.replicablePlays)
        ? value.replicablePlays.slice(0, 4).flatMap((item) => {
            if (!isRecord(item)) {
              return [];
            }

            const play = parseNullableText(item.play, 180);
            const when = parseNullableText(item.when, 120);

            if (!play || !when) {
              return [];
            }

            return [{ play, when }];
          })
        : [],
    };
  }

  return { kind: "open" };
};

const parseTimeline = (value: unknown): DealAnalysisTimeline => {
  if (!isRecord(value)) {
    return {
      firstContactDate: null,
      lastInteractionDate: null,
      keyEvents: [],
    };
  }

  return {
    firstContactDate: parseNullableText(value.firstContactDate, 40),
    lastInteractionDate: parseNullableText(value.lastInteractionDate, 40),
    keyEvents: Array.isArray(value.keyEvents)
      ? value.keyEvents.slice(0, 8).flatMap((item) => {
          if (!isRecord(item)) {
            return [];
          }

          const event = parseNullableText(item.event, 180);

          if (!event) {
            return [];
          }

          return [
            {
              date: parseNullableText(item.date, 40),
              event,
              impact:
                item.impact === "positive" || item.impact === "neutral" || item.impact === "negative"
                  ? item.impact
                  : "neutral",
              evidence: parseEvidenceRefs(item.evidence),
            },
          ];
        })
      : [],
  };
};

const parseDataQuality = (value: unknown): DealAnalysisDataQuality => {
  if (!isRecord(value)) {
    return {
      missingInformation: [],
      uncertainAssumptions: [],
      fieldsRequiringHumanReview: [],
    };
  }

  return {
    missingInformation: parseStringArray(value.missingInformation, 8, 160),
    uncertainAssumptions: parseStringArray(value.uncertainAssumptions, 8, 160),
    fieldsRequiringHumanReview: parseStringArray(value.fieldsRequiringHumanReview, 8, 120),
  };
};

export type DealAnalysisV1Body = Omit<DealAnalysisV1, "identifiers" | "metadata">;

export const parseDealAnalysisV1Body = (
  value: string,
  providerName: string,
  lifecycleStatus: DealLifecycleStatus,
): { body: DealAnalysisV1Body; confidence: DealAnalysisConfidence } => {
  const parsed = parseJsonObject<ParsedDealAnalysisV1>(value, providerName, "DealAnalysisV1");
  const confidence = isConfidence(parsed.confidence) ? parsed.confidence : "medium";

  return {
    confidence,
    body: {
    company: parseCompany(parsed.company, providerName),
    dealOverview: parseDealOverview(parsed.dealOverview, providerName),
    stakeholders: parseStakeholders(parsed.stakeholders),
    signals: parseSignals(parsed.signals),
    qualification: parseQualification(parsed.qualification, providerName),
    activitySignals: parseActivitySignals(parsed.activitySignals),
    forecast: parseForecast(parsed.forecast, providerName),
    actionPlan: parseActionPlan(parsed.actionPlan, providerName),
    lifecycle: parseLifecycle(parsed.lifecycle, lifecycleStatus, providerName),
    timeline: parseTimeline(parsed.timeline),
    dataQuality: parseDataQuality(parsed.dataQuality),
    },
  };
};