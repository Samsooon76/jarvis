import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";
import type { ChartConfiguration, TooltipItem } from "chart.js";
import {
  backfillProbabilityHistory,
  fetchProbabilityTimeline,
  type AggregatedProbabilityTimeline,
  type ForecastScope,
  type HubSpotOwnerOption,
} from "../../services/api";
import { formatDate } from "../../utils/dashboard/formatters";

type ProbabilityTimelinePanelProps = {
  orgId: string;
  owners: HubSpotOwnerOption[];
  selectedOwnerId?: string;
  /** Managers/admins peuvent basculer entre l'equipe et un sales precis. */
  canViewTeamForecast?: boolean;
};

const ProbabilityChart = ({ timeline }: { timeline: AggregatedProbabilityTimeline }) => {
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
            label: "Probabilite moyenne",
            data: points.map((point) => point.averageProbability),
            borderColor: "#007a59",
            backgroundColor: "rgba(0, 128, 96, 0.12)",
            borderWidth: 3,
            fill: true,
            pointBackgroundColor: "#007a59",
            pointBorderColor: "#ffffff",
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.28,
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
            borderColor: "rgba(255, 255, 255, 0.08)",
            borderWidth: 1,
            callbacks: {
              label: (context: TooltipItem<"line">) => `Proba moyenne ${context.parsed.y ?? 0}%`,
              afterBody: (items) => {
                const point = points[items[0]?.dataIndex ?? -1];

                return point ? [`${point.dealCount} deal(s) actif(s)`] : [];
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
            ticks: { color: "#334155", font: { size: 12, weight: 560 }, maxRotation: 0, minRotation: 0, maxTicksLimit: 8 },
          },
          y: {
            beginAtZero: true,
            max: 100,
            border: { display: false },
            grid: { color: "rgba(15, 23, 42, 0.08)" },
            ticks: { callback: (value) => `${value}%`, color: "#64748b", font: { size: 11, weight: 560 }, maxTicksLimit: 6 },
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
    <div className="ae-forecast-canvas-stage" role="img" aria-label="Evolution de la probabilite moyenne de closing">
      <canvas ref={canvasRef} />
    </div>
  );
};

export const ProbabilityTimelinePanel = ({
  orgId,
  owners,
  selectedOwnerId,
  canViewTeamForecast = false,
}: ProbabilityTimelinePanelProps) => {
  const [ownerId, setOwnerId] = useState(selectedOwnerId ?? "");
  const [includeClosed, setIncludeClosed] = useState(true);
  const [timeline, setTimeline] = useState<AggregatedProbabilityTimeline | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const scope: ForecastScope = ownerId ? "owner" : "all";
  const resolvedOwnerId = ownerId || null;

  useEffect(() => {
    setOwnerId(selectedOwnerId ?? "");
  }, [selectedOwnerId]);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await fetchProbabilityTimeline({
          orgId,
          scope,
          hubspotOwnerId: resolvedOwnerId,
          includeClosed,
        });

        if (isMounted) {
          setTimeline(result);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Erreur inconnue pendant le chargement de la timeline.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      isMounted = false;
    };
  }, [includeClosed, orgId, resolvedOwnerId, scope]);

  const handleBackfill = async () => {
    try {
      setIsBackfilling(true);
      setError(null);
      setMessage(null);
      const result = await backfillProbabilityHistory(orgId);
      setMessage(
        `Historique importe depuis HubSpot : ${result.pointsInserted} point(s) sur ${result.dealsProcessed} deal(s).`,
      );
      const refreshed = await fetchProbabilityTimeline({
        orgId,
        scope,
        hubspotOwnerId: resolvedOwnerId,
        includeClosed,
      });
      setTimeline(refreshed);
    } catch (backfillError) {
      setError(backfillError instanceof Error ? backfillError.message : "Erreur inconnue pendant l'import HubSpot.");
    } finally {
      setIsBackfilling(false);
    }
  };

  const hasPoints = useMemo(() => (timeline?.points.length ?? 0) > 0, [timeline]);

  return (
    <article className="ae-dashboard-panel">
      <div className="ae-panel-heading">
        <span>Evolution de la probabilite de closing</span>
        <strong>{timeline ? `${timeline.dealCount} deal(s)` : "--"}</strong>
      </div>

      <div className="ae-forecast-filters">
        {canViewTeamForecast ? (
          <label>
            Perimetre
            <select disabled={owners.length === 0} onChange={(event) => setOwnerId(event.target.value)} value={ownerId}>
              <option value="">Equipe (tous les sales)</option>
              {owners.map((owner) => (
                <option key={owner.ownerId} value={owner.ownerId}>
                  {owner.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="ae-mini-toggle">
          <input checked={includeClosed} onChange={(event) => setIncludeClosed(event.target.checked)} type="checkbox" />
          <span aria-hidden="true" />
          Inclure clotures
        </label>
        <button disabled={isBackfilling} onClick={() => void handleBackfill()} type="button">
          {isBackfilling ? "Import HubSpot..." : "Importer l'historique HubSpot"}
        </button>
      </div>

      {error ? <p className="ae-admin-feedback error">{error}</p> : null}
      {message ? <p className="ae-admin-feedback">{message}</p> : null}

      {hasPoints && timeline ? (
        <ProbabilityChart timeline={timeline} />
      ) : (
        <p className="ae-empty">
          {isLoading
            ? "Chargement de la timeline..."
            : "Aucun historique de probabilite. Lance « Importer l'historique HubSpot » pour recuperer les donnees passees."}
        </p>
      )}
    </article>
  );
};
