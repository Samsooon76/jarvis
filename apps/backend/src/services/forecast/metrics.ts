import type { DealIntelligenceAnalysis } from "../llm/llm.provider.js";
import { getObjectiveAmountForForecast } from "../sales-targets.service.js";
import type {
  DealAiAnalysisRow,
  ForecastAnalysisStatus,
  ForecastDeal,
  ForecastDealBucket,
  ForecastDealContext,
  ForecastDealSummary,
  ForecastLever,
  ForecastMonthlyProjection,
  ForecastReliabilityDimension,
  ForecastRisk,
  ForecastRiskSeverity,
  ForecastScenario,
  ForecastScope,
  HubSpotDealRow,
} from "./types.js";
import { clamp, getMonthEnd, getMonthKey, getMonthLabel, getMonthsBetween, normalizeText, parseNumber } from "./shared.js";
import { getForecastDealStatus, isSignedDealStatus } from "./deal-status.js";

const buildForecastDealSummary = (analysis: DealIntelligenceAnalysis | null): string | null => {
  if (!analysis) {
    return null;
  }

  const parts = [
    analysis.executiveSummary,
    ...analysis.detailedAnalysis,
  ]
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts.join("\n\n") : null;
};

const buildForecastSuggestedMove = (analysis: DealIntelligenceAnalysis | null): string | null => {
  if (!analysis) {
    return null;
  }

  const parts: string[] = [];
  const suggestedMove = analysis.suggestedMove.trim();

  if (suggestedMove) {
    parts.push(suggestedMove);
  }

  const primaryStep = analysis.nextSteps[0];
  const stepRationale = primaryStep?.rationale.trim() ?? "";
  const genericRationale = "Action recommandee depuis l'analyse du deal.";

  if (
    stepRationale &&
    stepRationale !== genericRationale &&
    stepRationale !== suggestedMove &&
    !parts.some((part) => part.includes(stepRationale))
  ) {
    parts.push(stepRationale);
  }

  return parts.length > 0 ? parts.join("\n\n") : null;
};

const getAnalysisStatus = (deal: HubSpotDealRow, analysis: DealAiAnalysisRow | null): ForecastAnalysisStatus => {
  if (!analysis) {
    return "missing";
  }

  const expiresAt = new Date(analysis.expires_at).getTime();

  if (!Number.isNaN(expiresAt) && expiresAt < Date.now()) {
    return "stale";
  }

  const dealUpdatedAt = deal.hubspot_updated_at ? new Date(deal.hubspot_updated_at).getTime() : null;
  const analyzedAt = new Date(analysis.generated_at).getTime();

  if (dealUpdatedAt && !Number.isNaN(dealUpdatedAt) && !Number.isNaN(analyzedAt) && dealUpdatedAt > analyzedAt) {
    return "stale";
  }

  return "fresh";
};

export const buildForecastDeal = (context: ForecastDealContext, analysisRow: DealAiAnalysisRow | null): ForecastDeal => {
  const amount = parseNumber(context.row.amount) ?? 0;
  const crmProbability = clamp(Math.round(parseNumber(context.row.close_probability) ?? 0), 0, 100);
  const dealStatus = getForecastDealStatus(context.row);
  const isSigned = isSignedDealStatus(dealStatus);
  const analysis = analysisRow?.analysis ?? null;
  const forecastBucket: ForecastDealBucket = isSigned ? dealStatus : "openForecast";
  const status = isSigned ? "closed_won" : getAnalysisStatus(context.row, analysisRow);
  const aiProbability = isSigned ? 100 : status === "fresh" && analysis ? clamp(Math.round(analysis.closeWonProbability), 0, 100) : null;
  const probability = aiProbability ?? crmProbability;
  const dealName = context.row.deal_name;
  const companyName = context.company?.name ?? context.contact?.company_name ?? dealName ?? "Entreprise inconnue";

  return {
    hubspotDealId: context.row.hubspot_deal_id,
    dealName,
    companyName,
    contactName: context.contact?.name ?? null,
    ownerName: context.ownerName ?? (context.row.hubspot_owner_id ? `Owner ${context.row.hubspot_owner_id}` : null),
    ownerHubSpotId: context.row.hubspot_owner_id,
    amount,
    stage: context.row.deal_stage_label ?? context.row.deal_stage ?? "Stage HubSpot non renseigne",
    closeDate: context.row.closed_at,
    syncedAt: context.row.synced_at,
    forecastBucket,
    aiProbability,
    crmProbability,
    forecastAmount: Math.round(amount * (probability / 100)),
    impactAmount: Math.round(amount * Math.max(0.1, probability / 100)),
    analysisStatus: status,
    analyzedAt: analysisRow?.generated_at ?? null,
    confidence: analysis?.confidence ?? null,
    dealHealth: analysis?.dealHealth ?? null,
    summary: buildForecastDealSummary(analysis),
    suggestedMove: buildForecastSuggestedMove(analysis),
    risks: analysis?.risks ?? [],
    positiveSignals: analysis?.positiveSignals ?? [],
  };
};

export const summarizeForecastDeals = (deals: ForecastDeal[]): ForecastDealSummary => {
  const signedPaymentPendingDeals = deals.filter((deal) => deal.forecastBucket === "signedPaymentPending");
  const paymentReceivedDeals = deals.filter((deal) => deal.forecastBucket === "paymentReceived");
  const signedDeals = [...signedPaymentPendingDeals, ...paymentReceivedDeals];
  const openDeals = deals.filter((deal) => deal.forecastBucket === "openForecast");
  const signedPaymentPendingAmount = signedPaymentPendingDeals.reduce((sum, deal) => sum + deal.amount, 0);
  const paymentReceivedAmount = paymentReceivedDeals.reduce((sum, deal) => sum + deal.amount, 0);
  const signedAmount = signedPaymentPendingAmount + paymentReceivedAmount;
  const openPipelineAmount = openDeals.reduce((sum, deal) => sum + deal.amount, 0);
  const openForecastAmount = openDeals.reduce((sum, deal) => sum + deal.forecastAmount, 0);

  return {
    signedDeals,
    signedPaymentPendingDeals,
    paymentReceivedDeals,
    openDeals,
    signedAmount,
    signedPaymentPendingAmount,
    paymentReceivedAmount,
    openPipelineAmount,
    openForecastAmount,
    landingAmount: signedAmount + openForecastAmount,
    pipelineAmount: signedAmount + openPipelineAmount,
  };
};

export const buildScenarios = (deals: ForecastDeal[]): ForecastScenario[] => {
  const weightedDeals = deals.filter((deal) => deal.analysisStatus === "closed_won" || deal.aiProbability !== null || deal.crmProbability > 0);
  const commitAmount = weightedDeals
    .filter((deal) => (deal.aiProbability ?? deal.crmProbability) >= 70 || deal.dealHealth === "strong")
    .reduce((sum, deal) => sum + deal.forecastAmount, 0);
  const likelyAmount = weightedDeals.reduce((sum, deal) => sum + deal.forecastAmount, 0);
  const upsideAmount = weightedDeals.reduce((sum, deal) => {
    const probability = (deal.aiProbability ?? deal.crmProbability) / 100;
    return sum + Math.round(deal.amount * clamp(probability + 0.22, 0, 0.98));
  }, 0);
  const averageProbability =
    weightedDeals.length > 0
      ? Math.round(weightedDeals.reduce((sum, deal) => sum + (deal.aiProbability ?? deal.crmProbability), 0) / weightedDeals.length)
      : 0;

  return [
    {
      id: "commit",
      label: "Commit",
      amount: commitAmount,
      probability: weightedDeals.length > 0 ? clamp(Math.round(averageProbability * 0.82), 0, 100) : 0,
    },
    {
      id: "likely",
      label: "Likely",
      amount: likelyAmount,
      probability: averageProbability,
    },
    {
      id: "upside",
      label: "Upside",
      amount: upsideAmount,
      probability: weightedDeals.length > 0 ? clamp(Math.round(averageProbability * 0.42), 0, 100) : 0,
    },
  ];
};

const severityFromRisk = (risk: string): ForecastRiskSeverity => {
  const normalized = normalizeText(risk);

  if (normalized.includes("bloqu") || normalized.includes("budget") || normalized.includes("decision") || normalized.includes("legal")) {
    return "high";
  }

  if (normalized.includes("concurr") || normalized.includes("retard") || normalized.includes("no show") || normalized.includes("silence")) {
    return "medium";
  }

  return "low";
};

export const buildRisks = (deals: ForecastDeal[]): ForecastRisk[] => {
  const byTitle = new Map<string, ForecastRisk>();

  for (const deal of deals) {
    for (const risk of deal.risks.slice(0, 3)) {
      const title = risk.trim();

      if (!title) {
        continue;
      }

      const key = normalizeText(title);
      const current = byTitle.get(key) ?? {
        title,
        severity: severityFromRisk(title),
        dealCount: 0,
        amount: 0,
      };

      current.dealCount += 1;
      current.amount += deal.amount;
      byTitle.set(key, current);
    }
  }

  return Array.from(byTitle.values())
    .sort((left, right) => right.dealCount - left.dealCount || right.amount - left.amount)
    .slice(0, 5);
};

export const buildLevers = (deals: ForecastDeal[]): ForecastLever[] =>
  Array.from(
    deals
      .filter((deal) => deal.suggestedMove)
      .reduce<Map<string, ForecastLever>>((rowsByTitle, deal) => {
      const title = deal.suggestedMove?.trim();

      if (!title) {
        return rowsByTitle;
      }

      const key = normalizeText(title);
      const current = rowsByTitle.get(key) ?? {
        title,
        dealCount: 0,
        amount: 0,
      };

      current.dealCount += 1;
      current.amount += deal.amount;
      rowsByTitle.set(key, current);

      return rowsByTitle;
      }, new Map())
      .values(),
  )
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 5);

const confidenceToScore = (confidence: DealIntelligenceAnalysis["confidence"] | null): number => {
  if (confidence === "high") {
    return 90;
  }

  if (confidence === "medium") {
    return 68;
  }

  if (confidence === "low") {
    return 42;
  }

  return 0;
};

export const buildReliability = (deals: ForecastDeal[]): ForecastReliabilityDimension[] => {
  const openDealCount = deals.length;
  const analyzedDeals = deals.filter((deal) => deal.analysisStatus === "fresh" || deal.analysisStatus === "closed_won");
  const recentAnalyzedDeals = analyzedDeals.filter((deal) => {
    if (deal.analysisStatus === "closed_won") {
      return true;
    }

    if (!deal.analyzedAt) {
      return false;
    }

    const analyzedAt = new Date(deal.analyzedAt).getTime();

    return !Number.isNaN(analyzedAt) && Date.now() - analyzedAt <= 7 * 86_400_000;
  });
  const confidenceScores = analyzedDeals.map((deal) => confidenceToScore(deal.confidence));
  const dealsWithCoreData = deals.filter((deal) => deal.amount > 0 && deal.closeDate && deal.stage !== "Stage HubSpot non renseigne");

  return [
    {
      id: "dataCompleteness",
      label: "Donnees completes",
      score: openDealCount > 0 ? Math.round((dealsWithCoreData.length / openDealCount) * 100) : 0,
    },
    {
      id: "recentAnalysis",
      label: "Analyse recente",
      score: openDealCount > 0 ? Math.round((recentAnalyzedDeals.length / openDealCount) * 100) : 0,
    },
    {
      id: "aiConfidence",
      label: "Confiance IA",
      score:
        confidenceScores.length > 0
          ? Math.round(confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length)
          : 0,
    },
    {
      id: "stageCoverage",
      label: "Win rate calibre",
      score: openDealCount > 0 ? Math.round((analyzedDeals.length / openDealCount) * 100) : 0,
    },
  ];
};

export const averageScore = (items: ForecastReliabilityDimension[]): number =>
  items.length > 0 ? Math.round(items.reduce((sum, item) => sum + item.score, 0) / items.length) : 0;

export const buildMonthlyProjection = async ({
  orgId,
  scope,
  hubspotOwnerId,
  dateFrom,
  dateTo,
  deals,
}: {
  orgId: string;
  scope: ForecastScope;
  hubspotOwnerId: string | null;
  dateFrom: string;
  dateTo: string;
  deals: ForecastDeal[];
}): Promise<ForecastMonthlyProjection[]> => {
  const monthsInRange = getMonthsBetween(dateFrom, dateTo);
  const firstMonth = monthsInRange[0] ?? getMonthKey(new Date(`${dateFrom}T00:00:00.000Z`));
  const lastMonth = monthsInRange[monthsInRange.length - 1] ?? getMonthKey(new Date(`${dateTo}T00:00:00.000Z`));
  const monthsInRangeSet = new Set(monthsInRange);
  const dealsByMonth = deals.reduce<Map<string, ForecastDeal[]>>((months, deal) => {
    const closeDate = deal.closeDate ? new Date(deal.closeDate) : null;
    let month = closeDate && !Number.isNaN(closeDate.getTime()) ? getMonthKey(closeDate) : lastMonth;

    // Backlog signe (signe, paiement en attente) : la date de signature est souvent passee.
    // On le rattache au premier mois de la periode pour qu'il reste visible comme acquis.
    if (deal.forecastBucket === "signedPaymentPending" && !monthsInRangeSet.has(month)) {
      month = firstMonth;
    }

    const currentDeals = months.get(month) ?? [];

    currentDeals.push(deal);
    months.set(month, currentDeals);

    return months;
  }, new Map());

  return Promise.all(
    monthsInRange.map(async (month) => {
      const monthStart = new Date(`${month}T00:00:00.000Z`);
      const monthEnd = getMonthEnd(monthStart).toISOString().slice(0, 10);
      const monthDeals = dealsByMonth.get(month) ?? [];
      const objectiveAmount = await getObjectiveAmountForForecast({
        orgId,
        scope,
        hubspotOwnerId,
        dateFrom: month,
        dateTo: monthEnd,
      });
      const wonDeals = monthDeals.filter((deal) => deal.analysisStatus === "closed_won");
      const summary = summarizeForecastDeals(monthDeals);
      const reliability = buildReliability(summary.openDeals);
      const analyzedDeals = summary.openDeals.filter((deal) => deal.analysisStatus === "fresh");
      const missingDeals = summary.openDeals.filter((deal) => deal.analysisStatus === "missing" || deal.analysisStatus === "stale");

      return {
        month,
        label: getMonthLabel(month),
        dealCount: monthDeals.length,
        signedDealCount: summary.signedDeals.length,
        signedPaymentPendingDealCount: summary.signedPaymentPendingDeals.length,
        paymentReceivedDealCount: summary.paymentReceivedDeals.length,
        openDealCount: summary.openDeals.length,
        wonDealCount: wonDeals.length,
        analyzedDealCount: analyzedDeals.length,
        missingAnalysisCount: missingDeals.length,
        signedAmount: summary.signedAmount,
        signedPaymentPendingAmount: summary.signedPaymentPendingAmount,
        paymentReceivedAmount: summary.paymentReceivedAmount,
        openPipelineAmount: summary.openPipelineAmount,
        openForecastAmount: summary.openForecastAmount,
        landingAmount: summary.landingAmount,
        pipelineAmount: summary.pipelineAmount,
        commitAmount: monthDeals
          .filter((deal) => deal.analysisStatus === "closed_won" || (deal.aiProbability ?? deal.crmProbability) >= 70 || deal.dealHealth === "strong")
          .reduce((sum, deal) => sum + deal.forecastAmount, 0),
        forecastAmount: summary.landingAmount,
        objectiveAmount,
        gapToObjective: objectiveAmount === null ? null : summary.landingAmount - objectiveAmount,
        confidenceScore: averageScore(reliability),
      };
    }),
  );
};
