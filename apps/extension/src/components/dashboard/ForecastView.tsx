import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Chart from "chart.js/auto";
import type { ChartConfiguration, TooltipItem } from "chart.js";
import { Bot } from "lucide-react";
import {
  analyzeForecastDeal,
  fetchForecastOverview,
  startAndPollForecastOpenDealsAnalysis,
  type AiProviderOption,
  type ForecastAnalyzeJobStatus,
  type ForecastDeal,
  type ForecastOverviewResult,
  type ForecastScope,
} from "../../services/api";
import { formatAmount, formatDate, formatDateTime } from "../../utils/dashboard/formatters";
import type { HubSpotOwnerOption } from "../../services/api";

type ForecastViewProps = {
  orgId: string;
  owners: HubSpotOwnerOption[];
  selectedAiProvider: AiProviderOption;
  selectedOwnerId?: string;
};

type ForecastTab = "overview" | "vs";

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

const getMonthBounds = (): { dateFrom: string; dateTo: string } => {
  const now = new Date();
  const firstDay = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const lastDay = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 12, 0));

  return {
    dateFrom: firstDay.toISOString().slice(0, 10),
    dateTo: lastDay.toISOString().slice(0, 10),
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
    forecast: month.forecastAmount,
    objective: month.objectiveAmount,
    pipeline: month.pipelineAmount,
    dealCount: month.dealCount,
    confidenceScore: month.confidenceScore,
  }));
};

const getScenarioClassName = (scenarioId: string): string =>
  scenarioId === "likely" ? "ae-forecast-scenario active" : "ae-forecast-scenario";

const getRiskClassName = (severity: string): string => `ae-forecast-risk-pill ${severity}`;

const sortInfluentialDeals = (deals: ForecastDeal[]): ForecastDeal[] =>
  [...deals].sort((left, right) => right.impactAmount - left.impactAmount).slice(0, 6);

const isTechnicalOwnerFallback = (ownerName: string | null | undefined): boolean => /^Owner \d+$/i.test(ownerName ?? "");

const getProbabilityLabel = (deal: ForecastDeal): string => {
  if (deal.analysisStatus === "closed_won") {
    return "Gagne";
  }

  return deal.aiProbability === null ? "A analyser" : `${deal.aiProbability}%`;
};

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
            label: "Forecast IA",
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
        <span><i className="forecast" /> Forecast IA</span>
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

export const ForecastView = ({ orgId, owners, selectedAiProvider, selectedOwnerId }: ForecastViewProps) => {
  const defaultDates = useMemo(getMonthBounds, []);
  const [ownerId, setOwnerId] = useState(selectedOwnerId ?? "");
  const [dateFrom, setDateFrom] = useState(defaultDates.dateFrom);
  const [dateTo, setDateTo] = useState(defaultDates.dateTo);
  const [overview, setOverview] = useState<ForecastOverviewResult | null>(null);
  const [activeTab, setActiveTab] = useState<ForecastTab>("overview");
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzingDealId, setAnalyzingDealId] = useState<string | null>(null);
  const [forecastJob, setForecastJob] = useState<ForecastAnalyzeJobStatus | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const scope: ForecastScope = ownerId ? "owner" : "all";
  const resolvedOwnerId = ownerId || null;

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
  const influentialDeals = useMemo(() => sortInfluentialDeals(overview?.deals ?? []), [overview?.deals]);
  const openDeals = useMemo(
    () => sortInfluentialDeals((overview?.deals ?? []).filter((deal) => deal.analysisStatus !== "closed_won")),
    [overview?.deals],
  );
  const ownersById = useMemo(() => new Map(owners.map((owner) => [owner.ownerId, owner.name])), [owners]);
  const analyzedRatio = overview && overview.openDealCount > 0 ? Math.round((overview.analyzedDealCount / overview.openDealCount) * 100) : 0;
  const forecastShare =
    overview && overview.pipelineAmount > 0 ? Math.round((overview.forecastAmount / overview.pipelineAmount) * 100) : 0;
  const objectiveAmount = overview?.objectiveAmount ?? overview?.pipelineAmount ?? 0;
  const gapAmount = overview ? objectiveAmount - overview.forecastAmount : 0;
  const trend = projection.length > 1 ? getTrend(projection[projection.length - 1].forecast, projection[0].forecast) : { value: 0, className: "flat" };

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
        <div>
          <h2>Forecast IA</h2>
          <span>Analysez les deals ouverts, integrez les close won et anticipez votre atterrissage de fin de periode.</span>
        </div>
        <div className="ae-forecast-header-meta">
          <span>
            Derniere mise a jour : {overview?.lastAnalyzedAt ? formatDateTime(overview.lastAnalyzedAt) : "aucune analyse IA"}
          </span>
          <button disabled={isAnalyzing} onClick={() => void handleAnalyze(false)} type="button">
            {isAnalyzing ? "Analyse..." : "Analyser les deals ouverts"}
          </button>
          <button disabled={isAnalyzing} onClick={() => void handleAnalyze(true)} type="button">
            Recalculer les deals ouverts
          </button>
        </div>
      </div>

      <div className="ae-forecast-tabs" aria-label="Forecast sections">
        <button className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")} type="button">
          Vue d'ensemble
        </button>
        <button className={activeTab === "vs" ? "active" : ""} onClick={() => setActiveTab("vs")} type="button">
          VS
        </button>
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
          <span>
            <input onChange={(event) => setDateFrom(event.target.value)} type="date" value={dateFrom} />
            <input onChange={(event) => setDateTo(event.target.value)} type="date" value={dateTo} />
          </span>
        </label>
        <label>
          Proprietaire
          <select disabled={owners.length === 0} onChange={(event) => setOwnerId(event.target.value)} value={ownerId}>
            <option value="">Tous</option>
            {owners.map((owner) => (
              <option key={owner.ownerId} value={owner.ownerId}>
                {owner.name}
              </option>
            ))}
          </select>
        </label>
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
              <span>Prediction IA</span>
              <strong>
                {overview
                  ? `Jarvis prevoit un atterrissage a ${formatAmount(overview.forecastAmount)} sur la periode, soit ${forecastShare}% du pipeline forecastable.`
                  : "Chargement du forecast IA depuis Supabase."}
              </strong>
              {overview && overview.missingAnalysisCount > 0 ? (
                <small>{overview.missingAnalysisCount} deal(s) ouverts doivent encore etre analyses par l'IA.</small>
              ) : null}
              {overview && overview.wonDealCount > 0 ? <small>{overview.wonDealCount} close won deja integre(s) a 100%.</small> : null}
            </div>
            <button type="button">Voir les leviers {"->"}</button>
          </article>

          <section className="ae-forecast-kpis">
            <article>
              <span>Forecast IA</span>
              <strong>{overview ? formatAmount(overview.forecastAmount) : "--"}</strong>
              <small className={trend.className}>{overview ? `${trend.value}% vs debut periode` : "Supabase"}</small>
            </article>
            <article>
              <span>Objectif</span>
              <strong>{overview ? formatAmount(objectiveAmount) : "--"}</strong>
              <small>{formatPeriod(dateFrom, dateTo)}</small>
            </article>
            <article>
              <span>Gap a l'objectif</span>
              <strong>{overview ? formatAmount(Math.max(0, gapAmount)) : "--"}</strong>
              <small className={gapAmount > 0 ? "negative" : "positive"}>{gapAmount > 0 ? "A combler" : "Objectif couvert"}</small>
            </article>
            <article>
              <span>Confiance</span>
              <strong>{overview ? `${overview.confidenceScore}%` : "--"}</strong>
              <small className="positive">{analyzedRatio}% de couverture IA</small>
            </article>
          </section>

          <section className="ae-forecast-layout">
            <article className="ae-forecast-panel large">
              <div className="ae-panel-heading">
                <span>Projection mois par mois</span>
                <strong>{overview ? `${overview.monthlyProjection.length} mois` : "--"}</strong>
              </div>
              {projection.length > 0 ? (
                <ProjectionChart objectiveLabel={formatAmount(objectiveAmount)} points={projection} />
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
              <button className="ae-forecast-link" type="button">Voir tous les risques {"->"}</button>
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
              <button className="ae-forecast-link" type="button">Voir tous les leviers {"->"}</button>
            </article>

            <article className="ae-forecast-panel">
              <div className="ae-panel-heading">
                <span>Fiabilite du forecast</span>
                <strong>{overview ? `${overview.confidenceScore}%` : "--"}</strong>
              </div>
              <div className="ae-forecast-confidence-ring" style={{ "--score": `${overview?.confidenceScore ?? 0}%` } as CSSProperties}>
                <strong>{overview ? `${overview.confidenceScore}%` : "--"}</strong>
                <span>Confiance globale</span>
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
              <span>Deals cles influencant le forecast</span>
              <strong>{influentialDeals.length} deal(s)</strong>
            </div>
            <div className="ae-forecast-deal-table" role="table">
              <div className="header" role="row">
                <span>Deal</span>
                <span>Compte</span>
                <span>Etape</span>
                <span>Proprietaire</span>
                <span>Montant</span>
                <span>Probabilite IA</span>
                <span>Impact</span>
                <span>Close prevue</span>
                <span>Action</span>
              </div>
              {influentialDeals.map((deal) => (
                <div key={deal.hubspotDealId} role="row">
                  <span>{deal.dealName ?? deal.hubspotDealId}</span>
                  <span>{deal.companyName}</span>
                  <span>{deal.stage}</span>
                  <span>{getOwnerDisplayName(deal)}</span>
                  <span>{formatAmount(deal.amount)}</span>
                  <span>{getProbabilityLabel(deal)}</span>
                  <span>{formatAmount(deal.impactAmount)}</span>
                  <span>{deal.closeDate ? formatDate(deal.closeDate) : "Sans date"}</span>
                  <span>
                    <button
                      className="ae-forecast-row-action"
                      disabled={isAnalyzing || analyzingDealId !== null || deal.analysisStatus === "closed_won"}
                      onClick={() => void handleAnalyzeDeal(deal)}
                      type="button"
                    >
                      {analyzingDealId === deal.hubspotDealId ? "Analyse..." : deal.aiProbability === null ? "Analyser" : "Recalculer"}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </article>
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
