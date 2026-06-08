import { useEffect, useRef, useState } from "react";
import Chart from "chart.js/auto";
import type { ChartConfiguration, TooltipItem } from "chart.js";
import { fetchDealProbabilityTimeline, type DealProbabilityTimeline } from "../../services/api";
import { formatDate } from "../../utils/dashboard/formatters";

type DealProbabilityHistoryPanelProps = {
  orgId: string;
  hubspotDealId: string | null;
};

const HistoryChart = ({ timeline }: { timeline: DealProbabilityTimeline }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current) {
      return undefined;
    }

    const points = timeline.points;
    const configuration: ChartConfiguration<"line", number[], string> = {
      type: "line",
      data: {
        labels: points.map((point) => formatDate(point.date)),
        datasets: [
          {
            label: "Probabilite de closing",
            data: points.map((point) => point.probability),
            borderColor: "#007a59",
            backgroundColor: "rgba(0, 128, 96, 0.12)",
            borderWidth: 3,
            fill: true,
            pointBackgroundColor: "#007a59",
            pointBorderColor: "#ffffff",
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            stepped: true,
          },
        ],
      },
      options: {
        animation: false,
        interaction: { intersect: false, mode: "index" },
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#07111f",
            bodyColor: "#dbeafe",
            borderWidth: 1,
            callbacks: {
              label: (context: TooltipItem<"line">) => `${context.parsed.y ?? 0}%`,
              afterBody: (items) => {
                const point = points[items[0]?.dataIndex ?? -1];

                return point && point.daysSinceCreation !== null ? [`J+${point.daysSinceCreation} apres creation`] : [];
              },
            },
            padding: 11,
            titleColor: "#ffffff",
          },
        },
        responsive: true,
        scales: {
          x: {
            border: { display: false },
            grid: { display: false },
            ticks: { color: "#334155", font: { size: 12 }, maxRotation: 0, minRotation: 0, maxTicksLimit: 8 },
          },
          y: {
            beginAtZero: true,
            max: 100,
            border: { display: false },
            grid: { color: "rgba(15, 23, 42, 0.08)" },
            ticks: { callback: (value) => `${value}%`, color: "#64748b", font: { size: 11 }, maxTicksLimit: 6 },
          },
        },
      },
    };

    const chart = new Chart(canvasRef.current, configuration);

    return () => {
      chart.destroy();
    };
  }, [timeline]);

  return (
    <div className="ae-forecast-canvas-stage" role="img" aria-label="Evolution de la probabilite de closing du deal">
      <canvas ref={canvasRef} />
    </div>
  );
};

export const DealProbabilityHistoryPanel = ({ orgId, hubspotDealId }: DealProbabilityHistoryPanelProps) => {
  const [timeline, setTimeline] = useState<DealProbabilityTimeline | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hubspotDealId) {
      setTimeline(null);
      return undefined;
    }

    const abortController = new AbortController();

    const load = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await fetchDealProbabilityTimeline(orgId, hubspotDealId, { signal: abortController.signal });

        if (!abortController.signal.aborted) {
          setTimeline(result);
        }
      } catch (loadError) {
        if (!abortController.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "Erreur inconnue pendant le chargement de l'historique.");
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      abortController.abort();
    };
  }, [hubspotDealId, orgId]);

  const hasPoints = (timeline?.points.length ?? 0) > 0;

  return (
    <article className="ae-deal-panel ae-chart-panel">
      <div className="ae-deal-panel-heading">
        <h3>Historique probabilite (CRM)</h3>
        <span className="ae-deal-chart-legend">
          {timeline?.ageDays !== null && timeline?.ageDays !== undefined ? `Deal cree il y a ${timeline.ageDays} j` : "probabilite_de__closing"}
        </span>
      </div>
      {error ? <p className="ae-admin-feedback error">{error}</p> : null}
      {hasPoints && timeline ? (
        <HistoryChart timeline={timeline} />
      ) : (
        <p className="ae-empty">
          {isLoading
            ? "Chargement de l'historique..."
            : "Aucun historique de probabilite pour ce deal. Lance l'import HubSpot depuis Statistiques."}
        </p>
      )}
    </article>
  );
};
