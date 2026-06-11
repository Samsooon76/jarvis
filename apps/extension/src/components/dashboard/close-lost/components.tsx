import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { Bot, CircleX, Euro, RotateCcw, Sigma } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  CloseLostBreakdownRow,
  CloseLostDealDetailResult,
  CloseLostDealListItem,
  CloseLostMetric,
  CloseLostOverviewResult,
  CloseLostScope,
  HubSpotOwnerOption,
} from "../../../services/api";
import { formatAmount, formatDate, formatDateTime } from "../../../utils/dashboard/formatters";
import {
  type BreakdownTableRow,
  getDetailOwnerDisplayName,
  getMetricTone,
  formatMetricValue,
  severityLabels,
  type TrendPoint,
} from "./utils";

type TreemapRect = {
  row: CloseLostBreakdownRow;
  x: number;
  y: number;
  width: number;
  height: number;
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

export const MetricCard = ({ metric }: { metric: CloseLostMetric }) => {
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

export const FilterToolbar = ({
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

export const KeyInsight = ({
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

export const buildTreemapRects = (
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

export const LossTreemap = ({ rows }: { rows: CloseLostBreakdownRow[] }) => {
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

export const ValueTrendChart = ({ points }: { points: TrendPoint[] }) => {
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

export const SegmentTable = ({ rows }: { rows: BreakdownTableRow[] }) => (
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

export const TopFactors = ({ overview }: { overview: CloseLostOverviewResult | null }) => {
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

export const Recommendations = ({
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

export const CompactBreakdown = ({ rows, title }: { rows: CloseLostBreakdownRow[]; title: string }) => (
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

export const DealTable = ({
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

export const DealDeepDive = ({
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
