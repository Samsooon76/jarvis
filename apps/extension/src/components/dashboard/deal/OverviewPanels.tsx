import type {
  DealAnalysisAction,
  DealAnalysisHealthDimension,
  DealAnalysisMetric,
  DealAnalysisTrendPoint,
} from "../../../services/api";
import {
  formatMetricCaption,
  formatMetricValue,
  formatOptionalDate,
  levelLabels,
  metricIcons,
  priorityLabels,
} from "../../../utils/dashboard/dealAnalysis";
import { MetricIcon } from "../MetricIcon";

export const ActionRows = ({ actions }: { actions: DealAnalysisAction[] }) =>
  actions.length > 0 ? (
    <div className="ae-deal-action-list">
      {actions.map((action) => (
        <div className="ae-deal-action-row" key={`${action.title}:${action.dueAt}`}>
          <span>{action.title}</span>
          <small>
            {formatOptionalDate(action.dueAt)} · {priorityLabels[action.priority]}
          </small>
        </div>
      ))}
    </div>
  ) : (
    <p className="ae-empty compact">Aucune action prioritaire.</p>
  );

export const InsightRows = ({ items, tone }: { items: string[]; tone: "green" | "red" }) =>
  items.length > 0 ? (
    <div className={`ae-deal-insight-list ${tone}`}>
      {items.map((item) => (
        <div className="ae-deal-insight-row" key={item}>
          <span aria-hidden="true" />
          <p>{item}</p>
        </div>
      ))}
    </div>
  ) : (
    <p className="ae-empty compact">Aucun signal disponible.</p>
  );

export const MetricCard = ({ metric }: { metric: DealAnalysisMetric }) => (
  <article className="ae-deal-metric-card">
    <MetricIcon name={metricIcons[metric.id]} />
    <div>
      <span>{metric.label}</span>
      <strong>{formatMetricValue(metric)}</strong>
      <small>{formatMetricCaption(metric)}</small>
    </div>
  </article>
);

export const HealthDimension = ({ dimension }: { dimension: DealAnalysisHealthDimension }) => (
  <div className="ae-health-dimension">
    <span>{dimension.label}</span>
    <strong className={dimension.tone}>{levelLabels[dimension.level]}</strong>
    <div className={`ae-health-track ${dimension.tone}`}>
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
    <div className="ae-deal-chart">
      <div className="ae-deal-panel-heading">
        <h3>Evolution du deal</h3>
        <span className="ae-deal-chart-legend">Probabilite de gain</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Evolution de la probabilite">
        {[0, 25, 50, 75, 100].map((value) => {
          const y = padding.top + innerHeight - (innerHeight * value) / 100;

          return (
            <g key={value}>
              <line className="ae-deal-chart-guide" x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
              <text className="ae-deal-chart-label" x={0} y={y + 4}>
                {value} %
              </text>
            </g>
          );
        })}
        <path className="ae-deal-chart-area" d={areaPath} />
        <path className="ae-deal-chart-line" d={linePath} />
        {points.map((point, index) => {
          const x = padding.left + (innerWidth * index) / Math.max(1, points.length - 1);
          const y = padding.top + innerHeight - (innerHeight * point.probability) / 100;

          return (
            <g key={`${point.date}:${point.probability}`}>
              <circle className="ae-deal-chart-point" cx={x} cy={y} r={4} />
              {index % 2 === 0 || index === points.length - 1 ? (
                <text className="ae-deal-chart-date" x={x} y={height - 8}>
                  {point.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {lastPoint ? (
          <g>
            <rect className="ae-deal-chart-badge" x={width - 68} y={height / 2 - 18} width={50} height={28} rx={6} />
            <text className="ae-deal-chart-badge-text" x={width - 43} y={height / 2 + 1}>
              {lastPoint.probability} %
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
};
