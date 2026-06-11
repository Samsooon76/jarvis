import { useEffect, useMemo, useState } from "react";
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
} from "../../services/api";
import { formatAmount, formatDateTime } from "../../utils/dashboard/formatters";
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
} from "../../utils/dashboard/forecast";
import { ForecastAccuracyPanel } from "./ForecastAccuracyPanel";
import { ForecastFilters } from "./forecast/ForecastFilters";
import { ForecastInsightPanels } from "./forecast/ForecastInsightPanels";
import { ForecastJobProgress } from "./forecast/ForecastJobProgress";
import { ForecastKpiCards } from "./forecast/ForecastKpiCards";
import { MonthlyProjectionCards } from "./forecast/MonthlyProjectionCards";
import { OpenDealsTable, SignedDealsTable, VsDealsTable } from "./forecast/ForecastDealTables";
import { ProjectionChart } from "./forecast/ProjectionChart";
import { SynthesisPanel } from "./forecast/SynthesisPanel";
import type { HubSpotOwnerOption } from "../../services/api";

type ForecastViewProps = {
  orgId: string;
  owners: HubSpotOwnerOption[];
  selectedAiProvider: AiProviderOption;
  selectedOwnerId?: string;
  /** Managers/admins can switch between the whole team and any individual sales rep. Sales reps stay locked to their own deals. */
  canViewTeamForecast?: boolean;
};

type ForecastTab = "overview" | "synthesis" | "vs" | "accuracy";

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
        <ForecastJobProgress
          forecastJob={forecastJob}
          logsOpen={logsOpen}
          onToggleLogs={() => setLogsOpen((isOpen) => !isOpen)}
        />
      ) : null}

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
        {canViewTeamForecast ? (
          <button className={activeTab === "accuracy" ? "active" : ""} onClick={() => setActiveTab("accuracy")} type="button">
            Fiabilite
          </button>
        ) : null}
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

          <ForecastKpiCards
            dateFrom={dateFrom}
            dateTo={dateTo}
            forecastShare={forecastShare}
            gapToFill={gapToFill}
            landingAmount={landingAmount}
            objectiveAmount={objectiveAmount}
            overview={overview}
            trendClassName={trend.className}
          />

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
            <MonthlyProjectionCards months={overview?.monthlyProjection ?? []} />
          ) : null}

          <ForecastInsightPanels analyzedRatio={analyzedRatio} overview={overview} />

          <SignedDealsTable getOwnerDisplayName={getOwnerDisplayName} isLoading={isLoading} signedDeals={signedDeals} />

          <OpenDealsTable
            analyzingDealId={analyzingDealId}
            getOwnerDisplayName={getOwnerDisplayName}
            isAnalyzing={isAnalyzing}
            isLoading={isLoading}
            onAnalyzeDeal={(deal) => void handleAnalyzeDeal(deal)}
            openDeals={openDeals}
          />
        </>
      ) : activeTab === "accuracy" ? (
        <ForecastAccuracyPanel />
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
            <SynthesisPanel synthesis={synthesis} />
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

          <VsDealsTable
            analyzingDealId={analyzingDealId}
            getOwnerDisplayName={getOwnerDisplayName}
            isAnalyzing={isAnalyzing}
            isLoading={isLoading}
            onAnalyzeDeal={(deal) => void handleAnalyzeDeal(deal)}
            openDeals={openDeals}
          />
        </>
      )}
    </section>
  );
};
