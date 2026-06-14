import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Flame,
  LayoutDashboard,
  ListChecks,
  Radar,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

type BucketId = "actNow" | "thisWeek" | "watch" | "all";
type Priority = "urgent" | "important" | "routine";

type ProspectItem = {
  id: string;
  company: string;
  contact: string;
  dealName: string;
  amount: string;
  stage: string;
  probability: number;
  priority: Priority;
  bucket: BucketId;
  score: number;
  owner: string;
  lastTouch: string;
  nextAction: string;
  dueLabel: string;
  summary: string;
  signals: string[];
  risks: string[];
  actions: string[];
};

const STATS = [
  { label: "Act now", value: "8", caption: "actions prioritaires" },
  { label: "Pipeline", value: "€1,24M", caption: "total du pipe" },
  { label: "Deals", value: "47", caption: "synchronisés" },
  { label: "Avg close", value: "68%", caption: "taux de réussite" },
] as const;

const BUCKETS: Array<{ id: BucketId; label: string; count: number }> = [
  { id: "actNow", label: "Act now", count: 8 },
  { id: "thisWeek", label: "This week", count: 12 },
  { id: "watch", label: "Watch", count: 6 },
  { id: "all", label: "All", count: 47 },
];

const SIGNALS = [
  { label: "Close date dépassée", count: 4 },
  { label: "Aucun contact 14j+", count: 3 },
  { label: "Probabilité en baisse", count: 2 },
] as const;

const SUGGESTED = [
  { label: "Relancer NovaRetail", count: 1 },
  { label: "Booker démo Helios", count: 1 },
  { label: "Valider champion Atlas", count: 1 },
] as const;

const PROSPECTS: ProspectItem[] = [
  {
    id: "1",
    company: "NovaRetail",
    contact: "Marie Dupont",
    dealName: "Renouvellement Q3",
    amount: "€84 000",
    stage: "Négociation",
    probability: 72,
    priority: "urgent",
    bucket: "actNow",
    score: 92,
    owner: "Thomas Martin",
    lastTouch: "Il y a 2j",
    nextAction: "Confirmer le comité budget",
    dueLabel: "Aujourd'hui",
    summary:
      "Deal chaud en phase finale. Marie est alignée sur la valeur, il manque la validation budget et l'implication du DSI.",
    signals: ["Probabilité +8 pts cette semaine", "Champion identifié", "Next step clair"],
    risks: ["Décideur budget pas encore en call", "Concurrent en évaluation parallèle"],
    actions: ["Inviter le DSI sur la prochaine démo", "Envoyer le business case mis à jour"],
  },
  {
    id: "2",
    company: "Helios SaaS",
    contact: "Paul Girard",
    dealName: "Pilote 30 jours",
    amount: "€32 000",
    stage: "Discovery",
    probability: 48,
    priority: "important",
    bucket: "thisWeek",
    score: 78,
    owner: "Léa Bernard",
    lastTouch: "Hier",
    nextAction: "Proposer créneau démo ops",
    dueLabel: "Demain",
    summary: "Bon fit ICP, objection pricing en cours de traitement. Ouverture sur un pilote court.",
    signals: ["Inbound récent", "Réponse positive au dernier email"],
    risks: ["Cycle long si pas de pilote cadré"],
    actions: ["Verrouiller le pilote avec critères de succès", "Préparer pricing pack starter"],
  },
  {
    id: "3",
    company: "Atlas Manufacturing",
    contact: "Sophie Laurent",
    dealName: "Déploiement national",
    amount: "€120 000",
    stage: "Contract sent",
    probability: 61,
    priority: "urgent",
    bucket: "actNow",
    score: 85,
    owner: "Thomas Martin",
    lastTouch: "Il y a 5j",
    nextAction: "Relance signature contrat",
    dueLabel: "Aujourd'hui",
    summary: "Contrat envoyé, silence depuis 5 jours. Deal à risque de slippage fin de mois.",
    signals: ["Montant élevé", "Stage avancé"],
    risks: ["Pas de réponse depuis l'envoi contrat", "Close date dans 6 jours"],
    actions: ["Call directe Sophie + sponsor", "Proposer call juridique accéléré"],
  },
  {
    id: "4",
    company: "Bluewave Media",
    contact: "Julien Moreau",
    dealName: "Upsell équipe sales",
    amount: "€18 000",
    stage: "Testing",
    probability: 35,
    priority: "routine",
    bucket: "watch",
    score: 54,
    owner: "Léa Bernard",
    lastTouch: "Il y a 8j",
    nextAction: "Check-in usage produit",
    dueLabel: "Cette semaine",
    summary: "Test en cours, engagement moyen. À surveiller sans action immédiate.",
    signals: ["Usage actif sur 2 licences"],
    risks: ["Champion peu disponible"],
    actions: ["Partager success story similaire", "Proposer session enablement"],
  },
  {
    id: "5",
    company: "Globex Industries",
    contact: "Camille Renard",
    dealName: "Expansion EMEA",
    amount: "€56 000",
    stage: "Initial proposition",
    probability: 42,
    priority: "important",
    bucket: "thisWeek",
    score: 71,
    owner: "Thomas Martin",
    lastTouch: "Il y a 3j",
    nextAction: "Envoyer proposition révisée",
    dueLabel: "Dans 2 j",
    summary: "Proposition en attente de retour. Bon engagement multi-thread.",
    signals: ["2 contacts engagés", "Prochaine étape planifiée"],
    risks: [],
    actions: ["Relance courte avec next step daté"],
  },
];

const priorityLabels: Record<Priority, string> = {
  urgent: "Hot",
  important: "Warm",
  routine: "Nurture",
};

const priorityClass: Record<Priority, string> = {
  urgent: "jv-meta-risk",
  important: "jv-meta-pending",
  routine: "jv-meta-ok",
};

const SectionLabel = ({ children, icon: Icon }: { children: string; icon: LucideIcon }) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

const StatStrip = () => (
  <section className="jv-stat-strip cols-4" aria-label="Résumé pipeline">
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

const ScoreBanner = () => (
  <section className="jv-score-banner" aria-label="Score priorité pipeline">
    <div className="jv-score-ring" style={{ background: "conic-gradient(#d4714a 320deg, #ece9e3 0)" }}>
      <span>87</span>
    </div>
    <div className="jv-score-copy">
      <strong>Très bon</strong>
      <p>Queue bien priorisée — 8 prospects demandent une action aujourd'hui.</p>
    </div>
    <span className="jv-score-badge">
      <Sparkles size={11} strokeWidth={1.5} />
      IA
    </span>
  </section>
);

const ProspectMeta = ({ prospect }: { prospect: ProspectItem }) => (
  <span className="jv-item-meta">
    <span className={priorityClass[prospect.priority]}>{priorityLabels[prospect.priority]}</span>
    <span>{prospect.stage}</span>
    <span>{prospect.probability}%</span>
    <span className="jv-meta-score">Score {prospect.score}</span>
  </span>
);

const ProspectList = ({
  prospects,
  selectedId,
  onSelect,
}: {
  prospects: ProspectItem[];
  selectedId: string;
  onSelect: (id: string) => void;
}) => (
  <section className="jv-list-shell">
    <header className="jv-list-head">
      <SectionLabel icon={Users}>Queue prospects</SectionLabel>
      <span className="jv-list-count">{prospects.length} résultat{prospects.length > 1 ? "s" : ""}</span>
    </header>
    <div className="jv-list-body">
      {prospects.map((prospect) => (
        <button
          className={selectedId === prospect.id ? "jv-list-item selected" : "jv-list-item"}
          key={prospect.id}
          onClick={() => onSelect(prospect.id)}
          type="button"
        >
          <span className="jv-list-main">
            <strong>{prospect.company}</strong>
            <small>
              {prospect.contact} · {prospect.dealName}
            </small>
            <ProspectMeta prospect={prospect} />
          </span>
          <span className="jv-list-side">
            <time>{prospect.lastTouch}</time>
            <em>{prospect.amount}</em>
            <ChevronRight size={14} strokeWidth={1.5} />
          </span>
        </button>
      ))}
    </div>
  </section>
);

const ProspectDetail = ({ prospect }: { prospect: ProspectItem | null }) => {
  if (!prospect) {
    return (
      <aside className="jv-detail">
        <div className="jv-detail-empty">
          <Target size={20} strokeWidth={1.25} />
          <strong>Sélectionnez un prospect</strong>
          <p>Deal, prochaine action et signaux de priorité Jarvis.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="jv-detail">
      <header className="jv-detail-head">
        <div>
          <h2>{prospect.company}</h2>
          <p>
            {prospect.dealName} · {prospect.amount} · {prospect.stage} · {prospect.owner}
          </p>
        </div>
        <button className="jv-btn-ghost" type="button">
          <Sparkles size={14} strokeWidth={1.5} />
          Analyse deal
        </button>
      </header>

      <ProspectMeta prospect={prospect} />

      <div className="jv-callout">
        <ListChecks size={15} strokeWidth={1.5} />
        <div>
          <p>{prospect.nextAction}</p>
          <small>
            {prospect.dueLabel} · {prospect.lastTouch}
          </small>
        </div>
      </div>

      <section className="jv-detail-section">
        <SectionLabel icon={TrendingUp}>Contexte</SectionLabel>
        <p className="jv-prose">{prospect.summary}</p>
      </section>

      {prospect.signals.length > 0 ? (
        <section className="jv-detail-section">
          <SectionLabel icon={Radar}>Signaux positifs</SectionLabel>
          <ul className="jv-bullet-list">
            {prospect.signals.map((signal) => (
              <li key={signal}>{signal}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {prospect.risks.length > 0 ? (
        <section className="jv-detail-section">
          <SectionLabel icon={AlertTriangle}>Risques</SectionLabel>
          <ul className="jv-risk-list">
            {prospect.risks.map((risk) => (
              <li key={risk}>
                <AlertTriangle size={12} strokeWidth={1.5} />
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {prospect.actions.length > 0 ? (
        <section className="jv-detail-section">
          <SectionLabel icon={ListChecks}>Actions suggérées</SectionLabel>
          <ul className="jv-bullet-list">
            {prospect.actions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </aside>
  );
};

export const JarvisOverviewPage = () => {
  const [bucket, setBucket] = useState<BucketId>("actNow");
  const [statusFilter, setStatusFilter] = useState("open");
  const [selectedId, setSelectedId] = useState(PROSPECTS[0]?.id ?? "");

  const filteredProspects = useMemo(() => {
    if (bucket === "all") {
      return PROSPECTS;
    }

    return PROSPECTS.filter((prospect) => prospect.bucket === bucket);
  }, [bucket]);

  const selectedProspect = filteredProspects.find((p) => p.id === selectedId) ?? filteredProspects[0] ?? null;

  return (
    <div className="jv-overview-page">
      <header className="jv-page-header">
        <LayoutDashboard aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
        <h1>
          Vue d'ensemble
          <span className="jv-page-kicker">pipeline</span>
        </h1>
      </header>

      <div className="jv-toolbar">
        <div className="jv-toolbar-filters">
          <div className="jv-filter-pills jv-bucket-pills" role="group" aria-label="Buckets queue">
            {BUCKETS.map((item) => (
              <button
                className={bucket === item.id ? "active" : ""}
                key={item.id}
                onClick={() => setBucket(item.id)}
                type="button"
              >
                {item.label}
                <em>{item.count}</em>
              </button>
            ))}
          </div>
        </div>
        <div className="jv-toolbar-actions">
          <select
            aria-label="Filtrer par statut deal"
            className="jv-select"
            onChange={(event) => setStatusFilter(event.target.value)}
            value={statusFilter}
          >
            <option value="open">Deals ouverts</option>
            <option value="all">Tous</option>
            <option value="won">Signés</option>
            <option value="lost">Closed lost</option>
          </select>
          <button className="jv-btn-primary" type="button">
            <RefreshCw size={15} strokeWidth={1.5} />
            Sync HubSpot
          </button>
        </div>
      </div>

      <StatStrip />
      <ScoreBanner />

      <section className="jv-themes-row">
        <ThemeBlock empty="Aucun signal." icon={Flame} items={SIGNALS} title="Signaux du jour" />
        <ThemeBlock empty="Aucune action." icon={Target} items={SUGGESTED} title="Actions suggérées" />
      </section>

      <div className="jv-workspace">
        <ProspectList onSelect={setSelectedId} prospects={filteredProspects} selectedId={selectedProspect?.id ?? ""} />
        <ProspectDetail prospect={selectedProspect} />
      </div>
    </div>
  );
};