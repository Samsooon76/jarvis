import type { QueueProspect } from "@jarvis/shared";
import { bucketRank, stageFilters, stageFunnelColors } from "../../components/dashboard/config";
import type {
  ForecastChartViewModel,
  MetricCard,
  QueueBucket,
  StageDashboardRow,
  StageChartViewModel,
  StageFilter,
} from "../../components/dashboard/types";
import { buildSmoothPath } from "./charts";
import { formatAmount, formatMonth, formatShortMonth } from "./formatters";
import { getBucket, getDateOnly, matchesStageFilter } from "./prospects";

export const buildForecastChart = (prospects: QueueProspect[]): ForecastChartViewModel => {
  const currentYear = new Date().getFullYear();
  const previousYear = currentYear - 1;
  const months = Array.from({ length: 12 }, (_, monthIndex) => {
    const monthDate = new Date(currentYear, monthIndex, 1);

    return {
      id: String(monthIndex + 1).padStart(2, "0"),
      monthIndex,
      label: formatMonth(monthDate),
      shortLabel: formatShortMonth(monthDate),
      currentYear,
      previousYear,
      currentCount: 0,
      previousCount: 0,
      currentAmount: 0,
      previousAmount: 0,
      deltaAmount: 0,
      deltaCount: 0,
    };
  });

  prospects.forEach((prospect) => {
    const closeDate = prospect.closeDate ? getDateOnly(prospect.closeDate) : null;

    if (!closeDate) {
      return;
    }

    const targetMonth = months[closeDate.getMonth()];

    if (closeDate.getFullYear() === currentYear) {
      targetMonth.currentCount += 1;
      targetMonth.currentAmount += prospect.dealAmount;
    }

    if (closeDate.getFullYear() === previousYear) {
      targetMonth.previousCount += 1;
      targetMonth.previousAmount += prospect.dealAmount;
    }
  });

  months.forEach((month) => {
    month.deltaAmount = month.currentAmount - month.previousAmount;
    month.deltaCount = month.currentCount - month.previousCount;
  });

  const width = 720;
  const height = 314;
  const padding = { top: 42, right: 28, bottom: 54, left: 42 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const baseline = padding.top + innerHeight;
  const maxForecastAmount = Math.max(
    ...months.flatMap((month) => [month.currentAmount, month.previousAmount]),
    1,
  );
  const monthSlotWidth = innerWidth / months.length;
  const barWidth = Math.min(18, Math.max(8, monthSlotWidth * 0.28));
  const barGap = 4;
  const points = months.map((month, index) => {
    const x = padding.left + index * monthSlotWidth + monthSlotWidth / 2;
    const previousHeight = (month.previousAmount / maxForecastAmount) * innerHeight;
    const currentHeight = (month.currentAmount / maxForecastAmount) * innerHeight;
    const previousBarX = x - barWidth - barGap / 2;
    const currentBarX = x + barGap / 2;

    return {
      ...month,
      x,
      y: baseline - Math.max(previousHeight, currentHeight),
      previousBar: {
        amount: month.previousAmount,
        count: month.previousCount,
        height: previousHeight,
        width: barWidth,
        x: previousBarX,
        y: baseline - previousHeight,
      },
      currentBar: {
        amount: month.currentAmount,
        count: month.currentCount,
        height: currentHeight,
        width: barWidth,
        x: currentBarX,
        y: baseline - currentHeight,
      },
    };
  });

  return {
    baseline,
    currentYear,
    hasData: months.some((month) => month.currentAmount > 0 || month.previousAmount > 0),
    height,
    innerWidth,
    months,
    padding,
    points,
    previousYear,
    width,
  };
};

const getStageChartColor = (stageId: string, index: number): string => {
  if (stageId === "closedLost") {
    return "#ef5b5b";
  }

  if (stageId === "won") {
    return "#5ec879";
  }

  return stageFunnelColors[index % stageFunnelColors.length];
};

export const buildStageChart = (
  prospects: QueueProspect[],
  hideClosedLostStage: boolean,
): StageChartViewModel => {
  const stageDashboardRows: StageDashboardRow[] = stageFilters
    .filter((filter) => filter.id !== "all" && filter.id !== "late")
    .map((filter) => {
      const matchingProspects = prospects.filter((prospect) => matchesStageFilter(prospect, filter.id));

      return {
        id: filter.id,
        label: filter.label,
        count: matchingProspects.length,
        amount: matchingProspects.reduce((sum, prospect) => sum + prospect.dealAmount, 0),
        prospects: [...matchingProspects].sort(
          (firstProspect, secondProspect) =>
            secondProspect.dealAmount - firstProspect.dealAmount ||
            secondProspect.closeProbability - firstProspect.closeProbability,
        ),
      };
    });
  const wonStageFilterIds = new Set<StageFilter>([
    "contractValidation",
    "dealSignedPaymentPending",
    "paymentReceived",
  ]);
  const wonStageChartRow = stageDashboardRows
    .filter((row) => wonStageFilterIds.has(row.id as StageFilter))
    .reduce<StageDashboardRow>(
      (summary, row) => ({
        ...summary,
        count: summary.count + row.count,
        amount: summary.amount + row.amount,
        prospects: [...summary.prospects, ...row.prospects].sort(
          (firstProspect, secondProspect) =>
            secondProspect.dealAmount - firstProspect.dealAmount ||
            secondProspect.closeProbability - firstProspect.closeProbability,
        ),
      }),
      { id: "won", label: "Gagné", count: 0, amount: 0, prospects: [] },
    );
  const rows = stageDashboardRows.reduce<StageDashboardRow[]>(
    (chartRows, row) => {
      if (hideClosedLostStage && row.id === "closedLost") {
        return chartRows;
      }

      if (wonStageFilterIds.has(row.id as StageFilter)) {
        if (!chartRows.some((candidate) => candidate.id === wonStageChartRow.id)) {
          chartRows.push(wonStageChartRow);
        }

        return chartRows;
      }

      chartRows.push(row);
      return chartRows;
    },
    [],
  );
  const dealCount = rows.reduce((sum, row) => sum + row.count, 0);
  const maxStageCount = Math.max(...rows.map((row) => row.count), 1);
  const totalStageCount = Math.max(dealCount, 1);
  const width = Math.max(980, rows.length * 132);
  const height = 230;
  const padding = { top: 20, right: 0, bottom: 18, left: 0 };
  const columnWidth =
    rows.length > 0 ? (width - padding.left - padding.right) / rows.length : width - padding.left - padding.right;
  const bandCenterY = 116;
  const points = rows.map((row, index) => {
    const ratio = row.count > 0 ? Math.sqrt(row.count / maxStageCount) : 0;
    const thickness = 16 + ratio * 128;
    const x = padding.left + index * columnWidth + columnWidth / 2;

    return {
      ...row,
      color: getStageChartColor(row.id, index),
      share: Math.round((row.count / totalStageCount) * 1000) / 10,
      x,
      y: bandCenterY,
      topY: bandCenterY - thickness / 2,
      bottomY: bandCenterY + thickness / 2,
    };
  });
  const topPoints =
    points.length > 0
      ? [
          { x: 0, y: points[0].topY },
          ...points.map((point) => ({ x: point.x, y: point.topY })),
          { x: width, y: points[points.length - 1].topY },
        ]
      : [];
  const bottomPoints =
    points.length > 0
      ? [
          { x: 0, y: points[0].bottomY },
          ...points.map((point) => ({ x: point.x, y: point.bottomY })),
          { x: width, y: points[points.length - 1].bottomY },
        ]
      : [];
  const topPath = buildSmoothPath(topPoints);
  const bottomPath = buildSmoothPath([...bottomPoints].reverse());
  const bandPath =
    points.length > 0
      ? `${topPath} L ${width} ${points[points.length - 1].bottomY} ${bottomPath.replace(
          /^M [0-9.]+ [0-9.]+/,
          "",
        )} Z`
      : "";

  return {
    bandCenterY,
    bandPath,
    columnWidth,
    dealCount,
    height,
    padding,
    points,
    width,
  };
};

export const buildMetricCards = ({
  lostPipeline,
  openPipeline,
  openProspectCount,
  weightedOpenPipeline,
  winRate,
  wonPipeline,
}: {
  lostPipeline: number;
  openPipeline: number;
  openProspectCount: number;
  weightedOpenPipeline: number;
  winRate: number;
  wonPipeline: number;
}): MetricCard[] => [
  { id: "open", label: "Deals ouverts", value: openProspectCount, icon: "pulse", tone: "green" },
  { id: "pipeline", label: "Pipeline ouvert", value: formatAmount(openPipeline), icon: "money", tone: "green" },
  { id: "weighted", label: "Pipeline pondere", value: formatAmount(weightedOpenPipeline), icon: "clock", tone: "green" },
  { id: "won", label: "Closed won", value: formatAmount(wonPipeline), icon: "check", tone: "green" },
  { id: "lost", label: "Closed lost", value: formatAmount(lostPipeline), icon: "x", tone: "red" },
  { id: "rate", label: "Win rate", value: `${winRate}%`, icon: "trend", tone: "green" },
];

export const getPriorityTasks = (openProspects: QueueProspect[]): QueueProspect[] =>
  [...openProspects]
    .sort((firstProspect, secondProspect) => {
      const firstBucket = getBucket(firstProspect);
      const secondBucket = getBucket(secondProspect);

      return (
        bucketRank[firstBucket as QueueBucket] - bucketRank[secondBucket as QueueBucket] ||
        secondProspect.closeProbability - firstProspect.closeProbability ||
        secondProspect.dealAmount - firstProspect.dealAmount
      );
    })
    .slice(0, 8);
