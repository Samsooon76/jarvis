import { useState } from "react";
import {
  AlertTriangle,
  AlignLeft,
  ChevronRight,
  GraduationCap,
  History,
  ListChecks,
  MessageCircleWarning,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  ScrollText,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

type CallDirection = "inbound" | "outbound";
type CallSentiment = "positive" | "neutral" | "negative" | "mixed";
type AnalysisStatus = "analyzed" | "pending" | "not_analyzed";

type CallItem = {
  id: string;
  company: string;
  contact: string;
  owner: string;
  direction: CallDirection;
  outcome: string;
  sentiment: CallSentiment | null;
  status: AnalysisStatus;
  startedAt: string;
  duration: string;
  risk?: boolean;
  summary?: string;
  objections?: string[];
  nextSteps?: string[];
  risks?: string[];
  coaching?: string[];
  transcript?: string;
};

const STATS = [
  { label: "Appels", value: "142", caption: "sur 30 jours" },
  { label: "Connectés", value: "89", caption: "63% du total" },
  { label: "Durée moyenne", value: "4m 12s", caption: "" },
  { label: "Analysés", value: "67", caption: "47% du total" },
  { label: "Sentiment +", value: "72%", caption: "des appels analysés" },
] as const;

const OBJECTIONS = [
  { label: "Budget non validé", count: 12 },
  { label: "Timing Q3", count: 8 },
  { label: "Concurrent en place", count: 6 },
  { label: "Décideur absent", count: 5 },
] as const;

const COACHING = [
  { label: "Qualifier le champion", count: 9 },
  { label: "Reformuler la valeur", count: 7 },
  { label: "Closer le next step", count: 6 },
] as const;

const CALLS: CallItem[] = [
  {
    id: "1",
    company: "NovaRetail",
    contact: "Marie Dupont",
    owner: "Thomas Martin",
    direction: "outbound",
    outcome: "Connecté",
    sentiment: "positive",
    status: "analyzed",
    startedAt: "14 juin · 09:42",
    duration: "8m 34s",
    summary:
      "Échange productif sur l'intégration HubSpot. Marie confirme l'intérêt pour l'automatisation post-call et demande une démo avec l'équipe ops.",
    objections: ["Budget à valider en comité fin juin", "Besoin d'un accord DSI sur l'API"],
    nextSteps: ["Envoyer le one-pager technique", "Planifier démo avec ops — mardi 17"],
    risks: ["Décideur budget pas encore impliqué"],
    coaching: ["Bien cadré le next step — pousser l'invitation du DSI dès le mail de suivi."],
    transcript:
      "Thomas: Bonjour Marie, je vous appelle suite à notre échange LinkedIn…\nMarie: Oui, on cherche justement à structurer le suivi commercial…",
  },
  {
    id: "2",
    company: "Helios SaaS",
    contact: "Paul Girard",
    owner: "Léa Bernard",
    direction: "inbound",
    outcome: "Next step",
    sentiment: "mixed",
    status: "analyzed",
    startedAt: "13 juin · 16:18",
    duration: "5m 02s",
    summary: "Paul revient sur une démo. Objection pricing, mais ouverture sur un pilote 30 jours.",
    objections: ["Pricing vs concurrent", "Délai d'onboarding perçu comme long"],
    nextSteps: ["Proposition pilote 30 jours", "Call de suivi vendredi"],
  },
  {
    id: "3",
    company: "Atlas Manufacturing",
    contact: "Sophie Laurent",
    owner: "Thomas Martin",
    direction: "outbound",
    outcome: "Sans réponse",
    sentiment: null,
    status: "not_analyzed",
    startedAt: "12 juin · 11:05",
    duration: "0m 32s",
    risk: true,
  },
  {
    id: "4",
    company: "Bluewave Media",
    contact: "Julien Moreau",
    owner: "Léa Bernard",
    direction: "outbound",
    outcome: "RDV booké",
    sentiment: "positive",
    status: "analyzed",
    startedAt: "11 juin · 14:55",
    duration: "12m 18s",
    summary: "RDV discovery booké pour le 18 juin. Bon fit ICP, équipe de 8 commerciaux.",
    nextSteps: ["Préparer battlecard concurrent", "Sync CRM avant le RDV"],
  },
];

const PERIODS = ["7 jours", "30 jours", "90 jours"] as const;
const TYPES = ["Tous", "Sortants", "Entrants"] as const;

const sentimentColor: Record<CallSentiment, string> = {
  positive: "text-[var(--jv-success)]",
  neutral: "text-[var(--jv-muted)]",
  negative: "text-[var(--jv-danger)]",
  mixed: "text-[var(--jv-warning)]",
};

const SectionLabel = ({ children, icon: Icon }: { children: string; icon: LucideIcon }) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

const FilterPills = ({
  options,
  active,
  onChange,
}: {
  options: readonly string[];
  active: string;
  onChange: (value: string) => void;
}) => (
  <div className="jv-filter-pills" role="group">
    {options.map((option) => (
      <button
        className={active === option ? "active" : ""}
        key={option}
        onClick={() => onChange(option)}
        type="button"
      >
        {option}
      </button>
    ))}
  </div>
);

const StatStrip = () => (
  <section className="jv-stat-strip" aria-label="Indicateurs appels">
    {STATS.map((stat, index) => (
      <div className="jv-stat" key={stat.label} style={{ animationDelay: `${index * 60}ms` }}>
        <span className="jv-stat-label">{stat.label}</span>
        <strong className="jv-stat-value">{stat.value}</strong>
        {stat.caption ? <small className="jv-stat-caption">{stat.caption}</small> : null}
      </div>
    ))}
  </section>
);

const ThemeBlock = ({
  empty,
  icon,
  items,
  title,
}: {
  empty: string;
  icon: LucideIcon;
  items: ReadonlyArray<{ label: string; count: number }>;
  title: string;
}) => (
  <div className="jv-theme-block">
    <SectionLabel icon={icon}>{title}</SectionLabel>
    {items.length > 0 ? (
      <ul className="jv-theme-list">
        {items.map((item) => (
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

const CallMeta = ({ call }: { call: CallItem }) => (
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
    <span>{call.outcome}</span>
    {call.sentiment ? (
      <span className={sentimentColor[call.sentiment]}>
        {call.sentiment === "positive"
          ? "Positif"
          : call.sentiment === "negative"
            ? "Négatif"
            : call.sentiment === "mixed"
              ? "Mitigé"
              : "Neutre"}
      </span>
    ) : null}
    <span className={call.status === "analyzed" ? "jv-meta-ok" : "jv-meta-pending"}>
      {call.status === "analyzed" ? "Analysé" : "À analyser"}
    </span>
    {call.risk ? <span className="jv-meta-risk">Risque</span> : null}
  </span>
);

const CallList = ({
  calls,
  selectedId,
  onSelect,
}: {
  calls: CallItem[];
  selectedId: string;
  onSelect: (id: string) => void;
}) => (
  <section className="jv-list-shell">
    <header className="jv-list-head">
      <SectionLabel icon={History}>Appels récents</SectionLabel>
      <span className="jv-list-count">{calls.length} résultats</span>
    </header>
    <div className="jv-list-body">
      {calls.map((call) => (
        <button
          className={selectedId === call.id ? "jv-list-item selected" : "jv-list-item"}
          key={call.id}
          onClick={() => onSelect(call.id)}
          type="button"
        >
          <span className="jv-list-main">
            <strong>{call.company}</strong>
            <small>
              {call.contact} · {call.owner}
            </small>
            <CallMeta call={call} />
          </span>
          <span className="jv-list-side">
            <time>{call.startedAt}</time>
            <em>{call.duration}</em>
            <ChevronRight size={14} strokeWidth={1.5} />
          </span>
        </button>
      ))}
    </div>
  </section>
);

const DetailPanel = ({ call }: { call: CallItem | null }) => {
  if (!call) {
    return (
      <aside className="jv-detail">
        <div className="jv-detail-empty">
          <PhoneCall size={20} strokeWidth={1.25} />
          <strong>Sélectionnez un appel</strong>
          <p>Résumé, objections et prochaines actions recommandées par Jarvis.</p>
        </div>
      </aside>
    );
  }

  const analyzed = call.status === "analyzed";

  return (
    <aside className="jv-detail">
      <header className="jv-detail-head">
        <div>
          <h2>{call.company}</h2>
          <p>
            {call.contact} · {call.owner} · {call.startedAt} · {call.duration}
          </p>
        </div>
        <button className="jv-btn-ghost" type="button">
          <Sparkles size={14} strokeWidth={1.5} />
          {analyzed ? "Relancer" : "Analyser"}
        </button>
      </header>

      <CallMeta call={call} />

      {!analyzed ? (
        <div className="jv-callout">
          <Sparkles size={15} strokeWidth={1.5} />
          <div>
            <p>Cet appel n'a pas encore été analysé.</p>
            <small>Lancez l'analyse pour obtenir le résumé et les prochaines actions.</small>
          </div>
        </div>
      ) : null}

      {call.summary ? (
        <section className="jv-detail-section">
          <SectionLabel icon={AlignLeft}>Résumé</SectionLabel>
          <p className="jv-prose">{call.summary}</p>
        </section>
      ) : null}

      {call.objections && call.objections.length > 0 ? (
        <section className="jv-detail-section">
          <SectionLabel icon={MessageCircleWarning}>Objections</SectionLabel>
          <ul className="jv-bullet-list">
            {call.objections.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {call.nextSteps && call.nextSteps.length > 0 ? (
        <section className="jv-detail-section">
          <SectionLabel icon={ListChecks}>Prochaines actions</SectionLabel>
          <ul className="jv-bullet-list">
            {call.nextSteps.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {call.risks && call.risks.length > 0 ? (
        <section className="jv-detail-section">
          <SectionLabel icon={AlertTriangle}>Risques</SectionLabel>
          <ul className="jv-risk-list">
            {call.risks.map((item) => (
              <li key={item}>
                <AlertTriangle size={12} strokeWidth={1.5} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {call.coaching && call.coaching.length > 0 ? (
        <section className="jv-detail-section">
          <SectionLabel icon={Users}>Coaching manager</SectionLabel>
          {call.coaching.map((note) => (
            <p className="jv-prose" key={note}>
              {note}
            </p>
          ))}
        </section>
      ) : null}

      {call.transcript ? (
        <section className="jv-detail-section">
          <SectionLabel icon={ScrollText}>Contenu de l'appel</SectionLabel>
          <div className="jv-transcript">{call.transcript}</div>
        </section>
      ) : null}
    </aside>
  );
};

export const JarvisCallIntelligencePage = () => {
  const [period, setPeriod] = useState<string>("30 jours");
  const [type, setType] = useState<string>("Tous");
  const [selectedId, setSelectedId] = useState<string>(CALLS[0]?.id ?? "");

  const selectedCall = CALLS.find((call) => call.id === selectedId) ?? null;

  const filteredCalls = CALLS.filter((call) => {
    if (type === "Sortants" && call.direction !== "outbound") return false;
    if (type === "Entrants" && call.direction !== "inbound") return false;
    return true;
  });

  return (
    <div className="jv-calls-page">
      <header className="jv-page-header">
        <PhoneCall aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
        <h1>
          Appels
          <span className="jv-page-kicker">intelligence</span>
        </h1>
      </header>

      <div className="jv-toolbar">
        <div className="jv-toolbar-filters">
          <FilterPills active={period} onChange={setPeriod} options={PERIODS} />
          <FilterPills active={type} onChange={setType} options={TYPES} />
        </div>
        <div className="jv-toolbar-actions">
          <select aria-label="Filtrer par équipe" className="jv-select" defaultValue="all">
            <option value="all">Toute l'équipe</option>
            <option value="thomas">Thomas Martin</option>
            <option value="lea">Léa Bernard</option>
          </select>
          <button className="jv-btn-primary" type="button">
            <Sparkles size={15} strokeWidth={1.5} />
            Analyser l'équipe
          </button>
        </div>
      </div>

      <StatStrip />

      <section className="jv-themes-row">
        <ThemeBlock
          empty="Aucune objection."
          icon={MessageCircleWarning}
          items={OBJECTIONS}
          title="Objections fréquentes"
        />
        <ThemeBlock empty="Aucun thème." icon={GraduationCap} items={COACHING} title="Thèmes de coaching" />
      </section>

      <div className="jv-workspace">
        <CallList calls={filteredCalls} onSelect={setSelectedId} selectedId={selectedId} />
        <DetailPanel call={selectedCall} />
      </div>
    </div>
  );
};