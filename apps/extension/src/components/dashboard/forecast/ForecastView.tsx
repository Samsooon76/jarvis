import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  BarChart3,
  ChartNoAxesCombined,
  RefreshCw,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
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
} from "../../../services/api";
import { formatAmount, formatDateTime } from "../../../utils/dashboard/formatters";
import {
  buildProjection,
  getConfidenceLabel,
  getPeriodBounds,
  getScenarioClassName,
  getTrend,
  isTechnicalOwnerFallback,
  sortDealsByImpact,
  sortSignedDeals,
  type ForecastPeriodMode,
} from "../../../utils/dashboard/forecast";
import { ForecastAccuracyPanel } from "../ForecastAccuracyPanel";
import { ForecastFilters } from "./ForecastFilters";
import { ForecastInsightPanels } from "./ForecastInsightPanels";
import { ForecastJobProgress } from "./ForecastJobProgress";
import { ForecastKpiCards } from "./ForecastKpiCards";
import { MonthlyProjectionCards } from "./MonthlyProjectionCards";
import {
  ForecastDealDetail,
  OpenDealsTable,
  SignedDealsTable,
  VsDealsTable,
} from "./ForecastDealTables";
import { ProjectionChart } from "./ProjectionChart";
import { SynthesisPanel } from "./SynthesisPanel";
import type { HubSpotOwnerOption } from "../../../services/api";
import "../../styles/forecast.css";

type ForecastViewProps = {
  orgId: string;
  owners: HubSpotOwnerOption[];
  selectedAiProvider: AiProviderOption;
  selectedOwnerId?: string;
  canViewTeamForecast?: boolean;
};

type ForecastTab = "overview" | "synthesis" | "vs" | "accuracy";

const tabOptions: Array<{ id: ForecastTab; label: string }> = [
  { id: "overview", label: "Vue d'ensemble" },
  { id: "synthesis", label: "Synthèse IA" },
  { id: "vs", label: "CRM vs IA" },
  { id: "accuracy", label: "Fiabilité" },
];

const SectionLabel = ({ children, icon: Icon }: { children: string; icon: LucideIcon }) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

export const ForecastView = ({
  orgId,
  owners,
  selectedAiProvider,
  selectedOwnerId,
  canViewTeamForecast = false,
}: ForecastViewProps) => {
  const defaultDates = useMemo(() => getPeriodBounds("currentMonth"), []);
  const [ownerId, setOwnerId] = useState(selectedOwnerId ?? "");
  const [periodMode, setPeriodMode] = useState<ForecastPeriodMode>("currentMonth");
  const [dateFrom, setDateFrom] = useState(defaultDates.dateFrom);
  const [dateTo, setDateTo] = useState(defaultDates.dateTo);
  const [overview, setOverview] = useState<ForecastOverviewResult | null>(null);
  const [activeTab, setActiveTab] = useState<ForecastTab>("overview");
  const [activeDealId, setActiveDealId] = useState<string | null>(null);
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
  const activeDeal = useMemo(
    () => openDeals.find((deal) => deal.hubspotDealId === activeDealId) ?? null,
    [activeDealId, openDeals],
  );

  useEffect(() => {
    if (openDeals.length === 0) {
      setActiveDealId(null);
      return;
    }

    if (!activeDealId || !openDeals.some((deal) => deal.hubspotDealId === activeDealId)) {
      setActiveDealId(openDeals[0]?.hubspotDealId ?? null);
    }
  }, [activeDealId, openDeals]);

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
        `Analyse complète terminée par lots de ${result.batchSize} : ${result.analyzedCount} deal(s) traité(s), ${result.reusedCount} réutilisé(s), ${result.failedCount} échec(s).`,
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
      setMessage(`Analyse complète relancée pour ${deal.dealName ?? deal.hubspotDealId}.`);
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
          ? `Synthèse IA générée : ${result.synthesis.deals.length} deal(s) classé(s).`
          : "Aucun deal ouvert analysé : lance d'abord l'analyse des deals ouverts.",
      );
    } catch (synthesisError) {
      setError(synthesisError instanceof Error ? synthesisError.message : "Erreur inconnue pendant la synthèse forecast.");
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

    return isTechnicalOwnerFallback(deal.ownerName) ? "Non assigné" : deal.ownerName ?? "Non assigné";
  };

  const confidenceDegrees = (overview?.confidenceScore ?? 0) * 3.6;
  const visibleTabs = tabOptions.filter((tab) => tab.id !== "accuracy" || canViewTeamForecast);

  return (
    <div className="jv-forecast-page" aria-label="Forecast IA">
      <header className="jv-page-header">
        <ChartNoAxesCombined aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
        <h1>
          Forecast
          <span className="jv-page-kicker">IA</span>
        </h1>
      </header>

      <div className="jv-toolbar">
        <ForecastFilters
          canViewTeamForecast={canViewTeamForecast}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={handleDateFromChange}
          onDateToChange={handleDateToChange}
          onOwnerIdChange={setOwnerId}
          onPeriodChange={setPeriod}
          ownerId={ownerId}
          owners={owners}
          periodMode={periodMode}
        />
        <div className="jv-toolbar-actions">
          <span className="jv-toolbar-meta">
            Dernière MAJ IA : {overview?.lastAnalyzedAt ? formatDateTime(overview.lastAnalyzedAt) : "aucune analyse"}
          </span>
          <button
            className="jv-btn-ghost"
            disabled={isAnalyzing || openDeals.length === 0}
            onClick={() => void handleAnalyze(true)}
            type="button"
          >
            Recalculer
          </button>
          <button
            className="jv-btn-primary"
            disabled={isAnalyzing || openDeals.length === 0}
            onClick={() => void handleAnalyze(false)}
            type="button"
          >
            {isAnalyzing ? (
              <>
                <RefreshCw aria-hidden="true" className="jv-spin" size={14} strokeWidth={1.5} />
                Analyse…
              </>
            ) : (
              <>
                <Sparkles aria-hidden="true" size={14} strokeWidth={1.5} />
                Analyser les deals ouverts
              </>
            )}
          </button>
        </div>
      </div>

      <div aria-label="Sections forecast" className="jv-section-tabs jv-filter-pills" role="group">
        {visibleTabs.map((tab) => (
          <button
            className={activeTab === tab.id ? "active" : ""}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {forecastJob ? (
        <ForecastJobProgress
          forecastJob={forecastJob}
          logsOpen={logsOpen}
          onToggleLogs={() => setLogsOpen((isOpen) => !isOpen)}
        />
      ) : null}

      {error ? <p className="jv-banner jv-banner-error">{error}</p> : null}
      {message ? <p className="jv-banner jv-banner-success">{message}</p> : null}

      {activeTab === "overview" ? (
        <>
          <ForecastKpiCards
            analyzedRatio={analyzedRatio}
            dateFrom={dateFrom}
            dateTo={dateTo}
            forecastShare={forecastShare}
            gapToFill={gapToFill}
            landingAmount={landingAmount}
            objectiveAmount={objectiveAmount}
            overview={overview}
            trendClassName={trend.className}
          />

          <section aria-label="Confiance forecast" className="jv-score-banner">
            <div
              className="jv-score-ring"
              style={{
                background: `conic-gradient(var(--jv-terra) ${confidenceDegrees}deg, #ece9e3 0)`,
              }}
            >
              <span>{overview ? `${overview.confidenceScore}%` : "—"}</span>
            </div>
            <div className="jv-score-copy">
              <strong>Atterrissage forecast</strong>
              <p>
                {overview
                  ? `${formatAmount(overview.signedAmount)} déjà signé + ${formatAmount(overview.openForecastAmount)} de forecast ouvert = ${formatAmount(landingAmount)} prévus sur la période.`
                  : "Chargement du forecast IA depuis Supabase."}
              </p>
              {overview && overview.missingAnalysisCount > 0 ? (
                <small>{overview.missingAnalysisCount} deal(s) ouverts doivent encore être analysés par l&apos;IA.</small>
              ) : null}
              {overview && overview.signedDealCount > 0 ? (
                <small>{overview.signedDealCount} deal(s) signé(s) intégré(s) à 100%.</small>
              ) : null}
              {overview && (overview.reliability ?? []).length > 0 ? (
                <div className="jv-reliability">
                  {overview.reliability.map((item) => (
                    <div key={item.id}>
                      <span>{item.label}</span>
                      <span className="jv-meter">
                        <i style={{ "--value": `${item.score}%`, width: `${item.score}%` } as CSSProperties} />
                      </span>
                      <strong>{item.score}%</strong>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <span className="jv-score-badge">
              <Sparkles aria-hidden="true" size={11} strokeWidth={1.5} />
              IA
            </span>
          </section>

          <ForecastInsightPanels overview={overview} />

          <section className="jv-workspace">
            <OpenDealsTable
              activeDealId={activeDealId}
              getOwnerDisplayName={getOwnerDisplayName}
              isLoading={isLoading}
              onDealSelect={setActiveDealId}
              openDeals={openDeals}
            />
            <ForecastDealDetail
              analyzingDealId={analyzingDealId}
              deal={activeDeal}
              getOwnerDisplayName={getOwnerDisplayName}
              isAnalyzing={isAnalyzing}
              mode="overview"
              onAnalyzeDeal={(deal) => void handleAnalyzeDeal(deal)}
            />
          </section>

          <section className="jv-panel-grid">
            <article className="jv-theme-block chart-block">
              <div className="jv-theme-block-head">
                <SectionLabel icon={BarChart3}>Projection mois par mois</SectionLabel>
                <span>{overview ? `${overview.monthlyProjection.length} mois` : "—"}</span>
              </div>
              {projection.length > 0 ? (
                <ProjectionChart
                  objectiveLabel={objectiveAmount === null ? "non défini" : formatAmount(objectiveAmount)}
                  points={projection}
                />
              ) : (
                <p className="jv-theme-empty">
                  {isLoading ? "Chargement Supabase…" : "Aucun deal forecastable sur cette période."}
                </p>
              )}
            </article>

            <article className="jv-theme-block">
              <SectionLabel icon={TrendingUp}>Scénarios</SectionLabel>
              <div className="jv-scenarios">
                {(overview?.scenarios ?? []).map((scenario) => (
                  <div className={getScenarioClassName(scenario.id)} key={scenario.id}>
                    <span>{scenario.label}</span>
                    <strong>{formatAmount(scenario.amount)}</strong>
                    <small>Probabilité {scenario.probability}%</small>
                  </div>
                ))}
              </div>
            </article>
          </section>

          {projection.length > 0 ? <MonthlyProjectionCards months={overview?.monthlyProjection ?? []} /> : null}

          <SignedDealsTable getOwnerDisplayName={getOwnerDisplayName} isLoading={isLoading} signedDeals={signedDeals} />
        </>
      ) : activeTab === "accuracy" ? (
        <ForecastAccuracyPanel />
      ) : activeTab === "synthesis" ? (
        <>
          <section className="jv-score-banner">
            <div className="jv-score-ring" style={{ background: "conic-gradient(var(--jv-terra) 280deg, #ece9e3 0)" }}>
              <span>
                <Sparkles aria-hidden="true" size={16} strokeWidth={1.5} />
              </span>
            </div>
            <div className="jv-score-copy">
              <strong>Synthèse IA du portefeuille</strong>
              <p>
                {synthesis
                  ? synthesis.headline
                  : "L'IA classe vos deals ouverts (commit / best case / à risque / slipping) et propose un plan pour atteindre l'objectif."}
              </p>
              {synthesis ? (
                <small>
                  {getConfidenceLabel(synthesis.confidence)} · {synthesis.analyzedDealCount} deal(s) analysé(s) · l&apos;IA
                  estime closer {formatAmount(synthesis.projectedCloseAmount)}
                  {synthesis.status === "stale" ? " · synthèse à régénérer (deals modifiés)" : ""}
                </small>
              ) : overview && overview.analyzedDealCount === 0 ? (
                <small>Lancez d&apos;abord « Analyser les deals ouverts » pour nourrir la synthèse IA.</small>
              ) : null}
            </div>
            <button
              className="jv-btn-primary"
              disabled={isGeneratingSynthesis}
              onClick={() => void handleGenerateSynthesis()}
              type="button"
            >
              {isGeneratingSynthesis ? "Synthèse…" : synthesis ? "Régénérer la synthèse" : "Générer la synthèse IA"}
            </button>
          </section>

          {synthesis ? (
            <SynthesisPanel synthesis={synthesis} />
          ) : (
            <p className="jv-theme-empty jv-list-empty">
              {isGeneratingSynthesis
                ? "Génération de la synthèse IA…"
                : isLoading
                  ? "Chargement Supabase…"
                  : "Aucune synthèse IA pour cette période. Générez-la à partir des deals ouverts analysés."}
            </p>
          )}
        </>
      ) : (
        <>
          <section className="jv-score-banner">
            <div className="jv-score-ring" style={{ background: "conic-gradient(var(--jv-outbound) 300deg, #ece9e3 0)" }}>
              <span>VS</span>
            </div>
            <div className="jv-score-copy">
              <strong>CRM vs IA</strong>
              <p>
                {overview
                  ? `Comparez le pourcentage de closing renseigné dans le CRM avec la probabilité calculée par l'IA sur les ${overview.openDealCount} deals ouverts.`
                  : "Chargement des deals ouverts depuis Supabase."}
              </p>
              {overview && overview.missingAnalysisCount > 0 ? (
                <small>{overview.missingAnalysisCount} deal(s) ouverts doivent encore être analysés par l&apos;IA.</small>
              ) : null}
            </div>
            <button className="jv-btn-primary" disabled={isAnalyzing} onClick={() => void handleAnalyze(true)} type="button">
              Recalculer les deals ouverts
            </button>
          </section>

          <section className="jv-workspace">
            <VsDealsTable
              activeDealId={activeDealId}
              getOwnerDisplayName={getOwnerDisplayName}
              isLoading={isLoading}
              onDealSelect={setActiveDealId}
              openDeals={openDeals}
            />
            <ForecastDealDetail
              analyzingDealId={analyzingDealId}
              deal={activeDeal}
              getOwnerDisplayName={getOwnerDisplayName}
              isAnalyzing={isAnalyzing}
              mode="vs"
              onAnalyzeDeal={(deal) => void handleAnalyzeDeal(deal)}
            />
          </section>
        </>
      )}
    </div>
  );
};