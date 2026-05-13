import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { Bot, CircleX, Euro, RotateCcw, Sigma } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  analyzeCloseLostDeal,
  fetchCloseLostAnalysisRun,
  fetchCloseLostDealDetail,
  fetchCloseLostOverview,
  startCloseLostAnalysisRun,
  type AiProviderOption,
  type CloseLostAnalysisRun,
  type CloseLostBreakdownRow,
  type CloseLostDealDetailResult,
  type CloseLostDealListItem,
  type CloseLostMetric,
  type CloseLostOverviewResult,
  type CloseLostScope,
  type HubSpotOwnerOption,
} from "../../services/api";
import { formatAmount, formatDate, formatDateTime } from "../../utils/dashboard/formatters";

type CloseLostAnalysisViewProps = {
  orgId: string;
  owners: HubSpotOwnerOption[];
  selectedOwnerId?: string;
  selectedAiProvider: AiProviderOption;
};

type BreakdownTableRow = {
  id: string;
  label: string;
  dealCount: number;
  lostValue: number;
  averageLoss: number;
  share: number;
};

type TrendPoint = {
  key: string;
  label: string;
  value: number;
  cumulativeValue: number;
};

type TreemapRect = {
  row: CloseLostBreakdownRow;
  x: number;
  y: number;
  width: number;
  height: number;
};

const wait = async (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });

const formatInputDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const getDefaultDateRange = (): { dateFrom: string; dateTo: string } => {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);

  return {
    dateFrom: formatInputDate(yearStart),
    dateTo: formatInputDate(now),
  };
};

const getSalesAeOwners = (owners: HubSpotOwnerOption[]): HubSpotOwnerOption[] => {
  const salesAeOwners = owners.filter((owner) => owner.teamName?.toLowerCase().includes("sales ae"));

  return salesAeOwners.length > 0 ? salesAeOwners : owners;
};

const formatMetricValue = (metric: CloseLostMetric): string => {
  if (metric.unit === "currency") {
    return formatAmount(metric.value);
  }

  if (metric.unit === "score") {
    return `${metric.value}/100`;
  }

  return String(metric.value);
};

const getMetricTone = (metric: CloseLostMetric): string => {
  if (metric.id === "lostDeals" || metric.id === "analyzedDeals") {
    return "down";
  }

  if (metric.id === "reactivationScore") {
    return "up";
  }

  return "neutral";
};

const metricIcons: Record<CloseLostMetric["id"], LucideIcon> = {
  analyzedDeals: Bot,
  averageLoss: Sigma,
  lostDeals: CircleX,
  lostValue: Euro,
  reactivationScore: RotateCcw,
};

const analysisStatusLabels: Record<CloseLostDealListItem["analysisStatus"], string> = {
  fresh: "Analysee",
  missing: "Non analysee",
  stale: "Analysee",
};

const severityLabels: Record<string, string> = {
  high: "Eleve",
  low: "Faible",
  medium: "Moyen",
};

const tabs = ["Vue d'ensemble", "Raisons de perte", "Concurrence", "Analyse par etape", "Equipe"];

const getDateRangeLabel = (dateFrom: string, dateTo: string): string => {
  const from = dateFrom ? formatDate(dateFrom) : "Debut";
  const to = dateTo ? formatDate(dateTo) : "Aujourd'hui";

  return `${from} - ${to}`;
};

const getKeyInsight = (overview: CloseLostOverviewResult | null): { title: string; detail: string } => {
  if (overview?.portfolio) {
    return {
      title: overview.portfolio.keyInsight,
      detail: overview.portfolio.executiveSummary,
    };
  }

  const topReason = overview?.lossReasons[0] ?? null;

  if (topReason) {
    return {
      title: `${topReason.label} est la premiere raison de perte (${topReason.share}% de la valeur perdue).`,
      detail: "Lance l'analyse IA globale pour confirmer les causes recurrentes et generer les recommandations manager.",
    };
  }

  return {
    title: "Aucune perte analysee sur ce perimetre.",
    detail: "Ajuste les filtres ou relance une synchronisation HubSpot pour alimenter cette vue.",
  };
};

const getOwnerDisplayName = (
  ownerHubSpotId: string | null,
  fallbackName: string | null,
  ownersById: Map<string, HubSpotOwnerOption>,
): string => {
  if (ownerHubSpotId) {
    const owner = ownersById.get(ownerHubSpotId);

    if (owner) {
      return owner.name;
    }
  }

  return fallbackName ?? "Owner non assigne";
};

const getDealOwnerDisplayName = (
  deal: Pick<CloseLostDealListItem, "ownerHubSpotId" | "ownerName">,
  ownersById: Map<string, HubSpotOwnerOption>,
): string => getOwnerDisplayName(deal.ownerHubSpotId, deal.ownerName, ownersById);

const getDetailOwnerDisplayName = (
  detail: CloseLostDealDetailResult,
  ownersById: Map<string, HubSpotOwnerOption>,
): string => getOwnerDisplayName(detail.deal.ownerHubSpotId, detail.deal.ownerName, ownersById);

const buildBreakdownRows = (
  deals: CloseLostDealListItem[],
  getKey: (deal: CloseLostDealListItem) => string | null,
  fallbackLabel: string,
): BreakdownTableRow[] => {
  const lostValue = deals.reduce((sum, deal) => sum + deal.amount, 0);
  const rowsByLabel = new Map<string, BreakdownTableRow>();

  for (const deal of deals) {
    const label = getKey(deal)?.trim() || fallbackLabel;
    const id = label.toLowerCase();
    const row = rowsByLabel.get(id) ?? {
      id,
      label,
      dealCount: 0,
      lostValue: 0,
      averageLoss: 0,
      share: 0,
    };

    row.dealCount += 1;
    row.lostValue += deal.amount;
    rowsByLabel.set(id, row);
  }

  return Array.from(rowsByLabel.values())
    .map((row) => ({
      ...row,
      averageLoss: row.dealCount > 0 ? Math.round(row.lostValue / row.dealCount) : 0,
      share: lostValue > 0 ? Math.round((row.lostValue / lostValue) * 100) : 0,
    }))
    .sort((left, right) => right.lostValue - left.lostValue)
    .slice(0, 5);
};

const buildMonthlyTrend = (deals: CloseLostDealListItem[]): TrendPoint[] => {
  const formatter = new Intl.DateTimeFormat("fr-FR", { month: "short" });
  const rowsByMonth = new Map<string, { date: Date; value: number }>();

  for (const deal of deals) {
    if (!deal.closedAt) {
      continue;
    }

    const closedAt = new Date(deal.closedAt);

    if (Number.isNaN(closedAt.getTime())) {
      continue;
    }

    const date = new Date(closedAt.getFullYear(), closedAt.getMonth(), 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const current = rowsByMonth.get(key) ?? { date, value: 0 };
    current.value += deal.amount;
    rowsByMonth.set(key, current);
  }

  let cumulativeValue = 0;

  return Array.from(rowsByMonth.entries())
    .sort(([, left], [, right]) => left.date.getTime() - right.date.getTime())
    .map(([key, row]) => {
      cumulativeValue += row.value;

      return {
        key,
        label: formatter.format(row.date).replace(".", ""),
        value: row.value,
        cumulativeValue,
      };
    });
};

const MetricCard = ({ metric }: { metric: CloseLostMetric }) => {
  const Icon = metricIcons[metric.id];

  return (
    <article className="ae-close-lost-metric">
      <span className="ae-close-lost-metric-icon" aria-hidden="true">
        <Icon size={20} strokeWidth={2.2} />
      </span>
      <div>
        <small>{metric.label}</small>
        <strong>{formatMetricValue(metric)}</strong>
        <em className={getMetricTone(metric)}>{metric.caption}</em>
      </div>
    </article>
  );
};

const FilterToolbar = ({
  dateFrom,
  dateTo,
  isLoading,
  onDateFromChange,
  onDateToChange,
  onOwnerChange,
  onRun,
  onScopeChange,
  ownerId,
  owners,
  scope,
}: {
  dateFrom: string;
  dateTo: string;
  isLoading: boolean;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onOwnerChange: (value: string) => void;
  onRun: () => void;
  onScopeChange: (value: CloseLostScope) => void;
  ownerId: string;
  owners: HubSpotOwnerOption[];
  scope: CloseLostScope;
}) => (
  <div className="ae-close-lost-toolbar">
    <label>
      Periode
      <span>
        <input onChange={(event) => onDateFromChange(event.target.value)} type="date" value={dateFrom} />
        <input onChange={(event) => onDateToChange(event.target.value)} type="date" value={dateTo} />
      </span>
    </label>
    <label>
      Propriétaire
      <select disabled={scope !== "owner" || owners.length === 0} onChange={(event) => onOwnerChange(event.target.value)} value={ownerId}>
        {owners.map((owner) => (
          <option key={owner.ownerId} value={owner.ownerId}>
            {[owner.name, owner.teamName].filter(Boolean).join(" - ")}
          </option>
        ))}
      </select>
    </label>
    <label>
      Equipe
      <select onChange={(event) => onScopeChange(event.target.value as CloseLostScope)} value={scope}>
        <option value="sales_ae">Toutes</option>
        <option value="owner">Owner selectionne</option>
      </select>
    </label>
    <button disabled={isLoading} onClick={onRun} type="button">
      + Analyser
    </button>
  </div>
);

const KeyInsight = ({
  detail,
  onRecommendationsClick,
  title,
}: {
  detail: string;
  onRecommendationsClick: () => void;
  title: string;
}) => (
  <section className="ae-close-lost-insight">
    <span className="ae-close-lost-bulb" aria-hidden="true">
      !
    </span>
    <div>
      <strong>Key insight</strong>
      <p>{title}</p>
      <small>{detail}</small>
    </div>
    <button onClick={onRecommendationsClick} type="button">
      Voir recommandations
    </button>
  </section>
);

const buildTreemapRects = (
  rows: CloseLostBreakdownRow[],
  x: number,
  y: number,
  width: number,
  height: number,
  vertical: boolean,
): TreemapRect[] => {
  if (rows.length === 0) {
    return [];
  }

  if (rows.length === 1) {
    return [{ row: rows[0], x, y, width, height }];
  }

  const totalValue = rows.reduce((sum, row) => sum + Math.max(0, row.lostValue), 0);
  const targetValue = totalValue / 2;
  let groupValue = 0;
  let splitIndex = 0;

  while (splitIndex < rows.length - 1 && groupValue + rows[splitIndex].lostValue <= targetValue) {
    groupValue += rows[splitIndex].lostValue;
    splitIndex += 1;
  }

  if (splitIndex === 0) {
    splitIndex = 1;
    groupValue = rows[0].lostValue;
  }

  const firstGroup = rows.slice(0, splitIndex);
  const secondGroup = rows.slice(splitIndex);
  const firstShare = totalValue > 0 ? groupValue / totalValue : firstGroup.length / rows.length;

  if (vertical) {
    const firstWidth = width * firstShare;

    return [
      ...buildTreemapRects(firstGroup, x, y, firstWidth, height, false),
      ...buildTreemapRects(secondGroup, x + firstWidth, y, width - firstWidth, height, false),
    ];
  }

  const firstHeight = height * firstShare;

  return [
    ...buildTreemapRects(firstGroup, x, y, width, firstHeight, true),
    ...buildTreemapRects(secondGroup, x, y + firstHeight, width, height - firstHeight, true),
  ];
};

const LossTreemap = ({ rows }: { rows: CloseLostBreakdownRow[] }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rectsRef = useRef<TreemapRect[]>([]);
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; row: CloseLostBreakdownRow } | null>(null);
  const visibleRows = useMemo(() => rows.slice(0, 5), [rows]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const drawTreemap = () => {
      const parent = canvas.parentElement;
      const width = Math.max(280, Math.floor(parent?.clientWidth ?? 520));
      const height = 220;
      const ratio = window.devicePixelRatio || 1;
      const context = canvas.getContext("2d");

      if (!context) {
        return;
      }

      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const colors = ["#0f6f5c", "#93c9bd", "#c8e2db", "#dcece7", "#edf6f3"];
      const rects = buildTreemapRects(visibleRows, 0, 0, width, height, true);
      rectsRef.current = rects;

      rects.forEach((rect, index) => {
        const isActive = rect.row.id === hoveredRowId;
        context.fillStyle = colors[index] ?? "#edf6f3";
        context.fillRect(rect.x + 1, rect.y + 1, Math.max(0, rect.width - 2), Math.max(0, rect.height - 2));

        if (isActive) {
          context.strokeStyle = "#073f36";
          context.lineWidth = 3;
          context.strokeRect(rect.x + 3, rect.y + 3, Math.max(0, rect.width - 6), Math.max(0, rect.height - 6));
        }

        const textColor = index === 0 ? "#ffffff" : "#17332e";
        context.fillStyle = textColor;
        context.font = "950 12px ui-sans-serif, system-ui";
        context.textBaseline = "top";
        context.fillText(rect.row.label, rect.x + 14, rect.y + 14, Math.max(20, rect.width - 28));

        if (rect.width > 120 && rect.height > 62) {
          context.font = "900 12px ui-sans-serif, system-ui";
          context.textBaseline = "bottom";
          context.fillText(
            `${formatAmount(rect.row.lostValue)} (${rect.row.share}%)`,
            rect.x + 14,
            rect.y + rect.height - 14,
            Math.max(20, rect.width - 28),
          );
        }
      });
    };

    drawTreemap();

    const observer = new ResizeObserver(drawTreemap);

    if (canvas.parentElement) {
      observer.observe(canvas.parentElement);
    }

    return () => observer.disconnect();
  }, [hoveredRowId, visibleRows]);

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const bounds = canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const rect = rectsRef.current.find(
      (candidate) =>
        x >= candidate.x &&
        x <= candidate.x + candidate.width &&
        y >= candidate.y &&
        y <= candidate.y + candidate.height,
    );

    setHoveredRowId(rect?.row.id ?? null);
    setTooltip(rect ? { x: Math.min(x + 14, bounds.width - 190), y: Math.max(10, y - 14), row: rect.row } : null);
  };

  return (
    <article className="ae-close-lost-panel ae-close-lost-treemap-panel">
      <div className="ae-close-lost-panel-head">
        <h3>Repartition des pertes par raison (par valeur)</h3>
      </div>
      {visibleRows.length > 0 ? (
        <div className="ae-close-lost-treemap">
          <canvas
            aria-label="Repartition interactive des pertes par raison"
            onPointerLeave={() => {
              setHoveredRowId(null);
              setTooltip(null);
            }}
            onPointerMove={handlePointerMove}
            ref={canvasRef}
            role="img"
          />
          {tooltip ? (
            <div className="ae-close-lost-treemap-tooltip" role="status" style={{ left: tooltip.x, top: tooltip.y }}>
              <strong>{tooltip.row.label}</strong>
              <span>Valeur perdue : {formatAmount(tooltip.row.lostValue)}</span>
              <span>{tooltip.row.dealCount} deal(s)</span>
              <span>{tooltip.row.share}% de la valeur perdue</span>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="ae-empty">Aucune raison analysee.</p>
      )}
    </article>
  );
};

const ValueTrendChart = ({ points }: { points: TrendPoint[] }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const maxValue = useMemo(() => Math.max(...points.map((point) => point.cumulativeValue), 1), [points]);
  const activePoint = hoverIndex === null ? null : points[hoverIndex] ?? null;

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const drawChart = () => {
      const parent = canvas.parentElement;
      const width = Math.max(320, Math.floor(parent?.clientWidth ?? 640));
      const height = 220;
      const ratio = window.devicePixelRatio || 1;
      const padding = {
        bottom: 28,
        left: 44,
        right: 22,
        top: 18,
      };
      const plotWidth = width - padding.left - padding.right;
      const plotHeight = height - padding.top - padding.bottom;
      const context = canvas.getContext("2d");

      if (!context) {
        return;
      }

      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      context.strokeStyle = "#e6ece8";
      context.lineWidth = 1;
      context.font = "700 10px ui-sans-serif, system-ui";
      context.fillStyle = "#66737b";

      for (let index = 0; index <= 3; index += 1) {
        const y = padding.top + (index / 3) * plotHeight;
        context.beginPath();
        context.moveTo(padding.left, y);
        context.lineTo(width - padding.right, y);
        context.stroke();
      }

      if (points.length === 0) {
        return;
      }

      const getX = (index: number) => padding.left + (points.length <= 1 ? 0.5 : index / (points.length - 1)) * plotWidth;
      const getY = (value: number) => padding.top + plotHeight - (value / maxValue) * plotHeight;
      const coordinates = points.map((point, index) => ({
        x: getX(index),
        y: getY(point.cumulativeValue),
      }));

      context.beginPath();
      coordinates.forEach((coordinate, index) => {
        if (index === 0) {
          context.moveTo(coordinate.x, coordinate.y);
          return;
        }

        context.lineTo(coordinate.x, coordinate.y);
      });
      context.lineTo(coordinates[coordinates.length - 1].x, padding.top + plotHeight);
      context.lineTo(coordinates[0].x, padding.top + plotHeight);
      context.closePath();
      context.fillStyle = "rgba(15, 111, 92, 0.11)";
      context.fill();

      context.beginPath();
      coordinates.forEach((coordinate, index) => {
        if (index === 0) {
          context.moveTo(coordinate.x, coordinate.y);
          return;
        }

        context.lineTo(coordinate.x, coordinate.y);
      });
      context.strokeStyle = "#0f6f5c";
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = 3;
      context.stroke();

      coordinates.forEach((coordinate, index) => {
        const isActive = index === hoverIndex;
        context.beginPath();
        context.arc(coordinate.x, coordinate.y, isActive ? 7 : 4.5, 0, Math.PI * 2);
        context.fillStyle = "#0f6f5c";
        context.fill();
        context.lineWidth = isActive ? 4 : 0;
        context.strokeStyle = isActive ? "rgba(15, 111, 92, 0.18)" : "transparent";
        context.stroke();

        context.fillStyle = "#66737b";
        context.font = "800 10px ui-sans-serif, system-ui";
        context.textAlign = index === 0 ? "left" : index === coordinates.length - 1 ? "right" : "center";
        context.fillText(points[index].label, coordinate.x, height - 6);
      });

      if (hoverIndex !== null && coordinates[hoverIndex]) {
        const coordinate = coordinates[hoverIndex];
        context.beginPath();
        context.moveTo(coordinate.x, padding.top);
        context.lineTo(coordinate.x, padding.top + plotHeight);
        context.strokeStyle = "rgba(15, 111, 92, 0.28)";
        context.lineWidth = 1;
        context.stroke();
      }
    };

    drawChart();

    const observer = new ResizeObserver(drawChart);

    if (canvas.parentElement) {
      observer.observe(canvas.parentElement);
    }

    return () => observer.disconnect();
  }, [hoverIndex, maxValue, points]);

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;

    if (!canvas || points.length === 0) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const paddingLeft = 44;
    const paddingRight = 22;
    const plotWidth = rect.width - paddingLeft - paddingRight;
    const pointerX = event.clientX - rect.left;
    const rawIndex =
      points.length <= 1 ? 0 : Math.round(((pointerX - paddingLeft) / Math.max(1, plotWidth)) * (points.length - 1));
    const nextIndex = Math.min(points.length - 1, Math.max(0, rawIndex));
    setHoverIndex(nextIndex);
  };

  return (
    <article className="ae-close-lost-panel ae-close-lost-trend-panel">
      <div className="ae-close-lost-panel-head">
        <h3>Evolution de la valeur perdue</h3>
        <span>Cumule</span>
      </div>
      {points.length > 0 ? (
        <div className="ae-close-lost-chart">
          <canvas
            aria-label="Evolution interactive de la valeur perdue"
            onPointerLeave={() => setHoverIndex(null)}
            onPointerMove={handlePointerMove}
            ref={canvasRef}
            role="img"
          />
          {activePoint ? (
            <div className="ae-close-lost-chart-tooltip" role="status">
              <strong>{activePoint.label}</strong>
              <span>Perdu sur le mois : {formatAmount(activePoint.value)}</span>
              <span>Cumul : {formatAmount(activePoint.cumulativeValue)}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="ae-empty">Pas encore assez de dates de cloture pour tracer une tendance.</p>
      )}
    </article>
  );
};

const SegmentTable = ({ rows }: { rows: BreakdownTableRow[] }) => (
  <article className="ae-close-lost-panel">
    <div className="ae-close-lost-panel-head">
      <h3>Analyse par segment</h3>
    </div>
    <div className="ae-close-lost-mini-table">
      <div className="head">
        <span>Segment</span>
        <span>Deals lost</span>
        <span>Valeur perdue</span>
        <span>Perte moyenne</span>
        <span>Part</span>
      </div>
      {rows.map((row) => (
        <div key={row.id}>
          <strong>{row.label}</strong>
          <span>{row.dealCount}</span>
          <span>{formatAmount(row.lostValue)}</span>
          <span>{formatAmount(row.averageLoss)}</span>
          <span>
            {row.share}%
            <i style={{ width: `${Math.max(6, row.share)}%` }} />
          </span>
        </div>
      ))}
    </div>
  </article>
);

const TopFactors = ({ overview }: { overview: CloseLostOverviewResult | null }) => {
  const factors =
    overview?.portfolio?.topFactors.map((factor) => ({
      title: factor.title,
      impact: severityLabels[factor.impact],
      dealShare: factor.dealShare,
      rationale: factor.rationale,
    })) ??
    overview?.lossReasons.slice(0, 5).map((row) => ({
      title: row.label,
      impact: row.share >= 30 ? "Eleve" : row.share >= 15 ? "Moyen" : "Faible",
      dealShare: row.share,
      rationale: `${row.dealCount} deal(s), ${formatAmount(row.lostValue)} de valeur perdue.`,
    })) ??
    [];

  return (
    <article className="ae-close-lost-panel">
      <div className="ae-close-lost-panel-head">
        <h3>Top facteurs influencant les pertes</h3>
      </div>
      <div className="ae-close-lost-factor-list">
        {factors.map((factor) => (
          <div key={factor.title}>
            <strong>{factor.title}</strong>
            <i style={{ width: `${Math.max(8, factor.dealShare)}%` }} />
            <span>{factor.impact}</span>
            <em>{factor.dealShare}%</em>
            <small>{factor.rationale}</small>
          </div>
        ))}
      </div>
    </article>
  );
};

const Recommendations = ({
  overview,
  panelRef,
}: {
  overview: CloseLostOverviewResult | null;
  panelRef: (node: HTMLElement | null) => void;
}) => (
  <article className="ae-close-lost-panel ae-close-lost-recommendations-panel" ref={panelRef}>
    <div className="ae-close-lost-panel-head">
      <h3>Recommandations cles</h3>
    </div>
    {overview?.recommendations.length ? (
      <div className="ae-close-lost-recommendations">
        {overview.recommendations.map((recommendation) => (
          <p key={recommendation.title}>
            <strong>{recommendation.title}</strong>
            <span>{severityLabels[recommendation.priority]}</span>
            <small>{recommendation.rationale}</small>
          </p>
        ))}
      </div>
    ) : (
      <p className="ae-empty">Lance une analyse globale pour produire les recommandations manager.</p>
    )}
  </article>
);

const CompactBreakdown = ({ rows, title }: { rows: CloseLostBreakdownRow[]; title: string }) => (
  <article className="ae-close-lost-panel">
    <div className="ae-close-lost-panel-head">
      <h3>{title}</h3>
    </div>
    <div className="ae-close-lost-compact-breakdown">
      {rows.slice(0, 5).map((row) => (
        <p key={row.id}>
          <strong>{row.label}</strong>
          <span>{row.dealCount} deals</span>
          <em>{row.share}%</em>
          <i style={{ width: `${Math.max(6, row.share)}%` }} />
        </p>
      ))}
    </div>
  </article>
);

const DealTable = ({
  activeDealId,
  deals,
  onDealSelect,
}: {
  activeDealId: string | null;
  deals: CloseLostDealListItem[];
  onDealSelect: (hubspotDealId: string) => void;
}) => (
  <article className="ae-close-lost-panel ae-close-lost-table-panel">
    <div className="ae-close-lost-panel-head">
      <h3>Focus pertes significatives</h3>
      <span>{deals.length} deal(s)</span>
    </div>
    <div className="ae-close-lost-table">
      <div className="ae-close-lost-row header">
        <span>Deal</span>
        <span>Valeur perdue</span>
        <span>Raison principale</span>
        <span>Etape</span>
        <span>Perdu le</span>
        <span>Deep dive</span>
      </div>
      {deals.map((deal) => (
        <button
          className={`ae-close-lost-row${activeDealId === deal.hubspotDealId ? " active" : ""}`}
          key={deal.hubspotDealId}
          onClick={() => onDealSelect(deal.hubspotDealId)}
          type="button"
        >
          <span>
            <strong>{deal.companyName}</strong>
            <small>{deal.dealName ?? deal.contactName ?? deal.hubspotDealId}</small>
          </span>
          <span>{formatAmount(deal.amount)}</span>
          <span>{deal.primaryLossReason ?? "Non analyse"}</span>
          <span>{deal.stage}</span>
          <span>{deal.closedAt ? formatDate(deal.closedAt) : "Sans date"}</span>
          <span className={`ae-close-lost-status ${deal.analysisStatus}`}>
            {analysisStatusLabels[deal.analysisStatus]}
          </span>
        </button>
      ))}
    </div>
  </article>
);

const DealDeepDive = ({
  detail,
  error,
  isAnalyzing,
  isLoading,
  onAnalyze,
  ownersById,
}: {
  detail: CloseLostDealDetailResult | null;
  error: string | null;
  isAnalyzing: boolean;
  isLoading: boolean;
  onAnalyze: () => void;
  ownersById: Map<string, HubSpotOwnerOption>;
}) => (
  <aside className="ae-close-lost-detail">
    <div className="ae-close-lost-detail-head">
      <div>
        <span>Deal deep dive</span>
        <h3>{detail?.deal.companyName ?? "Selectionne un deal"}</h3>
      </div>
      <button disabled={!detail || isAnalyzing || Boolean(detail?.analysis)} onClick={onAnalyze} type="button">
        {isAnalyzing ? "Analyse..." : detail?.analysis ? "Analyse terminee" : "Analyser"}
      </button>
    </div>

    {isLoading ? <p className="ae-empty">Chargement du deal...</p> : null}
    {error ? <p className="ae-detail-error">{error}</p> : null}

    {detail ? (
      <>
        <dl className="ae-close-lost-detail-facts">
          <div>
            <dt>Valeur perdue</dt>
            <dd>{formatAmount(detail.deal.amount)}</dd>
          </div>
          <div>
            <dt>Stage</dt>
            <dd>{detail.deal.stage}</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{getDetailOwnerDisplayName(detail, ownersById)}</dd>
          </div>
          <div>
            <dt>Derniere analyse</dt>
            <dd>{detail.generatedAt ? formatDateTime(detail.generatedAt) : "Non analysee"}</dd>
          </div>
        </dl>

        {detail.analysis ? (
          <div className="ae-close-lost-detail-grid">
            <section>
              <h4>Resume perte IA</h4>
              <p>{detail.analysis.summary}</p>
              <ul>
                <li>
                  <strong>Raison principale</strong>
                  <span>{detail.analysis.primaryLossReason}</span>
                </li>
                <li>
                  <strong>Raison secondaire</strong>
                  <span>{detail.analysis.secondaryLossReason ?? "Non identifiee"}</span>
                </li>
                <li>
                  <strong>Concurrent gagnant</strong>
                  <span>{detail.analysis.competitorName ?? "Non identifie"}</span>
                </li>
                <li>
                  <strong>Score de reactivation</strong>
                  <span>{detail.analysis.reactivationScore}/100</span>
                </li>
              </ul>
            </section>

            <section>
              <h4>Signaux avant perte</h4>
              {detail.analysis.riskSignals.map((signal) => (
                <p className={`ae-close-lost-signal ${signal.severity}`} key={signal.title}>
                  <strong>{signal.title}</strong>
                  <span>{severityLabels[signal.severity]}</span>
                  <small>{signal.detail}</small>
                </p>
              ))}
            </section>

            <section>
              <h4>Sante avant perte</h4>
              {detail.analysis.healthBeforeLoss.map((dimension) => (
                <p className="ae-close-lost-health" key={dimension.label}>
                  <strong>{dimension.label}</strong>
                  <i style={{ width: `${dimension.score}%` }} />
                  <span>{dimension.detail}</span>
                </p>
              ))}
            </section>

            <section>
              <h4>Playbook de reactivation</h4>
              {detail.analysis.playbook.map((action) => (
                <p className="ae-close-lost-action" key={action.title}>
                  <strong>{action.title}</strong>
                  <span>{action.timing}</span>
                  <small>{action.rationale}</small>
                </p>
              ))}
            </section>
          </div>
        ) : (
          <p className="ae-empty">Aucune analyse IA stockee pour ce deal. Lance le deep dive pour generer l'analyse.</p>
        )}
      </>
    ) : (
      <p className="ae-empty">Choisis un deal perdu dans le tableau pour ouvrir son analyse detaillee.</p>
    )}
  </aside>
);

export const CloseLostAnalysisView = ({
  orgId,
  owners,
  selectedAiProvider,
  selectedOwnerId,
}: CloseLostAnalysisViewProps) => {
  const defaultDates = useMemo(getDefaultDateRange, []);
  const salesAeOwners = useMemo(() => getSalesAeOwners(owners), [owners]);
  const [scope, setScope] = useState<CloseLostScope>("sales_ae");
  const [ownerId, setOwnerId] = useState(selectedOwnerId ?? salesAeOwners[0]?.ownerId ?? owners[0]?.ownerId ?? "");
  const [dateFrom, setDateFrom] = useState(defaultDates.dateFrom);
  const [dateTo, setDateTo] = useState(defaultDates.dateTo);
  const [overview, setOverview] = useState<CloseLostOverviewResult | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<CloseLostAnalysisRun | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [activeDealId, setActiveDealId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CloseLostDealDetailResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [dealAnalyzeLoading, setDealAnalyzeLoading] = useState(false);
  const [recommendationsPanel, setRecommendationsPanel] = useState<HTMLElement | null>(null);

  const salesAeOwnerIds = useMemo(() => salesAeOwners.map((owner) => owner.ownerId), [salesAeOwners]);
  const salesAeOwnerKey = salesAeOwnerIds.join(",");
  const ownersById = useMemo(
    () => new Map(owners.map((owner) => [owner.ownerId, owner])),
    [owners],
  );
  const resolvedOwnerId = scope === "owner" ? ownerId || selectedOwnerId || salesAeOwners[0]?.ownerId || null : null;
  const keyInsight = useMemo(() => getKeyInsight(overview), [overview]);
  const trendPoints = useMemo(() => buildMonthlyTrend(overview?.deals ?? []), [overview?.deals]);
  const segmentRows = useMemo(
    () => buildBreakdownRows(overview?.deals ?? [], (deal) => getDealOwnerDisplayName(deal, ownersById), "Owner non assigne"),
    [overview?.deals, ownersById],
  );
  const significantDeals = useMemo(
    () => [...(overview?.deals ?? [])].sort((left, right) => right.amount - left.amount),
    [overview?.deals],
  );

  const loadOverview = useCallback(async (options: { silent?: boolean } = {}) => {
    try {
      if (!options.silent) {
        setOverviewLoading(true);
      }
      setOverviewError(null);
      const result = await fetchCloseLostOverview({
        orgId,
        scope,
        hubspotOwnerId: resolvedOwnerId,
        salesAeOwnerIds,
        dateFrom,
        dateTo,
        aiProvider: selectedAiProvider,
      });
      setOverview(result);
      setActiveDealId((current) => current ?? result.deals[0]?.hubspotDealId ?? null);
    } catch (error) {
      setOverviewError(error instanceof Error ? error.message : "Close lost analysis indisponible.");
    } finally {
      if (!options.silent) {
        setOverviewLoading(false);
      }
    }
  }, [orgId, scope, resolvedOwnerId, salesAeOwnerIds, dateFrom, dateTo, selectedAiProvider.id, selectedAiProvider.model]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview, salesAeOwnerKey]);

  useEffect(() => {
    if (selectedOwnerId && !ownerId) {
      setOwnerId(selectedOwnerId);
    }
  }, [ownerId, selectedOwnerId]);

  useEffect(() => {
    if (!activeDealId) {
      setDetail(null);
      return;
    }

    let cancelled = false;

    const loadDetail = async () => {
      try {
        setDetailLoading(true);
        setDetailError(null);
        const result = await fetchCloseLostDealDetail(orgId, activeDealId, selectedAiProvider);

        if (!cancelled) {
          setDetail(result);
        }
      } catch (error) {
        if (!cancelled) {
          setDetailError(error instanceof Error ? error.message : "Detail close lost indisponible.");
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    };

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [activeDealId, orgId, selectedAiProvider.id, selectedAiProvider.model]);

  const handleStartRun = async () => {
    try {
      setRunLoading(true);
      setOverviewError(null);
      const startedRun = await startCloseLostAnalysisRun({
        orgId,
        scope,
        hubspotOwnerId: resolvedOwnerId,
        salesAeOwnerIds,
        dateFrom,
        dateTo,
        aiProvider: selectedAiProvider,
        refresh: false,
      });
      setActiveRun(startedRun);

      let currentRun = startedRun;
      let lastProcessedDealCount =
        startedRun.analyzedCount + startedRun.reusedCount + startedRun.failedCount;

      while (currentRun.status !== "completed" && currentRun.status !== "failed") {
        await wait(1200);
        currentRun = await fetchCloseLostAnalysisRun(startedRun.id);
        setActiveRun(currentRun);

        const processedDealCount =
          currentRun.analyzedCount + currentRun.reusedCount + currentRun.failedCount;

        if (processedDealCount > lastProcessedDealCount) {
          lastProcessedDealCount = processedDealCount;
          await loadOverview({ silent: true });
        }
      }

      if (currentRun.status === "failed") {
        throw new Error(currentRun.error ?? "Run close lost en erreur.");
      }

      await loadOverview();
    } catch (error) {
      setOverviewError(error instanceof Error ? error.message : "Impossible de lancer l'analyse close lost.");
    } finally {
      setRunLoading(false);
    }
  };

  const handleAnalyzeDeal = async () => {
    if (!activeDealId) {
      return;
    }

    try {
      setDealAnalyzeLoading(true);
      setDetailError(null);
      const result = await analyzeCloseLostDeal(orgId, activeDealId, selectedAiProvider, true);
      setDetail(result);
      await loadOverview();
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Impossible d'analyser ce deal close lost.");
    } finally {
      setDealAnalyzeLoading(false);
    }
  };

  return (
    <section className="ae-close-lost-page" aria-label="Close lost analysis">
      <div className="ae-close-lost-titlebar">
        <div>
          <h2>Close lost analysis</h2>
          <p>Comprenez pourquoi vous perdez des deals et identifiez les leviers d'amelioration.</p>
        </div>
        <span>Derniere mise a jour : {overview?.generatedAt ? formatDateTime(overview.generatedAt) : getDateRangeLabel(dateFrom, dateTo)}</span>
      </div>

      <nav className="ae-close-lost-tabs" aria-label="Close lost sections">
        {tabs.map((tab, index) => (
          <button className={index === 0 ? "active" : ""} key={tab} type="button">
            {tab}
          </button>
        ))}
      </nav>

      <FilterToolbar
        dateFrom={dateFrom}
        dateTo={dateTo}
        isLoading={runLoading || overviewLoading}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onOwnerChange={setOwnerId}
        onRun={handleStartRun}
        onScopeChange={setScope}
        ownerId={ownerId}
        owners={owners}
        scope={scope}
      />

      {overviewError ? <p className="ae-detail-error">{overviewError}</p> : null}

      {activeRun ? (
        <section className="ae-close-lost-run" aria-live="polite">
          <div>
            <span>{activeRun.currentStep}</span>
            <strong>{activeRun.progress}%</strong>
          </div>
          <i>
            <span style={{ width: `${activeRun.progress}%` }} />
          </i>
          <small>
            {activeRun.analyzedCount} analyse(s), {activeRun.reusedCount} cache(s), {activeRun.failedCount} erreur(s)
          </small>
        </section>
      ) : null}

      <KeyInsight
        detail={keyInsight.detail}
        onRecommendationsClick={() => recommendationsPanel?.scrollIntoView({ behavior: "smooth", block: "center" })}
        title={keyInsight.title}
      />

      <section className="ae-close-lost-metrics">
        {(overview?.metrics ?? []).map((metric) => (
          <MetricCard key={metric.id} metric={metric} />
        ))}
      </section>

      <section className="ae-close-lost-top-grid">
        <LossTreemap rows={overview?.lossReasons ?? []} />
        <ValueTrendChart points={trendPoints} />
      </section>

      <section className="ae-close-lost-middle-grid">
        <SegmentTable rows={segmentRows} />
        <TopFactors overview={overview} />
        <Recommendations overview={overview} panelRef={setRecommendationsPanel} />
      </section>

      <section className="ae-close-lost-bottom-grid">
        <DealTable activeDealId={activeDealId} deals={significantDeals} onDealSelect={(hubspotDealId) => setActiveDealId(hubspotDealId)} />
        <CompactBreakdown rows={overview?.competitors ?? []} title="Patterns competitifs recurrents" />
        <CompactBreakdown rows={overview?.stageBreakdown ?? []} title="Repartition des pertes par etape" />
      </section>

      <section className="ae-close-lost-workspace">
        <DealDeepDive
          detail={detail}
          error={detailError}
          isAnalyzing={dealAnalyzeLoading}
          isLoading={detailLoading}
          onAnalyze={handleAnalyzeDeal}
          ownersById={ownersById}
        />
      </section>
    </section>
  );
};
