import { useState } from "react";
import type { ForecastChartViewModel } from "../types";

type ForecastChartProps = {
  chart: ForecastChartViewModel;
  formatAmount: (amount: number) => string;
};

const getDeltaClassName = (amount: number): string => {
  if (amount > 0) {
    return "positive";
  }

  if (amount < 0) {
    return "negative";
  }

  return "flat";
};

const formatSignedAmount = (amount: number, formatAmount: (amount: number) => string): string =>
  amount > 0 ? `+${formatAmount(amount)}` : formatAmount(amount);

const getTooltipX = (x: number, chartWidth: number): number => Math.min(Math.max(x, 88), chartWidth - 88);

export const ForecastChart = ({ chart, formatAmount }: ForecastChartProps) => {
  const [activeMonthId, setActiveMonthId] = useState<string | null>(null);

  return (
    <div className="ae-forecast-chart">
      {chart.hasData ? (
        <>
        <div className="ae-forecast-series" aria-label="Legende forecast fermeture">
          <span>
            <i className="ae-forecast-swatch previous" />
            {chart.previousYear}
          </span>
          <span>
            <i className="ae-forecast-swatch current" />
            {chart.currentYear}
          </span>
        </div>
        <svg
          aria-label={`Forecast de fermeture par mois ${chart.currentYear} versus ${chart.previousYear}`}
          role="img"
          viewBox={`0 0 ${chart.width} ${chart.height}`}
        >
          <line
            className="ae-chart-guide"
            x1={chart.padding.left}
            x2={chart.padding.left + chart.innerWidth}
            y1={chart.padding.top}
            y2={chart.padding.top}
          />
          <line
            className="ae-chart-guide"
            x1={chart.padding.left}
            x2={chart.padding.left + chart.innerWidth}
            y1={(chart.padding.top + chart.baseline) / 2}
            y2={(chart.padding.top + chart.baseline) / 2}
          />
          <line
            className="ae-chart-axis"
            x1={chart.padding.left}
            x2={chart.padding.left + chart.innerWidth}
            y1={chart.baseline}
            y2={chart.baseline}
          />
          {chart.points.map((point) => (
            <line
              className="ae-chart-guide"
              key={`${point.id}-guide`}
              x1={point.x}
              x2={point.x}
              y1={chart.padding.top}
              y2={chart.baseline}
            />
          ))}
          {chart.points.map((point) => (
            <g
              aria-label={`${point.label}: ${chart.currentYear} ${formatAmount(point.currentAmount)}, ${chart.previousYear} ${formatAmount(
                point.previousAmount,
              )}, ecart ${formatSignedAmount(point.deltaAmount, formatAmount)}`}
              className={`ae-forecast-month ${getDeltaClassName(point.deltaAmount)} ${
                activeMonthId === point.id ? "active" : ""
              }`}
              key={point.id}
              onBlur={() => setActiveMonthId(null)}
              onClick={() => setActiveMonthId(point.id)}
              onFocus={() => setActiveMonthId(point.id)}
              onMouseEnter={() => setActiveMonthId(point.id)}
              onMouseLeave={() => setActiveMonthId(null)}
              onPointerEnter={() => setActiveMonthId(point.id)}
              onPointerLeave={() => setActiveMonthId(null)}
              role="listitem"
              tabIndex={0}
            >
              <rect
                className="ae-forecast-hitbox"
                height={chart.baseline - chart.padding.top + 48}
                width={chart.innerWidth / chart.points.length}
                x={point.x - chart.innerWidth / chart.points.length / 2}
                y={chart.padding.top}
              />
              <rect
                className="ae-forecast-selected-band"
                height={chart.baseline - chart.padding.top + 48}
                rx="10"
                width={chart.innerWidth / chart.points.length - 8}
                x={point.x - (chart.innerWidth / chart.points.length - 8) / 2}
                y={chart.padding.top}
              />
              <rect
                className="ae-forecast-bar previous"
                height={point.previousBar.height}
                rx="4"
                width={point.previousBar.width}
                x={point.previousBar.x}
                y={point.previousBar.y}
              >
                <title>
                  {point.label} {chart.previousYear}: {formatAmount(point.previousAmount)} · {point.previousCount} deal(s)
                </title>
              </rect>
              <rect
                className="ae-forecast-bar current"
                height={point.currentBar.height}
                rx="4"
                width={point.currentBar.width}
                x={point.currentBar.x}
                y={point.currentBar.y}
              >
                <title>
                  {point.label} {chart.currentYear}: {formatAmount(point.currentAmount)} · {point.currentCount} deal(s)
                </title>
              </rect>
              <rect
                className="ae-forecast-label-marker"
                height="24"
                rx="12"
                width="54"
                x={point.x - 27}
                y={chart.baseline + 14}
              />
              <text className="ae-chart-label" textAnchor="middle" x={point.x} y={chart.baseline + 30}>
                {point.shortLabel}
              </text>
              <g className="ae-forecast-tooltip" transform={`translate(${getTooltipX(point.x, chart.width)} 12)`}>
                <rect height="64" rx="8" width="176" x="-88" y="0" />
                <text className="ae-forecast-tooltip-title" textAnchor="middle" x="0" y="18">
                  {point.label}
                </text>
                <text className="ae-forecast-tooltip-line" textAnchor="middle" x="0" y="37">
                  {chart.currentYear}: {formatAmount(point.currentAmount)} · {chart.previousYear}:{" "}
                  {formatAmount(point.previousAmount)}
                </text>
                <text className="ae-forecast-tooltip-delta" textAnchor="middle" x="0" y="55">
                  {formatSignedAmount(point.deltaAmount, formatAmount)}
                </text>
              </g>
            </g>
          ))}
        </svg>
        <div className="ae-forecast-table" role="table" aria-label="Detail mensuel du forecast de fermeture">
          <div className="ae-forecast-table-row header" role="row">
            <span role="columnheader">Mois</span>
            <span role="columnheader">{chart.currentYear}</span>
            <span role="columnheader">{chart.previousYear}</span>
            <span role="columnheader">Ecart</span>
          </div>
          {chart.months.map((month) => (
            <button
              className={`ae-forecast-table-row ${activeMonthId === month.id ? "active" : ""}`}
              key={month.id}
              onBlur={() => setActiveMonthId(null)}
              onClick={() => setActiveMonthId(month.id)}
              onFocus={() => setActiveMonthId(month.id)}
              onMouseEnter={() => setActiveMonthId(month.id)}
              onMouseLeave={() => setActiveMonthId(null)}
              type="button"
            >
              <strong>{month.shortLabel}</strong>
              <span>{formatAmount(month.currentAmount)}</span>
              <span>{formatAmount(month.previousAmount)}</span>
              <em className={`ae-forecast-delta ${getDeltaClassName(month.deltaAmount)}`}>
                {formatSignedAmount(month.deltaAmount, formatAmount)}
              </em>
            </button>
          ))}
        </div>
        </>
      ) : (
        <p className="ae-empty">Aucune date de fermeture exploitable pour tracer le forecast.</p>
      )}
    </div>
  );
};
