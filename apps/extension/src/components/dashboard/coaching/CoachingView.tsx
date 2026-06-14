import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  GraduationCap,
  History,
  Lightbulb,
  ListChecks,
  Radar,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  fetchRepCoaching,
  fetchTeamCoaching,
  fetchTeamCoachingJob,
  startTeamCoachingRun,
  type RepCoaching,
  type RepCoachingSourceDeal,
  type TeamCoachingCard,
  type TeamCoachingJobSnapshot,
} from "../../../services/api";
import "../../styles/coaching.css";

const TREND_LABELS: Record<string, string> = {
  improving: "En progression",
  stable: "Stable",
  declining: "En difficulté",
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

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  const dayMonth = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(date);
  const time = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);

  return `${dayMonth} · ${time}`;
};

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
    background: `conic-gradient(var(--jv-terra) ${Math.max(0, Math.min(100, winRate ?? 0)) * 3.6}deg, #ece9e3 0)`,
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

const SectionLabel = ({ children, icon: Icon }: { children: string; icon: LucideIcon }) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

const ThemeBlock = ({
  empty,
  icon,
  items,
  title,
}: {
  empty: string;
  icon: LucideIcon;
  items: Array<{ label: string; count: number }>;
  title: string;
}) => (
  <div className="jv-theme-block">
    <SectionLabel icon={icon}>{title}</SectionLabel>
    {items.length > 0 ? (
      <ul className="jv-theme-list">
        {items.slice(0, 5).map((item) => (
          <li key={item.label}>
            <span>{item.label}</span>
            <em>{item.count}</em>
          </li>
        ))}
      </ul>
    ) : (
      <p className="jv-theme-empty">{empty}</p>
    )}
  </div>
);

const ProfileSection = ({ children, icon, label }: { children: React.ReactNode; icon: LucideIcon; label: string }) => (
  <section className="jv-coaching-profile-section">
    <SectionLabel icon={icon}>{label}</SectionLabel>
    {children}
  </section>
);

const SourceDealList = ({ deals, label }: { deals: RepCoachingSourceDeal[]; label: string }) => {
  if (deals.length === 0) {
    return null;
  }

  return (
    <details className="jv-coaching-source-deals">
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
                <div className="jv-coaching-evidence-source-list">
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

const RepCardGrid = ({
  cards,
  isLoading,
  onOpenRep,
}: {
  cards: TeamCoachingCard[];
  isLoading: boolean;
  onOpenRep: (userId: string) => void;
}) => {
  if (isLoading && cards.length === 0) {
    return <p className="jv-coaching-profile-loading">Chargement des profils…</p>;
  }

  if (!isLoading && cards.length === 0) {
    return <p className="jv-coaching-profile-loading">Aucun commercial (role sales) dans cette organisation.</p>;
  }

  return (
    <section className="jv-coaching-rep-grid" aria-label="Commerciaux">
      {cards.map((card) => {
        const trendClass = getCardTrendClass(card);

        return (
          <article className={`jv-coaching-rep-card ${trendClass}`} key={card.userId}>
            <div className="jv-coaching-rep-head">
              <div>
                <h3>{card.repName}</h3>
                <small>{card.generatedAt ? `Analyse du ${formatDateTime(card.generatedAt)}` : "A analyser"}</small>
              </div>
              <span className={`jv-coaching-status ${trendClass}`}>
                {card.trend ? TREND_BADGE_LABELS[card.trend] ?? card.trend : "En attente"}
              </span>
            </div>

            <div className="jv-coaching-score-ring-row">
              <div
                aria-label={`Win rate ${card.winRate !== null ? `${card.winRate}%` : "non disponible"}`}
                className={`jv-coaching-win-ring ${trendClass}`}
                style={getWinRateRingStyle(card.winRate)}
              >
                <span>Win rate</span>
                <strong>{card.winRate !== null ? `${card.winRate}%` : "n/a"}</strong>
              </div>
              <dl className="jv-coaching-deal-breakdown">
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

            <p className={card.headline ? "jv-coaching-headline" : "jv-coaching-headline muted"}>
              {card.headline ?? "Pas encore de synthese IA. Lancez l'analyse equipe ou ouvrez le profil."}
            </p>

            <button className="jv-coaching-profile-button" onClick={() => onOpenRep(card.userId)} type="button">
              {getCardActionLabel(card)}
            </button>
          </article>
        );
      })}
    </section>
  );
};

const RepProfilePage = ({
  copiedAction,
  isLoading,
  onBack,
  onCopyAction,
  onRefresh,
  repCoaching,
  repError,
}: {
  copiedAction: string | null;
  isLoading: boolean;
  onBack: () => void;
  onCopyAction: (action: string) => void;
  onRefresh: () => void;
  repCoaching: RepCoaching | null;
  repError: string | null;
}) => {
  if (isLoading && !repCoaching) {
    return <p className="jv-coaching-profile-loading">On reconstruit le profil de coaching du commercial…</p>;
  }

  if (!repCoaching) {
    return (
      <p className="jv-coaching-profile-loading">
        {repError ?? "Impossible de charger le profil de coaching pour ce commercial."}
      </p>
    );
  }

  const funnelMax = Math.max(
    1,
    ...(repCoaching.stats.funnel ?? []).map((stage) => stage.openCount + stage.wonCount + stage.lostCount),
  );

  const repStats = [
    {
      caption: `mediane equipe ${repCoaching.stats.teamMedian.winRate !== null ? `${repCoaching.stats.teamMedian.winRate}%` : "n/a"}`,
      label: "Win rate",
      value: repCoaching.stats.winRate !== null ? `${repCoaching.stats.winRate}%` : "n/a",
    },
    {
      caption: `${repCoaching.stats.closedWonCount} gagnes / ${repCoaching.stats.closedLostCount} perdus`,
      label: "Deals fermes",
      value: String(repCoaching.stats.closedCount),
    },
    {
      caption: `cycle moyen ${repCoaching.stats.avgSalesCycleDays !== null ? `${repCoaching.stats.avgSalesCycleDays} j` : "n/a"}`,
      label: "Panier moyen gagne",
      value: repCoaching.stats.avgWonAmount !== null ? formatAmount(repCoaching.stats.avgWonAmount) : "n/a",
    },
    {
      caption: `${repCoaching.stats.openDealCount} deals`,
      label: "Pipe ouvert",
      value: formatAmount(repCoaching.stats.openPipelineAmount),
    },
  ] as const;

  return (
    <>
      <div className="jv-coaching-back">
        <button className="jv-btn-ghost" onClick={onBack} type="button">
          <ArrowLeft aria-hidden="true" size={15} strokeWidth={1.5} />
          Retour equipe
        </button>
        <button
          className="jv-btn-ghost"
          disabled={isLoading || repCoaching.status === "insufficient_data"}
          onClick={onRefresh}
          type="button"
        >
          {isLoading ? <RefreshCw className="jv-spin" size={14} strokeWidth={1.5} /> : <Sparkles size={14} strokeWidth={1.5} />}
          Regenerer
        </button>
      </div>

      <section className="jv-score-banner" aria-label="Synthese coaching commercial">
        <div className="jv-score-ring" style={getWinRateRingStyle(repCoaching.stats.winRate)}>
          <span>{repCoaching.stats.winRate ?? "—"}</span>
        </div>
        <div className="jv-score-copy">
          <strong>{repCoaching.repName}</strong>
          <p>
            {repCoaching.analysis?.headline ??
              `Donnees insuffisantes pour une synthese IA fiable (${repCoaching.stats.closedCount} deal${repCoaching.stats.closedCount > 1 ? "s" : ""} ferme${repCoaching.stats.closedCount > 1 ? "s" : ""} sur la periode).`}
          </p>
          <small>
            Periode {repCoaching.stats.dateFrom} au {repCoaching.stats.dateTo}
            {repCoaching.analysis
              ? ` · tendance ${TREND_LABELS[repCoaching.analysis.trend] ?? repCoaching.analysis.trend} · confiance ${repCoaching.analysis.confidence}`
              : ""}
            {repCoaching.generatedAt
              ? ` · Synthese du ${formatDateTime(repCoaching.generatedAt)}${repCoaching.cached ? " (cache)" : ""}`
              : ""}
          </small>
        </div>
        <span className="jv-score-badge">
          <Sparkles size={11} strokeWidth={1.5} />
          IA
        </span>
      </section>

      <section className="jv-stat-strip cols-4" aria-label="Indicateurs commercial">
        {repStats.map((stat, index) => (
          <div className="jv-stat" key={stat.label} style={{ animationDelay: `${index * 60}ms` }}>
            <span className="jv-stat-label">{stat.label}</span>
            <span className="jv-stat-value">{stat.value}</span>
            {stat.caption ? <small className="jv-stat-caption">{stat.caption}</small> : null}
          </div>
        ))}
      </section>

      <div className="jv-coaching-profile" aria-busy={isLoading}>
        <ProfileSection icon={TrendingUp} label="Funnel par stage">
          <div className="jv-coaching-funnel-legend" aria-hidden="true">
            <span className="won">Gagnes</span>
            <span className="open">Ouverts</span>
            <span className="lost">Perdus</span>
          </div>
          <div className="jv-coaching-insight-list">
            {repCoaching.stats.funnel.map((stage) => {
              const total = stage.openCount + stage.wonCount + stage.lostCount;

              return (
                <div className="jv-coaching-funnel-row" key={stage.stage}>
                  <span>{stage.stage}</span>
                  <div className="jv-coaching-funnel-bar" aria-label={`${stage.stage}: ${total} deals`}>
                    <i className="won" style={{ width: `${(stage.wonCount / funnelMax) * 100}%` }} />
                    <i className="open" style={{ width: `${(stage.openCount / funnelMax) * 100}%` }} />
                    <i className="lost" style={{ width: `${(stage.lostCount / funnelMax) * 100}%` }} />
                  </div>
                  <small>
                    {stage.openCount} ouverts · {stage.wonCount} gagnes · {stage.lostCount} perdus
                  </small>
                  <SourceDealList deals={stage.sourceDeals} label="Voir les deals du stage" />
                </div>
              );
            })}
          </div>
        </ProfileSection>

        {repCoaching.analysis ? (
          <>
            <div className="jv-themes-layout">
              <ProfileSection icon={Radar} label="Forces">
                {repCoaching.analysis.strengths.length === 0 ? (
                  <p className="jv-prose">Aucune force identifiee.</p>
                ) : (
                  <div className="jv-coaching-insight-list">
                    {repCoaching.analysis.strengths.map((strength) => (
                      <article className="jv-coaching-insight-card strength" key={strength.title}>
                        <span>Force</span>
                        <strong>{strength.title}</strong>
                        <p>{strength.evidence}</p>
                      </article>
                    ))}
                  </div>
                )}
              </ProfileSection>

              <ProfileSection icon={AlertTriangle} label="Axes de progression">
                {repCoaching.analysis.weaknesses.length === 0 ? (
                  <p className="jv-prose">Aucun axe identifie.</p>
                ) : (
                  <div className="jv-coaching-insight-list">
                    {repCoaching.analysis.weaknesses.map((weakness) => {
                      const sourceDeals = getSourceDealsForText(repCoaching, `${weakness.title} ${weakness.evidence}`);

                      return (
                        <article className="jv-coaching-insight-card growth" key={weakness.title}>
                          <span>{weakness.stage ?? "A travailler"}</span>
                          <strong>{weakness.title}</strong>
                          <p>{weakness.evidence}</p>
                          <SourceDealList deals={sourceDeals} label="Deals qui expliquent ce signal" />
                        </article>
                      );
                    })}
                  </div>
                )}
              </ProfileSection>
            </div>

            {repCoaching.analysis.lossPatterns.length > 0 ? (
              <ProfileSection icon={History} label="Patterns de pertes">
                <div className="jv-coaching-loss-patterns">
                  {repCoaching.analysis.lossPatterns.map((pattern) => {
                    const sourceDeals = getSourceDealsForText(repCoaching, pattern.pattern);

                    return (
                      <article className="jv-coaching-loss-pattern" key={pattern.pattern}>
                        <span>{FREQUENCY_LABELS[pattern.frequency] ?? pattern.frequency}</span>
                        <strong>{pattern.pattern}</strong>
                        <SourceDealList deals={sourceDeals} label="Deals concernes" />
                      </article>
                    );
                  })}
                </div>
              </ProfileSection>
            ) : null}

            {repCoaching.stats.lossReasons.length > 0 || repCoaching.stats.topRiskSignals.length > 0 ? (
              <ProfileSection icon={Lightbulb} label="Sources des compteurs">
                <div className="jv-coaching-source-grid">
                  {repCoaching.stats.lossReasons.map((reason) => (
                    <article className="jv-coaching-source-card" key={`reason-${reason.category}`}>
                      <span>Raison de perte</span>
                      <strong>
                        {reason.category} ({reason.count})
                      </strong>
                      <SourceDealList deals={reason.sourceDeals} label="Deals sources" />
                    </article>
                  ))}
                  {repCoaching.stats.topRiskSignals.map((signal) => (
                    <article className="jv-coaching-source-card" key={`signal-${signal.title}`}>
                      <span>Signal de risque</span>
                      <strong>
                        {signal.title} ({signal.count})
                      </strong>
                      <SourceDealList deals={signal.sourceDeals} label="Deals sources" />
                    </article>
                  ))}
                </div>
              </ProfileSection>
            ) : null}

            <ProfileSection icon={ListChecks} label="Actions de coaching pour le 1:1">
              <p className="jv-prose">Cliquer pour copier une action dans le presse-papiers.</p>
              <div className="jv-coaching-action-list">
                {repCoaching.analysis.coachingActions.map((action) => (
                  <article className="jv-coaching-action-card" key={action.action}>
                    <button
                      className="jv-coaching-action-button"
                      onClick={() => onCopyAction(`${action.action} (impact attendu: ${action.expectedImpact})`)}
                      type="button"
                    >
                      <span className={action.priority === "high" ? "high" : "medium"}>
                        {action.priority === "high" ? "Prioritaire" : "Moyen"}
                      </span>
                      <strong>{action.action}</strong>
                    </button>
                    <p>Impact attendu: {action.expectedImpact}</p>
                    {copiedAction?.startsWith(action.action) ? <small>Copie !</small> : null}
                  </article>
                ))}
              </div>
            </ProfileSection>
          </>
        ) : null}
      </div>
    </>
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
        setRepCoaching(null);
        setIsLoadingRep(false);
      });
  }, []);

  const handleBackToTeam = (): void => {
    setSelectedUserId(null);
    setRepCoaching(null);
    setRepError(null);
  };

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

  const teamInsights = useMemo(() => {
    const weaknesses = priorityCards
      .filter((card) => card.headline)
      .slice(0, 5)
      .map((card) => ({ label: `${card.repName} · ${card.headline ?? ""}`, count: 1 }));

    const strengths = cards
      .filter((card) => card.trend === "improving" && card.headline)
      .slice(0, 5)
      .map((card) => ({ label: `${card.repName} · ${card.headline ?? ""}`, count: 1 }));

    const scoreLabel =
      priorityCards.length > 0
        ? `${priorityCards.length} profil${priorityCards.length > 1 ? "s" : ""} a prioriser`
        : "Equipe stable sur la periode";

    return { scoreLabel, strengths, weaknesses };
  }, [cards, priorityCards]);

  const stats = [
    {
      caption: "periode 90 jours",
      label: "Profils analyses",
      value: `${analyzedCards.length}/${cards.length}`,
    },
    {
      caption: `${cardsWithWinRate.length} commerciaux avec donnees`,
      label: "Win rate moyen",
      value: teamAverageWinRate !== null ? `${teamAverageWinRate}%` : "n/a",
    },
    {
      caption: priorityCards.length > 0 ? "profil(s) sous surveillance" : "aucun signal critique",
      label: "A prioriser",
      value: String(priorityCards.length),
    },
    {
      caption: "role sales",
      label: "Equipe",
      value: String(cards.length),
    },
  ] as const;

  if (selectedUserId) {
    return (
      <div className="jv-coaching-page" aria-label="Coaching commercial">
        <header className="jv-page-header">
          <GraduationCap aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
          <h1>
            Coaching IA
            <span className="jv-page-kicker">profil</span>
          </h1>
        </header>

        {repError ? <p className="jv-banner jv-banner-error">{repError}</p> : null}

        <RepProfilePage
          copiedAction={copiedAction}
          isLoading={isLoadingRep}
          onBack={handleBackToTeam}
          onCopyAction={handleCopyAction}
          onRefresh={() => loadRep(selectedUserId, true)}
          repCoaching={repCoaching}
          repError={repError}
        />
      </div>
    );
  }

  return (
    <div className="jv-coaching-page" aria-label="Coaching equipe">
      <header className="jv-page-header">
        <GraduationCap aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
        <h1>
          Coaching IA
          <span className="jv-page-kicker">equipe</span>
        </h1>
      </header>

      <div className="jv-toolbar">
        <div className="jv-toolbar-filters">
          <span className="jv-section-label">
            <Users aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
            Qui coacher cette semaine ?
          </span>
        </div>
        <div className="jv-toolbar-actions">
          <button className="jv-btn-ghost" disabled={isLoadingTeam} onClick={() => loadTeam(true)} type="button">
            <RefreshCw aria-hidden="true" className={isLoadingTeam ? "jv-spin" : undefined} size={15} strokeWidth={1.5} />
            Actualiser
          </button>
          <button className="jv-btn-primary" disabled={isRunInProgress} onClick={handleRunTeam} type="button">
            <Sparkles aria-hidden="true" size={15} strokeWidth={1.5} />
            {isRunInProgress ? "Analyse en cours…" : "Analyser l'equipe"}
          </button>
        </div>
      </div>

      <section className="jv-stat-strip cols-4" aria-label="Synthese coaching equipe">
        {stats.map((stat, index) => (
          <div className="jv-stat" key={stat.label} style={{ animationDelay: `${index * 60}ms` }}>
            <span className="jv-stat-label">{stat.label}</span>
            <span className="jv-stat-value">{stat.value}</span>
            {stat.caption ? <small className="jv-stat-caption">{stat.caption}</small> : null}
          </div>
        ))}
      </section>

      <section className="jv-score-banner" aria-label="Score coaching equipe">
        <div className="jv-score-ring" style={getWinRateRingStyle(teamAverageWinRate)}>
          <span>{teamAverageWinRate ?? "—"}</span>
        </div>
        <div className="jv-score-copy">
          <strong>{teamInsights.scoreLabel}</strong>
          <p>
            Vue manager sur les commerciaux, les signaux de conversion et les profils a preparer pour les prochains
            1:1.
          </p>
        </div>
        <span className="jv-score-badge">
          <Sparkles size={11} strokeWidth={1.5} />
          IA
        </span>
      </section>

      <section className="jv-themes-row" aria-label="Points faibles et bonnes pratiques">
        <ThemeBlock empty="Aucun point faible detecte." icon={AlertTriangle} items={teamInsights.weaknesses} title="Points faibles" />
        <ThemeBlock empty="Aucune bonne pratique identifiee." icon={Lightbulb} items={teamInsights.strengths} title="Bonnes pratiques" />
      </section>

      {runJob && isRunInProgress ? (
        <div className="jv-progress" aria-live="polite">
          <div className="jv-progress-head">
            <span>{runJob.currentStep}</span>
            <span>{runJob.progress}%</span>
          </div>
          <div className="jv-progress-track">
            <i style={{ width: `${runJob.progress}%` }} />
          </div>
        </div>
      ) : null}

      {runJob?.status === "failed" ? (
        <p className="jv-banner jv-banner-error">{runJob.error ?? "L'analyse equipe a echoue."}</p>
      ) : null}
      {teamError ? <p className="jv-banner jv-banner-error">{teamError}</p> : null}

      <RepCardGrid cards={cards} isLoading={isLoadingTeam} onOpenRep={loadRep} />
    </div>
  );
};