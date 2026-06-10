import { useCallback, useEffect, useRef, useState } from "react";
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

type WinAnalysisViewProps = {
  orgId: string;
};

const RUN_POLL_INTERVAL_MS = 2_500;

const formatAmount = (value: number): string =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);

const formatDate = (value: string | null): string =>
  value
    ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value))
    : "n/a";

export const WinAnalysisView = ({ orgId }: WinAnalysisViewProps) => {
  const [overview, setOverview] = useState<WinAnalysisOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<WinAnalysisRun | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<{
    deal: WinAnalysisDealListItem;
    analysis: CloseWonDealAnalysis | null;
  } | null>(null);
  const [isLoadingDeal, setIsLoadingDeal] = useState(false);
  const pollTimeoutRef = useRef<number | null>(null);

  const loadOverview = useCallback(
    (forceRefresh = false, signal?: AbortSignal) => {
      setIsLoading(true);
      setError(null);

      fetchWinAnalysisOverview(orgId, { forceRefresh, signal })
        .then((result) => {
          setOverview(result);
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

  const openDeal = (deal: WinAnalysisDealListItem): void => {
    setIsLoadingDeal(true);
    setSelectedDeal({ deal, analysis: null });

    fetchWinAnalysisDealDetail(orgId, deal.hubspotDealId)
      .then((detail) => {
        setSelectedDeal({ deal: detail.deal, analysis: detail.analysis });
        setIsLoadingDeal(false);
      })
      .catch(() => {
        setIsLoadingDeal(false);
      });
  };

  const isRunInProgress = run !== null && (run.status === "queued" || run.status === "running");
  const allBenchmark = overview?.benchmarks.find((benchmark) => benchmark.segment === "all") ?? null;

  return (
    <section className="ae-view-panel ae-win-analysis-page" aria-label="Win analysis">
      <div className="ae-forecast-header">
        <span className="ae-forecast-last-update">
          {overview
            ? `${overview.wonDealCount} deal${overview.wonDealCount > 1 ? "s" : ""} gagne${overview.wonDealCount > 1 ? "s" : ""} sur 12 mois - ${overview.analyzedCount} analyse${overview.analyzedCount > 1 ? "s" : ""} IA`
            : "Patterns de victoire des deals gagnes"}
        </span>
        <div className="ae-forecast-header-meta">
          <button className="ae-forecast-link" disabled={isLoading} onClick={() => loadOverview(true)} type="button">
            Actualiser
          </button>
          <button className="ae-forecast-link" disabled={isRunInProgress} onClick={handleStartRun} type="button">
            {isRunInProgress ? "Analyse en cours..." : "Analyser les wins (30 max)"}
          </button>
        </div>
      </div>

      {run && isRunInProgress ? (
        <div className="ae-sync-progress" aria-live="polite">
          <div className="ae-sync-progress-head">
            <span>{run.currentStep}</span>
            <span>{run.progress}%</span>
          </div>
          <div className="ae-sync-progress-track">
            <i style={{ width: `${run.progress}%` }} />
          </div>
        </div>
      ) : null}
      {run?.status === "failed" ? <p className="ae-admin-feedback error">{run.error ?? "Le run a echoue."}</p> : null}
      {error ? <p className="ae-admin-feedback error">{error}</p> : null}
      {isLoading && !overview ? <p className="ae-empty">Chargement des deals gagnes...</p> : null}

      {overview ? (
        <>
          <section className="ae-forecast-kpis">
            <div>
              <small>Deals gagnes</small>
              <strong>{overview.wonDealCount}</strong>
              <small>{overview.needsAnalysisCount} a analyser</small>
            </div>
            <div>
              <small>Valeur gagnee</small>
              <strong>{formatAmount(overview.wonValue)}</strong>
              <small>panier moyen {formatAmount(overview.averageWin)}</small>
            </div>
            <div>
              <small>Benchmark wins</small>
              <strong>{allBenchmark ? `${allBenchmark.sampleSize} wins` : "n/a"}</strong>
              <small>
                {allBenchmark && allBenchmark.sampleSize < 10
                  ? "echantillon trop faible (scoring inactif)"
                  : "alimente le scoring queue"}
              </small>
            </div>
          </section>

          {overview.portfolio ? (
            <article className="ae-win-hero-card">
              <div className="ae-win-hero-label">
                <span>Insight IA</span>
                <strong>Portefeuille gagne</strong>
              </div>
              <div className="ae-win-hero-copy">
                <h3>{overview.portfolio.keyInsight}</h3>
                <p>{overview.portfolio.executiveSummary}</p>
                <small>Confiance {overview.portfolio.confidence} - attention au biais de survivant</small>
              </div>
            </article>
          ) : null}

          <section className="ae-win-playbook-grid">
            {overview.portfolio && overview.portfolio.winningPatterns.length > 0 ? (
              <article className="ae-forecast-panel ae-win-playbook-panel">
                <div className="ae-panel-heading">
                  <h4>Patterns de victoire</h4>
                </div>
                <div className="ae-win-pattern-grid">
                  {overview.portfolio.winningPatterns.map((pattern, index) => (
                    <div key={pattern} className="ae-win-pattern-card">
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <p>{pattern}</p>
                    </div>
                  ))}
                </div>
              </article>
            ) : null}

            {overview.portfolio && overview.portfolio.idealSequence.length > 0 ? (
              <article className="ae-forecast-panel ae-win-sequence-panel">
                <div className="ae-panel-heading">
                  <h4>Sequence gagnante type</h4>
                </div>
                <ol className="ae-win-sequence-list">
                  {overview.portfolio.idealSequence.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </article>
            ) : null}
          </section>

          <section className="ae-win-data-grid">
            {allBenchmark ? (
              <article className="ae-forecast-panel ae-win-benchmark-panel">
                <div className="ae-panel-heading">
                  <h4>Benchmark quantitatif (0 LLM)</h4>
                  <small>
                    {allBenchmark.sampleSize} wins, {allBenchmark.dateFrom} au {allBenchmark.dateTo}
                  </small>
                </div>
                <div className="ae-win-benchmark-grid">
                  <div>
                    <span>Cycle moyen</span>
                    <strong>{allBenchmark.metrics.avgCycleDays ?? "n/a"} j</strong>
                  </div>
                  <div>
                    <span>Panier median</span>
                    <strong>
                      {allBenchmark.metrics.medianAmount !== null ? formatAmount(allBenchmark.metrics.medianAmount) : "n/a"}
                    </strong>
                  </div>
                  <div>
                    <span>Appels moyens</span>
                    <strong>{allBenchmark.metrics.avgCalls ?? "n/a"}</strong>
                  </div>
                  <div>
                    <span>Emails moyens</span>
                    <strong>{allBenchmark.metrics.avgEmails ?? "n/a"}</strong>
                  </div>
                  <div>
                    <span>Touchpoints</span>
                    <strong>{allBenchmark.metrics.avgTouchpoints ?? "n/a"}</strong>
                  </div>
                </div>
              </article>
            ) : null}

            {overview.winFactors.length > 0 ? (
              <article className="ae-forecast-panel ae-win-factors-panel">
                <div className="ae-panel-heading">
                  <h4>Facteurs de victoire</h4>
                </div>
                <div className="ae-win-factor-list">
                  {overview.winFactors.map((factor) => (
                    <div key={factor.id} className="ae-win-factor-row">
                      <div>
                        <strong>{factor.label}</strong>
                        <span>
                          {factor.dealCount} deal{factor.dealCount > 1 ? "s" : ""} - {formatAmount(factor.wonValue)}
                        </span>
                      </div>
                      <div className="ae-win-factor-meter" aria-label={`${factor.share}%`}>
                        <i style={{ width: `${factor.share}%` }} />
                      </div>
                      <em>{factor.share}%</em>
                    </div>
                  ))}
                </div>
              </article>
            ) : null}
          </section>

          <article className="ae-forecast-panel">
            <div className="ae-panel-heading">
              <h4>Deals gagnes</h4>
              <small>Cliquer pour le detail IA</small>
            </div>
            {overview.deals.length === 0 ? (
              <p className="ae-empty">Aucun deal gagne sur les 12 derniers mois.</p>
            ) : (
              <div className="ae-win-deals-table" role="region" aria-label="Deals gagnes">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Deal</th>
                      <th scope="col">Montant</th>
                      <th scope="col">Date gagnee</th>
                      <th scope="col">Owner</th>
                      <th scope="col">Analyse IA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.deals.map((deal) => (
                      <tr key={deal.hubspotDealId}>
                        <td>
                          <button className="ae-win-deal-link" onClick={() => openDeal(deal)} type="button">
                            {deal.dealName ?? deal.companyName}
                          </button>
                        </td>
                        <td>{formatAmount(deal.amount)}</td>
                        <td>{formatDate(deal.closedAt)}</td>
                        <td>{deal.ownerName ?? "owner inconnu"}</td>
                        <td>
                          <span className={deal.analyzed ? "ae-win-analysis-status done" : "ae-win-analysis-status"}>
                            {deal.analyzed ? deal.primaryWinFactor : "Pas encore analysee"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          {selectedDeal ? (
            <article className="ae-forecast-panel">
              <div className="ae-panel-heading">
                <h4>{selectedDeal.deal.dealName ?? selectedDeal.deal.companyName}</h4>
                <button className="ae-forecast-link" onClick={() => setSelectedDeal(null)} type="button">
                  Fermer
                </button>
              </div>
              {isLoadingDeal ? <p className="ae-empty">Chargement du detail...</p> : null}
              {!isLoadingDeal && !selectedDeal.analysis ? (
                <p className="ae-empty">Ce deal n'a pas encore d'analyse IA: lancez un run.</p>
              ) : null}
              {selectedDeal.analysis ? (
                <div className="ae-forecast-list">
                  <div>
                    <strong>{selectedDeal.analysis.primaryWinFactor}</strong>
                    <p>{selectedDeal.analysis.summary}</p>
                  </div>
                  {selectedDeal.analysis.keyMoments.map((moment) => (
                    <div key={moment.moment}>
                      <strong>
                        Moment cle{moment.stage ? ` (${moment.stage})` : ""}
                      </strong>
                      <p>
                        {moment.moment} - {moment.impact}
                      </p>
                    </div>
                  ))}
                  {selectedDeal.analysis.replicablePlays.map((play) => (
                    <div key={play.play}>
                      <strong>Tactique replicable ({play.when})</strong>
                      <p>{play.play}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          ) : null}
        </>
      ) : null}
    </section>
  );
};
