import { PhoneCall, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
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
} from "../../../services/api";
import "../../styles/calls.css";

type CallsViewProps = {
  canViewTeamInsights: boolean;
  orgId: string;
  role: CallActorRole;
};

const periodOptions: Array<{ id: CallPeriodFilter; label: string }> = [
  { id: "7d", label: "7 jours" },
  { id: "30d", label: "30 jours" },
  { id: "90d", label: "90 jours" },
];

const typeOptions: Array<{ id: CallTypeFilter; label: string }> = [
  { id: "all", label: "Tous" },
  { id: "outbound", label: "Sortants" },
  { id: "inbound", label: "Entrants" },
];

const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const formatDuration = (seconds: number | null): string => {
  if (!seconds || seconds <= 0) {
    return "--";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
};

const statusLabels: Record<CallListItem["analysisStatus"], string> = {
  analyzed: "Analyse",
  failed: "Erreur",
  not_analyzed: "A analyser",
  pending: "En attente",
};

const outcomeLabels: Record<CallListItem["outcome"], string> = {
  connected: "Connecte",
  left_voicemail: "Message vocal",
  lost: "Perdu",
  meeting_booked: "RDV booke",
  next_step: "Next step",
  no_answer: "Sans reponse",
  unknown: "Inconnu",
};

const sentimentLabels: Record<CallSentiment, string> = {
  positive: "Positif",
  neutral: "Neutre",
  negative: "Negatif",
  mixed: "Mitige",
};

const sourceKindLabels: Record<NonNullable<CallDetail["sourceKind"]>, string> = {
  transcript: "Transcript",
  notes: "Notes HubSpot",
  summary: "Resume",
};

const getCallTitle = (call: CallListItem): string =>
  call.companyName ?? call.contactName ?? call.dealName ?? `Appel ${call.id.slice(0, 8)}`;

const KpiCard = ({ label, value, caption }: { label: string; value: string | number; caption: string }) => (
  <article className="calls-kpi-card">
    <span className="calls-eyebrow">{label}</span>
    <strong>{value}</strong>
    <small>{caption}</small>
  </article>
);

const formatAverageDuration = (seconds: number): string => {
  if (seconds <= 0) {
    return "--";
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;

  return minutes > 0 ? `${minutes}m ${String(remainder).padStart(2, "0")}s` : `${remainder}s`;
};

const CallsKpiRow = ({ insights }: { insights: CallInsights | null }) => {
  const connectedRate =
    insights && insights.totalCalls > 0 ? Math.round((insights.connectedCalls / insights.totalCalls) * 100) : null;
  const analyzedRate =
    insights && insights.totalCalls > 0 ? Math.round((insights.analyzedCalls / insights.totalCalls) * 100) : null;

  return (
    <div className="calls-kpi-row">
      <KpiCard caption="sur la periode" label="Appels" value={insights?.totalCalls ?? "--"} />
      <KpiCard
        caption={connectedRate !== null ? `${connectedRate}% du total` : "appels >= 45 s"}
        label="Connectes"
        value={insights?.connectedCalls ?? "--"}
      />
      <KpiCard
        caption="par appel connecte ou non"
        label="Duree moyenne"
        value={insights ? formatAverageDuration(insights.averageDurationSeconds) : "--"}
      />
      <KpiCard
        caption={analyzedRate !== null ? `${analyzedRate}% du total` : "via Jarvis"}
        label="Analyses"
        value={insights?.analyzedCalls ?? "--"}
      />
      <KpiCard
        caption="des appels analyses"
        label="Sentiment +"
        value={insights ? `${insights.positiveSentimentRate}%` : "--"}
      />
    </div>
  );
};

const ThemeChips = ({
  emptyLabel,
  items,
  label,
}: {
  emptyLabel: string;
  items: Array<{ label: string; count: number }>;
  label: string;
}) => (
  <div className="calls-theme-card">
    <span className="calls-eyebrow">{label}</span>
    {items.length > 0 ? (
      <div className="calls-theme-chips">
        {items.slice(0, 5).map((item) => (
          <span className="calls-theme-chip" key={item.label} title={item.label}>
            {item.label}
            <small>{item.count}</small>
          </span>
        ))}
      </div>
    ) : (
      <p>{emptyLabel}</p>
    )}
  </div>
);

const CallsThemesRow = ({ insights }: { insights: CallInsights | null }) => (
  <div className="calls-themes-row">
    <ThemeChips
      emptyLabel="Aucune objection consolidee."
      items={insights?.topObjections ?? []}
      label="Objections frequentes"
    />
    <ThemeChips emptyLabel="Aucun theme detecte." items={insights?.coachingThemes ?? []} label="Themes de coaching" />
  </div>
);

const SentimentPill = ({ sentiment }: { sentiment: CallSentiment | null }) =>
  sentiment ? <span className={`calls-pill calls-pill-${sentiment}`}>{sentimentLabels[sentiment]}</span> : null;

const CallsList = ({
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
  <section className="calls-list-panel" aria-busy={isLoading}>
    {isLoading && calls.length === 0 ? <p className="ae-empty">Chargement des appels...</p> : null}
    {!isLoading && calls.length === 0 ? <p className="ae-empty">Aucun appel trouve sur cette periode.</p> : null}
    {calls.map((call) => (
      <button
        className={selectedCallId === call.id ? "calls-list-item selected" : "calls-list-item"}
        key={call.id}
        onClick={() => onSelectCall(call)}
        type="button"
      >
        <span className="calls-list-head">
          <span className="calls-list-main">
            <strong>{getCallTitle(call)}</strong>
            <small>{[call.contactName, call.ownerName].filter(Boolean).join(" · ") || "Contact non renseigne"}</small>
          </span>
          <span className="calls-list-meta">
            <small>{formatDateTime(call.startedAt)}</small>
            <small>{formatDuration(call.durationSeconds)}</small>
          </span>
        </span>
        <span className="calls-tags">
          <span className="calls-tag">{call.direction === "outbound" ? "Sortant" : "Entrant"}</span>
          <span className="calls-tag">{outcomeLabels[call.outcome]}</span>
          <SentimentPill sentiment={call.analysisStatus === "analyzed" ? call.sentiment : null} />
          {call.priority === "high" ? <span className="calls-pill calls-pill-risk">Risque eleve</span> : null}
          <span className={`calls-tag calls-status-${call.analysisStatus}`}>{statusLabels[call.analysisStatus]}</span>
          {call.mergedCallCount > 1 ? <span className="calls-tag calls-tag-merged">{call.mergedCallCount} logs fusionnes</span> : null}
        </span>
      </button>
    ))}
  </section>
);

const DetailSection = ({ label, children }: { label: string; children: ReactNode }) => (
  <section className="calls-detail-block">
    <span className="calls-eyebrow">{label}</span>
    {children}
  </section>
);

const CallsDetailPanel = ({
  call,
  detail,
  isLoading,
  isAnalyzingCall,
  onAnalyzeCall,
  role,
}: {
  call: CallListItem | null;
  detail: CallDetail | null;
  isLoading: boolean;
  isAnalyzingCall: boolean;
  onAnalyzeCall: () => void;
  role: CallActorRole;
}) => {
  if (!call) {
    return (
      <aside className="calls-detail-panel">
        <div className="calls-detail-placeholder">
          <PhoneCall aria-hidden="true" size={20} strokeWidth={1.6} />
          <p>Selectionnez un appel pour voir le resume, les signaux et les actions.</p>
        </div>
      </aside>
    );
  }

  const selected = detail ?? call;
  const analysis = detail?.analysis ?? null;
  const isAnalyzed = Boolean(analysis);

  return (
    <aside className="calls-detail-panel" aria-busy={isLoading}>
      <header className="calls-detail-header">
        <div className="calls-panel-title">
          <span>{getCallTitle(selected)}</span>
          <small>
            {[
              selected.contactName,
              selected.ownerName,
              formatDateTime(selected.startedAt),
              formatDuration(selected.durationSeconds),
            ]
              .filter(Boolean)
              .join(" · ")}
          </small>
        </div>
        <button
          className="calls-secondary-action"
          disabled={isAnalyzingCall || isLoading}
          onClick={onAnalyzeCall}
          title={isAnalyzed ? "Relancer l'analyse de cet appel" : "Analyser cet appel"}
          type="button"
        >
          {isAnalyzingCall ? <RefreshCw className="calls-spin" size={14} /> : <Sparkles size={14} />}
          {isAnalyzed ? "Relancer" : "Analyser"}
        </button>
      </header>

      <div className="calls-detail-chips">
        <span className="calls-tag">{selected.direction === "outbound" ? "Sortant" : "Entrant"}</span>
        <span className="calls-tag">{outcomeLabels[selected.outcome]}</span>
        <SentimentPill sentiment={analysis ? selected.sentiment : null} />
        {detail?.sourceKind ? <span className="calls-tag">Source: {sourceKindLabels[detail.sourceKind]}</span> : null}
        {analysis?.generatedAt ? <span className="calls-tag">Analyse le {formatDateTime(analysis.generatedAt)}</span> : null}
      </div>

      {isLoading && !detail ? <p className="ae-empty compact">Chargement du detail de l'appel...</p> : null}

      {!isLoading && !isAnalyzed ? (
        <div className="calls-detail-callout">
          <p>Cet appel n'a pas encore ete analyse.</p>
          <small>Lancez l'analyse pour obtenir le resume, les objections et les prochaines actions.</small>
        </div>
      ) : null}

      {analysis?.summary ? (
        <DetailSection label="Resume">
          <p>{analysis.summary}</p>
        </DetailSection>
      ) : null}

      {analysis && analysis.objections.length > 0 ? (
        <DetailSection label="Objections">
          <ul className="calls-detail-list">
            {analysis.objections.map((objection) => (
              <li key={objection}>{objection}</li>
            ))}
          </ul>
        </DetailSection>
      ) : null}

      {analysis && analysis.nextSteps.length > 0 ? (
        <DetailSection label="Prochaines actions">
          <ul className="calls-detail-list">
            {analysis.nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </DetailSection>
      ) : null}

      {analysis && analysis.risks.length > 0 ? (
        <DetailSection label="Risques">
          <ul className="calls-detail-list calls-detail-list-risk">
            {analysis.risks.map((signal) => (
              <li key={signal}>{signal}</li>
            ))}
          </ul>
        </DetailSection>
      ) : null}

      {analysis && analysis.customerNeeds.length > 0 ? (
        <DetailSection label="Points cles du client">
          <ul className="calls-detail-list">
            {analysis.customerNeeds.map((signal) => (
              <li key={signal}>{signal}</li>
            ))}
          </ul>
        </DetailSection>
      ) : null}

      {analysis ? (
        role === "manager" ? (
          <DetailSection label="Coaching manager">
            {analysis.coachingNotes.length > 0 ? (
              analysis.coachingNotes.map((note) => <p key={note}>{note}</p>)
            ) : (
              <p>Aucun coaching consolide pour cet appel.</p>
            )}
          </DetailSection>
        ) : (
          <DetailSection label="Action sales">
            <p>Reprendre le contexte, confirmer le next step et mettre a jour HubSpot apres l'appel.</p>
          </DetailSection>
        )
      ) : null}

      {detail?.transcript ? (
        <DetailSection label="Contenu de l'appel">
          <div className="calls-detail-content">{detail.transcript}</div>
        </DetailSection>
      ) : null}
    </aside>
  );
};

export const CallsView = ({ canViewTeamInsights, orgId, role }: CallsViewProps) => {
  const [period, setPeriod] = useState<CallPeriodFilter>("30d");
  const [type, setType] = useState<CallTypeFilter>("all");
  const [calls, setCalls] = useState<CallListItem[]>([]);
  const [insights, setInsights] = useState<CallInsights | null>(null);
  const [selectedCall, setSelectedCall] = useState<CallListItem | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<CallDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAnalyzingCall, setIsAnalyzingCall] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedCallId = selectedCall?.id ?? null;

  const refreshLists = async () => {
    const [callsResult, insightsResult] = await Promise.all([
      fetchCalls(orgId, period, type),
      fetchCallInsights(orgId, period),
    ]);

    setCalls(callsResult.calls);
    setInsights(insightsResult);
  };

  useEffect(() => {
    const abortController = new AbortController();

    const loadCalls = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const [callsResult, insightsResult] = await Promise.all([
          fetchCalls(orgId, period, type, { signal: abortController.signal }),
          fetchCallInsights(orgId, period, { signal: abortController.signal }),
        ]);

        setCalls(callsResult.calls);
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
  }, [orgId, period, type]);

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

        setError(detailError instanceof Error ? detailError.message : "Impossible de charger le detail de l'appel.");
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

      setMessage(`${result.analyzedCount} appel(s) analyse(s), ${result.skippedCount} ignore(s), ${result.failedCount} echec(s).`);
      await refreshLists();
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
            ? { ...call, analysisStatus: "analyzed", sentiment: refreshed.sentiment, summary: refreshed.summary, priority: refreshed.priority }
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
    <section className="ae-view-panel calls-view" aria-label="Call intelligence">
      <div className="calls-toolbar">
        <div className="calls-filters" aria-label="Filtres appels">
          <div className="calls-filter-group" role="group" aria-label="Periode">
            {periodOptions.map((option) => (
              <button
                className={period === option.id ? "active" : ""}
                key={option.id}
                onClick={() => setPeriod(option.id)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="calls-filter-group" role="group" aria-label="Direction">
            {typeOptions.map((option) => (
              <button className={type === option.id ? "active" : ""} key={option.id} onClick={() => setType(option.id)} type="button">
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="calls-toolbar-actions">
          <span className="calls-tag">{canViewTeamInsights ? "Vue manager" : "Vue sales"}</span>
          <button className="calls-primary-action" disabled={isAnalyzing} onClick={() => void handleRunAnalysis()} type="button">
            {isAnalyzing ? <RefreshCw className="calls-spin" size={15} /> : <Sparkles size={15} />}
            {isAnalyzing ? "Analyse en cours..." : role === "manager" ? "Analyser l'equipe" : "Analyser mes appels"}
          </button>
        </div>
      </div>

      <CallsKpiRow insights={insights} />
      <CallsThemesRow insights={insights} />

      {message ? <p className="calls-message">{message}</p> : null}
      {error ? <p className="calls-error">{error}</p> : null}

      <div className="calls-layout">
        <CallsList calls={calls} isLoading={isLoading} onSelectCall={setSelectedCall} selectedCallId={selectedCallId} />
        <CallsDetailPanel
          call={selectedCall}
          detail={selectedDetail}
          isAnalyzingCall={isAnalyzingCall}
          isLoading={isDetailLoading}
          onAnalyzeCall={() => void handleAnalyzeCall()}
          role={role}
        />
      </div>
    </section>
  );
};
