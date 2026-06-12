import { RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  fetchCallDetail,
  fetchCallInsights,
  fetchCalls,
  runCallAnalysis,
  type CallActorRole,
  type CallDetail,
  type CallInsights,
  type CallListItem,
  type CallPeriodFilter,
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

const getCallTitle = (call: CallListItem): string =>
  call.dealName ?? call.companyName ?? call.contactName ?? `Appel ${call.id.slice(0, 8)}`;

const getEmptyDetail = (call: CallListItem | null): string =>
  call ? "Chargement du detail de l'appel..." : "Selectionnez un appel pour voir le resume, les signaux et les actions.";

const InsightMetric = ({ label, value }: { label: string; value: string | number }) => (
  <article className="calls-metric">
    <strong>{value}</strong>
    <span>{label}</span>
  </article>
);

const CallsInsightsPanel = ({ insights }: { insights: CallInsights | null }) => (
  <aside className="calls-insights-panel">
    <div className="calls-panel-title">
      <span>Insights agreges</span>
      <small>{insights ? `Mis a jour ${formatDateTime(insights.generatedAt)}` : "En attente de donnees"}</small>
    </div>

    <div className="calls-metric-grid">
      <InsightMetric label="Appels" value={insights?.totalCalls ?? "--"} />
      <InsightMetric label="Analyses" value={insights?.analyzedCalls ?? "--"} />
      <InsightMetric label="Connectes" value={insights?.connectedCalls ?? "--"} />
      <InsightMetric label="Sentiment +" value={insights ? `${insights.positiveSentimentRate}%` : "--"} />
    </div>

    <div className="calls-insight-section">
      <strong>Objections frequentes</strong>
      {(insights?.topObjections ?? []).length > 0 ? (
        <ul>
          {insights?.topObjections.map((item) => (
            <li key={item.label}>
              <span>{item.label}</span>
              <small>{item.count}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p>Aucune objection consolidee.</p>
      )}
    </div>

    <div className="calls-insight-section">
      <strong>Themes de coaching</strong>
      {(insights?.coachingThemes ?? []).length > 0 ? (
        <ul>
          {insights?.coachingThemes.map((item) => (
            <li key={item.label}>
              <span>{item.label}</span>
              <small>{item.count}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p>Aucun theme detecte.</p>
      )}
    </div>
  </aside>
);

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
    {isLoading && calls.length === 0 ? <p className="calls-empty">Chargement des appels...</p> : null}
    {!isLoading && calls.length === 0 ? <p className="calls-empty">Aucun appel trouve sur cette periode.</p> : null}
    {calls.map((call) => (
      <button
        className={selectedCallId === call.id ? "calls-list-item active" : "calls-list-item"}
        key={call.id}
        onClick={() => onSelectCall(call)}
        type="button"
      >
        <span className="calls-list-main">
          <strong>{getCallTitle(call)}</strong>
          <small>{[call.contactName, call.ownerName].filter(Boolean).join(" - ") || "Contact non renseigne"}</small>
        </span>
        <span className="calls-list-meta">
          <small>{formatDateTime(call.startedAt)}</small>
          <small>{formatDuration(call.durationSeconds)}</small>
        </span>
        <span className="calls-tags">
          <span>{call.direction === "outbound" ? "Sortant" : "Entrant"}</span>
          <span>{outcomeLabels[call.outcome]}</span>
          <span className={`calls-status calls-status-${call.analysisStatus}`}>{statusLabels[call.analysisStatus]}</span>
        </span>
      </button>
    ))}
  </section>
);

const CallsDetailPanel = ({
  call,
  detail,
  isLoading,
  role,
}: {
  call: CallListItem | null;
  detail: CallDetail | null;
  isLoading: boolean;
  role: CallActorRole;
}) => {
  const selectedDetail = detail ?? call;

  return (
    <aside className="calls-detail-panel" aria-busy={isLoading}>
      {!selectedDetail ? <p className="calls-empty">{getEmptyDetail(call)}</p> : null}
      {selectedDetail ? (
        <>
          <div className="calls-panel-title">
            <span>{getCallTitle(selectedDetail)}</span>
            <small>{formatDateTime(selectedDetail.startedAt)}</small>
          </div>
          <div className="calls-detail-summary">
            <span>{selectedDetail.companyName ?? "Compte non renseigne"}</span>
            <span>{selectedDetail.ownerName ?? "Owner non renseigne"}</span>
            <span>{formatDuration(selectedDetail.durationSeconds)}</span>
          </div>
          <section className="calls-detail-block">
            <strong>Resume</strong>
            <p>{detail?.analysis?.summary ?? selectedDetail.summary ?? getEmptyDetail(call)}</p>
          </section>
          <section className="calls-detail-block">
            <strong>Next step</strong>
            <p>{selectedDetail.nextStep ?? "Aucune prochaine action detectee."}</p>
          </section>
          <section className="calls-detail-block">
            <strong>Signaux</strong>
            <div className="calls-signal-columns">
              <div>
                <small>Risques</small>
                {(selectedDetail.riskSignals.length > 0 ? selectedDetail.riskSignals : detail?.analysis?.risks ?? []).map((signal) => (
                  <span key={signal}>{signal}</span>
                ))}
              </div>
              <div>
                <small>Positifs</small>
                {selectedDetail.positiveSignals.map((signal) => (
                  <span key={signal}>{signal}</span>
                ))}
              </div>
            </div>
          </section>
          {role === "manager" ? (
            <section className="calls-detail-block">
              <strong>Coaching manager</strong>
              {(detail?.analysis?.coachingNotes ?? []).length > 0 ? (
                detail?.analysis?.coachingNotes.map((note) => <p key={note}>{note}</p>)
              ) : (
                <p>Aucun coaching consolide pour cet appel.</p>
              )}
            </section>
          ) : (
            <section className="calls-detail-block">
              <strong>Action sales</strong>
              <p>Reprendre le contexte, confirmer le next step et mettre a jour HubSpot apres l'appel.</p>
            </section>
          )}
        </>
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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedCallId = selectedCall?.id ?? null;
  const analyzedCount = useMemo(() => calls.filter((call) => call.analysisStatus === "analyzed").length, [calls]);

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
      setMessage(`${result.analyzedCount} appel(s) analyse(s), ${result.failedCount} echec(s).`);
      const [callsResult, insightsResult] = await Promise.all([fetchCalls(orgId, period, type), fetchCallInsights(orgId, period)]);
      setCalls(callsResult.calls);
      setInsights(insightsResult);
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "Impossible de lancer l'analyse des appels.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <section className="ae-view-panel calls-view" aria-label="Call intelligence">
      <div className="calls-toolbar">
        <div className="calls-filters" aria-label="Filtres appels">
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
          {typeOptions.map((option) => (
            <button className={type === option.id ? "active" : ""} key={option.id} onClick={() => setType(option.id)} type="button">
              {option.label}
            </button>
          ))}
        </div>
        <button className="calls-primary-action" disabled={isAnalyzing} onClick={() => void handleRunAnalysis()} type="button">
          {isAnalyzing ? <RefreshCw size={16} /> : <Sparkles size={16} />}
          {role === "manager" ? "Analyser equipe" : "Analyser mes appels"}
        </button>
      </div>

      <div className="calls-status-row">
        <span>{calls.length} appel(s)</span>
        <span>{analyzedCount} analyse(s)</span>
        {canViewTeamInsights ? <span>Vue manager active</span> : <span>Vue sales active</span>}
      </div>
      {message ? <p className="calls-message">{message}</p> : null}
      {error ? <p className="calls-error">{error}</p> : null}

      <div className="calls-layout">
        <CallsList calls={calls} isLoading={isLoading} onSelectCall={setSelectedCall} selectedCallId={selectedCallId} />
        <CallsDetailPanel call={selectedCall} detail={selectedDetail} isLoading={isDetailLoading} role={role} />
        <CallsInsightsPanel insights={insights} />
      </div>
    </section>
  );
};
