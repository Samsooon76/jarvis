import { useEffect, useRef } from "react";
import Chart from "chart.js/auto";
import type { ChartConfiguration, TooltipItem } from "chart.js";
import { formatAmount } from "../../../utils/dashboard/formatters";
import type { ForecastPoint } from "../../../utils/dashboard/forecast";

export const ProjectionChart = ({
  points,
  objectiveLabel,
}: {
  points: ForecastPoint[];
  objectiveLabel: string;
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current) {
      return undefined;
    }

    const configuration: ChartConfiguration<"line", Array<number | null>, string> = {
      type: "line",
      data: {
        labels: points.map((point) => point.label),
        datasets: [
          {
            label: "Commit",
            data: points.map((point) => point.commit),
            borderColor: "#73bf69",
            backgroundColor: "rgba(115, 191, 105, 0.12)",
            borderWidth: 2,
            pointBackgroundColor: "#73bf69",
            pointBorderColor: "#ffffff",
            pointBorderWidth: 2,
            pointHoverRadius: 6,
            pointRadius: 4,
            tension: 0.28,
          },
          {
            label: "Atterrissage",
            data: points.map((point) => point.forecast),
            borderColor: "#007a59",
            backgroundColor: "rgba(0, 128, 96, 0.12)",
            borderWidth: 3,
            pointBackgroundColor: "#007a59",
            pointBorderColor: "#ffffff",
            pointBorderWidth: 2,
            pointHoverRadius: 7,
            pointRadius: 5,
            tension: 0.28,
          },
          {
            label: "Objectif",
            data: points.map((point) => point.objective),
            borderColor: "#94a3b8",
            borderDash: [7, 6],
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 0,
            tension: 0,
          },
        ],
      },
      options: {
        animation: false,
        interaction: {
          intersect: false,
          mode: "index",
        },
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            backgroundColor: "#07111f",
            bodyColor: "#dbeafe",
            borderColor: "rgba(255, 255, 255, 0.08)",
            borderWidth: 1,
            callbacks: {
              label: (context: TooltipItem<"line">) => {
                const value = context.parsed.y ?? 0;

                return `${context.dataset.label ?? ""} ${formatAmount(value)}`;
              },
              afterBody: (items) => {
                const point = points[items[0]?.dataIndex ?? -1];

                return point ? [`Pipeline ${formatAmount(point.pipeline)}`, `${point.dealCount} deal(s) | confiance ${point.confidenceScore}%`] : [];
              },
            },
            displayColors: true,
            padding: 11,
            titleColor: "#ffffff",
          },
        },
        responsive: true,
        scales: {
          x: {
            border: {
              display: false,
            },
            grid: {
              display: false,
            },
            ticks: {
              color: "#334155",
              font: {
                size: 12,
                weight: 560,
              },
              maxRotation: 0,
              minRotation: 0,
            },
          },
          y: {
            beginAtZero: true,
            border: {
              display: false,
            },
            grid: {
              color: "rgba(15, 23, 42, 0.08)",
            },
            ticks: {
              callback: (value) => formatAmount(Number(value)),
              color: "#64748b",
              font: {
                size: 11,
                weight: 560,
              },
              maxTicksLimit: 5,
            },
          },
        },
      },
    };

    const chart = new Chart(canvasRef.current, configuration);

    return () => {
      chart.destroy();
    };
  }, [points]);

  return (
    <div className="ae-forecast-chart-card">
      <div className="ae-forecast-chart-legend" aria-label="Legende">
        <span><i className="commit" /> Commit</span>
        <span><i className="forecast" /> Atterrissage</span>
        <span><i className="objective" /> Objectif</span>
      </div>
      <div
        className="ae-forecast-canvas-stage"
        role="img"
        aria-label={`Projection d'atterrissage. Objectif ${objectiveLabel}.`}
      >
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
};
