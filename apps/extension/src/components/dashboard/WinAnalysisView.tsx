import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignLeft,
  BarChart3,
  ChevronRight,
  History,
  Lightbulb,
  ListChecks,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import {
  fetchWinAnalysisDealDetail,
  fetchWinAnalysisOverview,
  fetchWinAnalysisRun,
  startWinAnalysisRun,
  type CloseWonDealAnalysis,
  type WinAnalysisDealListItem,
  type WinAnalysisOverview,
  type WinAnalysisRun,
} from "../../services/api";
import { formatAmount, formatDate } from "../../utils/dashboard/formatters";
import "../styles/win-analysis.css";

type WinAnalysisViewProps = {
  orgId: string;
};

const RUN_POLL_INTERVAL_MS = 2_500;

const priorityLabels: Record<"low" | "medium" | "high", string> = {
  low: "Faible",
  medium: "Moyenne",
  high: "Haute",
};

const confidenceLabels: Record<"low" | "medium" | "high", string> = {
  low: "faible",
  medium: "moyenne",
  high: "élevée",
};

const SectionLabel = ({ children, icon: Icon }: { children: string; icon: LucideIcon }) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

const RunProgress = ({ run }: { run: WinAnalysisRun }) => (
  <section aria-live="polite" className="jv-run-progress">
    <div className="jv-run-progress-head">
      <span>{run.currentStep}</span>
      <strong>{run.progress}%</strong>
    </div>
    <span className="jv-run-progress-bar">
      <span style={{ width: `${run.progress}%` }} />
    </span>
    <small>
      {run.analyzedCount} analysé(s), {run.reusedCount} cache(s), {run.failedCount} erreur(s)
    </small>
  </section>
);

const WinningPatterns = ({ overview }: { overview: WinAnalysisOverview | null }) => {
  const patterns = overview?.portfolio?.winningPatterns ?? [];
  const sequence = overview?.portfolio?.idealSequence ?? [];

  return (
    <div className="jv-theme-block">
      <SectionLabel icon={TrendingUp}>Patterns gagnants</SectionLabel>
      {patterns.length > 0 ? (
        <div className="jv-win-pattern-list">
          {patterns.slice(0, 5).map((pattern, index) => (
            <div className="jv-win-pattern-item" key={pattern}>
              <em>{String(index + 1).padStart(2, "0")}</em>
              <span>{pattern}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="jv-theme-empty">Aucun pattern détecté. Lancez une analyse globale.</p>
      )}
      {sequence.length > 0 ? (
        <>
          <SectionLabel icon={ListChecks}>Séquence gagnante type</SectionLabel>
          <ol className="jv-win-sequence-list">
            {sequence.slice(0, 5).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </>
      ) : null}
    </div>
  );
};

const WinRecommendations = ({ overview }: { overview: WinAnalysisOverview | null }) => {
  const portfolio = overview?.portfolio;
  const recommendations = portfolio?.recommendations ?? [];

  return (
    <div className="jv-theme-block">
      <SectionLabel icon={Lightbulb}>Recommandations</SectionLabel>

      {portfolio ? (
        <div className="jv-theme-insight">
          <div className="jv-theme-insight-head">
            <span className="jv-theme-insight-label">
              <Sparkles aria-hidden="true" size={11} strokeWidth={1.5} />
              Insight clé
            </span>
            <em>Confiance {confidenceLabels[portfolio.confidence]}</em>
          </div>
          <p className="jv-prose">{portfolio.keyInsight}</p>
          <small>{portfolio.executiveSummary}</small>
        </div>
      ) : (
        <p className="jv-theme-empty">Lancez une analyse globale pour générer des recommandations.</p>
      )}

      {recommendations.length > 0 ? (
        <div className="jv-recommendation-list">
          {recommendations.slice(0, 5).map((recommendation) => (
            <div className="jv-recommendation-item" key={recommendation.title}>
              <div className="jv-recommendation-item-head">
                <strong>{recommendation.title}</strong>
                <span>{priorityLabels[recommendation.priority]}</span>
              </div>
              <small>{recommendation.rationale}</small>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const BenchmarkPanel = ({
  benchmark,
}: {
  benchmark: WinAnalysisOverview["benchmarks"][number] | null;
}) => (
  <div className="jv-theme-block">
    <div className="jv-theme-block-head">
      <SectionLabel icon={BarChart3}>Benchmark quantitatif</SectionLabel>
      {benchmark ? (
        <span>
          {benchmark.sampleSize} wins · {benchmark.dateFrom} → {benchmark.dateTo}
        </span>
      ) : null}
    </div>
    {benchmark ? (
      <div className="jv-win-benchmark-grid">
        <div>
          <span>Cycle moyen</span>
          <strong>{benchmark.metrics.avgCycleDays ?? "n/a"} j</strong>
        </div>
        <div>
          <span>Panier médian</span>
          <strong>
            {benchmark.metrics.medianAmount !== null ? formatAmount(benchmark.metrics.medianAmount) : "n/a"}
          </strong>
        </div>
        <div>
          <span>Appels moyens</span>
          <strong>{benchmark.metrics.avgCalls ?? "n/a"}</strong>
        </div>
        <div>
          <span>Emails moyens</span>
          <strong>{benchmark.metrics.avgEmails ?? "n/a"}</strong>
        </div>
        <div>
          <span>Touchpoints</span>
          <strong>{benchmark.metrics.avgTouchpoints ?? "n/a"}</strong>
        </div>
      </div>
    ) : (
      <p className="jv-theme-empty">Benchmark indisponible sur cette période.</p>
    )}
  </div>
);

const WinFactorsPanel = ({ overview }: { overview: WinAnalysisOverview | null }) => {
  const factors = overview?.winFactors ?? [];

  return (
    <div className="jv-theme-block">
      <SectionLabel icon={TrendingUp}>Facteurs de victoire</SectionLabel>
      {factors.length > 0 ? (
        <div className="jv-factor-list">
          {factors.map((factor) => (
            <div className="jv-factor-item" key={factor.id}>
              <div className="jv-factor-item-head">
                <strong>{factor.label}</strong>
                <em>{factor.share}%</em>
              </div>
              <div className="jv-factor-bar">
                <span style={{ width: `${Math.max(8, factor.share)}%` }} />
              </div>
              <small>
                {factor.dealCount} deal{factor.dealCount > 1 ? "s" : ""} · {formatAmount(factor.wonValue)}
              </small>
            </div>
          ))}
        </div>
      ) : (
        <p className="jv-theme-empty">Aucun facteur agrégé sur cette période.</p>
      )}
    </div>
  );
};

const DealMeta = ({ deal }: { deal: WinAnalysisDealListItem }) => (
  <span className="jv-item-meta">
    <span>{deal.ownerName ?? "Owner inconnu"}</span>
    <span className={deal.analyzed ? "jv-meta-ok" : "jv-meta-pending"}>
      {deal.analyzed ? "Analysé" : "À analyser"}
    </span>
    {deal.primaryWinFactor ? <span>{deal.primaryWinFactor}</span> : null}
  </span>
);

const DealList = ({
  activeDealId,
  deals,
  isLoading,
  onDealSelect,
}: {
  activeDealId: string | null;
  deals: WinAnalysisDealListItem[];
  isLoading: boolean;
  onDealSelect: (hubspotDealId: string) => void;
}) => (
  <section aria-busy={isLoading} aria-label="Deals gagnés" className="jv-list-shell">
    <header className="jv-list-head">
      <SectionLabel icon={History}>Deals gagnés</SectionLabel>
      <span className="jv-list-count">
        {deals.length} résultat{deals.length > 1 ? "s" : ""}
      </span>
    </header>
    <div className="jv-list-body">
      {isLoading && deals.length === 0 ? <p className="jv-list-empty">Chargement des deals…</p> : null}
      {!isLoading && deals.length === 0 ? (
        <p className="jv-list-empty">Aucun deal gagné sur les 12 derniers mois.</p>
      ) : null}
      {deals.map((deal) => (
        <button
          className={activeDealId === deal.hubspotDealId ? "jv-list-item selected" : "jv-list-item"}
          key={deal.hubspotDealId}
          onClick={() => onDealSelect(deal.hubspotDealId)}
          type="button"
        >
          <span className="jv-list-main">
            <strong>{deal.companyName}</strong>
            <small>{deal.dealName ?? deal.hubspotDealId}</small>
            <DealMeta deal={deal} />
          </span>
          <span className="jv-list-side">
            <time>{deal.closedAt ? formatDate(deal.closedAt) : "Sans date"}</time>
            <em>{formatAmount(deal.amount)}</em>
            <ChevronRight aria-hidden="true" size={14} strokeWidth={1.5} />
          </span>
        </button>
      ))}
    </div>
  </section>
);

const DetailSection = ({ children, icon, label }: { children: React.ReactNode; icon: LucideIcon; label: string }) => (
  <section className="jv-detail-section">
    <SectionLabel icon={icon}>{label}</SectionLabel>
    {children}
  </section>
);

const DealDeepDive = ({
  analysis,
  deal,
  error,
  isLoading,
}: {
  analysis: CloseWonDealAnalysis | null;
  deal: WinAnalysisDealListItem | null;
  error: string | null;
  isLoading: boolean;
}) => {
  if (!deal && !isLoading) {
    return (
      <aside className="jv-detail">
        <div className="jv-detail-empty">
          <Trophy aria-hidden="true" size={20} strokeWidth={1.25} />
          <strong>Sélectionnez un deal</strong>
          <p>Analyse IA des facteurs de victoire, moments clés et tactiques réplicables.</p>
        </div>
      </aside>
    );
  }

  const subtitle = deal
    ? [deal.dealName, deal.ownerName, deal.closedAt ? formatDate(deal.closedAt) : null].filter(Boolean).join(" · ")
    : "";

  return (
    <aside aria-busy={isLoading} className="jv-detail">
      <header className="jv-detail-head">
        <div>
          <h2>{deal?.companyName ?? "Chargement…"}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </header>

      {isLoading ? <p className="jv-detail-loading">Chargement du deal…</p> : null}
      {error ? <p className="jv-banner jv-banner-error">{error}</p> : null}

      {deal ? (
        <>
          <dl className="jv-detail-facts">
            <div>
              <dt>Valeur gagnée</dt>
              <dd>{formatAmount(deal.amount)}</dd>
            </div>
            <div>
              <dt>Date gagnée</dt>
              <dd>{deal.closedAt ? formatDate(deal.closedAt) : "n/a"}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{deal.ownerName ?? "Inconnu"}</dd>
            </div>
            <div>
              <dt>Statut analyse</dt>
              <dd className={deal.analyzed ? "jv-meta-ok" : "jv-meta-pending"}>
                {deal.analyzed ? "Analysé" : "À analyser"}
              </dd>
            </div>
          </dl>

          {analysis ? (
            <>
              <DetailSection icon={AlignLeft} label="Résumé victoire IA">
                <p className="jv-prose">{analysis.summary}</p>
                <ul className="jv-bullet-list">
                  <li>Facteur principal : {analysis.primaryWinFactor}</li>
                  <li>
                    Confiance :{" "}
                    <span className="jv-meta-score">{confidenceLabels[analysis.confidence]}</span>
                  </li>
                </ul>
              </DetailSection>

              <DetailSection icon={TrendingUp} label="Moments clés">
                {analysis.keyMoments.map((moment) => (
                  <div className="jv-moment-item" key={`${moment.moment}-${moment.stage ?? ""}`}>
                    <strong>
                      {moment.moment}
                      {moment.stage ? ` (${moment.stage})` : ""}
                    </strong>
                    <span>{moment.impact}</span>
                  </div>
                ))}
              </DetailSection>

              <DetailSection icon={ListChecks} label="Tactiques réplicables">
                {analysis.replicablePlays.map((play) => (
                  <div className="jv-action-item" key={play.play}>
                    <div className="jv-action-item-head">
                      <strong>{play.when}</strong>
                    </div>
                    <small>{play.play}</small>
                  </div>
                ))}
              </DetailSection>
            </>
          ) : (
            <div className="jv-callout">
              <Sparkles aria-hidden="true" size={16} strokeWidth={1.5} />
              <div>
                <p>Ce deal n&apos;a pas encore été analysé.</p>
                <small>Lancez l&apos;analyse globale pour générer le deep dive et les tactiques réplicables.</small>
              </div>
            </div>
          )}
        </>
      ) : null}
    </aside>
  );
};

export const WinAnalysisView = ({ orgId }: WinAnalysisViewProps) => {
  const [overview, setOverview] = useState<WinAnalysisOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<WinAnalysisRun | null>(null);
  const [activeDealId, setActiveDealId] = useState<string | null>(null);
  const [detailDeal, setDetailDeal] = useState<WinAnalysisDealListItem | null>(null);
  const [detailAnalysis, setDetailAnalysis] = useState<CloseWonDealAnalysis | null>(null);
  const [isLoadingDeal, setIsLoadingDeal] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const pollTimeoutRef = useRef<number | null>(null);

  const sortedDeals = useMemo(
    () => [...(overview?.deals ?? [])].sort((left, right) => right.amount - left.amount),
    [overview?.deals],
  );

  const allBenchmark = overview?.benchmarks.find((benchmark) => benchmark.segment === "all") ?? null;

  const loadOverview = useCallback(
    (forceRefresh = false, signal?: AbortSignal) => {
      setIsLoading(true);
      setError(null);

      fetchWinAnalysisOverview(orgId, { forceRefresh, signal })
        .then((result) => {
          setOverview(result);
          setActiveDealId((current) => current ?? result.deals[0]?.hubspotDealId ?? null);
          setIsLoading(false);
        })
        .catch((fetchError: unknown) => {
          if (fetchError instanceof DOMException && fetchError.name === "AbortError") {
            return;
          }

          setError(fetchError instanceof Error ? fetchError.message : "Impossible de charger la win analysis.");
          setIsLoading(false);
        });
    },
    [orgId],
  );

  useEffect(() => {
    const abortController = new AbortController();

    loadOverview(false, abortController.signal);

    return () => abortController.abort();
  }, [loadOverview]);

  useEffect(
    () => () => {
      if (pollTimeoutRef.current !== null) {
        window.clearTimeout(pollTimeoutRef.current);
      }
    },
    [],
  );

  const pollRun = useCallback(
    (runId: string) => {
      fetchWinAnalysisRun(runId)
        .then((snapshot) => {
          setRun(snapshot);

          if (snapshot.status === "completed" || snapshot.status === "failed") {
            loadOverview(true);
            return;
          }

          pollTimeoutRef.current = window.setTimeout(() => pollRun(runId), RUN_POLL_INTERVAL_MS);
        })
        .catch(() => {
          pollTimeoutRef.current = window.setTimeout(() => pollRun(runId), RUN_POLL_INTERVAL_MS * 2);
        });
    },
    [loadOverview],
  );

  useEffect(() => {
    if (!activeDealId) {
      setDetailDeal(null);
      setDetailAnalysis(null);
      return;
    }

    let cancelled = false;

    const loadDetail = async () => {
      try {
        setIsLoadingDeal(true);
        setDetailError(null);
        const detail = await fetchWinAnalysisDealDetail(orgId, activeDealId);

        if (!cancelled) {
          setDetailDeal(detail.deal);
          setDetailAnalysis(detail.analysis);
        }
      } catch (fetchError: unknown) {
        if (!cancelled) {
          setDetailError(fetchError instanceof Error ? fetchError.message : "Détail win analysis indisponible.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingDeal(false);
        }
      }
    };

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [activeDealId, orgId]);

  const handleStartRun = (): void => {
    setError(null);

    startWinAnalysisRun(orgId)
      .then((snapshot) => {
        setRun(snapshot);
        pollRun(snapshot.id);
      })
      .catch((runError: unknown) => {
        setError(runError instanceof Error ? runError.message : "Impossible de lancer l'analyse des wins.");
      });
  };

  const isRunInProgress = run !== null && (run.status === "queued" || run.status === "running");
  const periodLabel = overview
    ? `${overview.wonDealCount} deal${overview.wonDealCount > 1 ? "s" : ""} gagné${overview.wonDealCount > 1 ? "s" : ""} · ${overview.dateFrom} → ${overview.dateTo}`
    : "Patterns de victoire des deals gagnés";

  return (
    <div className="jv-win-page" aria-label="Win analysis">
      <header className="jv-page-header">
        <Trophy aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
        <h1>
          Win Analysis
          <span className="jv-page-kicker">analyse</span>
        </h1>
      </header>

      <div className="jv-toolbar">
        <span className="jv-toolbar-period">{periodLabel}</span>
        <div className="jv-toolbar-actions">
          <button className="jv-btn-ghost" disabled={isLoading} onClick={() => loadOverview(true)} type="button">
            <RefreshCw aria-hidden="true" size={14} strokeWidth={1.5} />
            Actualiser
          </button>
          <button className="jv-btn-primary" disabled={isRunInProgress} onClick={handleStartRun} type="button">
            {isRunInProgress ? (
              <RefreshCw aria-hidden="true" className="jv-spin" size={14} strokeWidth={1.5} />
            ) : (
              <Sparkles aria-hidden="true" size={14} strokeWidth={1.5} />
            )}
            {isRunInProgress ? "Analyse en cours…" : "Analyser (30 max)"}
          </button>
        </div>
      </div>

      {error ? <p className="jv-banner jv-banner-error">{error}</p> : null}
      {run?.status === "failed" ? (
        <p className="jv-banner jv-banner-error">{run.error ?? "Le run a échoué."}</p>
      ) : null}

      {run && isRunInProgress ? <RunProgress run={run} /> : null}

      {isLoading && !overview ? <p className="jv-list-empty">Chargement des deals gagnés…</p> : null}

      {overview ? (
        <>
          <section aria-label="Indicateurs win analysis" className="jv-stat-strip">
            <div className="jv-stat" style={{ animationDelay: "0ms" }}>
              <span className="jv-stat-label">Deals gagnés</span>
              <span className="jv-stat-value">{overview.wonDealCount}</span>
              <small className="jv-stat-caption">
                {overview.needsAnalysisCount} à analyser
              </small>
            </div>
            <div className="jv-stat" style={{ animationDelay: "60ms" }}>
              <span className="jv-stat-label">Valeur gagnée</span>
              <span className="jv-stat-value">{formatAmount(overview.wonValue)}</span>
              <small className="jv-stat-caption">panier moyen {formatAmount(overview.averageWin)}</small>
            </div>
            <div className="jv-stat" style={{ animationDelay: "120ms" }}>
              <span className="jv-stat-label">Analyses IA</span>
              <span className="jv-stat-value">{overview.analyzedCount}</span>
              <small className="jv-stat-caption">
                {overview.needsAnalysisCount} restante{overview.needsAnalysisCount > 1 ? "s" : ""}
              </small>
            </div>
            <div className="jv-stat" style={{ animationDelay: "180ms" }}>
              <span className="jv-stat-label">Benchmark wins</span>
              <span className="jv-stat-value">{allBenchmark ? allBenchmark.sampleSize : "n/a"}</span>
              <small
                className={`jv-stat-caption ${
                  allBenchmark && allBenchmark.sampleSize < 10 ? "" : "up"
                }`}
              >
                {allBenchmark && allBenchmark.sampleSize < 10
                  ? "échantillon trop faible"
                  : "alimente le scoring queue"}
              </small>
            </div>
          </section>

          <section aria-label="Patterns et recommandations" className="jv-themes-row">
            <WinningPatterns overview={overview} />
            <WinRecommendations overview={overview} />
          </section>

          <section aria-label="Benchmark et facteurs" className="jv-themes-row">
            <BenchmarkPanel benchmark={allBenchmark} />
            <WinFactorsPanel overview={overview} />
          </section>

          <div className="jv-workspace">
            <DealList
              activeDealId={activeDealId}
              deals={sortedDeals}
              isLoading={isLoading}
              onDealSelect={setActiveDealId}
            />
            <DealDeepDive
              analysis={detailAnalysis}
              deal={detailDeal}
              error={detailError}
              isLoading={isLoadingDeal}
            />
          </div>
        </>
      ) : null}
    </div>
  );
};