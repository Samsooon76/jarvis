import { AlertTriangle, type LucideIcon } from "lucide-react";
import type {
  DealAnalysisAction,
  DealAnalysisHealthDimension,
  DealAnalysisTrendPoint,
} from "../../../services/api";
import {
  formatOptionalDate,
  levelLabels,
  priorityLabels,
} from "../../../utils/dashboard/dealAnalysis";

export const ActionRows = ({ actions }: { actions: DealAnalysisAction[] }) =>
  actions.length > 0 ? (
    <ul className="jv-action-list">
      {actions.map((action) => (
        <li key={`${action.title}:${action.dueAt}`}>
          <strong>{action.title}</strong>
          <small>
            {formatOptionalDate(action.dueAt)} · {priorityLabels[action.priority]}
          </small>
        </li>
      ))}
    </ul>
  ) : (
    <p className="jv-theme-empty">Aucune action prioritaire.</p>
  );

export const InsightRows = ({
  items,
  tone,
  icon: Icon = AlertTriangle,
}: {
  items: string[];
  tone: "green" | "red";
  icon?: LucideIcon;
}) =>
  items.length > 0 ? (
    tone === "red" ? (
      <ul className="jv-risk-list">
        {items.map((item) => (
          <li key={item}>
            <Icon aria-hidden="true" size={12} strokeWidth={1.5} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    ) : (
      <ul className="jv-bullet-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    )
  ) : (
    <p className="jv-theme-empty">Aucun signal disponible.</p>
  );

export const HealthDimension = ({ dimension }: { dimension: DealAnalysisHealthDimension }) => (
  <div className="jv-health-dimension">
    <span>{dimension.label}</span>
    <strong className={dimension.tone}>{levelLabels[dimension.level]}</strong>
    <div className={`jv-health-track ${dimension.tone}`}>
      <i style={{ width: `${dimension.score}%` }} />
    </div>
    <small>{dimension.rationale}</small>
  </div>
);

const buildTrendPath = (points: DealAnalysisTrendPoint[], width: number, height: number): string => {
  if (points.length === 0) {
    return "";
  }

  const padding = { bottom: 32, left: 38, right: 18, top: 14 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  return points
    .map((point, index) => {
      const x = padding.left + (innerWidth * index) / Math.max(1, points.length - 1);
      const y = padding.top + innerHeight - (innerHeight * point.probability) / 100;

      return `${index === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");
};

export const TrendChart = ({ points }: { points: DealAnalysisTrendPoint[] }) => {
  const width = 560;
  const height = 220;
  const padding = { bottom: 32, left: 38, right: 18, top: 14 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const linePath = buildTrendPath(points, width, height);
  const lastPoint = points[points.length - 1] ?? null;
  const firstCoordinate = points.length > 0 ? `${padding.left},${height - padding.bottom}` : "";
  const lastX = padding.left + innerWidth;
  const areaPath = linePath ? `${linePath} L${lastX},${height - padding.bottom} L${firstCoordinate} Z` : "";

  return (
    <div className="jv-deal-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Évolution de la probabilité">
        {[0, 25, 50, 75, 100].map((value) => {
          const y = padding.top + innerHeight - (innerHeight * value) / 100;

          return (
            <g key={value}>
              <line className="jv-deal-chart-guide" x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
              <text className="jv-deal-chart-label" x={0} y={y + 4}>
                {value} %
              </text>
            </g>
          );
        })}
        <path className="jv-deal-chart-area" d={areaPath} />
        <path className="jv-deal-chart-line" d={linePath} />
        {points.map((point, index) => {
          const x = padding.left + (innerWidth * index) / Math.max(1, points.length - 1);
          const y = padding.top + innerHeight - (innerHeight * point.probability) / 100;

          return (
            <g key={`${point.date}:${point.probability}`}>
              <circle className="jv-deal-chart-point" cx={x} cy={y} r={4} />
              {index % 2 === 0 || index === points.length - 1 ? (
                <text className="jv-deal-chart-date" x={x} y={height - 8}>
                  {point.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {lastPoint ? (
          <g>
            <rect className="jv-deal-chart-badge" x={width - 68} y={height / 2 - 18} width={50} height={28} rx={6} />
            <text className="jv-deal-chart-badge-text" x={width - 43} y={height / 2 + 1}>
              {lastPoint.probability} %
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
};