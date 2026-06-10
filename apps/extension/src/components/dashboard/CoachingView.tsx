import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchRepCoaching,
  fetchTeamCoaching,
  fetchTeamCoachingJob,
  startTeamCoachingRun,
  type RepCoaching,
  type TeamCoachingCard,
  type TeamCoachingJobSnapshot,
} from "../../services/api";

const TREND_LABELS: Record<string, string> = {
  improving: "En progression",
  stable: "Stable",
  declining: "En difficulte",
};

const FREQUENCY_LABELS: Record<string, string> = {
  rare: "rare",
  recurrent: "recurrent",
  systematic: "systematique",
};

const JOB_POLL_INTERVAL_MS = 2_000;

const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const formatAmount = (value: number): string =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);

export const CoachingView = () => {
  const [cards, setCards] = useState<TeamCoachingCard[]>([]);
  const [isLoadingTeam, setIsLoadingTeam] = useState(true);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [repCoaching, setRepCoaching] = useState<RepCoaching | null>(null);
  const [isLoadingRep, setIsLoadingRep] = useState(false);
  const [repError, setRepError] = useState<string | null>(null);
  const [runJob, setRunJob] = useState<TeamCoachingJobSnapshot | null>(null);
  const [copiedAction, setCopiedAction] = useState<string | null>(null);
  const pollTimeoutRef = useRef<number | null>(null);

  const loadTeam = useCallback((forceRefresh = false, signal?: AbortSignal) => {
    setIsLoadingTeam(true);
    setTeamError(null);

    fetchTeamCoaching({ forceRefresh, signal })
      .then((result) => {
        setCards(result);
        setIsLoadingTeam(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setTeamError(error instanceof Error ? error.message : "Impossible de charger le coaching equipe.");
        setIsLoadingTeam(false);
      });
  }, []);

  useEffect(() => {
    const abortController = new AbortController();

    loadTeam(false, abortController.signal);

    return () => abortController.abort();
  }, [loadTeam]);

  useEffect(
    () => () => {
      if (pollTimeoutRef.current !== null) {
        window.clearTimeout(pollTimeoutRef.current);
      }
    },
    [],
  );

  const loadRep = useCallback((userId: string, refresh = false) => {
    setSelectedUserId(userId);
    setIsLoadingRep(true);
    setRepError(null);

    fetchRepCoaching(userId, { refresh })
      .then((result) => {
        setRepCoaching(result);
        setIsLoadingRep(false);
      })
      .catch((error: unknown) => {
        setRepError(error instanceof Error ? error.message : "Impossible de charger le profil de coaching.");
        setIsLoadingRep(false);
      });
  }, []);

  const pollRunJob = useCallback(
    (jobId: string) => {
      fetchTeamCoachingJob(jobId)
        .then((job) => {
          setRunJob(job);

          if (job.status === "completed" || job.status === "failed") {
            loadTeam(true);
            return;
          }

          pollTimeoutRef.current = window.setTimeout(() => pollRunJob(jobId), JOB_POLL_INTERVAL_MS);
        })
        .catch(() => {
          pollTimeoutRef.current = window.setTimeout(() => pollRunJob(jobId), JOB_POLL_INTERVAL_MS * 2);
        });
    },
    [loadTeam],
  );

  const handleRunTeam = (): void => {
    setTeamError(null);

    startTeamCoachingRun()
      .then((job) => {
        setRunJob(job);
        pollRunJob(job.jobId);
      })
      .catch((error: unknown) => {
        setTeamError(error instanceof Error ? error.message : "Impossible de demarrer l'analyse equipe.");
      });
  };

  const handleCopyAction = (action: string): void => {
    void navigator.clipboard
      .writeText(action)
      .then(() => {
        setCopiedAction(action);
        window.setTimeout(() => setCopiedAction(null), 2_000);
      })
      .catch(() => undefined);
  };

  const isRunInProgress = runJob !== null && (runJob.status === "queued" || runJob.status === "running");

  if (selectedUserId) {
    const funnelMax = Math.max(
      1,
      ...(repCoaching?.stats.funnel ?? []).map((stage) => stage.openCount + stage.wonCount + stage.lostCount),
    );

    return (
      <section className="ae-view-panel ae-coaching-page" aria-label="Coaching commercial">
        <div className="ae-forecast-header">
          <button
            className="ae-forecast-link"
            onClick={() => {
              setSelectedUserId(null);
              setRepCoaching(null);
              setRepError(null);
            }}
            type="button"
          >
            &larr; Retour equipe
          </button>
          {repCoaching ? (
            <div className="ae-forecast-header-meta">
              {repCoaching.generatedAt ? (
                <span className="ae-forecast-last-update">
                  Synthese du {formatDateTime(repCoaching.generatedAt)}
                  {repCoaching.cached ? " (cache)" : ""}
                </span>
              ) : null}
              <button
                className="ae-forecast-link"
                disabled={isLoadingRep || repCoaching.status === "insufficient_data"}
                onClick={() => loadRep(selectedUserId, true)}
                type="button"
              >
                Regenerer
              </button>
            </div>
          ) : null}
        </div>

        {repError ? <p className="ae-admin-feedback error">{repError}</p> : null}
        {isLoadingRep ? <p className="ae-empty">Chargement du profil...</p> : null}

        {repCoaching && !isLoadingRep ? (
          <>
            <article className="ae-forecast-banner">
              <div>
                <h3>{repCoaching.repName}</h3>
                {repCoaching.analysis ? (
                  <p>{repCoaching.analysis.headline}</p>
                ) : (
                  <p>
                    Donnees insuffisantes pour une synthese IA fiable ({repCoaching.stats.closedCount} deal
                    {repCoaching.stats.closedCount > 1 ? "s" : ""} ferme{repCoaching.stats.closedCount > 1 ? "s" : ""} sur
                    la periode). Les stats restent disponibles ci-dessous.
                  </p>
                )}
                <small>
                  Periode {repCoaching.stats.dateFrom} au {repCoaching.stats.dateTo}
                  {repCoaching.analysis
                    ? ` - tendance ${TREND_LABELS[repCoaching.analysis.trend] ?? repCoaching.analysis.trend} - confiance ${repCoaching.analysis.confidence}`
                    : ""}
                </small>
              </div>
            </article>

            <section className="ae-forecast-kpis">
              <div>
                <small>Win rate</small>
                <strong>{repCoaching.stats.winRate !== null ? `${repCoaching.stats.winRate}%` : "n/a"}</strong>
                <small>
                  mediane equipe{" "}
                  {repCoaching.stats.teamMedian.winRate !== null ? `${repCoaching.stats.teamMedian.winRate}%` : "n/a"}
                </small>
              </div>
              <div>
                <small>Deals fermes</small>
                <strong>{repCoaching.stats.closedCount}</strong>
                <small>
                  {repCoaching.stats.closedWonCount} gagnes / {repCoaching.stats.closedLostCount} perdus
                </small>
              </div>
              <div>
                <small>Panier moyen gagne</small>
                <strong>
                  {repCoaching.stats.avgWonAmount !== null ? formatAmount(repCoaching.stats.avgWonAmount) : "n/a"}
                </strong>
                <small>
                  cycle moyen{" "}
                  {repCoaching.stats.avgSalesCycleDays !== null ? `${repCoaching.stats.avgSalesCycleDays} j` : "n/a"}
                </small>
              </div>
              <div>
                <small>Pipe ouvert</small>
                <strong>{formatAmount(repCoaching.stats.openPipelineAmount)}</strong>
                <small>{repCoaching.stats.openDealCount} deals</small>
              </div>
            </section>

            <article className="ae-forecast-panel">
              <div className="ae-panel-heading">
                <h4>Funnel par stage</h4>
                <small>Repartition ouverts / gagnes / perdus</small>
              </div>
              <div className="ae-coaching-funnel-legend" aria-hidden="true">
                <span className="won">Gagnes</span>
                <span className="open">Ouverts</span>
                <span className="lost">Perdus</span>
              </div>
              <div className="ae-forecast-list">
                {repCoaching.stats.funnel.map((stage) => {
                  const total = stage.openCount + stage.wonCount + stage.lostCount;

                  return (
                    <div className="ae-coaching-funnel-row" key={stage.stage}>
                      <span>{stage.stage}</span>
                      <div className="ae-coaching-funnel-bar" aria-label={`${stage.stage}: ${total} deals`}>
                        <i className="won" style={{ width: `${(stage.wonCount / funnelMax) * 100}%` }} />
                        <i className="open" style={{ width: `${(stage.openCount / funnelMax) * 100}%` }} />
                        <i className="lost" style={{ width: `${(stage.lostCount / funnelMax) * 100}%` }} />
                      </div>
                      <small>
                        {stage.openCount} ouverts - {stage.wonCount} gagnes - {stage.lostCount} perdus
                      </small>
                    </div>
                  );
                })}
              </div>
            </article>

            {repCoaching.analysis ? (
              <>
                <section className="ae-forecast-layout">
                  <article className="ae-forecast-panel">
                    <div className="ae-panel-heading">
                      <h4>Forces</h4>
                    </div>
                    <div className="ae-coaching-insight-list">
                      {repCoaching.analysis.strengths.length === 0 ? (
                        <p className="ae-empty">Aucune force identifiee.</p>
                      ) : (
                        repCoaching.analysis.strengths.map((strength) => (
                          <article className="ae-coaching-insight-card strength" key={strength.title}>
                            <span>Force</span>
                            <strong>{strength.title}</strong>
                            <p>{strength.evidence}</p>
                          </article>
                        ))
                      )}
                    </div>
                  </article>

                  <article className="ae-forecast-panel">
                    <div className="ae-panel-heading">
                      <h4>Axes de progression</h4>
                    </div>
                    <div className="ae-coaching-insight-list">
                      {repCoaching.analysis.weaknesses.length === 0 ? (
                        <p className="ae-empty">Aucun axe identifie.</p>
                      ) : (
                        repCoaching.analysis.weaknesses.map((weakness) => (
                          <article className="ae-coaching-insight-card growth" key={weakness.title}>
                            <span>{weakness.stage ?? "A travailler"}</span>
                            <strong>
                              {weakness.title}
                            </strong>
                            <p>{weakness.evidence}</p>
                          </article>
                        ))
                      )}
                    </div>
                  </article>
                </section>

                {repCoaching.analysis.lossPatterns.length > 0 ? (
                  <article className="ae-forecast-panel">
                    <div className="ae-panel-heading">
                      <h4>Patterns de pertes</h4>
                    </div>
                    <div className="ae-coaching-loss-patterns">
                      {repCoaching.analysis.lossPatterns.map((pattern) => (
                        <article className="ae-coaching-loss-pattern" key={pattern.pattern}>
                          <span>{FREQUENCY_LABELS[pattern.frequency] ?? pattern.frequency}</span>
                          <strong>{pattern.pattern}</strong>
                        </article>
                      ))}
                    </div>
                  </article>
                ) : null}

                <article className="ae-forecast-panel">
                  <div className="ae-panel-heading">
                    <h4>Actions de coaching pour le 1:1</h4>
                    <small>Cliquer pour copier</small>
                  </div>
                  <div className="ae-coaching-action-list">
                    {repCoaching.analysis.coachingActions.map((action) => (
                      <article className="ae-coaching-action-card" key={action.action}>
                        <button
                          className="ae-coaching-action-button"
                          onClick={() => handleCopyAction(`${action.action} (impact attendu: ${action.expectedImpact})`)}
                          type="button"
                        >
                          <span className={action.priority === "high" ? "high" : "medium"}>
                            {action.priority === "high" ? "Prioritaire" : "Moyen"}
                          </span>
                          <strong>
                            {action.action}
                          </strong>
                        </button>
                        <p>Impact attendu: {action.expectedImpact}</p>
                        {copiedAction?.startsWith(action.action) ? <small>Copie !</small> : null}
                      </article>
                    ))}
                  </div>
                </article>
              </>
            ) : null}
          </>
        ) : null}
      </section>
    );
  }

  return (
    <section className="ae-view-panel ae-coaching-page" aria-label="Coaching equipe">
      <div className="ae-forecast-header">
        <span className="ae-forecast-last-update">
          Profil de coaching par commercial (periode glissante de 90 jours).
        </span>
        <div className="ae-forecast-header-meta">
          <button className="ae-forecast-link" disabled={isLoadingTeam} onClick={() => loadTeam(true)} type="button">
            Actualiser
          </button>
          <button className="ae-forecast-link" disabled={isRunInProgress} onClick={handleRunTeam} type="button">
            {isRunInProgress ? "Analyse en cours..." : "Analyser toute l'equipe"}
          </button>
        </div>
      </div>

      {runJob && isRunInProgress ? (
        <div className="ae-sync-progress" aria-live="polite">
          <div className="ae-sync-progress-head">
            <span>{runJob.currentStep}</span>
            <span>{runJob.progress}%</span>
          </div>
          <div className="ae-sync-progress-track">
            <i style={{ width: `${runJob.progress}%` }} />
          </div>
        </div>
      ) : null}
      {runJob?.status === "failed" ? (
        <p className="ae-admin-feedback error">{runJob.error ?? "L'analyse equipe a echoue."}</p>
      ) : null}

      {teamError ? <p className="ae-admin-feedback error">{teamError}</p> : null}
      {isLoadingTeam ? <p className="ae-empty">Chargement de l'equipe...</p> : null}

      {!isLoadingTeam && cards.length === 0 ? (
        <p className="ae-empty">Aucun commercial (role sales) dans cette organisation.</p>
      ) : null}

      <section className="ae-forecast-layout three">
        {cards.map((card) => (
          <article className="ae-forecast-panel" key={card.userId}>
            <div className="ae-panel-heading">
              <h4>{card.repName}</h4>
              <small>{card.trend ? TREND_LABELS[card.trend] ?? card.trend : "En attente d'analyse"}</small>
            </div>
            <div className="ae-forecast-list">
              <div>
                <strong>Win rate: {card.winRate !== null ? `${card.winRate}%` : "n/a"}</strong>
                <p>
                  {card.closedWonCount} gagnes / {card.closedLostCount} perdus - {card.openDealCount} ouverts
                </p>
              </div>
              <div>
                {card.headline ? (
                  <p>{card.headline}</p>
                ) : (
                  <p className="ae-empty">Pas encore de synthese IA: lancez l'analyse equipe ou ouvrez le profil.</p>
                )}
              </div>
            </div>
            <button className="ae-forecast-link" onClick={() => loadRep(card.userId)} type="button">
              Voir le profil
            </button>
          </article>
        ))}
      </section>
    </section>
  );
};
