import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Chart from "chart.js/auto";
import type { ChartConfiguration, TooltipItem } from "chart.js";
import { Bot } from "lucide-react";
import {
  analyzeForecastDeal,
  fetchForecastOverview,
  generateForecastSynthesis,
  startAndPollForecastOpenDealsAnalysis,
  type AiProviderOption,
  type ForecastAnalyzeJobStatus,
  type ForecastDeal,
  type ForecastOverviewResult,
  type ForecastScope,
  type ForecastSynthesis,
  type ForecastSynthesisCategory,
  type ForecastSynthesisDeal,
} from "../../services/api";
import { formatAmount, formatDate, formatDateTime } from "../../utils/dashboard/formatters";
import type { HubSpotOwnerOption } from "../../services/api";

type ForecastViewProps = {
  orgId: string;
  owners: HubSpotOwnerOption[];
  selectedAiProvider: AiProviderOption;
  selectedOwnerId?: string;
  /** Managers/admins can switch between the whole team and any individual sales rep. Sales reps stay locked to their own deals. */
  canViewTeamForecast?: boolean;
};

type ForecastTab = "overview" | "synthesis" | "vs";

const FORECAST_SYNTHESIS_CATEGORY_ORDER: ForecastSynthesisCategory[] = ["commit", "bestCase", "atRisk", "slipping"];

const getSynthesisCategoryTone = (category: ForecastSynthesisCategory): string => {
  if (category === "commit") {
    return "commit";
  }

  if (category === "bestCase") {
    return "best-case";
  }

  if (category === "atRisk") {
    return "at-risk";
  }

  return "slipping";
};

const getConfidenceLabel = (confidence: ForecastSynthesis["confidence"]): string =>
  confidence === "high" ? "Confiance elevee" : confidence === "medium" ? "Confiance moyenne" : "Confiance faible";

const getPriorityLabel = (priority: "low" | "medium" | "high"): string =>
  priority === "high" ? "Prioritaire" : priority === "medium" ? "A suivre" : "Optionnel";
type ForecastPeriodMode = "currentAndNext" | "currentMonth" | "nextMonth" | "custom";

type ForecastPoint = {
  date: string;
  label: string;
  commit: number;
  forecast: number;
  objective: number | null;
  pipeline: number;
  dealCount: number;
  confidenceScore: number;
};

const getMonthBounds = (offsetMonths = 0): { dateFrom: string; dateTo: string } => {
  const now = new Date();
  const firstDay = new Date(Date.UTC(now.getFullYear(), now.getMonth() + offsetMonths, 1));
  const lastDay = new Date(Date.UTC(now.getFullYear(), now.getMonth() + offsetMonths + 1, 0));

  return {
    dateFrom: firstDay.toISOString().slice(0, 10),
    dateTo: lastDay.toISOString().slice(0, 10),
  };
};

const getPeriodBounds = (mode: Exclude<ForecastPeriodMode, "custom">): { dateFrom: string; dateTo: string } => {
  if (mode === "currentMonth") {
    return getMonthBounds(0);
  }

  if (mode === "nextMonth") {
    return getMonthBounds(1);
  }

  return {
    dateFrom: getMonthBounds(0).dateFrom,
    dateTo: getMonthBounds(1).dateTo,
  };
};

const formatPeriod = (dateFrom: string, dateTo: string): string => {
  if (!dateFrom || !dateTo) {
    return "Periode non definie";
  }

  return `${formatDate(dateFrom)} - ${formatDate(dateTo)}`;
};

const buildProjection = (overview: ForecastOverviewResult | null): ForecastPoint[] => {
  if (!overview || overview.monthlyProjection.length === 0) {
    return [];
  }

  return overview.monthlyProjection.map((month) => ({
    date: month.month,
    label: month.label,
    commit: month.commitAmount,
    forecast: month.landingAmount,
    objective: month.objectiveAmount,
    pipeline: month.pipelineAmount,
    dealCount: month.dealCount,
    confidenceScore: month.confidenceScore,
  }));
};

const getScenarioClassName = (scenarioId: string): string =>
  scenarioId === "likely" ? "ae-forecast-scenario active" : "ae-forecast-scenario";

const getRiskClassName = (severity: string): string => `ae-forecast-risk-pill ${severity}`;

const sortDealsByImpact = (deals: ForecastDeal[]): ForecastDeal[] =>
  [...deals].sort((left, right) => right.impactAmount - left.impactAmount);

const sortSignedDeals = (deals: ForecastDeal[]): ForecastDeal[] =>
  [...deals].sort((left, right) => right.amount - left.amount);

const isTechnicalOwnerFallback = (ownerName: string | null | undefined): boolean => /^Owner \d+$/i.test(ownerName ?? "");

const getProbabilityLabel = (deal: ForecastDeal): string => {
  if (deal.analysisStatus === "closed_won") {
    return "100% factuel";
  }

  return deal.aiProbability === null ? "A analyser" : `${deal.aiProbability}%`;
};

const getSignedBucketLabel = (deal: ForecastDeal): string =>
  deal.forecastBucket === "paymentReceived" ? "Paiement recu" : "Signe, paiement pending";

const getDelta = (deal: ForecastDeal): number | null => (deal.aiProbability === null ? null : deal.aiProbability - deal.crmProbability);

const getDeltaClassName = (delta: number | null): string => {
  if (delta === null || delta === 0) {
    return "flat";
  }

  return delta > 0 ? "positive" : "negative";
};

const formatDelta = (delta: number | null): string => {
  if (delta === null) {
    return "--";
  }

  return `${delta > 0 ? "+" : ""}${delta} pts`;
};

const getTrend = (current: number, previous: number): { value: number; className: string } => {
  if (previous <= 0) {
    return { value: current > 0 ? 100 : 0, className: current > 0 ? "positive" : "flat" };
  }

  const value = Math.round(((current - previous) / previous) * 100);

  return {
    value: Math.abs(value),
    className: value > 0 ? "positive" : value < 0 ? "negative" : "flat",
  };
};

const ProjectionChart = ({
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

export const ForecastView = ({
  orgId,
  owners,
  selectedAiProvider,
  selectedOwnerId,
  canViewTeamForecast = false,
}: ForecastViewProps) => {
  const defaultDates = useMemo(() => getPeriodBounds("currentAndNext"), []);
  const [ownerId, setOwnerId] = useState(selectedOwnerId ?? "");
  const [periodMode, setPeriodMode] = useState<ForecastPeriodMode>("currentAndNext");
  const [dateFrom, setDateFrom] = useState(defaultDates.dateFrom);
  const [dateTo, setDateTo] = useState(defaultDates.dateTo);
  const [overview, setOverview] = useState<ForecastOverviewResult | null>(null);
  const [activeTab, setActiveTab] = useState<ForecastTab>("overview");
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzingDealId, setAnalyzingDealId] = useState<string | null>(null);
  const [isGeneratingSynthesis, setIsGeneratingSynthesis] = useState(false);
  const [forecastJob, setForecastJob] = useState<ForecastAnalyzeJobStatus | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const scope: ForecastScope = ownerId ? "owner" : "all";
  const resolvedOwnerId = ownerId || null;

  useEffect(() => {
    setOwnerId(selectedOwnerId ?? "");
  }, [selectedOwnerId]);

  useEffect(() => {
    let isMounted = true;

    const loadOverview = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await fetchForecastOverview({
          orgId,
          scope,
          hubspotOwnerId: resolvedOwnerId,
          dateFrom,
          dateTo,
          aiProvider: selectedAiProvider,
        });

        if (isMounted) {
          setOverview(result);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Erreur inconnue pendant le chargement forecast.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadOverview();

    return () => {
      isMounted = false;
    };
  }, [dateFrom, dateTo, orgId, resolvedOwnerId, scope, selectedAiProvider]);

  const projection = useMemo(() => buildProjection(overview), [overview]);
  const synthesis: ForecastSynthesis | null = overview?.synthesis ?? null;
  const signedDeals = useMemo(
    () => sortSignedDeals((overview?.deals ?? []).filter((deal) => deal.forecastBucket !== "openForecast")),
    [overview?.deals],
  );
  const openDeals = useMemo(
    () => sortDealsByImpact((overview?.deals ?? []).filter((deal) => deal.forecastBucket === "openForecast")),
    [overview?.deals],
  );
  const ownersById = useMemo(() => new Map(owners.map((owner) => [owner.ownerId, owner.name])), [owners]);
  const analyzedRatio = overview && overview.openDealCount > 0 ? Math.round((overview.analyzedDealCount / overview.openDealCount) * 100) : 0;
  const forecastShare =
    overview && overview.openPipelineAmount > 0 ? Math.round((overview.openForecastAmount / overview.openPipelineAmount) * 100) : 0;
  const objectiveAmount = overview && overview.objectiveAmount && overview.objectiveAmount > 0 ? overview.objectiveAmount : null;
  const landingAmount = overview?.landingAmount ?? overview?.forecastAmount ?? 0;
  const gapToFill = objectiveAmount === null ? null : Math.max(0, objectiveAmount - landingAmount);
  const trend = projection.length > 1 ? getTrend(projection[projection.length - 1].forecast, projection[0].forecast) : { value: 0, className: "flat" };

  const setPeriod = (nextMode: ForecastPeriodMode) => {
    setPeriodMode(nextMode);

    if (nextMode !== "custom") {
      const nextDates = getPeriodBounds(nextMode);
      setDateFrom(nextDates.dateFrom);
      setDateTo(nextDates.dateTo);
    }
  };

  const handleDateFromChange = (value: string) => {
    setPeriodMode("custom");
    setDateFrom(value);
  };

  const handleDateToChange = (value: string) => {
    setPeriodMode("custom");
    setDateTo(value);
  };

  const handleAnalyze = async (refresh: boolean) => {
    try {
      setIsAnalyzing(true);
      setError(null);
      setMessage(null);
      setForecastJob(null);
      setLogsOpen(true);
      const result = await startAndPollForecastOpenDealsAnalysis({
        orgId,
        scope,
        hubspotOwnerId: resolvedOwnerId,
        dateFrom,
        dateTo,
        aiProvider: selectedAiProvider,
        refresh,
        batchSize: 5,
        retryFailedCount: 2,
        onProgress: setForecastJob,
      });

      setOverview(result.overview);
      setMessage(
        `Analyse complete terminee par lots de ${result.batchSize}: ${result.analyzedCount} deal(s) traite(s), ${result.reusedCount} reutilise(s), ${result.failedCount} echec(s).`,
      );
    } catch (analyzeError) {
      setError(analyzeError instanceof Error ? analyzeError.message : "Erreur inconnue pendant l'analyse forecast.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAnalyzeDeal = async (deal: ForecastDeal) => {
    try {
      setAnalyzingDealId(deal.hubspotDealId);
      setError(null);
      setMessage(null);
      const result = await analyzeForecastDeal({
        orgId,
        scope,
        hubspotOwnerId: resolvedOwnerId,
        dateFrom,
        dateTo,
        hubspotDealId: deal.hubspotDealId,
        aiProvider: selectedAiProvider,
        refresh: true,
      });

      setOverview(result.overview);
      setMessage(`Analyse complete relancee pour ${deal.dealName ?? deal.hubspotDealId}.`);
    } catch (analyzeError) {
      setError(analyzeError instanceof Error ? analyzeError.message : "Erreur inconnue pendant l'analyse du deal.");
    } finally {
      setAnalyzingDealId(null);
    }
  };

  const handleGenerateSynthesis = async () => {
    try {
      setIsGeneratingSynthesis(true);
      setError(null);
      setMessage(null);
      const result = await generateForecastSynthesis({
        orgId,
        scope,
        hubspotOwnerId: resolvedOwnerId,
        dateFrom,
        dateTo,
        aiProvider: selectedAiProvider,
      });

      setOverview(result.overview);
      setMessage(
        result.synthesis
          ? `Synthese IA generee: ${result.synthesis.deals.length} deal(s) classe(s).`
          : "Aucun deal ouvert analyse: lance d'abord l'analyse des deals ouverts.",
      );
    } catch (synthesisError) {
      setError(synthesisError instanceof Error ? synthesisError.message : "Erreur inconnue pendant la synthese forecast.");
    } finally {
      setIsGeneratingSynthesis(false);
    }
  };

  const getOwnerDisplayName = (deal: ForecastDeal): string => {
    if (deal.ownerHubSpotId) {
      const ownerNameFromHubSpot = ownersById.get(deal.ownerHubSpotId);

      if (ownerNameFromHubSpot) {
        return ownerNameFromHubSpot;
      }
    }

    return isTechnicalOwnerFallback(deal.ownerName) ? "Non assigne" : deal.ownerName ?? "Non assigne";
  };

  return (
    <section className="ae-view-panel ae-forecast-page" aria-label="Forecast IA">
      <div className="ae-forecast-header">
        <span className="ae-forecast-last-update">
          Derniere mise a jour IA : {overview?.lastAnalyzedAt ? formatDateTime(overview.lastAnalyzedAt) : "aucune analyse"}
        </span>
        <div className="ae-forecast-header-meta">
          <button disabled={isAnalyzing || openDeals.length === 0} onClick={() => void handleAnalyze(false)} type="button">
            {isAnalyzing ? "Analyse..." : "Analyser les deals ouverts"}
          </button>
          <button disabled={isAnalyzing || openDeals.length === 0} onClick={() => void handleAnalyze(true)} type="button">
            Recalculer les deals ouverts
          </button>
        </div>
      </div>

      {forecastJob ? (
        <div className="ae-sync-progress" aria-live="polite">
          <div className="ae-sync-progress-head">
            <span>{forecastJob.currentStep}</span>
            <strong>{forecastJob.progress}%</strong>
          </div>
          <div className="ae-sync-progress-track">
            <div style={{ width: `${forecastJob.progress}%` }} />
          </div>
          <button className="ae-forecast-link" onClick={() => setLogsOpen((isOpen) => !isOpen)} type="button">
            {logsOpen ? "Masquer les logs" : "Voir les logs"}
          </button>
          {logsOpen ? (
            <ol className="ae-sync-logs">
              {forecastJob.logs.slice(-8).map((log) => (
                <li className={log.level} key={`${log.at}:${log.message}`}>
                  <time>{formatDateTime(log.at)}</time>
                  <span>{log.message}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}

      <div className="ae-forecast-filters">
        <label>
          Periode
          <span className="ae-forecast-period-toggle">
            <button className={periodMode === "currentAndNext" ? "active" : ""} onClick={() => setPeriod("currentAndNext")} type="button">
              Ce mois + prochain
            </button>
            <button className={periodMode === "currentMonth" ? "active" : ""} onClick={() => setPeriod("currentMonth")} type="button">
              Ce mois
            </button>
            <button className={periodMode === "nextMonth" ? "active" : ""} onClick={() => setPeriod("nextMonth")} type="button">
              Mois prochain
            </button>
            <button className={periodMode === "custom" ? "active" : ""} onClick={() => setPeriod("custom")} type="button">
              Personnalise
            </button>
          </span>
        </label>
        <label>
          Dates
          <span>
            <input onChange={(event) => handleDateFromChange(event.target.value)} type="date" value={dateFrom} />
            <input onChange={(event) => handleDateToChange(event.target.value)} type="date" value={dateTo} />
          </span>
        </label>
        {canViewTeamForecast ? (
          <label>
            Forecast
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
      </div>

      <div className="ae-forecast-tabs" aria-label="Forecast sections">
        <button className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")} type="button">
          Vue d'ensemble
        </button>
        <button className={activeTab === "synthesis" ? "active" : ""} onClick={() => setActiveTab("synthesis")} type="button">
          Synthese IA
        </button>
        <button className={activeTab === "vs" ? "active" : ""} onClick={() => setActiveTab("vs")} type="button">
          CRM vs IA
        </button>
      </div>

      {error ? <p className="ae-admin-feedback error">{error}</p> : null}
      {message ? <p className="ae-admin-feedback">{message}</p> : null}

      {activeTab === "overview" ? (
        <>
          <article className="ae-forecast-banner">
            <div className="ae-forecast-spark" aria-label="AI" role="img">
              <Bot size={21} strokeWidth={2.3} />
            </div>
            <div>
              <span>Atterrissage forecast</span>
              <strong>
                {overview
                  ? `${formatAmount(overview.signedAmount)} deja signe + ${formatAmount(overview.openForecastAmount)} de forecast ouvert = ${formatAmount(landingAmount)} prevus sur la periode.`
                  : "Chargement du forecast IA depuis Supabase."}
              </strong>
              {overview && overview.missingAnalysisCount > 0 ? (
                <small>{overview.missingAnalysisCount} deal(s) ouverts doivent encore etre analyses par l'IA.</small>
              ) : null}
              {overview && overview.signedDealCount > 0 ? <small>{overview.signedDealCount} deal(s) signe(s) integre(s) a 100%.</small> : null}
            </div>
            <button disabled={openDeals.length === 0 || isAnalyzing} onClick={() => void handleAnalyze(false)} type="button">
              Actualiser l'IA
            </button>
          </article>

          <section className="ae-forecast-kpis">
            <article>
              <span>Deja signe</span>
              <strong>{overview ? formatAmount(overview.signedAmount) : "--"}</strong>
              <small>{overview ? `${overview.signedDealCount} deal(s) a 100%` : "HubSpot"}</small>
            </article>
            <article>
              <span>Paiement pending</span>
              <strong>{overview ? formatAmount(overview.signedPaymentPendingAmount) : "--"}</strong>
              <small>{overview ? `${overview.signedPaymentPendingDealCount} deal(s) signe(s)` : "HubSpot"}</small>
            </article>
            <article>
              <span>Paiement recu</span>
              <strong>{overview ? formatAmount(overview.paymentReceivedAmount) : "--"}</strong>
              <small>{overview ? `${overview.paymentReceivedDealCount} deal(s) paye(s)` : "HubSpot"}</small>
            </article>
            <article>
              <span>Atterrissage</span>
              <strong>{overview ? formatAmount(landingAmount) : "--"}</strong>
              <small className={trend.className}>{overview ? `${forecastShare}% du pipeline ouvert pondere` : "Supabase"}</small>
            </article>
            <article>
              <span>Objectif</span>
              <strong>{!overview ? "--" : objectiveAmount === null ? "Non defini" : formatAmount(objectiveAmount)}</strong>
              <small>{formatPeriod(dateFrom, dateTo)}</small>
            </article>
            <article>
              <span>Gap objectif</span>
              <strong>{!overview || objectiveAmount === null ? "--" : formatAmount(gapToFill ?? 0)}</strong>
              <small className={gapToFill && gapToFill > 0 ? "negative" : "positive"}>
                {objectiveAmount === null ? "Objectif non defini" : gapToFill && gapToFill > 0 ? "A combler" : "Objectif couvert"}
              </small>
            </article>
          </section>

          <section className="ae-forecast-layout">
            <article className="ae-forecast-panel large">
              <div className="ae-panel-heading">
                <span>Projection mois par mois</span>
                <strong>{overview ? `${overview.monthlyProjection.length} mois` : "--"}</strong>
              </div>
              {projection.length > 0 ? (
                <ProjectionChart objectiveLabel={objectiveAmount === null ? "non defini" : formatAmount(objectiveAmount)} points={projection} />
              ) : (
                <p className="ae-empty">{isLoading ? "Chargement Supabase..." : "Aucun deal forecastable sur cette periode."}</p>
              )}
            </article>

            <article className="ae-forecast-panel">
              <div className="ae-panel-heading">
                <span>Scenarios</span>
                <strong>Scenario central</strong>
              </div>
              <div className="ae-forecast-scenarios">
                {(overview?.scenarios ?? []).map((scenario) => (
                  <div className={getScenarioClassName(scenario.id)} key={scenario.id}>
                    <span>{scenario.label}</span>
                    <strong>{formatAmount(scenario.amount)}</strong>
                    <small>Probabilite {scenario.probability}%</small>
                  </div>
                ))}
              </div>
            </article>
          </section>

          {projection.length > 0 ? (
            <section className="ae-forecast-months" aria-label="Detail par mois">
              {(overview?.monthlyProjection ?? []).map((month) => {
                const toFill = month.objectiveAmount === null ? null : Math.max(0, month.objectiveAmount - month.landingAmount);

                return (
                  <article className="ae-forecast-month-card" key={month.month}>
                    <header>
                      <strong>{month.label}</strong>
                      <span>{month.dealCount} deal(s)</span>
                    </header>
                    <dl>
                      <div>
                        <dt>Deja signe</dt>
                        <dd>
                          {formatAmount(month.signedAmount)}
                          <small>{month.signedDealCount} deal(s) a 100%</small>
                        </dd>
                      </div>
                      <div>
                        <dt>Reste a closer (pondere)</dt>
                        <dd>
                          {formatAmount(month.openForecastAmount)}
                          <small>{month.openDealCount} ouvert(s) | {formatAmount(month.openPipelineAmount)} brut</small>
                        </dd>
                      </div>
                      <div className="highlight">
                        <dt>Atterrissage</dt>
                        <dd>{formatAmount(month.landingAmount)}</dd>
                      </div>
                      <div>
                        <dt>Objectif</dt>
                        <dd>{month.objectiveAmount === null ? "--" : formatAmount(month.objectiveAmount)}</dd>
                      </div>
                      <div className={toFill === null ? "" : toFill > 0 ? "negative" : "positive"}>
                        <dt>Gap objectif</dt>
                        <dd>
                          {toFill === null ? "--" : toFill > 0 ? formatAmount(toFill) : "Couvert"}
                          {toFill !== null ? <small>{toFill > 0 ? "a combler" : "objectif atteint"}</small> : null}
                        </dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </section>
          ) : null}

          <section className="ae-forecast-layout three">
            <article className="ae-forecast-panel">
              <div className="ae-panel-heading">
                <span>Risques principaux</span>
                <strong>{overview?.risks.length ?? 0}</strong>
              </div>
              <div className="ae-forecast-list">
                {(overview?.risks ?? []).map((risk) => (
                  <div key={risk.title}>
                    <span>{risk.title}</span>
                    <em className={getRiskClassName(risk.severity)}>
                      {risk.severity === "high" ? "Eleve" : risk.severity === "medium" ? "Moyen" : "Faible"}
                    </em>
                  </div>
                ))}
              </div>
            </article>

            <article className="ae-forecast-panel">
              <div className="ae-panel-heading">
                <span>Leviers prioritaires</span>
                <strong>{overview?.levers.length ?? 0}</strong>
              </div>
              <div className="ae-forecast-list">
                {(overview?.levers ?? []).map((lever) => (
                  <div key={lever.title}>
                    <span>{lever.title}</span>
                    <em>{formatAmount(lever.amount)}</em>
                  </div>
                ))}
              </div>
            </article>

            <article className="ae-forecast-panel">
              <div className="ae-panel-heading">
                <span>Fiabilite du forecast</span>
                <strong>{overview ? `${overview.confidenceScore}%` : "--"}</strong>
              </div>
              <div className="ae-forecast-confidence-ring" style={{ "--score": `${overview?.confidenceScore ?? 0}%` } as CSSProperties}>
                <strong>{overview ? `${overview.confidenceScore}%` : "--"}</strong>
                <span>{overview ? `${analyzedRatio}% couverture IA` : "Confiance globale"}</span>
              </div>
              <div className="ae-forecast-reliability">
                {(overview?.reliability ?? []).map((item) => (
                  <div key={item.id}>
                    <span>{item.label}</span>
                    <span className="ae-forecast-meter"><i style={{ "--value": `${item.score}%` } as CSSProperties} /></span>
                    <strong>{item.score}%</strong>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <article className="ae-forecast-panel">
            <div className="ae-panel-heading">
              <span>Deals signes</span>
              <strong>{signedDeals.length} deal(s)</strong>
            </div>
            <div className="ae-forecast-deal-table signed" role="table">
              <div className="header" role="row">
                <span>Deal</span>
                <span>Compte</span>
                <span>Statut</span>
                <span>Proprietaire</span>
                <span>Montant</span>
                <span>Close prevue</span>
                <span>Sync CRM</span>
              </div>
              {signedDeals.length > 0 ? (
                signedDeals.map((deal) => (
                  <div key={deal.hubspotDealId} role="row">
                    <span>{deal.dealName ?? deal.hubspotDealId}</span>
                    <span>{deal.companyName}</span>
                    <span>{getSignedBucketLabel(deal)}</span>
                    <span>{getOwnerDisplayName(deal)}</span>
                    <span>{formatAmount(deal.amount)}</span>
                    <span>{deal.closeDate ? formatDate(deal.closeDate) : "Sans date"}</span>
                    <span>{formatDateTime(deal.syncedAt)}</span>
                  </div>
                ))
              ) : (
                <p className="ae-empty">{isLoading ? "Chargement Supabase..." : "Aucun deal signe sur cette periode."}</p>
              )}
            </div>
          </article>

          <article className="ae-forecast-panel">
            <div className="ae-panel-heading">
              <span>Deals ouverts a closer</span>
              <strong>{openDeals.length} deal(s)</strong>
            </div>
            <div className="ae-forecast-deal-table open" role="table">
              <div className="header" role="row">
                <span>Deal</span>
                <span>Compte</span>
                <span>Etape</span>
                <span>Proprietaire</span>
                <span>Montant</span>
                <span>% CRM</span>
                <span>% IA</span>
                <span>Pondere</span>
                <span>Close prevue</span>
                <span>Action</span>
              </div>
              {openDeals.length > 0 ? (
                openDeals.map((deal) => (
                  <div key={deal.hubspotDealId} role="row">
                    <span>{deal.dealName ?? deal.hubspotDealId}</span>
                    <span>{deal.companyName}</span>
                    <span>{deal.stage}</span>
                    <span>{getOwnerDisplayName(deal)}</span>
                    <span>{formatAmount(deal.amount)}</span>
                    <span>{deal.crmProbability}%</span>
                    <span>{getProbabilityLabel(deal)}</span>
                    <span>{formatAmount(deal.forecastAmount)}</span>
                    <span>{deal.closeDate ? formatDate(deal.closeDate) : "Sans date"}</span>
                    <span>
                      <button
                        className="ae-forecast-row-action"
                        disabled={isAnalyzing || analyzingDealId !== null}
                        onClick={() => void handleAnalyzeDeal(deal)}
                        type="button"
                      >
                        {analyzingDealId === deal.hubspotDealId ? "Analyse..." : deal.aiProbability === null ? "Analyser" : "Recalculer"}
                      </button>
                    </span>
                  </div>
                ))
              ) : (
                <p className="ae-empty">{isLoading ? "Chargement Supabase..." : "Aucun deal ouvert a closer sur cette periode."}</p>
              )}
            </div>
          </article>
        </>
      ) : activeTab === "synthesis" ? (
        <>
          <article className="ae-forecast-banner">
            <div className="ae-forecast-spark" aria-label="AI" role="img">
              <Bot size={21} strokeWidth={2.3} />
            </div>
            <div>
              <span>Synthese IA du portefeuille</span>
              <strong>
                {synthesis
                  ? synthesis.headline
                  : "L'IA classe tes deals ouverts (commit / best case / a risque / slipping) et te donne le plan pour atteindre l'objectif."}
              </strong>
              {synthesis ? (
                <small>
                  {getConfidenceLabel(synthesis.confidence)} · {synthesis.analyzedDealCount} deal(s) analyse(s) · l'IA estime closer {formatAmount(synthesis.projectedCloseAmount)}
                  {synthesis.status === "stale" ? " · synthese a regenerer (deals modifies)" : ""}
                </small>
              ) : overview && overview.analyzedDealCount === 0 ? (
                <small>Lance d'abord « Analyser les deals ouverts » pour nourrir la synthese IA.</small>
              ) : null}
            </div>
            <button disabled={isGeneratingSynthesis} onClick={() => void handleGenerateSynthesis()} type="button">
              {isGeneratingSynthesis ? "Synthese..." : synthesis ? "Regenerer la synthese" : "Generer la synthese IA"}
            </button>
          </article>

          {synthesis ? (
            <>
              <section className="ae-forecast-synthesis-board" aria-label="Classement des deals par l'IA">
                {FORECAST_SYNTHESIS_CATEGORY_ORDER.map((category) => {
                  const summary = synthesis.categories.find((item) => item.category === category);
                  const categoryDeals: ForecastSynthesisDeal[] = synthesis.deals.filter((deal) => deal.category === category);

                  return (
                    <article className={`ae-forecast-synthesis-column ${getSynthesisCategoryTone(category)}`} key={category}>
                      <header>
                        <span>{summary?.label ?? category}</span>
                        <strong>{formatAmount(summary?.amount ?? 0)}</strong>
                        <small>{categoryDeals.length} deal(s) · {formatAmount(summary?.weightedAmount ?? 0)} pondere</small>
                      </header>
                      <div className="ae-forecast-synthesis-deals">
                        {categoryDeals.length > 0 ? (
                          categoryDeals.map((deal) => (
                            <div className="ae-forecast-synthesis-deal" key={deal.hubspotDealId}>
                              <div className="ae-forecast-synthesis-deal-head">
                                <strong>{deal.companyName}</strong>
                                <span>{formatAmount(deal.amount)}</span>
                              </div>
                              <div className="ae-forecast-synthesis-deal-meta">
                                <span>{deal.dealName ?? deal.hubspotDealId}</span>
                                <em>{deal.aiProbability === null ? "% IA n/a" : `${deal.aiProbability}% IA`}</em>
                              </div>
                              <p>{deal.reason}</p>
                              {deal.recommendedAction ? (
                                <p className="ae-forecast-synthesis-deal-action">→ {deal.recommendedAction}</p>
                              ) : null}
                            </div>
                          ))
                        ) : (
                          <p className="ae-empty">Aucun deal</p>
                        )}
                      </div>
                    </article>
                  );
                })}
              </section>

              <article className="ae-forecast-panel">
                <div className="ae-panel-heading">
                  <span>Plan d'action pour atteindre l'objectif</span>
                  <strong>{synthesis.actionPlan.length}</strong>
                </div>
                <div className="ae-forecast-synthesis-plan">
                  {synthesis.actionPlan.length > 0 ? (
                    synthesis.actionPlan.map((action, index) => {
                      const relatedDeals = action.relatedDealIds
                        .map((id) => synthesis.deals.find((deal) => deal.hubspotDealId === id)?.companyName)
                        .filter((name): name is string => Boolean(name));

                      return (
                        <div className="ae-forecast-synthesis-plan-item" key={`${action.title}-${index}`}>
                          <div className="ae-forecast-synthesis-plan-head">
                            <strong>{action.title}</strong>
                            <em className={`ae-forecast-risk-pill ${action.priority}`}>{getPriorityLabel(action.priority)}</em>
                          </div>
                          <p>{action.rationale}</p>
                          {relatedDeals.length > 0 ? <small>Deals : {relatedDeals.join(", ")}</small> : null}
                        </div>
                      );
                    })
                  ) : (
                    <p className="ae-empty">Aucune action proposee par l'IA.</p>
                  )}
                </div>
              </article>
            </>
          ) : (
            <p className="ae-empty">
              {isGeneratingSynthesis
                ? "Generation de la synthese IA..."
                : isLoading
                  ? "Chargement Supabase..."
                  : "Aucune synthese IA pour cette periode. Genere-la a partir des deals ouverts analyses."}
            </p>
          )}
        </>
      ) : (
        <>
          <article className="ae-forecast-banner">
            <div className="ae-forecast-spark" aria-hidden="true">VS</div>
            <div>
              <span>CRM vs IA</span>
              <strong>
                {overview
                  ? `Comparez le pourcentage de closing renseigne dans le CRM avec la probabilite calculee par l'IA sur les ${overview.openDealCount} deals ouverts.`
                  : "Chargement des deals ouverts depuis Supabase."}
              </strong>
              {overview && overview.missingAnalysisCount > 0 ? (
                <small>{overview.missingAnalysisCount} deal(s) ouverts doivent encore etre analyses par l'IA.</small>
              ) : null}
            </div>
            <button disabled={isAnalyzing} onClick={() => void handleAnalyze(true)} type="button">
              Recalculer les deals ouverts
            </button>
          </article>

          <article className="ae-forecast-panel">
            <div className="ae-panel-heading">
              <span>Table VS</span>
              <strong>{openDeals.length} deal(s) ouvert(s)</strong>
            </div>
            <div className="ae-forecast-deal-table vs" role="table">
              <div className="header" role="row">
                <span>Deal</span>
                <span>Compte</span>
                <span>Proprietaire</span>
                <span>Montant</span>
                <span>% CRM</span>
                <span>% IA</span>
                <span>Delta</span>
                <span>Pondere IA</span>
                <span>Close prevue</span>
                <span>Factuel</span>
                <span>Action</span>
              </div>
              {openDeals.length > 0 ? (
                openDeals.map((deal) => {
                  const delta = getDelta(deal);
                  const signals = [...deal.positiveSignals, ...deal.risks].slice(0, 2);

                  return (
                    <div key={deal.hubspotDealId} role="row">
                      <span>{deal.dealName ?? deal.hubspotDealId}</span>
                      <span>{deal.companyName}</span>
                      <span>{getOwnerDisplayName(deal)}</span>
                      <span>{formatAmount(deal.amount)}</span>
                      <span>{deal.crmProbability}%</span>
                      <span>{getProbabilityLabel(deal)}</span>
                      <span className={`ae-forecast-delta ${getDeltaClassName(delta)}`}>{formatDelta(delta)}</span>
                      <span>{formatAmount(deal.forecastAmount)}</span>
                      <span>{deal.closeDate ? formatDate(deal.closeDate) : "Sans date"}</span>
                      <span>{signals.length > 0 ? signals.join(" / ") : deal.summary ?? "Analyse IA factuelle a lancer"}</span>
                      <span>
                        <button
                          className="ae-forecast-row-action"
                          disabled={isAnalyzing || analyzingDealId !== null}
                          onClick={() => void handleAnalyzeDeal(deal)}
                          type="button"
                        >
                          {analyzingDealId === deal.hubspotDealId ? "Analyse..." : deal.aiProbability === null ? "Analyser" : "Recalculer"}
                        </button>
                      </span>
                    </div>
                  );
                })
              ) : (
                <p className="ae-empty">{isLoading ? "Chargement Supabase..." : "Aucun deal ouvert forecastable sur cette periode."}</p>
              )}
            </div>
          </article>
        </>
      )}
    </section>
  );
};
