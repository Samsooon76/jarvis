import {
  AlertTriangle,
  AlignLeft,
  ChevronRight,
  GraduationCap,
  History,
  Lightbulb,
  ListChecks,
  MessageCircleWarning,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  RefreshCw,
  ScrollText,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  analyzeSingleCall,
  fetchCallDetail,
  fetchCallInsights,
  fetchCalls,
  runCallAnalysis,
  type CallActorRole,
  type CallDetail,
  type CallInsights,
  type CallListItem,
  type CallPeriodFilter,
  type CallSentiment,
  type CallTypeFilter,
  type HubSpotOwnerOption,
} from "../../../services/api";
import "../../styles/calls.css";

type CallsViewProps = {
  canViewTeamInsights: boolean;
  orgId: string;
  owners?: HubSpotOwnerOption[];
  role: CallActorRole;
};

const periodOptions: Array<{ id: CallPeriodFilter; label: string }> = [
  { id: "7d", label: "7 jours" },
  { id: "30d", label: "30 jours" },
  { id: "90d", label: "90 jours" },
];

const periodCaptions: Record<CallPeriodFilter, string> = {
  "7d": "sur 7 jours",
  "30d": "sur 30 jours",
  "90d": "sur 90 jours",
};

const typeOptions: Array<{ id: CallTypeFilter; label: string }> = [
  { id: "all", label: "Tous" },
  { id: "outbound", label: "Sortants" },
  { id: "inbound", label: "Entrants" },
];

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  const dayMonth = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(date);
  const time = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);

  return `${dayMonth} · ${time}`;
};

const formatDuration = (seconds: number | null): string => {
  if (!seconds || seconds <= 0) {
    return "—";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
};

const statusLabels: Record<CallListItem["analysisStatus"], string> = {
  analyzed: "Analysé",
  failed: "Erreur",
  not_analyzed: "À analyser",
  pending: "En attente",
};

const outcomeLabels: Record<CallListItem["outcome"], string> = {
  connected: "Connecté",
  left_voicemail: "Message vocal",
  lost: "Perdu",
  meeting_booked: "RDV booké",
  next_step: "Next step",
  no_answer: "Sans réponse",
  unknown: "Inconnu",
};

const sentimentLabels: Record<CallSentiment, string> = {
  positive: "Positif",
  neutral: "Neutre",
  negative: "Négatif",
  mixed: "Mitigé",
};

const sourceKindLabels: Record<NonNullable<CallDetail["sourceKind"]>, string> = {
  transcript: "Transcript",
  notes: "Notes HubSpot",
  summary: "Résumé",
};

const getCallTitle = (call: CallListItem): string =>
  call.companyName ?? call.contactName ?? call.dealName ?? `Appel ${call.id.slice(0, 8)}`;

const formatAverageDuration = (seconds: number): string => {
  if (seconds <= 0) {
    return "—";
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;

  return minutes > 0 ? `${minutes}m ${String(remainder).padStart(2, "0")}s` : `${remainder}s`;
};

const getStatusClass = (status: CallListItem["analysisStatus"]): string => {
  if (status === "analyzed") {
    return "jv-meta-ok";
  }

  if (status === "failed") {
    return "jv-meta-failed";
  }

  return "jv-meta-pending";
};

const SectionLabel = ({ children, icon: Icon }: { children: string; icon: LucideIcon }) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

const FilterPills = <T extends string>({
  active,
  onChange,
  options,
}: {
  active: T;
  onChange: (value: T) => void;
  options: Array<{ id: T; label: string }>;
}) => (
  <div className="jv-filter-pills" role="group">
    {options.map((option) => (
      <button
        className={active === option.id ? "active" : ""}
        key={option.id}
        onClick={() => onChange(option.id)}
        type="button"
      >
        {option.label}
      </button>
    ))}
  </div>
);

const StatStrip = ({ insights, period }: { insights: CallInsights | null; period: CallPeriodFilter }) => {
  const connectedRate =
    insights && insights.totalCalls > 0 ? Math.round((insights.connectedCalls / insights.totalCalls) * 100) : null;
  const analyzedRate =
    insights && insights.totalCalls > 0 ? Math.round((insights.analyzedCalls / insights.totalCalls) * 100) : null;

  const stats = [
    {
      caption: periodCaptions[period],
      label: "Appels",
      value: insights?.totalCalls ?? "—",
    },
    {
      caption: connectedRate !== null ? `${connectedRate}% du total` : undefined,
      label: "Connectés",
      value: insights?.connectedCalls ?? "—",
    },
    {
      caption: undefined,
      label: "Durée moyenne",
      value: insights ? formatAverageDuration(insights.averageDurationSeconds) : "—",
    },
    {
      caption: analyzedRate !== null ? `${analyzedRate}% du total` : undefined,
      label: "Analysés",
      value: insights?.analyzedCalls ?? "—",
    },
    {
      caption: insights ? "des appels analysés" : undefined,
      label: "Sentiment +",
      value: insights ? `${insights.positiveSentimentRate}%` : "—",
    },
  ] as const;

  return (
    <section className="jv-stat-strip" aria-label="Indicateurs appels">
      {stats.map((stat, index) => (
        <div className="jv-stat" key={stat.label} style={{ animationDelay: `${index * 60}ms` }}>
          <span className="jv-stat-label">{stat.label}</span>
          <span className="jv-stat-value">{stat.value}</span>
          {stat.caption ? <small className="jv-stat-caption">{stat.caption}</small> : null}
        </div>
      ))}
    </section>
  );
};

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

const ThemesRow = ({ insights }: { insights: CallInsights | null }) => (
  <section className="jv-themes-row" aria-label="Thèmes détectés">
    <ThemeBlock
      empty="Aucune objection."
      icon={MessageCircleWarning}
      items={insights?.topObjections ?? []}
      title="Objections fréquentes"
    />
    <ThemeBlock
      empty="Aucun thème."
      icon={GraduationCap}
      items={insights?.coachingThemes ?? []}
      title="Thèmes de coaching"
    />
  </section>
);

const CallMeta = ({ call, showSentiment }: { call: CallListItem; showSentiment: boolean }) => (
  <span className="jv-call-meta">
    <span className={call.direction === "outbound" ? "jv-meta-outbound" : "jv-meta-inbound"}>
      {call.direction === "outbound" ? (
        <>
          <PhoneOutgoing size={11} strokeWidth={1.5} />
          Sortant
        </>
      ) : (
        <>
          <PhoneIncoming size={11} strokeWidth={1.5} />
          Entrant
        </>
      )}
    </span>
    <span>{outcomeLabels[call.outcome]}</span>
    {showSentiment && call.sentiment ? (
      <span className={`jv-meta-sentiment-${call.sentiment}`}>{sentimentLabels[call.sentiment]}</span>
    ) : null}
    <span className={getStatusClass(call.analysisStatus)}>{statusLabels[call.analysisStatus]}</span>
    {call.priority === "high" ? <span className="jv-meta-risk">Risque</span> : null}
    {call.mergedCallCount > 1 ? <span>{call.mergedCallCount} logs</span> : null}
  </span>
);

const CallList = ({
  calls,
  isLoading,
  onSelectCall,
  selectedCallId,
}: {
  calls: CallListItem[];
  isLoading: boolean;
  onSelectCall: (call: CallListItem) => void;
  selectedCallId: string | null;
}) => (
  <section className="jv-list-shell" aria-busy={isLoading} aria-label="Liste des appels">
    <header className="jv-list-head">
      <SectionLabel icon={History}>Appels récents</SectionLabel>
      <span className="jv-list-count">
        {calls.length} résultat{calls.length > 1 ? "s" : ""}
      </span>
    </header>
    <div className="jv-list-body">
      {isLoading && calls.length === 0 ? <p className="jv-list-empty">Chargement des appels…</p> : null}
      {!isLoading && calls.length === 0 ? <p className="jv-list-empty">Aucun appel sur cette période.</p> : null}
      {calls.map((call) => (
        <button
          className={selectedCallId === call.id ? "jv-list-item selected" : "jv-list-item"}
          key={call.id}
          onClick={() => onSelectCall(call)}
          type="button"
        >
          <span className="jv-list-main">
            <strong>{getCallTitle(call)}</strong>
            <small>{[call.contactName, call.ownerName].filter(Boolean).join(" · ") || "Contact non renseigné"}</small>
            <CallMeta call={call} showSentiment={call.analysisStatus === "analyzed"} />
          </span>
          <span className="jv-list-side">
            <time>{formatDateTime(call.startedAt)}</time>
            <em>{formatDuration(call.durationSeconds)}</em>
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

const DetailPanel = ({
  call,
  detail,
  isAnalyzingCall,
  isLoading,
  onAnalyzeCall,
  role,
}: {
  call: CallListItem | null;
  detail: CallDetail | null;
  isAnalyzingCall: boolean;
  isLoading: boolean;
  onAnalyzeCall: () => void;
  role: CallActorRole;
}) => {
  if (!call) {
    return (
      <aside className="jv-detail">
        <div className="jv-detail-empty">
          <PhoneCall aria-hidden="true" size={20} strokeWidth={1.25} />
          <strong>Sélectionnez un appel</strong>
          <p>Résumé, objections et prochaines actions recommandées par Jarvis.</p>
        </div>
      </aside>
    );
  }

  const selected = detail ?? call;
  const analysis = detail?.analysis ?? null;
  const isAnalyzed = Boolean(analysis);

  return (
    <aside className="jv-detail" aria-busy={isLoading}>
      <header className="jv-detail-head">
        <div>
          <h2>{getCallTitle(selected)}</h2>
          <p>
            {[
              selected.contactName,
              selected.ownerName,
              formatDateTime(selected.startedAt),
              formatDuration(selected.durationSeconds),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <button
          className="jv-btn-ghost"
          disabled={isAnalyzingCall || isLoading}
          onClick={onAnalyzeCall}
          title={isAnalyzed ? "Relancer l'analyse de cet appel" : "Analyser cet appel"}
          type="button"
        >
          {isAnalyzingCall ? <RefreshCw className="jv-spin" size={14} strokeWidth={1.5} /> : <Sparkles size={14} strokeWidth={1.5} />}
          {isAnalyzed ? "Relancer" : "Analyser"}
        </button>
      </header>

      <CallMeta call={selected} showSentiment={Boolean(analysis)} />

      {detail?.sourceKind ? (
        <p className="jv-detail-source">
          Source {sourceKindLabels[detail.sourceKind]}
          {analysis?.generatedAt ? ` · Analysé le ${formatDateTime(analysis.generatedAt)}` : ""}
        </p>
      ) : null}

      {isLoading && !detail ? <p className="jv-detail-loading">Chargement…</p> : null}

      {!isLoading && !isAnalyzed ? (
        <div className="jv-callout">
          <Sparkles aria-hidden="true" size={15} strokeWidth={1.5} />
          <div>
            <p>Cet appel n'a pas encore été analysé.</p>
            <small>Lancez l'analyse pour obtenir le résumé et les prochaines actions.</small>
          </div>
        </div>
      ) : null}

      {analysis?.summary ? (
        <DetailSection icon={AlignLeft} label="Résumé">
          <p className="jv-prose">{analysis.summary}</p>
        </DetailSection>
      ) : null}

      {analysis && analysis.objections.length > 0 ? (
        <DetailSection icon={MessageCircleWarning} label="Objections">
          <ul className="jv-bullet-list">
            {analysis.objections.map((objection) => (
              <li key={objection}>{objection}</li>
            ))}
          </ul>
        </DetailSection>
      ) : null}

      {analysis && analysis.nextSteps.length > 0 ? (
        <DetailSection icon={ListChecks} label="Prochaines actions">
          <ul className="jv-bullet-list">
            {analysis.nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </DetailSection>
      ) : null}

      {analysis && analysis.risks.length > 0 ? (
        <DetailSection icon={AlertTriangle} label="Risques">
          <ul className="jv-risk-list">
            {analysis.risks.map((signal) => (
              <li key={signal}>
                <AlertTriangle aria-hidden="true" size={12} strokeWidth={1.5} />
                <span>{signal}</span>
              </li>
            ))}
          </ul>
        </DetailSection>
      ) : null}

      {analysis && analysis.customerNeeds.length > 0 ? (
        <DetailSection icon={Lightbulb} label="Points clés du client">
          <ul className="jv-bullet-list">
            {analysis.customerNeeds.map((signal) => (
              <li key={signal}>{signal}</li>
            ))}
          </ul>
        </DetailSection>
      ) : null}

      {analysis ? (
        role === "manager" ? (
          <DetailSection icon={Users} label="Coaching manager">
            {analysis.coachingNotes.length > 0 ? (
              analysis.coachingNotes.map((note) => (
                <p className="jv-prose" key={note}>
                  {note}
                </p>
              ))
            ) : (
              <p className="jv-prose">Aucun coaching consolidé pour cet appel.</p>
            )}
          </DetailSection>
        ) : (
          <DetailSection icon={ListChecks} label="Action sales">
            <p className="jv-prose">
              Reprendre le contexte, confirmer le next step et mettre à jour HubSpot après l'appel.
            </p>
          </DetailSection>
        )
      ) : null}

      {detail?.transcript ? (
        <DetailSection icon={ScrollText} label="Contenu de l'appel">
          <div className="jv-transcript">{detail.transcript}</div>
        </DetailSection>
      ) : null}
    </aside>
  );
};

const buildSalesOptionsFromOwners = (owners: HubSpotOwnerOption[] = []): Record<string, string> =>
  Object.fromEntries(
    owners
      .filter((owner) => owner.userId)
      .map((owner) => [owner.userId as string, owner.name]),
  );

export const CallsView = ({ canViewTeamInsights, orgId, owners = [], role }: CallsViewProps) => {
  const [period, setPeriod] = useState<CallPeriodFilter>("30d");
  const [type, setType] = useState<CallTypeFilter>("all");
  const [calls, setCalls] = useState<CallListItem[]>([]);
  const [insights, setInsights] = useState<CallInsights | null>(null);
  const [salesFilter, setSalesFilter] = useState<string>("all");
  const [salesOptions, setSalesOptions] = useState<Record<string, string>>({});
  const [selectedCall, setSelectedCall] = useState<CallListItem | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<CallDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAnalyzingCall, setIsAnalyzingCall] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedCallId = selectedCall?.id ?? null;
  const filteredUserId = salesFilter === "all" ? null : salesFilter;

  useEffect(() => {
    setSalesOptions(buildSalesOptionsFromOwners(owners));
  }, [owners]);

  const collectSalesOptions = (items: CallListItem[]) => {
    setSalesOptions((current) => {
      const next = { ...current, ...buildSalesOptionsFromOwners(owners) };

      for (const call of items) {
        if (call.userId && call.ownerName) {
          next[call.userId] = call.ownerName;
        }
      }

      return next;
    });
  };

  const refreshLists = async (forceRefresh = false) => {
    const [callsResult, insightsResult] = await Promise.all([
      fetchCalls(orgId, period, type, filteredUserId, {}, forceRefresh),
      fetchCallInsights(orgId, period, filteredUserId, {}, forceRefresh),
    ]);

    setCalls(callsResult.calls);
    collectSalesOptions(callsResult.calls);
    setInsights(insightsResult);
  };

  useEffect(() => {
    const abortController = new AbortController();

    const loadCalls = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const [callsResult, insightsResult] = await Promise.all([
          fetchCalls(orgId, period, type, filteredUserId, { signal: abortController.signal }),
          fetchCallInsights(orgId, period, filteredUserId, { signal: abortController.signal }),
        ]);

        setCalls(callsResult.calls);
        collectSalesOptions(callsResult.calls);
        setInsights(insightsResult);
        setSelectedCall((current) => {
          if (current && callsResult.calls.some((call) => call.id === current.id)) {
            return current;
          }

          return callsResult.calls[0] ?? null;
        });
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "Impossible de charger les appels.");
        setCalls([]);
        setInsights(null);
      } finally {
        setIsLoading(false);
      }
    };

    void loadCalls();

    return () => abortController.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, period, type, salesFilter]);

  useEffect(() => {
    if (!selectedCallId) {
      setSelectedDetail(null);
      return;
    }

    const abortController = new AbortController();

    const loadDetail = async () => {
      try {
        setIsDetailLoading(true);
        setSelectedDetail(null);
        setError(null);
        setSelectedDetail(await fetchCallDetail(orgId, selectedCallId, { signal: abortController.signal }));
      } catch (detailError) {
        if (detailError instanceof DOMException && detailError.name === "AbortError") {
          return;
        }

        setError(detailError instanceof Error ? detailError.message : "Impossible de charger le détail de l'appel.");
      } finally {
        setIsDetailLoading(false);
      }
    };

    void loadDetail();

    return () => abortController.abort();
  }, [orgId, selectedCallId]);

  const handleRunAnalysis = async () => {
    try {
      setIsAnalyzing(true);
      setMessage(null);
      setError(null);
      const result = await runCallAnalysis(orgId, period);

      setMessage(
        `${result.analyzedCount} appel(s) analysé(s), ${result.skippedCount} ignoré(s), ${result.failedCount} échec(s).`,
      );
      await refreshLists(true);
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "Impossible de lancer l'analyse des appels.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAnalyzeCall = async () => {
    if (!selectedCallId) {
      return;
    }

    try {
      setIsAnalyzingCall(true);
      setError(null);
      const refreshed = await analyzeSingleCall(orgId, selectedCallId, Boolean(selectedDetail?.analysis));

      setSelectedDetail(refreshed);
      setCalls((current) =>
        current.map((call) =>
          call.id === refreshed.id
            ? {
                ...call,
                analysisStatus: "analyzed",
                sentiment: refreshed.sentiment,
                summary: refreshed.summary,
                priority: refreshed.priority,
              }
            : call,
        ),
      );
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "Impossible d'analyser cet appel.");
    } finally {
      setIsAnalyzingCall(false);
    }
  };

  return (
    <div className="jv-calls-page" aria-label="Intelligence appels">
      <header className="jv-page-header">
        <PhoneCall aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
        <h1>Appels</h1>
      </header>

      <div className="jv-toolbar">
        <div className="jv-toolbar-filters">
          <FilterPills active={period} onChange={setPeriod} options={periodOptions} />
          <FilterPills active={type} onChange={setType} options={typeOptions} />
        </div>
        <div className="jv-toolbar-actions">
          {canViewTeamInsights ? (
            <select
              aria-label="Filtrer par équipe"
              className="jv-select"
              onChange={(event) => setSalesFilter(event.target.value)}
              value={salesFilter}
            >
              <option value="all">Toute l'équipe</option>
              {Object.entries(salesOptions)
                .sort(([, leftName], [, rightName]) => leftName.localeCompare(rightName))
                .map(([userId, name]) => (
                  <option key={userId} value={userId}>
                    {name}
                  </option>
                ))}
            </select>
          ) : null}
          <button
            className="jv-btn-primary"
            disabled={isAnalyzing}
            onClick={() => void handleRunAnalysis()}
            type="button"
          >
            {isAnalyzing ? <RefreshCw className="jv-spin" size={15} strokeWidth={1.5} /> : <Sparkles size={15} strokeWidth={1.5} />}
            {isAnalyzing ? "Analyse en cours…" : role === "manager" ? "Analyser l'équipe" : "Analyser mes appels"}
          </button>
        </div>
      </div>

      <StatStrip insights={insights} period={period} />
      <ThemesRow insights={insights} />

      {message ? <p className="jv-banner jv-banner-success">{message}</p> : null}
      {error ? <p className="jv-banner jv-banner-error">{error}</p> : null}

      <div className="jv-workspace">
        <CallList calls={calls} isLoading={isLoading} onSelectCall={setSelectedCall} selectedCallId={selectedCallId} />
        <DetailPanel
          call={selectedCall}
          detail={selectedDetail}
          isAnalyzingCall={isAnalyzingCall}
          isLoading={isDetailLoading}
          onAnalyzeCall={() => void handleAnalyzeCall()}
          role={role}
        />
      </div>
    </div>
  );
};