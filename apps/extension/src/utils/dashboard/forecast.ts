import type {
  ForecastDeal,
  ForecastOverviewResult,
  ForecastSynthesis,
  ForecastSynthesisCategory,
} from "../../services/api";
import { formatDate } from "./formatters";

export type ForecastPeriodMode = "currentMonth" | "nextMonth" | "custom";

export type ForecastPoint = {
  date: string;
  label: string;
  commit: number;
  forecast: number;
  objective: number | null;
  pipeline: number;
  dealCount: number;
  confidenceScore: number;
};

export const FORECAST_SYNTHESIS_CATEGORY_ORDER: ForecastSynthesisCategory[] = ["commit", "bestCase", "atRisk", "slipping"];

export const getSynthesisCategoryTone = (category: ForecastSynthesisCategory): string => {
  if (category === "commit") {
    return "commit";
  }

  if (category === "bestCase") {
    return "best-case";
  }

  if (category === "atRisk") {
    return "at-risk";
  }

  return "slipping";
};

export const getConfidenceLabel = (confidence: ForecastSynthesis["confidence"]): string =>
  confidence === "high" ? "Confiance elevee" : confidence === "medium" ? "Confiance moyenne" : "Confiance faible";

export const getPriorityLabel = (priority: "low" | "medium" | "high"): string =>
  priority === "high" ? "Prioritaire" : priority === "medium" ? "A suivre" : "Optionnel";

const getMonthBounds = (offsetMonths = 0): { dateFrom: string; dateTo: string } => {
  const now = new Date();
  const firstDay = new Date(Date.UTC(now.getFullYear(), now.getMonth() + offsetMonths, 1));
  const lastDay = new Date(Date.UTC(now.getFullYear(), now.getMonth() + offsetMonths + 1, 0));

  return {
    dateFrom: firstDay.toISOString().slice(0, 10),
    dateTo: lastDay.toISOString().slice(0, 10),
  };
};

export const getPeriodBounds = (mode: Exclude<ForecastPeriodMode, "custom">): { dateFrom: string; dateTo: string } => {
  if (mode === "nextMonth") {
    return getMonthBounds(1);
  }

  return getMonthBounds(0);
};

export const formatPeriod = (dateFrom: string, dateTo: string): string => {
  if (!dateFrom || !dateTo) {
    return "Periode non definie";
  }

  return `${formatDate(dateFrom)} - ${formatDate(dateTo)}`;
};

export const buildProjection = (overview: ForecastOverviewResult | null): ForecastPoint[] => {
  if (!overview || overview.monthlyProjection.length === 0) {
    return [];
  }

  return overview.monthlyProjection.map((month) => ({
    date: month.month,
    label: month.label,
    commit: month.commitAmount,
    forecast: month.landingAmount,
    objective: month.objectiveAmount,
    pipeline: month.pipelineAmount,
    dealCount: month.dealCount,
    confidenceScore: month.confidenceScore,
  }));
};

export const getScenarioClassName = (scenarioId: string): string =>
  scenarioId === "likely" ? "ae-forecast-scenario active" : "ae-forecast-scenario";

export const getRiskClassName = (severity: string): string => `ae-forecast-risk-pill ${severity}`;

export const sortDealsByImpact = (deals: ForecastDeal[]): ForecastDeal[] =>
  [...deals].sort((left, right) => right.impactAmount - left.impactAmount);

export const sortSignedDeals = (deals: ForecastDeal[]): ForecastDeal[] =>
  [...deals].sort((left, right) => right.amount - left.amount);

export const isTechnicalOwnerFallback = (ownerName: string | null | undefined): boolean => /^Owner \d+$/i.test(ownerName ?? "");

export const getProbabilityLabel = (deal: ForecastDeal): string => {
  if (deal.analysisStatus === "closed_won") {
    return "100% factuel";
  }

  return deal.aiProbability === null ? "A analyser" : `${deal.aiProbability}%`;
};

export const getSignedBucketLabel = (deal: ForecastDeal): string =>
  deal.forecastBucket === "paymentReceived" ? "Paiement recu" : "Signe, paiement pending";

export const getDelta = (deal: ForecastDeal): number | null => (deal.aiProbability === null ? null : deal.aiProbability - deal.crmProbability);

export const getDeltaClassName = (delta: number | null): string => {
  if (delta === null || delta === 0) {
    return "flat";
  }

  return delta > 0 ? "positive" : "negative";
};

export const formatDelta = (delta: number | null): string => {
  if (delta === null) {
    return "--";
  }

  return `${delta > 0 ? "+" : ""}${delta} pts`;
};

export const getTrend = (current: number, previous: number): { value: number; className: string } => {
  if (previous <= 0) {
    return { value: current > 0 ? 100 : 0, className: current > 0 ? "positive" : "flat" };
  }

  const value = Math.round(((current - previous) / previous) * 100);

  return {
    value: Math.abs(value),
    className: value > 0 ? "positive" : value < 0 ? "negative" : "flat",
  };
};
