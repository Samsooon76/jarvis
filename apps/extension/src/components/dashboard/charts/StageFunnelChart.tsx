import type { StageChartViewModel } from "../types";
import { formatAmount } from "../../../utils/dashboard/formatters";

type StageFunnelChartProps = {
  chart: StageChartViewModel;
  onStageSelect: (stageId: string) => void;
  selectedStageId: string | null;
};

export const StageFunnelChart = ({ chart, onStageSelect, selectedStageId }: StageFunnelChartProps) => (
  <div className="ae-stage-funnel">
    {chart.points.length > 0 ? (
      <>
        <div className="ae-stage-header-grid" style={{ gridTemplateColumns: `repeat(${chart.points.length}, minmax(0, 1fr))` }}>
          {chart.points.map((point) => (
            <button
              className={`ae-stage-column-head ${selectedStageId === point.id ? "selected" : ""}`}
              key={point.id}
              onClick={() => onStageSelect(point.id)}
              type="button"
            >
              <span>
                <i aria-hidden="true" style={{ background: point.color }} />
                {point.label}
              </span>
              <strong>{point.count}</strong>
              <small>{formatAmount(point.amount)}</small>
            </button>
          ))}
        </div>
        <svg aria-label="Funnel de repartition par stage" role="img" viewBox={`0 0 ${chart.width} ${chart.height}`}>
          <defs>
            <clipPath id="stageBandClip">
              <path d={chart.bandPath} />
            </clipPath>
          </defs>
          {chart.points.map((point, index) => (
            <g key={`${point.id}-column`}>
              <rect
                className={`ae-stage-column-bg ${index % 2 === 1 ? "muted" : ""}`}
                height={chart.height}
                width={chart.columnWidth}
                x={chart.padding.left + index * chart.columnWidth}
                y="0"
              />
              <rect
                className="ae-stage-band-segment"
                clipPath="url(#stageBandClip)"
                height={chart.height}
                style={{ fill: point.color }}
                width={chart.columnWidth}
                x={chart.padding.left + index * chart.columnWidth}
                y="0"
              />
              <line
                className="ae-stage-divider"
                x1={chart.padding.left + index * chart.columnWidth}
                x2={chart.padding.left + index * chart.columnWidth}
                y1="0"
                y2={chart.height}
              />
              <rect
                aria-label={`${point.label}: ${point.count} deal(s)`}
                className="ae-stage-click-target"
                height={chart.height}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onStageSelect(point.id);
                  }
                }}
                onClick={() => onStageSelect(point.id)}
                role="button"
                tabIndex={0}
                width={chart.columnWidth}
                x={chart.padding.left + index * chart.columnWidth}
                y="0"
              />
            </g>
          ))}
          <path className="ae-stage-band-outline" d={chart.bandPath} />
          {chart.points.map((point) => (
            <g key={point.id}>
              <rect
                className="ae-stage-rate-pill"
                height="20"
                rx="10"
                width="50"
                x={point.x - 25}
                y={chart.bandCenterY - 11}
              />
              <text className="ae-stage-rate" textAnchor="middle" x={point.x} y={chart.bandCenterY + 4}>
                {point.share.toFixed(1)}%
              </text>
            </g>
          ))}
        </svg>
      </>
    ) : (
      <p className="ae-empty">Aucun stage HubSpot exploitable pour le moment.</p>
    )}
  </div>
);
