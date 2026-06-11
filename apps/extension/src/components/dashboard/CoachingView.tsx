import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  fetchRepCoaching,
  fetchTeamCoaching,
  fetchTeamCoachingJob,
  startTeamCoachingRun,
  type RepCoaching,
  type RepCoachingSourceDeal,
  type TeamCoachingCard,
  type TeamCoachingJobSnapshot,
} from "../../services/api";
import { LoadingState } from "./LoadingState";

const TREND_LABELS: Record<string, string> = {
  improving: "En progression",
  stable: "Stable",
  declining: "En difficulte",
};

const TREND_BADGE_LABELS: Record<string, string> = {
  improving: "Progresse",
  stable: "Stable",
  declining: "A coacher",
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

const formatDate = (value: string | null): string | null =>
  value
    ? new Intl.DateTimeFormat("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(new Date(value))
    : null;

const SOURCE_DEAL_STATUS_LABELS: Record<RepCoachingSourceDeal["status"], string> = {
  open: "Ouvert",
  won: "Gagne",
  lost: "Perdu",
};

const ACTIVITY_TYPE_LABELS: Record<RepCoachingSourceDeal["evidenceSources"][number]["type"], string> = {
  deal: "Deal",
  note: "Note",
  call: "Appel",
  meeting: "Reunion",
  email: "Email",
  sms: "SMS",
  communication: "Message",
  task: "Tache",
};

const getCardTrendClass = (card: TeamCoachingCard): string => {
  if (card.status === "pending" || card.trend === null) {
    return "pending";
  }

  return card.trend;
};

const getCardActionLabel = (card: TeamCoachingCard): string => {
  if (card.status === "pending" || card.headline === null) {
    return "Analyser le profil";
  }

  return card.trend === "stable" || card.trend === "improving" ? "Preparer le 1:1" : "Voir le plan coaching";
};

const getWinRateRingStyle = (winRate: number | null): CSSProperties =>
  ({
    "--ae-coaching-ring-value": `${Math.max(0, Math.min(100, winRate ?? 0)) * 3.6}deg`,
  }) as CSSProperties;

const getSourceDealsForText = (repCoaching: RepCoaching, text: string): RepCoachingSourceDeal[] => {
  const normalizedText = text.toLowerCase();
  const sourceDeals = new Map<string, RepCoachingSourceDeal>();

  const addDeals = (deals: RepCoachingSourceDeal[]): void => {
    for (const deal of deals) {
      sourceDeals.set(deal.hubspotDealId, deal);
    }
  };

  for (const reason of repCoaching.stats.lossReasons) {
    if (normalizedText.includes(reason.category.toLowerCase())) {
      addDeals(reason.sourceDeals);
    }
  }

  for (const signal of repCoaching.stats.topRiskSignals) {
    if (normalizedText.includes(signal.title.toLowerCase())) {
      addDeals(signal.sourceDeals);
    }
  }

  return Array.from(sourceDeals.values()).slice(0, 8);
};

const SourceDealList = ({ deals, label }: { deals: RepCoachingSourceDeal[]; label: string }) => {
  if (deals.length === 0) {
    return null;
  }

  return (
    <details className="ae-coaching-source-deals">
      <summary>
        {label} ({deals.length})
      </summary>
      <div>
        {deals.map((deal) => {
          const closedDate = formatDate(deal.closedAt);

          return (
            <article key={deal.hubspotDealId}>
              <strong>{deal.dealName}</strong>
              <span>
                {SOURCE_DEAL_STATUS_LABELS[deal.status]} - {deal.stage} - {formatAmount(deal.amount)}
                {closedDate ? ` - cloture ${closedDate}` : ""}
              </span>
              {deal.evidenceSources.length > 0 ? (
                <div className="ae-coaching-evidence-source-list">
                  {deal.evidenceSources.map((source) => (
                    <section key={source.activityId}>
                      <small>
                        {ACTIVITY_TYPE_LABELS[source.type] ?? source.type}
                        {source.channel ? ` - ${source.channel}` : ""}
                        {source.occurredAt ? ` - ${formatDateTime(source.occurredAt)}` : ""}
                      </small>
                      <p>{source.quote}</p>
                    </section>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </details>
  );
};

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
  const analyzedCards = cards.filter((card) => card.status === "ready" && card.headline !== null);
  const cardsWithWinRate = cards.filter((card) => card.winRate !== null);
  const teamAverageWinRate =
    cardsWithWinRate.length > 0
      ? Math.round(
          cardsWithWinRate.reduce((total, card) => total + (card.winRate ?? 0), 0) / cardsWithWinRate.length,
        )
      : null;
  const priorityCards = cards.filter(
    (card) => card.trend === "declining" || (card.winRate !== null && card.winRate < 25),
  );

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
        {isLoadingRep ? (
          <LoadingState detail="On reconstruit le profil de coaching du commercial." label="Chargement du profil" />
        ) : null}

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
                      <SourceDealList deals={stage.sourceDeals} label="Voir les deals du stage" />
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
                        repCoaching.analysis.weaknesses.map((weakness) => {
                          const sourceDeals = getSourceDealsForText(repCoaching, `${weakness.title} ${weakness.evidence}`);

                          return (
                            <article className="ae-coaching-insight-card growth" key={weakness.title}>
                              <span>{weakness.stage ?? "A travailler"}</span>
                              <strong>{weakness.title}</strong>
                              <p>{weakness.evidence}</p>
                              <SourceDealList deals={sourceDeals} label="Deals qui expliquent ce signal" />
                            </article>
                          );
                        })
                      )}
                    </div>
                  </article>
                </section>

                {repCoaching.analysis.lossPatterns.length > 0 ? (
                  <article className="ae-forecast-panel">
                    <div className="ae-panel-heading">
                      <h4>Patterns de pertes</h4>
                      <small>Les listes ci-dessous viennent des analyses close-lost en cache.</small>
                    </div>
                    <div className="ae-coaching-loss-patterns">
                      {repCoaching.analysis.lossPatterns.map((pattern) => {
                        const sourceDeals = getSourceDealsForText(repCoaching, pattern.pattern);

                        return (
                          <article className="ae-coaching-loss-pattern" key={pattern.pattern}>
                            <span>{FREQUENCY_LABELS[pattern.frequency] ?? pattern.frequency}</span>
                            <strong>{pattern.pattern}</strong>
                            <SourceDealList deals={sourceDeals} label="Deals concernes" />
                          </article>
                        );
                      })}
                    </div>
                  </article>
                ) : null}

                {repCoaching.stats.lossReasons.length > 0 || repCoaching.stats.topRiskSignals.length > 0 ? (
                  <article className="ae-forecast-panel">
                    <div className="ae-panel-heading">
                      <h4>Sources des compteurs</h4>
                      <small>Les nombres entre parentheses correspondent a ces deals analyses.</small>
                    </div>
                    <div className="ae-coaching-source-grid">
                      {repCoaching.stats.lossReasons.map((reason) => (
                        <article className="ae-coaching-source-card" key={`reason-${reason.category}`}>
                          <span>Raison de perte</span>
                          <strong>
                            {reason.category} ({reason.count})
                          </strong>
                          <SourceDealList deals={reason.sourceDeals} label="Deals sources" />
                        </article>
                      ))}
                      {repCoaching.stats.topRiskSignals.map((signal) => (
                        <article className="ae-coaching-source-card" key={`signal-${signal.title}`}>
                          <span>Signal de risque</span>
                          <strong>
                            {signal.title} ({signal.count})
                          </strong>
                          <SourceDealList deals={signal.sourceDeals} label="Deals sources" />
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
    <section className="ae-view-panel ae-coaching-page ae-team-coaching-page" aria-label="Coaching equipe">
      <div className="ae-coaching-hero">
        <div>
          <span className="ae-coaching-kicker">Coaching equipe</span>
          <h3>Qui coacher cette semaine ?</h3>
          <p>
            Vue manager sur les commerciaux, les signaux de conversion et les profils a preparer pour les prochains
            1:1.
          </p>
        </div>
        <div className="ae-coaching-hero-actions">
          <button className="ae-forecast-link" disabled={isLoadingTeam} onClick={() => loadTeam(true)} type="button">
            Actualiser
          </button>
          <button className="ae-forecast-link primary" disabled={isRunInProgress} onClick={handleRunTeam} type="button">
            {isRunInProgress ? "Analyse en cours..." : "Analyser l'equipe"}
          </button>
        </div>
      </div>

      <section className="ae-coaching-team-summary" aria-label="Synthese coaching equipe">
        <article>
          <small>Profils analyses</small>
          <strong>
            {analyzedCards.length}/{cards.length}
          </strong>
          <span>periode 90 jours</span>
        </article>
        <article>
          <small>Win rate moyen</small>
          <strong>{teamAverageWinRate !== null ? `${teamAverageWinRate}%` : "n/a"}</strong>
          <span>{cardsWithWinRate.length} commerciaux avec donnees</span>
        </article>
        <article className={priorityCards.length > 0 ? "attention" : ""}>
          <small>A prioriser</small>
          <strong>{priorityCards.length}</strong>
          <span>{priorityCards.length > 0 ? "profil(s) sous surveillance" : "aucun signal critique"}</span>
        </article>
      </section>

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
      {isLoadingTeam ? (
        <LoadingState detail="On charge les profils de coaching disponibles." label="Chargement de l'equipe" />
      ) : null}

      {!isLoadingTeam && cards.length === 0 ? (
        <p className="ae-empty">Aucun commercial (role sales) dans cette organisation.</p>
      ) : null}

      <section className="ae-coaching-rep-grid">
        {cards.map((card) => {
          const cardTrendClass = getCardTrendClass(card);

          return (
            <article className={`ae-coaching-rep-card ${cardTrendClass}`} key={card.userId}>
              <div className="ae-coaching-rep-head">
                <div>
                  <h4>{card.repName}</h4>
                  <small>{card.generatedAt ? `Analyse du ${formatDateTime(card.generatedAt)}` : "A analyser"}</small>
                </div>
                <span className={`ae-coaching-status ${cardTrendClass}`}>
                  {card.trend ? TREND_BADGE_LABELS[card.trend] ?? card.trend : "En attente"}
                </span>
              </div>

              <div className="ae-coaching-score-ring-row">
                <div
                  aria-label={`Win rate ${card.winRate !== null ? `${card.winRate}%` : "non disponible"}`}
                  className={`ae-coaching-win-ring ${cardTrendClass}`}
                  style={getWinRateRingStyle(card.winRate)}
                >
                  <span>Win rate</span>
                  <strong>{card.winRate !== null ? `${card.winRate}%` : "n/a"}</strong>
                </div>
                <dl className="ae-coaching-deal-breakdown">
                  <div>
                    <dt>Gagnes</dt>
                    <dd>{card.closedWonCount}</dd>
                  </div>
                  <div>
                    <dt>Perdus</dt>
                    <dd>{card.closedLostCount}</dd>
                  </div>
                  <div>
                    <dt>Ouverts</dt>
                    <dd>{card.openDealCount}</dd>
                  </div>
                </dl>
              </div>

              <p className={card.headline ? "ae-coaching-headline" : "ae-coaching-headline muted"}>
                {card.headline ?? "Pas encore de synthese IA. Lancez l'analyse equipe ou ouvrez le profil."}
              </p>

              <button className="ae-coaching-profile-button" onClick={() => loadRep(card.userId)} type="button">
                {getCardActionLabel(card)}
              </button>
            </article>
          );
        })}
      </section>
    </section>
  );
};
