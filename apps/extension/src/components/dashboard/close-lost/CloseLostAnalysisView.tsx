import { useCallback, useEffect, useMemo, useState } from "react";
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
import { formatDateTime } from "../../../utils/dashboard/formatters";
import {
  CompactBreakdown,
  DealDeepDive,
  DealTable,
  FilterToolbar,
  KeyInsight,
  LossTreemap,
  MetricCard,
  Recommendations,
  SegmentTable,
  TopFactors,
  ValueTrendChart,
} from "./components";
import {
  buildBreakdownRows,
  buildMonthlyTrend,
  CLOSE_LOST_POLL_TIMEOUT_MS,
  getDateRangeLabel,
  getDealOwnerDisplayName,
  getDefaultDateRange,
  getKeyInsight,
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
  const [recommendationsPanel, setRecommendationsPanel] = useState<HTMLElement | null>(null);

  const salesAeOwnerIds = useMemo(() => salesAeOwners.map((owner) => owner.ownerId), [salesAeOwners]);
  const salesAeOwnerKey = salesAeOwnerIds.join(",");
  const ownersById = useMemo(
    () => new Map(owners.map((owner) => [owner.ownerId, owner])),
    [owners],
  );
  const resolvedOwnerId = scope === "owner" ? ownerId || selectedOwnerId || salesAeOwners[0]?.ownerId || null : null;
  const keyInsight = useMemo(() => getKeyInsight(overview), [overview]);
  const trendPoints = useMemo(() => buildMonthlyTrend(overview?.deals ?? []), [overview?.deals]);
  const segmentRows = useMemo(
    () => buildBreakdownRows(overview?.deals ?? [], (deal) => getDealOwnerDisplayName(deal, ownersById), "Owner non assigne"),
    [overview?.deals, ownersById],
  );
  const significantDeals = useMemo(
    () => [...(overview?.deals ?? [])].sort((left, right) => right.amount - left.amount),
    [overview?.deals],
  );

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
      setOverviewError(error instanceof Error ? error.message : "Close lost analysis indisponible.");
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
          setDetailError(error instanceof Error ? error.message : "Detail close lost indisponible.");
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
          throw new Error("Delai d'attente depasse pendant l'analyse close-lost. Veuillez reessayer.");
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
    <section className="ae-close-lost-page" aria-label="Close lost analysis">
      <div className="ae-close-lost-titlebar">
        <div>
          <h2>Close lost analysis</h2>
          <p>Comprenez pourquoi vous perdez des deals et identifiez les leviers d'amelioration.</p>
        </div>
        <span>Derniere mise a jour : {overview?.generatedAt ? formatDateTime(overview.generatedAt) : getDateRangeLabel(dateFrom, dateTo)}</span>
      </div>

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

      {overviewError ? <p className="ae-detail-error">{overviewError}</p> : null}

      {activeRun ? (
        <section className="ae-close-lost-run" aria-live="polite">
          <div>
            <span>{activeRun.currentStep}</span>
            <strong>{activeRun.progress}%</strong>
          </div>
          <i>
            <span style={{ width: `${activeRun.progress}%` }} />
          </i>
          <small>
            {activeRun.analyzedCount} analyse(s), {activeRun.reusedCount} cache(s), {activeRun.failedCount} erreur(s)
          </small>
        </section>
      ) : null}

      <KeyInsight
        detail={keyInsight.detail}
        onRecommendationsClick={() => recommendationsPanel?.scrollIntoView({ behavior: "smooth", block: "center" })}
        title={keyInsight.title}
      />

      <section className="ae-close-lost-metrics">
        {(overview?.metrics ?? []).map((metric) => (
          <MetricCard key={metric.id} metric={metric} />
        ))}
      </section>

      <section className="ae-close-lost-top-grid">
        <LossTreemap rows={overview?.lossReasons ?? []} />
        <ValueTrendChart points={trendPoints} />
      </section>

      <section className="ae-close-lost-middle-grid">
        <SegmentTable rows={segmentRows} />
        <TopFactors overview={overview} />
        <Recommendations overview={overview} panelRef={setRecommendationsPanel} />
      </section>

      <section className="ae-close-lost-bottom-grid">
        <DealTable activeDealId={activeDealId} deals={significantDeals} onDealSelect={(hubspotDealId) => setActiveDealId(hubspotDealId)} />
        <CompactBreakdown rows={overview?.competitors ?? []} title="Patterns competitifs recurrents" />
        <CompactBreakdown rows={overview?.stageBreakdown ?? []} title="Repartition des pertes par etape" />
      </section>

      <section className="ae-close-lost-workspace">
        <DealDeepDive
          detail={detail}
          error={detailError}
          isAnalyzing={dealAnalyzeLoading}
          isLoading={detailLoading}
          onAnalyze={handleAnalyzeDeal}
          ownersById={ownersById}
        />
      </section>
    </section>
  );
};
