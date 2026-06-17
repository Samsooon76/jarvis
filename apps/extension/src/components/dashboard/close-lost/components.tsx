import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import {
  AlertTriangle,
  AlignLeft,
  ChevronRight,
  CircleX,
  History,
  Lightbulb,
  ListChecks,
  MessageCircleWarning,
  RefreshCw,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type {
  CloseLostBreakdownRow,
  CloseLostDealDetailResult,
  CloseLostDealListItem,
  CloseLostOverviewResult,
  CloseLostScope,
  HubSpotOwnerOption,
} from "../../../services/api";
import { formatAmount, formatDate, formatDateTime } from "../../../utils/dashboard/formatters";
import {
  type BreakdownTableRow,
  getDetailOwnerDisplayName,
  getKeyInsight,
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

const analysisStatusLabels: Record<CloseLostDealListItem["analysisStatus"], string> = {
  fresh: "Analysée",
  missing: "À analyser",
  stale: "Analysée",
};

const getAnalysisStatusClass = (status: CloseLostDealListItem["analysisStatus"]): string => {
  if (status === "fresh" || status === "stale") {
    return "jv-meta-ok";
  }

  return "jv-meta-pending";
};

export const SectionLabel = ({ children, icon: Icon }: { children: string; icon: LucideIcon }) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

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
  <div className="jv-toolbar">
    <div className="jv-toolbar-filters">
      <span className="jv-date-range" aria-label="Période d'analyse">
        <input
          className="jv-date-input"
          onChange={(event) => onDateFromChange(event.target.value)}
          type="date"
          value={dateFrom}
        />
        <span aria-hidden="true">→</span>
        <input
          className="jv-date-input"
          onChange={(event) => onDateToChange(event.target.value)}
          type="date"
          value={dateTo}
        />
      </span>
      <div className="jv-filter-pills" role="group" aria-label="Périmètre">
        <button
          className={scope === "sales_ae" ? "active" : ""}
          onClick={() => onScopeChange("sales_ae")}
          type="button"
        >
          Toute l&apos;équipe
        </button>
        <button
          className={scope === "owner" ? "active" : ""}
          onClick={() => onScopeChange("owner")}
          type="button"
        >
          Par owner
        </button>
      </div>
      {scope === "owner" ? (
        <select
          aria-label="Propriétaire"
          className="jv-select"
          disabled={owners.length === 0}
          onChange={(event) => onOwnerChange(event.target.value)}
          value={ownerId}
        >
          {owners.map((owner) => (
            <option key={owner.ownerId} value={owner.ownerId}>
              {[owner.name, owner.teamName].filter(Boolean).join(" · ")}
            </option>
          ))}
        </select>
      ) : null}
    </div>
    <div className="jv-toolbar-actions">
      <button className="jv-btn-primary" disabled={isLoading} onClick={onRun} type="button">
        {isLoading ? (
          <RefreshCw aria-hidden="true" className="jv-spin" size={14} strokeWidth={1.5} />
        ) : (
          <Sparkles aria-hidden="true" size={14} strokeWidth={1.5} />
        )}
        Analyser
      </button>
    </div>
  </div>
);

export const RunProgress = ({
  analyzedCount,
  currentStep,
  failedCount,
  progress,
  reusedCount,
}: {
  analyzedCount: number;
  currentStep: string;
  failedCount: number;
  progress: number;
  reusedCount: number;
}) => (
  <section aria-live="polite" className="jv-run-progress">
    <div className="jv-run-progress-head">
      <span>{currentStep}</span>
      <strong>{progress}%</strong>
    </div>
    <span className="jv-run-progress-bar">
      <span style={{ width: `${progress}%` }} />
    </span>
    <small>
      {analyzedCount} analysé(s), {reusedCount} cache(s), {failedCount} erreur(s)
    </small>
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

const TREEMAP_COLORS = ["#d4714a", "#e8a088", "#f0c4b8", "#f5ddd6", "#faf0ec"];

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

      const rects = buildTreemapRects(visibleRows, 0, 0, width, height, true);
      rectsRef.current = rects;

      rects.forEach((rect, index) => {
        const isActive = rect.row.id === hoveredRowId;
        context.fillStyle = TREEMAP_COLORS[index] ?? "#faf0ec";
        context.fillRect(rect.x + 1, rect.y + 1, Math.max(0, rect.width - 2), Math.max(0, rect.height - 2));

        if (isActive) {
          context.strokeStyle = "#b95734";
          context.lineWidth = 2;
          context.strokeRect(rect.x + 3, rect.y + 3, Math.max(0, rect.width - 6), Math.max(0, rect.height - 6));
        }

        const textColor = index === 0 ? "#ffffff" : "#44403c";
        context.fillStyle = textColor;
        context.font = "500 12px DM Sans, ui-sans-serif, system-ui";
        context.textBaseline = "top";
        context.fillText(rect.row.label, rect.x + 14, rect.y + 14, Math.max(20, rect.width - 28));

        if (rect.width > 120 && rect.height > 62) {
          context.font = "500 11px DM Sans, ui-sans-serif, system-ui";
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
    <div className="jv-theme-block chart-block">
      <SectionLabel icon={MessageCircleWarning}>Pertes par raison (valeur)</SectionLabel>
      {visibleRows.length > 0 ? (
        <div className="jv-chart-wrap">
          <canvas
            aria-label="Répartition interactive des pertes par raison"
            onPointerLeave={() => {
              setHoveredRowId(null);
              setTooltip(null);
            }}
            onPointerMove={handlePointerMove}
            ref={canvasRef}
            role="img"
          />
          {tooltip ? (
            <div className="jv-chart-tooltip" role="status" style={{ left: tooltip.x, top: tooltip.y }}>
              <strong>{tooltip.row.label}</strong>
              <span>Valeur perdue : {formatAmount(tooltip.row.lostValue)}</span>
              <span>{tooltip.row.dealCount} deal(s)</span>
              <span>{tooltip.row.share}% de la valeur perdue</span>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="jv-theme-empty">Aucune raison analysée.</p>
      )}
    </div>
  );
};

export const ValueTrendChart = ({ points }: { points: TrendPoint[] }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const maxValue = useMemo(() => Math.max(...points.map((point) => point.cumulativeValue), 1), [points]);
  const activePoint = hoverIndex === null ? null : (points[hoverIndex] ?? null);

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
      const padding = { bottom: 28, left: 44, right: 22, top: 18 };
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

      context.strokeStyle = "rgba(28, 25, 23, 0.08)";
      context.lineWidth = 1;
      context.font = "500 10px DM Sans, ui-sans-serif, system-ui";
      context.fillStyle = "#a8a29e";

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

      const getX = (index: number) =>
        padding.left + (points.length <= 1 ? 0.5 : index / (points.length - 1)) * plotWidth;
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
      context.fillStyle = "rgba(212, 113, 74, 0.11)";
      context.fill();

      context.beginPath();
      coordinates.forEach((coordinate, index) => {
        if (index === 0) {
          context.moveTo(coordinate.x, coordinate.y);
          return;
        }

        context.lineTo(coordinate.x, coordinate.y);
      });
      context.strokeStyle = "#d4714a";
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = 2.5;
      context.stroke();

      coordinates.forEach((coordinate, index) => {
        const isActive = index === hoverIndex;
        context.beginPath();
        context.arc(coordinate.x, coordinate.y, isActive ? 6 : 4, 0, Math.PI * 2);
        context.fillStyle = "#d4714a";
        context.fill();

        context.fillStyle = "#a8a29e";
        context.font = "500 10px DM Sans, ui-sans-serif, system-ui";
        context.textAlign = index === 0 ? "left" : index === coordinates.length - 1 ? "right" : "center";
        context.fillText(points[index].label, coordinate.x, height - 6);
      });

      if (hoverIndex !== null && coordinates[hoverIndex]) {
        const coordinate = coordinates[hoverIndex];
        context.beginPath();
        context.moveTo(coordinate.x, padding.top);
        context.lineTo(coordinate.x, padding.top + plotHeight);
        context.strokeStyle = "rgba(212, 113, 74, 0.28)";
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
    <div className="jv-theme-block chart-block">
      <div className="jv-theme-block-head">
        <SectionLabel icon={TrendingUp}>Évolution valeur perdue</SectionLabel>
        <span>Cumulé</span>
      </div>
      {points.length > 0 ? (
        <div className="jv-chart-wrap">
          <canvas
            aria-label="Évolution interactive de la valeur perdue"
            onPointerLeave={() => setHoverIndex(null)}
            onPointerMove={handlePointerMove}
            ref={canvasRef}
            role="img"
          />
          {activePoint ? (
            <div className="jv-chart-tooltip floating" role="status">
              <strong>{activePoint.label}</strong>
              <span>Perdu sur le mois : {formatAmount(activePoint.value)}</span>
              <span>Cumul : {formatAmount(activePoint.cumulativeValue)}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="jv-theme-empty">Pas assez de dates de clôture pour tracer une tendance.</p>
      )}
    </div>
  );
};

export const TopFactors = ({ overview }: { overview: CloseLostOverviewResult | null }) => {
  const factors =
    overview?.portfolio?.topFactors.map((factor) => ({
      title: factor.title,
      impact: severityLabels[factor.impact],
      dealShare: factor.dealShare,
      rationale: factor.rationale,
    })) ??
    overview?.lossReasons.map((row) => ({
      title: row.label,
      impact: row.share >= 30 ? "Élevé" : row.share >= 15 ? "Moyen" : "Faible",
      dealShare: row.share,
      rationale: `${row.dealCount} deal(s), ${formatAmount(row.lostValue)} de valeur perdue.`,
    })) ??
    [];

  return (
    <div className="jv-theme-block">
      <SectionLabel icon={AlertTriangle}>Patterns de perte</SectionLabel>
      {factors.length > 0 ? (
        <div className="jv-factor-list">
          {factors.map((factor) => (
            <div className="jv-factor-item" key={factor.title}>
              <div className="jv-factor-item-head">
                <strong>{factor.title}</strong>
                <em>{factor.dealShare}%</em>
              </div>
              <div className="jv-factor-bar">
                <span style={{ width: `${Math.max(8, factor.dealShare)}%` }} />
              </div>
              <small>
                {factor.impact} · {factor.rationale}
              </small>
            </div>
          ))}
        </div>
      ) : (
        <p className="jv-theme-empty">Aucun pattern détecté. Lancez une analyse globale.</p>
      )}
    </div>
  );
};

export const Recommendations = ({ overview }: { overview: CloseLostOverviewResult | null }) => {
  const keyInsight = getKeyInsight(overview);
  const insightShare = overview?.lossReasons[0]?.share ?? null;
  const recommendations = overview?.recommendations ?? [];

  return (
    <div className="jv-theme-block">
      <SectionLabel icon={Lightbulb}>Recommandations</SectionLabel>

      <div className="jv-theme-insight">
        <div className="jv-theme-insight-head">
          <span className="jv-theme-insight-label">
            <Sparkles aria-hidden="true" size={11} strokeWidth={1.5} />
            Insight clé
          </span>
          {insightShare !== null ? <em>{insightShare}%</em> : null}
        </div>
        <p className="jv-prose">{keyInsight.title}</p>
        <small>{keyInsight.detail}</small>
      </div>

      {recommendations.length > 0 ? (
        <div className="jv-recommendation-list">
          {recommendations.map((recommendation) => (
            <div className="jv-recommendation-item" key={recommendation.title}>
              <div className="jv-recommendation-item-head">
                <strong>{recommendation.title}</strong>
                <span>{severityLabels[recommendation.priority]}</span>
              </div>
              <small>{recommendation.rationale}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="jv-theme-empty">Lancez une analyse globale pour générer des recommandations actionnables.</p>
      )}
    </div>
  );
};

export const CompactBreakdown = ({ rows, title }: { rows: CloseLostBreakdownRow[]; title: string }) => (
  <div className="jv-theme-block">
    <SectionLabel icon={History}>{title}</SectionLabel>
    {rows.length > 0 ? (
      <div className="jv-compact-breakdown">
        {rows.map((row) => (
          <div className="jv-compact-row" key={row.id}>
            <strong>{row.label}</strong>
            <span>{row.dealCount} deals</span>
            <em>{row.share}%</em>
            <div className="jv-compact-row-bar">
              <span style={{ width: `${Math.max(6, row.share)}%` }} />
            </div>
          </div>
        ))}
      </div>
    ) : (
      <p className="jv-theme-empty">Aucune donnée sur cette période.</p>
    )}
  </div>
);

const DealMeta = ({ deal }: { deal: CloseLostDealListItem }) => (
  <span className="jv-item-meta">
    <span>{deal.stage}</span>
    <span>{deal.primaryLossReason ?? "Non analysé"}</span>
    <span className={getAnalysisStatusClass(deal.analysisStatus)}>
      {analysisStatusLabels[deal.analysisStatus]}
    </span>
  </span>
);

export const DealList = ({
  activeDealId,
  deals,
  isLoading,
  onDealSelect,
}: {
  activeDealId: string | null;
  deals: CloseLostDealListItem[];
  isLoading: boolean;
  onDealSelect: (hubspotDealId: string) => void;
}) => (
  <section aria-busy={isLoading} aria-label="Deals perdus" className="jv-list-shell">
    <header className="jv-list-head">
      <SectionLabel icon={History}>Pertes significatives</SectionLabel>
      <span className="jv-list-count">
        {deals.length} résultat{deals.length > 1 ? "s" : ""}
      </span>
    </header>
    <div className="jv-list-body">
      {isLoading && deals.length === 0 ? <p className="jv-list-empty">Chargement des deals…</p> : null}
      {!isLoading && deals.length === 0 ? (
        <p className="jv-list-empty">Aucun deal perdu sur cette période.</p>
      ) : null}
      {deals.map((deal) => (
        <button
          className={activeDealId === deal.hubspotDealId ? "jv-list-item selected" : "jv-list-item"}
          key={deal.hubspotDealId}
          onClick={() => onDealSelect(deal.hubspotDealId)}
          type="button"
        >
          <span className="jv-list-main">
            <strong>{deal.companyName}</strong>
            <small>{deal.dealName ?? deal.contactName ?? deal.hubspotDealId}</small>
            <DealMeta deal={deal} />
          </span>
          <span className="jv-list-side">
            <time>{deal.closedAt ? formatDate(deal.closedAt) : "Sans date"}</time>
            <em>{formatAmount(deal.amount)}</em>
            <ChevronRight aria-hidden="true" size={14} strokeWidth={1.5} />
          </span>
        </button>
      ))}
    </div>
  </section>
);

const DetailSection = ({ children, icon, label }: { children: React.ReactNode; icon: LucideIcon; label: string }) => (
  <section className="jv-detail-section">
    <SectionLabel icon={icon}>{label}</SectionLabel>
    {children}
  </section>
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
}) => {
  if (!detail && !isLoading) {
    return (
      <aside className="jv-detail jv-detail-expanded">
        <div className="jv-detail-empty">
          <CircleX aria-hidden="true" size={20} strokeWidth={1.25} />
          <strong>Sélectionnez un deal</strong>
          <p>Analyse IA des causes de perte, signaux de risque et playbook de réactivation.</p>
        </div>
      </aside>
    );
  }

  const subtitle = detail
    ? [
        detail.deal.dealName,
        getDetailOwnerDisplayName(detail, ownersById),
        detail.deal.closedAt ? formatDate(detail.deal.closedAt) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <aside aria-busy={isLoading} className="jv-detail jv-detail-expanded">
      <header className="jv-detail-head">
        <div>
          <h2>{detail?.deal.companyName ?? "Chargement…"}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <button
          className="jv-btn-ghost"
          disabled={!detail || isAnalyzing || Boolean(detail?.analysis)}
          onClick={onAnalyze}
          type="button"
        >
          {isAnalyzing ? (
            <RefreshCw aria-hidden="true" className="jv-spin" size={14} strokeWidth={1.5} />
          ) : (
            <Sparkles aria-hidden="true" size={14} strokeWidth={1.5} />
          )}
          {isAnalyzing ? "Analyse…" : detail?.analysis ? "Analysé" : "Analyser"}
        </button>
      </header>

      {isLoading ? <p className="jv-detail-loading">Chargement du deal…</p> : null}
      {error ? <p className="jv-banner jv-banner-error">{error}</p> : null}

      {detail ? (
        <>
          <dl className="jv-detail-facts">
            <div>
              <dt>Valeur perdue</dt>
              <dd>{formatAmount(detail.deal.amount)}</dd>
            </div>
            <div>
              <dt>Étape</dt>
              <dd>{detail.deal.stage}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{getDetailOwnerDisplayName(detail, ownersById)}</dd>
            </div>
            <div>
              <dt>Dernière analyse</dt>
              <dd>{detail.generatedAt ? formatDateTime(detail.generatedAt) : "Non analysée"}</dd>
            </div>
          </dl>

          {detail.analysis ? (
            <>
              <DetailSection icon={AlignLeft} label="Résumé perte IA">
                <p className="jv-prose">{detail.analysis.summary}</p>
                <ul className="jv-bullet-list">
                  <li>
                    Raison principale : {detail.analysis.primaryLossReason}
                  </li>
                  <li>
                    Raison secondaire : {detail.analysis.secondaryLossReason ?? "Non identifiée"}
                  </li>
                  <li>Concurrent gagnant : {detail.analysis.competitorName ?? "Non identifié"}</li>
                  <li>
                    Score de réactivation :{" "}
                    <span className="jv-meta-score">{detail.analysis.reactivationScore}/100</span>
                  </li>
                </ul>
              </DetailSection>

              <DetailSection icon={AlertTriangle} label="Signaux avant perte">
                <ul className="jv-risk-list">
                  {detail.analysis.riskSignals.map((signal) => (
                    <li className={signal.severity} key={signal.title}>
                      <AlertTriangle aria-hidden="true" size={13} strokeWidth={1.5} />
                      <span className="jv-risk-detail">
                        <strong>{signal.title}</strong>
                        <span>{severityLabels[signal.severity]}</span>
                        <small>{signal.detail}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              </DetailSection>

              <DetailSection icon={TrendingUp} label="Santé avant perte">
                {detail.analysis.healthBeforeLoss.map((dimension) => (
                  <div className="jv-health-item" key={dimension.label}>
                    <div className="jv-health-item-head">
                      <strong>{dimension.label}</strong>
                    </div>
                    <div className="jv-health-bar">
                      <span style={{ width: `${dimension.score}%` }} />
                    </div>
                    <span>{dimension.detail}</span>
                  </div>
                ))}
              </DetailSection>

              <DetailSection icon={ListChecks} label="Playbook de réactivation">
                {detail.analysis.playbook.map((action) => (
                  <div className="jv-action-item" key={action.title}>
                    <div className="jv-action-item-head">
                      <strong>{action.title}</strong>
                      <span>{action.timing}</span>
                    </div>
                    <small>{action.rationale}</small>
                  </div>
                ))}
              </DetailSection>
            </>
          ) : (
            <div className="jv-callout">
              <Sparkles aria-hidden="true" size={16} strokeWidth={1.5} />
              <div>
                <p>Ce deal n&apos;a pas encore été analysé.</p>
                <small>Lancez l&apos;analyse IA pour générer le deep dive et le playbook de réactivation.</small>
              </div>
            </div>
          )}
        </>
      ) : null}
    </aside>
  );
};