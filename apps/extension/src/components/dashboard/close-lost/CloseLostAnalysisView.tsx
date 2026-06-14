import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleX } from "lucide-react";
import {
  analyzeCloseLostDeal,
  fetchCloseLostAnalysisRun,
  fetchCloseLostDealDetail,
  fetchCloseLostOverview,
  startCloseLostAnalysisRun,
  type CloseLostAnalysisRun,
  type CloseLostDealDetailResult,
  type CloseLostOverviewResult,
  type CloseLostScope,
} from "../../../services/api";
import "../../styles/close-lost.css";
import {
  CompactBreakdown,
  DealDeepDive,
  DealList,
  FilterToolbar,
  LossTreemap,
  Recommendations,
  RunProgress,
  TopFactors,
  ValueTrendChart,
} from "./components";
import {
  buildMonthlyTrend,
  CLOSE_LOST_POLL_TIMEOUT_MS,
  formatMetricValue,
  getDefaultDateRange,
  getMetricTone,
  getSalesAeOwners,
  type CloseLostAnalysisViewProps,
  wait,
} from "./utils";

export const CloseLostAnalysisView = ({
  orgId,
  owners,
  selectedAiProvider,
  selectedOwnerId,
}: CloseLostAnalysisViewProps) => {
  const defaultDates = useMemo(getDefaultDateRange, []);
  const salesAeOwners = useMemo(() => getSalesAeOwners(owners), [owners]);
  const [scope, setScope] = useState<CloseLostScope>("sales_ae");
  const [ownerId, setOwnerId] = useState(selectedOwnerId ?? salesAeOwners[0]?.ownerId ?? owners[0]?.ownerId ?? "");
  const [dateFrom, setDateFrom] = useState(defaultDates.dateFrom);
  const [dateTo, setDateTo] = useState(defaultDates.dateTo);
  const [overview, setOverview] = useState<CloseLostOverviewResult | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<CloseLostAnalysisRun | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [activeDealId, setActiveDealId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CloseLostDealDetailResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [dealAnalyzeLoading, setDealAnalyzeLoading] = useState(false);


  const salesAeOwnerIds = useMemo(() => salesAeOwners.map((owner) => owner.ownerId), [salesAeOwners]);
  const salesAeOwnerKey = salesAeOwnerIds.join(",");
  const ownersById = useMemo(
    () => new Map(owners.map((owner) => [owner.ownerId, owner])),
    [owners],
  );
  const resolvedOwnerId = scope === "owner" ? ownerId || selectedOwnerId || salesAeOwners[0]?.ownerId || null : null;
  const significantDeals = useMemo(
    () => [...(overview?.deals ?? [])].sort((left, right) => right.amount - left.amount),
    [overview?.deals],
  );
  const trendPoints = useMemo(() => buildMonthlyTrend(overview?.deals ?? []), [overview?.deals]);

  const loadOverview = useCallback(async (options: { forceRefresh?: boolean; silent?: boolean } = {}) => {
    try {
      if (!options.silent) {
        setOverviewLoading(true);
      }
      setOverviewError(null);
      const result = await fetchCloseLostOverview({
        orgId,
        scope,
        hubspotOwnerId: resolvedOwnerId,
        salesAeOwnerIds,
        dateFrom,
        dateTo,
        aiProvider: selectedAiProvider,
        forceRefresh: options.forceRefresh,
      });
      setOverview(result);
      setActiveDealId((current) => current ?? result.deals[0]?.hubspotDealId ?? null);

      const firstDealId = result.deals[0]?.hubspotDealId;

      if (firstDealId) {
        void fetchCloseLostDealDetail(orgId, firstDealId, selectedAiProvider).catch(() => undefined);
      }
    } catch (error) {
      setOverviewError(error instanceof Error ? error.message : "Analyse close lost indisponible.");
    } finally {
      if (!options.silent) {
        setOverviewLoading(false);
      }
    }
  }, [orgId, scope, resolvedOwnerId, salesAeOwnerIds, dateFrom, dateTo, selectedAiProvider.id, selectedAiProvider.model]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview, salesAeOwnerKey]);

  useEffect(() => {
    if (selectedOwnerId && !ownerId) {
      setOwnerId(selectedOwnerId);
    }
  }, [ownerId, selectedOwnerId]);

  useEffect(() => {
    if (!activeDealId) {
      setDetail(null);
      return;
    }

    let cancelled = false;

    const loadDetail = async () => {
      try {
        setDetailLoading(true);
        setDetailError(null);
        const result = await fetchCloseLostDealDetail(orgId, activeDealId, selectedAiProvider);

        if (!cancelled) {
          setDetail(result);
        }
      } catch (error) {
        if (!cancelled) {
          setDetailError(error instanceof Error ? error.message : "Détail close lost indisponible.");
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    };

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [activeDealId, orgId, selectedAiProvider.id, selectedAiProvider.model]);

  const handleStartRun = async () => {
    try {
      setRunLoading(true);
      setOverviewError(null);
      const startedRun = await startCloseLostAnalysisRun({
        orgId,
        scope,
        hubspotOwnerId: resolvedOwnerId,
        salesAeOwnerIds,
        dateFrom,
        dateTo,
        aiProvider: selectedAiProvider,
        refresh: false,
      });
      setActiveRun(startedRun);

      let currentRun = startedRun;
      let lastProcessedDealCount =
        startedRun.analyzedCount + startedRun.reusedCount + startedRun.failedCount;

      const deadline = Date.now() + CLOSE_LOST_POLL_TIMEOUT_MS;

      while (currentRun.status !== "completed" && currentRun.status !== "failed") {
        if (Date.now() > deadline) {
          throw new Error("Délai d'attente dépassé pendant l'analyse close-lost. Veuillez réessayer.");
        }
        await wait(1200);
        currentRun = await fetchCloseLostAnalysisRun(startedRun.id);
        setActiveRun(currentRun);

        const processedDealCount =
          currentRun.analyzedCount + currentRun.reusedCount + currentRun.failedCount;

        if (processedDealCount > lastProcessedDealCount) {
          lastProcessedDealCount = processedDealCount;
          await loadOverview({ forceRefresh: true, silent: true });
        }
      }

      if (currentRun.status === "failed") {
        throw new Error(currentRun.error ?? "Run close lost en erreur.");
      }

      await loadOverview({ forceRefresh: true });
    } catch (error) {
      setOverviewError(error instanceof Error ? error.message : "Impossible de lancer l'analyse close lost.");
    } finally {
      setRunLoading(false);
    }
  };

  const handleAnalyzeDeal = async () => {
    if (!activeDealId) {
      return;
    }

    try {
      setDealAnalyzeLoading(true);
      setDetailError(null);
      const result = await analyzeCloseLostDeal(orgId, activeDealId, selectedAiProvider, true);
      setDetail(result);
      await loadOverview({ forceRefresh: true });
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Impossible d'analyser ce deal close lost.");
    } finally {
      setDealAnalyzeLoading(false);
    }
  };

  return (
    <div className="jv-close-lost-page" aria-label="Close Lost">
      <header className="jv-page-header">
        <CircleX aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
        <h1>
          Close Lost
          <span className="jv-page-kicker">analyse</span>
        </h1>
      </header>

      <FilterToolbar
        dateFrom={dateFrom}
        dateTo={dateTo}
        isLoading={runLoading || overviewLoading}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onOwnerChange={setOwnerId}
        onRun={handleStartRun}
        onScopeChange={setScope}
        ownerId={ownerId}
        owners={owners}
        scope={scope}
      />

      {overviewError ? <p className="jv-banner jv-banner-error">{overviewError}</p> : null}

      {activeRun && (activeRun.status === "queued" || activeRun.status === "running") ? (
        <RunProgress
          analyzedCount={activeRun.analyzedCount}
          currentStep={activeRun.currentStep}
          failedCount={activeRun.failedCount}
          progress={activeRun.progress}
          reusedCount={activeRun.reusedCount}
        />
      ) : null}

      <section aria-label="Indicateurs close lost" className="jv-stat-strip">
        {(overview?.metrics ?? []).map((metric, index) => (
          <div className="jv-stat" key={metric.id} style={{ animationDelay: `${index * 60}ms` }}>
            <span className="jv-stat-label">{metric.label}</span>
            <span className="jv-stat-value">{formatMetricValue(metric)}</span>
            {metric.caption ? (
              <small className={`jv-stat-caption ${getMetricTone(metric)}`}>{metric.caption}</small>
            ) : null}
          </div>
        ))}
      </section>

      <section aria-label="Patterns et recommandations" className="jv-themes-row">
        <TopFactors overview={overview} />
        <Recommendations overview={overview} />
      </section>

      <section aria-label="Visualisations" className="jv-themes-row">
        <LossTreemap rows={overview?.lossReasons ?? []} />
        <ValueTrendChart points={trendPoints} />
      </section>

      <section aria-label="Répartitions" className="jv-themes-row">
        <CompactBreakdown rows={overview?.competitors ?? []} title="Patterns compétitifs" />
        <CompactBreakdown rows={overview?.stageBreakdown ?? []} title="Pertes par étape" />
      </section>

      <div className="jv-workspace">
        <DealList
          activeDealId={activeDealId}
          deals={significantDeals}
          isLoading={overviewLoading}
          onDealSelect={(hubspotDealId) => setActiveDealId(hubspotDealId)}
        />
        <DealDeepDive
          detail={detail}
          error={detailError}
          isAnalyzing={dealAnalyzeLoading}
          isLoading={detailLoading}
          onAnalyze={handleAnalyzeDeal}
          ownersById={ownersById}
        />
      </div>
    </div>
  );
};