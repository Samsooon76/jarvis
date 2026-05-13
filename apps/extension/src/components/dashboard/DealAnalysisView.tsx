import { useEffect, useMemo, useState } from "react";
import type { QueueProspect } from "@jarvis/shared";
import { CircleHelp, Loader2 } from "lucide-react";
import {
  createFollowUpTask,
  fetchDealActivityPlan,
  fetchDealAnalysisBundle,
  fetchDealAnalysisPage,
  fetchDealQualification,
  type ActivityPlanAction,
  type ActivityPlanDeadline,
  type ActivityPlanInsight,
  type AiProviderOption,
  type BuyingCommitteeMember,
  type DecisionProcess,
  type DealActivityPlanResult,
  type DealAnalysisAction,
  type DealChannelEngagement,
  type DealAnalysisHealthDimension,
  type DealAnalysisMetric,
  type DealAnalysisBundleResult,
  type DealAnalysisPageResult,
  type DealRecentActivity,
  type DealAnalysisTrendPoint,
  type DealQualificationResult,
  type DealQualificationStatus,
  type MeddiccCriterion,
  type QualificationInsight,
  type QualificationRisk,
  type FollowUpTaskResult,
} from "../../services/api";
import { formatAmount, formatDate, formatDateTime } from "../../utils/dashboard/formatters";
import { getInitials } from "../../utils/dashboard/prospects";
import { MetricIcon } from "./MetricIcon";

type DealAnalysisViewProps = {
  activeProspect: QueueProspect | null;
  hubspotPortalId?: string | null;
  orgId: string;
  ownerName?: string;
  onBack: () => void;
  selectedAiProvider: AiProviderOption;
};

type DealSection = "overview" | "qualification" | "activity";

type LoadingStep = {
  label: string;
  detail: string;
};

const pageCache = new Map<string, DealAnalysisPageResult>();
const bundleCache = new Map<string, DealAnalysisBundleResult>();
const qualificationCache = new Map<string, DealQualificationResult>();
const activityPlanCache = new Map<string, DealActivityPlanResult>();
const refreshRetryDelays = [0, 900, 1_800] as const;

const wait = (delayMs: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, delayMs));

const qualificationLoadingSteps: LoadingStep[] = [
  {
    label: "Chargement CRM",
    detail: "Lecture du deal, des contacts et du contexte HubSpot.",
  },
  {
    label: "Historique commercial",
    detail: "Collecte des notes, emails, calls, meetings et SMS dates.",
  },
  {
    label: "Qualification IA",
    detail: "Analyse du comite d'achat, MEDDICC et processus de decision.",
  },
  {
    label: "Validation",
    detail: "Controle du format de reponse avant affichage.",
  },
];

const dealAnalysisLoadingSteps: LoadingStep[] = [
  {
    label: "Resolution du deal",
    detail: "Identification du prospect, du deal HubSpot et du contexte organisation.",
  },
  {
    label: "Lecture HubSpot",
    detail: "Chargement de la timeline, du snapshot deal et des contacts associes.",
  },
  {
    label: "Analyse IA",
    detail: "Evaluation de la probabilite, des risques et des prochaines actions.",
  },
  {
    label: "Preparation dashboard",
    detail: "Construction des metriques, tendances et cartes de synthese.",
  },
];

const activityLoadingSteps: LoadingStep[] = [
  {
    label: "Connexion HubSpot",
    detail: "Resolution du deal et verification de l'acces CRM.",
  },
  {
    label: "Collecte des activites",
    detail: "Lecture des notes, calls, meetings, emails et SMS associes.",
  },
  {
    label: "Consolidation timeline",
    detail: "Tri chronologique avec dates completes et engagement par canal.",
  },
  {
    label: "Analyse IA",
    detail: "Generation du plan d'action, des echeances et des insights.",
  },
  {
    label: "Controle chronologique",
    detail: "Filtrage des echeances passees avant affichage.",
  },
];

const forecastLabels: Record<DealAnalysisPageResult["snapshot"]["forecastLabel"], string> = {
  at_risk: "At risk",
  best_case: "Best case",
  commit: "Commit",
  pipeline: "Pipeline",
};

const levelLabels: Record<DealAnalysisHealthDimension["level"], string> = {
  high: "Eleve",
  low: "Faible",
  medium: "Moyen",
};

const priorityLabels: Record<DealAnalysisAction["priority"], string> = {
  high: "Haute",
  low: "Basse",
  medium: "Moyenne",
};

const qualificationStatusLabels: Record<DealQualificationStatus, string> = {
  confirmed: "Confirme",
  missing: "Manquant",
  partial: "Partiel",
  weak: "Faible",
};

const qualificationStatusTones: Record<DealQualificationStatus, "green" | "amber" | "red" | "muted"> = {
  confirmed: "green",
  missing: "muted",
  partial: "amber",
  weak: "red",
};

const influenceLabels: Record<BuyingCommitteeMember["influence"], string> = {
  high: "Elevee",
  low: "Faible",
  medium: "Moyenne",
};

const sentimentLabels: Record<BuyingCommitteeMember["sentiment"], string> = {
  negative: "Negatif",
  neutral: "Neutre",
  positive: "Positif",
  unknown: "Inconnu",
};

const dealRoleLabels: Record<BuyingCommitteeMember["dealRole"], string> = {
  blocker: "Bloqueur",
  champion: "Champion",
  decision_maker: "Decideur",
  influencer: "Influenceur",
  unknown: "Inconnu",
  user: "Utilisateur",
};

const riskSeverityLabels: Record<QualificationRisk["severity"], string> = {
  high: "Eleve",
  low: "Faible",
  medium: "Moyen",
};

const activityStatusLabels: Record<ActivityPlanAction["status"], string> = {
  done: "Fait",
  in_progress: "En cours",
  planned: "Planifie",
  todo: "A faire",
};

const activityPriorityLabels: Record<ActivityPlanAction["priority"], string> = {
  high: "Elevee",
  low: "Faible",
  medium: "Moyenne",
};

const budgetStatusLabels: Record<DecisionProcess["budgetStatus"], string> = {
  blocked: "Bloque",
  to_confirm: "A preciser",
  unknown: "Inconnu",
  validated: "Valide",
};

const purchaseProcessLabels: Record<DecisionProcess["purchaseProcess"], string> = {
  blocked: "Bloque",
  clear: "Clair",
  to_confirm: "A preciser",
  unknown: "Inconnu",
};

const legalStatusLabels: Record<DecisionProcess["legalStatus"], string> = {
  approved: "Valide",
  blocked: "Bloque",
  in_review: "En revue",
  unknown: "Inconnu",
};

const metricIcons: Record<DealAnalysisMetric["id"], "money" | "clock" | "trend"> = {
  dealValue: "money",
  engagementScore: "trend",
  stageAge: "clock",
  weightedValue: "money",
};

const activityChannelLabels: Record<DealRecentActivity["channel"], string> = {
  call: "Appel",
  deal: "Deal",
  email: "Email",
  meeting: "Rendez-vous",
  note: "Note",
  sms: "SMS",
};

const compactText = (value: string | undefined, maxLength: number): string => {
  const compacted = (value ?? "").replace(/\s+/g, " ").trim();

  if (compacted.length <= maxLength) {
    return compacted;
  }

  return `${compacted.slice(0, maxLength - 3).trim()}...`;
};

const getCacheKey = (orgId: string, selectedAiProvider: AiProviderOption, prospectId: string): string =>
  `${orgId}:${selectedAiProvider.id}:${selectedAiProvider.model}:${prospectId}`;

const getHubSpotDealUrl = (portalId: string | null | undefined, dealId: string | null | undefined): string | null => {
  const trimmedPortalId = portalId?.trim();
  const trimmedDealId = dealId?.trim();

  if (!trimmedPortalId || !trimmedDealId) {
    return null;
  }

  return `https://app.hubspot.com/contacts/${encodeURIComponent(trimmedPortalId)}/record/0-3/${encodeURIComponent(trimmedDealId)}`;
};

const formatOptionalDate = (value: string | null | undefined): string => {
  if (!value) {
    return "Non renseigne";
  }

  return formatDate(value);
};

const formatOptionalDateTime = (value: string | null | undefined): string => {
  if (!value) {
    return "Non renseigne";
  }

  return formatDateTime(value);
};

const formatActivityTime = (value: string | null | undefined): string => {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
};

const buildScoreExplanation = (analysis: DealAnalysisPageResult["analysis"]): string[] => {
  const signals = [
    analysis.whyNow,
    analysis.detailedAnalysis[0],
    ...analysis.positiveSignals.slice(0, 2),
    ...analysis.risks.slice(0, 2),
    ...analysis.evidence.slice(0, 2),
  ];

  return Array.from(new Set(signals.map((signal) => signal.trim()).filter(Boolean))).slice(0, 5);
};

const ActivityChannelIcon = ({ channel }: { channel: DealRecentActivity["channel"] }) => (
  <span
    className="ae-activity-icon"
    aria-label={activityChannelLabels[channel]}
    role="img"
    title={activityChannelLabels[channel]}
  >
    {channel === "email" ? (
      <svg viewBox="0 0 24 24">
        <rect x="4" y="6" width="16" height="12" rx="2" />
        <path d="m5 8 7 5 7-5" />
      </svg>
    ) : null}
    {channel === "call" ? (
      <svg viewBox="0 0 24 24">
        <path d="M8.5 5.5 6.7 7.3c-.7.7-.7 2.1 0 3.3 1.8 3.2 3.5 4.9 6.7 6.7 1.2.7 2.6.7 3.3 0l1.8-1.8-3.2-3.2-1.6 1.6c-1.9-.9-2.7-1.7-3.6-3.6l1.6-1.6-3.2-3.2Z" />
      </svg>
    ) : null}
    {channel === "meeting" ? (
      <svg viewBox="0 0 24 24">
        <rect x="5" y="6" width="14" height="13" rx="2" />
        <path d="M8 4v4M16 4v4M5 10h14M8 14h3M13 14h3" />
      </svg>
    ) : null}
    {channel === "note" ? (
      <svg viewBox="0 0 24 24">
        <path d="M6 4h9l3 3v13H6z" />
        <path d="M14 4v4h4M9 12h6M9 16h4" />
      </svg>
    ) : null}
    {channel === "sms" ? (
      <svg viewBox="0 0 24 24">
        <path d="M5 6h14v10H9l-4 3z" />
        <path d="M8 10h8M8 13h5" />
      </svg>
    ) : null}
    {channel === "deal" ? (
      <svg viewBox="0 0 24 24">
        <path d="M7 11V7.5A2.5 2.5 0 0 1 9.5 5h5A2.5 2.5 0 0 1 17 7.5V11" />
        <rect x="4" y="10" width="16" height="9" rx="2" />
        <path d="M9 14h6" />
      </svg>
    ) : null}
  </span>
);

const formatShortDayMonth = (value: string | null | undefined): { day: string; month: string; year: string } => {
  if (!value) {
    return { day: "--", month: "", year: "" };
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return { day: "--", month: "", year: "" };
  }

  return {
    day: new Intl.DateTimeFormat("fr-FR", { day: "2-digit" }).format(date),
    month: new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(date).replace(".", ""),
    year: new Intl.DateTimeFormat("fr-FR", { year: "numeric" }).format(date),
  };
};

const formatCloseDelta = (value: string | null): string => {
  if (!value) {
    return "";
  }

  const date = new Date(value).getTime();

  if (Number.isNaN(date)) {
    return "";
  }

  const days = Math.ceil((date - Date.now()) / 86_400_000);

  if (days === 0) {
    return "Aujourd'hui";
  }

  return days > 0 ? `J+${days}` : `J${days}`;
};

const formatMetricValue = (metric: DealAnalysisMetric): string => {
  if (metric.unit === "currency") {
    return formatAmount(metric.value);
  }

  if (metric.unit === "days") {
    return `${metric.value} jours`;
  }

  return `${metric.value}/100`;
};

const formatMetricCaption = (metric: DealAnalysisMetric): string => {
  if (metric.id !== "stageAge" || !metric.caption.startsWith("Depuis ")) {
    return metric.caption;
  }

  const rawDate = metric.caption.replace("Depuis ", "");

  return `Depuis ${formatOptionalDate(rawDate)}`;
};

const AnalysisLoadingPanel = ({
  error,
  idleText,
  isLoading,
  steps,
  title,
  compact = false,
}: {
  error: string | null;
  idleText: string;
  isLoading: boolean;
  steps: LoadingStep[];
  title: string;
  compact?: boolean;
}) => {
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  useEffect(() => {
    if (!isLoading) {
      setActiveStepIndex(0);
      return undefined;
    }

    setActiveStepIndex(0);

    const intervalId = window.setInterval(() => {
      setActiveStepIndex((currentStepIndex) => Math.min(currentStepIndex + 1, steps.length - 1));
    }, 1100);

    return () => window.clearInterval(intervalId);
  }, [isLoading, steps.length]);

  if (!isLoading) {
    return (
      <article className="ae-deal-panel ae-analysis-loading idle">
        <h3>{title}</h3>
        {error ? <p className="ae-detail-error">{error}</p> : null}
        <p>{idleText}</p>
      </article>
    );
  }

  const activeStep = steps[activeStepIndex] ?? steps[0];

  return (
    <article className={`ae-deal-panel ae-analysis-loading${compact ? " compact" : ""}`} aria-live="polite">
      <div className="ae-loading-head">
        <div className="ae-loading-orbit" aria-hidden="true">
          <span />
          <i />
        </div>
        <div>
          <h3>{title}</h3>
          <p>{activeStep.detail}</p>
        </div>
      </div>
      {error ? <p className="ae-detail-error">{error}</p> : null}
      <ol className="ae-loading-steps">
        {steps.map((step, index) => {
          const stateClass = index < activeStepIndex ? "done" : index === activeStepIndex ? "current" : "waiting";

          return (
            <li className={stateClass} key={step.label}>
              <span aria-hidden="true" />
              <div>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="ae-loading-progress" aria-hidden="true">
        <span style={{ width: `${((activeStepIndex + 1) / steps.length) * 100}%` }} />
      </div>
    </article>
  );
};

const getInfluenceScore = (influence: BuyingCommitteeMember["influence"]): number => {
  if (influence === "high") {
    return 86;
  }

  if (influence === "medium") {
    return 56;
  }

  return 26;
};

const getSentimentTone = (sentiment: BuyingCommitteeMember["sentiment"]): "green" | "amber" | "red" | "muted" => {
  if (sentiment === "positive") {
    return "green";
  }

  if (sentiment === "negative") {
    return "red";
  }

  return sentiment === "neutral" ? "muted" : "amber";
};

const getDealRoleTone = (dealRole: BuyingCommitteeMember["dealRole"]): "green" | "amber" | "red" | "muted" => {
  if (dealRole === "champion" || dealRole === "decision_maker") {
    return "green";
  }

  if (dealRole === "blocker") {
    return "red";
  }

  return dealRole === "unknown" ? "muted" : "amber";
};

const getRiskTone = (severity: QualificationRisk["severity"]): "amber" | "red" | "muted" => {
  if (severity === "high") {
    return "red";
  }

  return severity === "medium" ? "amber" : "muted";
};

const ActionRows = ({ actions }: { actions: DealAnalysisAction[] }) =>
  actions.length > 0 ? (
    <div className="ae-deal-action-list">
      {actions.map((action) => (
        <div className="ae-deal-action-row" key={`${action.title}:${action.dueAt}`}>
          <span>{action.title}</span>
          <small>
            {formatOptionalDate(action.dueAt)} · {priorityLabels[action.priority]}
          </small>
        </div>
      ))}
    </div>
  ) : (
    <p className="ae-empty compact">Aucune action prioritaire.</p>
  );

const InsightRows = ({ items, tone }: { items: string[]; tone: "green" | "red" }) =>
  items.length > 0 ? (
    <div className={`ae-deal-insight-list ${tone}`}>
      {items.map((item) => (
        <div className="ae-deal-insight-row" key={item}>
          <span aria-hidden="true" />
          <p>{item}</p>
        </div>
      ))}
    </div>
  ) : (
    <p className="ae-empty compact">Aucun signal disponible.</p>
  );

const MetricCard = ({ metric }: { metric: DealAnalysisMetric }) => (
  <article className="ae-deal-metric-card">
    <MetricIcon name={metricIcons[metric.id]} />
    <div>
      <span>{metric.label}</span>
      <strong>{formatMetricValue(metric)}</strong>
      <small>{formatMetricCaption(metric)}</small>
    </div>
  </article>
);

const HealthDimension = ({ dimension }: { dimension: DealAnalysisHealthDimension }) => (
  <div className="ae-health-dimension">
    <span>{dimension.label}</span>
    <strong className={dimension.tone}>{levelLabels[dimension.level]}</strong>
    <div className={`ae-health-track ${dimension.tone}`}>
      <i style={{ width: `${dimension.score}%` }} />
    </div>
    <small>{dimension.rationale}</small>
  </div>
);

const buildTrendPath = (points: DealAnalysisTrendPoint[], width: number, height: number): string => {
  if (points.length === 0) {
    return "";
  }

  const padding = { bottom: 32, left: 38, right: 18, top: 14 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  return points
    .map((point, index) => {
      const x = padding.left + (innerWidth * index) / Math.max(1, points.length - 1);
      const y = padding.top + innerHeight - (innerHeight * point.probability) / 100;

      return `${index === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");
};

const TrendChart = ({ points }: { points: DealAnalysisTrendPoint[] }) => {
  const width = 560;
  const height = 220;
  const padding = { bottom: 32, left: 38, right: 18, top: 14 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const linePath = buildTrendPath(points, width, height);
  const lastPoint = points[points.length - 1] ?? null;
  const firstCoordinate = points.length > 0 ? `${padding.left},${height - padding.bottom}` : "";
  const lastX = padding.left + innerWidth;
  const areaPath = linePath ? `${linePath} L${lastX},${height - padding.bottom} L${firstCoordinate} Z` : "";

  return (
    <div className="ae-deal-chart">
      <div className="ae-deal-panel-heading">
        <h3>Evolution du deal</h3>
        <button type="button">Probabilite de gain</button>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Evolution de la probabilite">
        {[0, 25, 50, 75, 100].map((value) => {
          const y = padding.top + innerHeight - (innerHeight * value) / 100;

          return (
            <g key={value}>
              <line className="ae-deal-chart-guide" x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
              <text className="ae-deal-chart-label" x={0} y={y + 4}>
                {value} %
              </text>
            </g>
          );
        })}
        <path className="ae-deal-chart-area" d={areaPath} />
        <path className="ae-deal-chart-line" d={linePath} />
        {points.map((point, index) => {
          const x = padding.left + (innerWidth * index) / Math.max(1, points.length - 1);
          const y = padding.top + innerHeight - (innerHeight * point.probability) / 100;

          return (
            <g key={`${point.date}:${point.probability}`}>
              <circle className="ae-deal-chart-point" cx={x} cy={y} r={4} />
              {index % 2 === 0 || index === points.length - 1 ? (
                <text className="ae-deal-chart-date" x={x} y={height - 8}>
                  {point.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {lastPoint ? (
          <g>
            <rect className="ae-deal-chart-badge" x={width - 68} y={height / 2 - 18} width={50} height={28} rx={6} />
            <text className="ae-deal-chart-badge-text" x={width - 43} y={height / 2 + 1}>
              {lastPoint.probability} %
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
};

const CommitteeTable = ({ members }: { members: BuyingCommitteeMember[] }) => (
  <article className="ae-deal-panel ae-qualification-committee">
    <h3>Comite d'achat</h3>
    {members.length > 0 ? (
      <div className="ae-committee-table">
        <div className="ae-committee-row header">
          <span>Personne</span>
          <span>Role</span>
          <span>Influence</span>
          <span>Sentiment</span>
          <span>Role dans le deal</span>
        </div>
        {members.map((member) => (
          <div className="ae-committee-row" key={`${member.name}:${member.role}`}>
            <div className="ae-committee-person">
              <i aria-hidden="true">{getInitials(member.name)}</i>
              <span>
                <strong>{member.name}</strong>
                <small>{member.evidence}</small>
              </span>
            </div>
            <span>{member.role}</span>
            <span className="ae-qualification-influence">
              <strong>{influenceLabels[member.influence]}</strong>
              <i>
                <b style={{ width: `${getInfluenceScore(member.influence)}%` }} />
              </i>
            </span>
            <span className={`ae-qualification-pill ${getSentimentTone(member.sentiment)}`}>
              {sentimentLabels[member.sentiment]}
            </span>
            <span className={`ae-qualification-pill ${getDealRoleTone(member.dealRole)}`}>
              {dealRoleLabels[member.dealRole]}
            </span>
          </div>
        ))}
      </div>
    ) : (
      <p className="ae-empty compact">Aucun membre de comite nomme dans les donnees CRM.</p>
    )}
  </article>
);

const MeddiccGrid = ({ criteria }: { criteria: MeddiccCriterion[] }) => (
  <article className="ae-deal-panel ae-meddicc-panel">
    <h3>Qualification MEDDICC</h3>
    {criteria.length > 0 ? (
      <div className="ae-meddicc-grid">
        {criteria.map((criterion) => (
          <div className="ae-meddicc-card" key={criterion.id}>
            <span>{criterion.label}</span>
            <strong className={qualificationStatusTones[criterion.status]}>{qualificationStatusLabels[criterion.status]}</strong>
            <small>{criterion.score} %</small>
            <i className={qualificationStatusTones[criterion.status]}>
              <b style={{ width: `${criterion.score}%` }} />
            </i>
            <p>{criterion.gap ?? criterion.evidence}</p>
          </div>
        ))}
      </div>
    ) : (
      <p className="ae-empty compact">Qualification MEDDICC indisponible dans la reponse IA.</p>
    )}
  </article>
);

const DecisionProcessPanel = ({ process }: { process: DecisionProcess }) => (
  <article className="ae-deal-panel ae-decision-panel">
    <h3>Decision & processus</h3>
    <dl className="ae-decision-list">
      <div>
        <dt>Calendrier de decision</dt>
        <dd>{process.decisionCalendar ?? "Non renseigne"}</dd>
      </div>
      <div>
        <dt>Statut budgetaire</dt>
        <dd className={process.budgetStatus === "validated" ? "green" : process.budgetStatus === "blocked" ? "red" : "amber"}>
          {budgetStatusLabels[process.budgetStatus]}
        </dd>
      </div>
      <div>
        <dt>Processus d'achat</dt>
        <dd className={process.purchaseProcess === "clear" ? "green" : process.purchaseProcess === "blocked" ? "red" : "amber"}>
          {purchaseProcessLabels[process.purchaseProcess]}
        </dd>
      </div>
      <div>
        <dt>Statut juridique</dt>
        <dd className={process.legalStatus === "approved" ? "green" : process.legalStatus === "blocked" ? "red" : "amber"}>
          {legalStatusLabels[process.legalStatus]}
        </dd>
      </div>
      <div>
        <dt>Prochaine etape de gouvernance</dt>
        <dd>{process.nextGovernanceStep ?? "Non renseignee"}</dd>
      </div>
    </dl>
  </article>
);

const QualificationRiskRows = ({ risks }: { risks: QualificationRisk[] }) => (
  <article className="ae-deal-panel">
    <h3>Risques & blocages</h3>
    {risks.length > 0 ? (
      <div className="ae-qualification-risk-list">
        {risks.map((risk) => (
          <div className="ae-qualification-risk-row" key={`${risk.title}:${risk.severity}`}>
            <span>{risk.title}</span>
            <small>{risk.evidence}</small>
            <strong className={getRiskTone(risk.severity)}>{riskSeverityLabels[risk.severity]}</strong>
          </div>
        ))}
      </div>
    ) : (
      <p className="ae-empty compact">Aucun risque qualifie par l'IA.</p>
    )}
  </article>
);

const QualificationInsightList = ({ items }: { items: QualificationInsight[] }) =>
  items.length > 0 ? (
    <div className="ae-qualification-insight-list">
      {items.map((item) => (
        <div className="ae-qualification-insight-row" key={item.title}>
          <span aria-hidden="true" />
          <p>
            <strong>{item.title}</strong>
            <small>{item.rationale}</small>
          </p>
        </div>
      ))}
    </div>
  ) : (
    <p className="ae-empty compact">Aucune information disponible.</p>
  );

const QualificationInsightRows = ({ title, items }: { title: string; items: QualificationInsight[] }) => (
  <article className="ae-deal-panel">
    <h3>{title}</h3>
    <QualificationInsightList items={items} />
  </article>
);

const QualificationAiAside = ({
  error,
  isLoading,
  items,
  onRefresh,
  result,
}: {
  error: string | null;
  isLoading: boolean;
  items: QualificationInsight[];
  onRefresh: () => void;
  result: DealQualificationResult;
}) => (
  <aside className="ae-deal-panel ae-qualification-ai">
    <h3>Lecture IA</h3>
    <small>
      {result.provider} · {result.model} · {formatOptionalDateTime(result.generatedAt)}
    </small>
    {error ? <p className="ae-detail-error">{error}</p> : null}
    <div className="ae-qualification-ai-section">
      <h4>Ce qui manque pour ameliorer la probabilite de gain</h4>
      <QualificationInsightList items={items} />
    </div>
    <button disabled={isLoading} onClick={onRefresh} type="button">
      {isLoading ? "Analyse..." : "Relancer l'analyse IA"}
    </button>
  </aside>
);

const QualificationSection = ({
  error,
  isLoading,
  onRefresh,
  result,
}: {
  error: string | null;
  isLoading: boolean;
  onRefresh: () => void;
  result: DealQualificationResult | null;
}) => {
  if (!result) {
    return (
        <AnalysisLoadingPanel
          error={error}
          idleText="Analyse en cours de preparation."
          isLoading={isLoading}
        steps={qualificationLoadingSteps}
        title="Comite & qualification"
      />
    );
  }

  const qualification = result.qualification;

  return (
    <section className="ae-qualification-layout" aria-label="Comite et qualification">
      <div className="ae-qualification-main">
        <CommitteeTable members={qualification.buyingCommittee} />
        <div className="ae-qualification-top-grid">
          <MeddiccGrid criteria={qualification.meddicc} />
          <DecisionProcessPanel process={qualification.decisionProcess} />
        </div>
        <div className="ae-qualification-bottom-grid">
          <QualificationRiskRows risks={qualification.risks} />
          <QualificationInsightRows items={qualification.strengths} title="Atouts du deal" />
        </div>
      </div>

      <QualificationAiAside
        error={error}
        isLoading={isLoading}
        items={qualification.missingForWin}
        onRefresh={onRefresh}
        result={result}
      />
    </section>
  );
};

const RecentActivityPanel = ({ crmDealUrl, items }: { crmDealUrl: string | null; items: DealRecentActivity[] }) => (
  <article className="ae-deal-panel ae-activity-recent">
    <div className="ae-deal-panel-heading">
      <h3>Activite recente</h3>
      {crmDealUrl ? (
        <a href={crmDealUrl} rel="noreferrer" target="_blank">
          Voir toute l'activite
        </a>
      ) : (
        <button disabled type="button">
          Voir toute l'activite
        </button>
      )}
    </div>
    {items.length > 0 ? (
      <div className="ae-activity-timeline">
        {items.map((item) => (
          <div className={`ae-activity-event ${item.channel}`} key={item.id}>
            <ActivityChannelIcon channel={item.channel} />
            <time>
              {formatOptionalDate(item.occurredAt)}
              {formatActivityTime(item.occurredAt) ? `, ${formatActivityTime(item.occurredAt)}` : ""}
            </time>
            <div>
              <strong>{item.title}</strong>
              {item.actorName ? <small>{item.actorName}</small> : null}
              {item.body ? <p>{compactText(item.body, 130)}</p> : null}
            </div>
          </div>
        ))}
      </div>
    ) : (
      <p className="ae-empty compact">Aucune activite HubSpot exploitable.</p>
    )}
  </article>
);

const ActivityPlanPanel = ({ actions }: { actions: ActivityPlanAction[] }) => (
  <article className="ae-deal-panel ae-activity-plan">
    <div className="ae-deal-panel-heading">
      <h3>Plan d'action mutuel</h3>
      <button type="button">Ajouter une action</button>
    </div>
    {actions.length > 0 ? (
      <div className="ae-activity-plan-table">
        <div className="ae-activity-plan-row header">
          <span>Action</span>
          <span>Proprietaire</span>
          <span>Echeance</span>
          <span>Statut</span>
        </div>
        {actions.map((action) => (
          <div className="ae-activity-plan-row" key={`${action.title}:${action.dueDate ?? "no-date"}`}>
            <span className="ae-action-check" aria-hidden="true" />
            <div>
              <strong>{action.title}</strong>
              <small>{action.rationale}</small>
            </div>
            <span>{action.ownerName ?? "Non assigne"}</span>
            <span>{formatOptionalDate(action.dueDate)}</span>
            <strong className={`ae-activity-status ${action.status}`}>{activityStatusLabels[action.status]}</strong>
          </div>
        ))}
      </div>
    ) : (
      <p className="ae-empty compact">Aucun plan d'action detecte dans le CRM.</p>
    )}
  </article>
);

const UpcomingDeadlinesPanel = ({ deadlines }: { deadlines: ActivityPlanDeadline[] }) => (
  <article className="ae-deal-panel ae-activity-deadlines">
    <h3>Prochaines echeances</h3>
    {deadlines.length > 0 ? (
      <div className="ae-deadline-list">
        {deadlines.map((deadline) => {
          const dateParts = formatShortDayMonth(deadline.date);

          return (
            <div className="ae-deadline-row" key={`${deadline.title}:${deadline.date ?? "no-date"}`}>
              <time>
                <strong>{dateParts.day}</strong>
                <small>
                  {dateParts.month} {dateParts.year}
                </small>
              </time>
              <div>
                <strong>{deadline.title}</strong>
                <small>{deadline.ownerName ? `Avec ${deadline.ownerName}` : deadline.description}</small>
              </div>
              <span>{deadline.timeWindow ?? ""}</span>
            </div>
          );
        })}
      </div>
    ) : (
      <p className="ae-empty compact">Aucune echeance future detectee.</p>
    )}
  </article>
);

const ChannelEngagementPanel = ({ channels }: { channels: DealChannelEngagement[] }) => (
  <article className="ae-deal-panel ae-channel-panel">
    <div className="ae-deal-panel-heading">
      <h3>Engagement par canal</h3>
      <button type="button">Historique CRM</button>
    </div>
    <div className="ae-channel-grid">
      {channels.map((channel) => (
        <div className="ae-channel-card" key={channel.channel}>
          <span>{channel.label}</span>
          <strong>{channel.count}</strong>
          <small>{channel.responseRate === null ? channel.caption : `${channel.responseRate} % de reponse`}</small>
        </div>
      ))}
    </div>
    <p className="ae-channel-summary">
      Volumes calcules depuis les activites HubSpot associees a ce deal.
    </p>
  </article>
);

const NotesInsightsPanel = ({ insights }: { insights: ActivityPlanInsight[] }) => (
  <article className="ae-deal-panel ae-activity-notes">
    <h3>Notes & insights</h3>
    {insights.length > 0 ? (
      <div className="ae-activity-note-list">
        {insights.map((insight) => (
          <div className="ae-activity-note" key={insight.title}>
            <span aria-hidden="true" />
            <p>
              <strong>{insight.title}</strong>
              <small>{insight.detail}</small>
            </p>
          </div>
        ))}
      </div>
    ) : (
      <p className="ae-empty compact">Aucun insight supplementaire detecte.</p>
    )}
  </article>
);

const ActivityRecommendationPanel = ({
  isLoading,
  onRefresh,
  result,
}: {
  isLoading: boolean;
  onRefresh: () => void;
  result: DealActivityPlanResult;
}) => {
  const recommendation = result.activityPlan.recommendation;

  return (
    <article className="ae-deal-panel ae-activity-reco">
      <div className="ae-deal-panel-heading">
        <h3>Recommandation IA</h3>
        <strong className={`ae-activity-priority ${recommendation.priority}`}>
          {activityPriorityLabels[recommendation.priority]}
        </strong>
      </div>
      <p>{recommendation.summary}</p>
      <div className="ae-next-best-action">
        <span>Prochaine meilleure action</span>
        <button type="button">
          <strong>{recommendation.nextBestAction.title}</strong>
          <small>{recommendation.nextBestAction.rationale}</small>
        </button>
      </div>
      <button disabled={isLoading} onClick={onRefresh} type="button">
        {isLoading ? "Analyse..." : "Relancer l'analyse IA"}
      </button>
    </article>
  );
};

const ActivitySection = ({
  error,
  hubspotPortalId,
  isLoading,
  onRefresh,
  result,
}: {
  error: string | null;
  hubspotPortalId?: string | null;
  isLoading: boolean;
  onRefresh: () => void;
  result: DealActivityPlanResult | null;
}) => {
  if (!result) {
    return (
        <AnalysisLoadingPanel
          error={error}
          idleText="Activite en cours de preparation."
        isLoading={isLoading}
        steps={activityLoadingSteps}
        title="Activite & plan d'action"
      />
    );
  }

  const crmDealUrl = getHubSpotDealUrl(hubspotPortalId, result.hubspotDealId);

  return (
    <section className="ae-activity-layout" aria-label="Activite et plan d'action">
      {isLoading ? (
        <AnalysisLoadingPanel
          compact
          error={null}
          idleText=""
          isLoading={isLoading}
          steps={activityLoadingSteps}
          title="Mise a jour de l'activite"
        />
      ) : null}
      {error ? <p className="ae-detail-error">{error}</p> : null}
      <RecentActivityPanel crmDealUrl={crmDealUrl} items={result.recentActivities} />
      <ActivityPlanPanel actions={result.activityPlan.mutualActionPlan} />
      <UpcomingDeadlinesPanel deadlines={result.activityPlan.upcomingDeadlines} />
      <ChannelEngagementPanel channels={result.channelEngagement} />
      <NotesInsightsPanel insights={result.activityPlan.notesAndInsights} />
      <ActivityRecommendationPanel isLoading={isLoading} onRefresh={onRefresh} result={result} />
    </section>
  );
};

export const DealAnalysisView = ({
  activeProspect,
  hubspotPortalId,
  orgId,
  ownerName,
  onBack,
  selectedAiProvider,
}: DealAnalysisViewProps) => {
  const [page, setPage] = useState<DealAnalysisPageResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<DealSection>("overview");
  const [qualification, setQualification] = useState<DealQualificationResult | null>(null);
  const [qualificationLoading, setQualificationLoading] = useState(false);
  const [qualificationError, setQualificationError] = useState<string | null>(null);
  const [activityPlan, setActivityPlan] = useState<DealActivityPlanResult | null>(null);
  const [activityPlanLoading, setActivityPlanLoading] = useState(false);
  const [activityPlanError, setActivityPlanError] = useState<string | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskResult, setTaskResult] = useState<FollowUpTaskResult | null>(null);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [refreshAttempt, setRefreshAttempt] = useState<number | null>(null);

  const loadQualification = async (refresh = false) => {
    if (!activeProspect) {
      return;
    }

    const cacheKey = getCacheKey(orgId, selectedAiProvider, activeProspect.id);

    if (!refresh) {
      const cached = qualificationCache.get(cacheKey);

      if (cached) {
        setQualification(cached);
        setQualificationError(null);
        return;
      }
    }

    try {
      setQualificationLoading(true);
      setQualificationError(null);

      const result = await fetchDealQualification(activeProspect, orgId, selectedAiProvider, ownerName, refresh);
      qualificationCache.set(cacheKey, result);
      setQualification(result);
    } catch (error) {
      setQualificationError(error instanceof Error ? error.message : "Qualification deal indisponible.");
    } finally {
      setQualificationLoading(false);
    }
  };

  const loadActivityPlan = async (refresh = false) => {
    if (!activeProspect) {
      return;
    }

    const cacheKey = getCacheKey(orgId, selectedAiProvider, activeProspect.id);

    if (!refresh) {
      const cached = activityPlanCache.get(cacheKey);

      if (cached) {
        setActivityPlan(cached);
        setActivityPlanError(null);
        return;
      }
    }

    try {
      setActivityPlanLoading(true);
      setActivityPlanError(null);

      const result = await fetchDealActivityPlan(activeProspect, orgId, selectedAiProvider, ownerName, refresh);
      activityPlanCache.set(cacheKey, result);
      setActivityPlan(result);
    } catch (error) {
      setActivityPlanError(error instanceof Error ? error.message : "Activite deal indisponible.");
    } finally {
      setActivityPlanLoading(false);
    }
  };

  const applyBundle = (bundle: DealAnalysisBundleResult, cacheKey: string) => {
    pageCache.set(cacheKey, bundle.page);
    bundleCache.set(cacheKey, bundle);
    qualificationCache.set(cacheKey, bundle.qualification);
    activityPlanCache.set(cacheKey, bundle.activityPlan);
    setPage(bundle.page);
    setQualification(bundle.qualification);
    setActivityPlan(bundle.activityPlan);
    setAnalysisError(null);
    setQualificationError(null);
    setActivityPlanError(null);
  };

  const refreshDealBundleWithRetry = async (cacheKey: string): Promise<DealAnalysisBundleResult> => {
    if (!activeProspect) {
      throw new Error("Aucun deal selectionne.");
    }

    let lastError: unknown = null;

    for (const [index, delayMs] of refreshRetryDelays.entries()) {
      if (delayMs > 0) {
        await wait(delayMs);
      }

      setRefreshAttempt(index + 1);

      try {
        const result = await fetchDealAnalysisBundle(activeProspect, orgId, selectedAiProvider, ownerName, true);

        pageCache.delete(cacheKey);
        bundleCache.delete(cacheKey);
        qualificationCache.delete(cacheKey);
        activityPlanCache.delete(cacheKey);

        return result;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Erreur inconnue pendant le rafraichissement du deal.");
  };

  const preheatDealSections = async (refresh = false) => {
    if (!activeProspect) {
      return;
    }

    const cacheKey = getCacheKey(orgId, selectedAiProvider, activeProspect.id);

    if (!refresh) {
      const cached = bundleCache.get(cacheKey);

      if (cached) {
        applyBundle(cached, cacheKey);
        return;
      }
    }

    try {
      setQualificationLoading(true);
      setActivityPlanLoading(true);
      setQualificationError(null);
      setActivityPlanError(null);

      const result = await fetchDealAnalysisBundle(activeProspect, orgId, selectedAiProvider, ownerName, refresh);
      applyBundle(result, cacheKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analyse complete du deal indisponible.";
      setAnalysisError(message);
      setQualificationError(message);
      setActivityPlanError(message);
    } finally {
      setQualificationLoading(false);
      setActivityPlanLoading(false);
    }
  };

  const loadPage = async (refresh = false) => {
    if (!activeProspect) {
      return;
    }

    const cacheKey = getCacheKey(orgId, selectedAiProvider, activeProspect.id);

    if (!refresh) {
      const cached = pageCache.get(cacheKey);

      if (cached) {
        setPage(cached);
        setAnalysisError(null);
        void preheatDealSections(false);
        return;
      }
    }

    try {
      setIsAnalyzing(true);
      setAnalysisError(null);

      const result = await fetchDealAnalysisPage(activeProspect, orgId, selectedAiProvider, ownerName, refresh);
      pageCache.set(cacheKey, result);
      setPage(result);
      void preheatDealSections(false);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Analyse deal indisponible.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    setPage(null);
    setTaskResult(null);
    setRefreshMessage(null);
    setRefreshAttempt(null);
    setAnalysisError(null);
    setActiveSection("overview");
    setQualification(null);
    setQualificationError(null);
    setActivityPlan(null);
    setActivityPlanError(null);

    if (activeProspect) {
      void loadPage(false);
    }
  }, [activeProspect?.id, orgId, ownerName, selectedAiProvider.id, selectedAiProvider.model]);

  const handleCreateTask = async () => {
    if (!activeProspect) {
      return;
    }

    try {
      setTaskLoading(true);
      setTaskResult(null);

      const result = await createFollowUpTask(activeProspect, orgId);
      setTaskResult(result);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Impossible de creer la tache HubSpot.");
    } finally {
      setTaskLoading(false);
    }
  };

  const handleSectionChange = (section: DealSection) => {
    setActiveSection(section);
  };

  const handleRefresh = () => {
    if (!activeProspect) {
      return;
    }

    const cacheKey = getCacheKey(orgId, selectedAiProvider, activeProspect.id);

    void (async () => {
      try {
        setIsAnalyzing(true);
        setQualificationLoading(true);
        setActivityPlanLoading(true);
        setRefreshMessage(null);
        setAnalysisError(null);
        setQualificationError(null);
        setActivityPlanError(null);
        setTaskResult(null);

        const result = await refreshDealBundleWithRetry(cacheKey);
        applyBundle(result, cacheKey);
        setRefreshMessage(`Deal rafraichi avec l'analyse du ${formatOptionalDateTime(result.page.generatedAt)}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erreur inconnue pendant le rafraichissement du deal.";
        setAnalysisError(`Impossible de rafraichir le deal complet. Reessaie le rafraichissement. Detail: ${message}`);
      } finally {
        setIsAnalyzing(false);
        setQualificationLoading(false);
        setActivityPlanLoading(false);
        setRefreshAttempt(null);
      }
    })();
  };

  const snapshot = page?.snapshot ?? null;
  const analysis = page?.analysis ?? null;
  const primaryAction = page?.primaryActions[0] ?? null;
  const refreshLoading = isAnalyzing || qualificationLoading || activityPlanLoading;
  const summaryLines = useMemo(() => {
    if (!analysis) {
      return [];
    }

    return [analysis.executiveSummary, ...analysis.detailedAnalysis].filter(Boolean).slice(0, 3);
  }, [analysis]);
  const scoreExplanation = useMemo(() => (analysis ? buildScoreExplanation(analysis) : []), [analysis]);

  if (!activeProspect) {
    return (
      <section className="ae-deal-page" aria-label="Analyse deal">
        <button className="ae-deal-back" onClick={onBack} type="button">
          Retour overview
        </button>
        <p className="ae-empty">Selectionne un deal dans l'overview pour ouvrir son analyse.</p>
      </section>
    );
  }

  return (
    <section className="ae-deal-page" aria-label="Analyse deal">
      <div className="ae-deal-titlebar">
        <button className="ae-deal-back" onClick={onBack} type="button">
          Retour overview
        </button>
        <div>
          <p className="ae-eyebrow">Pipeline inbox / Deal analysis</p>
          <h2>{snapshot?.companyName ?? activeProspect.company}</h2>
        </div>
        <div className="ae-deal-sync-note">
          <span>Derniere analyse</span>
          <strong>{formatOptionalDateTime(page?.generatedAt)}</strong>
        </div>
        <button
          className="ae-deal-refresh"
          disabled={refreshLoading}
          onClick={handleRefresh}
          type="button"
        >
          {refreshLoading ? (
            <span className="ae-button-spinner" aria-label="Rafraichissement en cours" role="status">
              <Loader2 size={15} strokeWidth={2.4} />
              <small>{refreshAttempt ? `Essai ${refreshAttempt}/3` : "Analyse..."}</small>
            </span>
          ) : (
            "Rafraichir le deal complet"
          )}
        </button>
      </div>

      {analysisError ? <p className="ae-detail-error">{analysisError}</p> : null}
      {refreshMessage ? <p className="ae-detail-success">{refreshMessage}</p> : null}
      {taskResult ? (
        <p className="ae-detail-success">
          {taskResult.created ? "Task HubSpot creee." : taskResult.recommendation.rationale}
        </p>
      ) : null}

      {page && snapshot && analysis ? (
        <>
          <section className="ae-deal-hero">
            <div className="ae-deal-company-block">
              <span aria-hidden="true">{getInitials(snapshot.companyName)}</span>
              <div>
                <h3>{snapshot.companyName}</h3>
                <strong>{snapshot.contactName}</strong>
                <p>
                  {[snapshot.contactEmail, snapshot.contactPhone].filter(Boolean).join(" · ") || "Contact CRM"}
                </p>
              </div>
            </div>

            <dl className="ae-deal-hero-facts">
              <div>
                <dt>Proprietaire du deal</dt>
                <dd>{snapshot.ownerName ?? "Non assigne"}</dd>
              </div>
              <div>
                <dt>Valeur</dt>
                <dd>{formatAmount(snapshot.amount)}</dd>
              </div>
              <div>
                <dt>Etape</dt>
                <dd>
                  <i aria-hidden="true" />
                  {snapshot.stage}
                </dd>
              </div>
              <div>
                <dt className="ae-score-label">
                  Probabilite de gain
                  <span className="ae-score-help" tabIndex={0}>
                    <CircleHelp size={14} strokeWidth={2.2} />
                    <span className="ae-score-tooltip" role="tooltip">
                      <strong>Pourquoi ce score ?</strong>
                      {scoreExplanation.length > 0 ? (
                        scoreExplanation.map((item) => <small key={item}>{item}</small>)
                      ) : (
                        <small>Analyse IA non disponible pour expliquer ce score.</small>
                      )}
                    </span>
                  </span>
                </dt>
                <dd>{analysis.closeWonProbability} %</dd>
                <span className="ae-deal-probability-bar">
                  <i style={{ width: `${analysis.closeWonProbability}%` }} />
                </span>
              </div>
              <div>
                <dt>Prevision</dt>
                <dd className="green">{forecastLabels[snapshot.forecastLabel]}</dd>
              </div>
              <div>
                <dt>Date de cloture prevue</dt>
                <dd>{formatOptionalDate(snapshot.closeDate)}</dd>
                <small>{formatCloseDelta(snapshot.closeDate)}</small>
              </div>
            </dl>

            <div className="ae-deal-hero-actions">
              <h3>Actions principales</h3>
              {page.primaryActions.slice(0, 3).map((action) => (
                <p key={`${action.title}:${action.dueAt}`}>
                  <span aria-hidden="true" />
                  {action.title}
                </p>
              ))}
            </div>
          </section>

          <nav className="ae-deal-tabs" aria-label="Analyse deal sections">
            <button
              className={activeSection === "overview" ? "active" : undefined}
              onClick={() => handleSectionChange("overview")}
              type="button"
            >
              Vue d'ensemble
            </button>
            <button
              className={activeSection === "qualification" ? "active" : undefined}
              onClick={() => handleSectionChange("qualification")}
              type="button"
            >
              Comite & qualification
            </button>
            <button
              className={activeSection === "activity" ? "active" : undefined}
              onClick={() => handleSectionChange("activity")}
              type="button"
            >
              Activite & plan d'action
            </button>
          </nav>

          {activeSection === "overview" ? (
            <>
              <section className="ae-deal-metrics" aria-label="Deal metrics">
                {page.metrics.map((metric) => (
                  <MetricCard key={metric.id} metric={metric} />
                ))}
              </section>

              <section className="ae-deal-grid">
                <article className="ae-deal-panel ae-summary-panel">
                  <h3>Resume IA</h3>
                  {summaryLines.map((line) => (
                    <p key={line}>{compactText(line, 180)}</p>
                  ))}
                  <div className="ae-next-best-action">
                    <span>Prochaine meilleure action</span>
                    <button disabled={taskLoading} onClick={handleCreateTask} type="button">
                      <strong>{primaryAction?.title ?? analysis.suggestedMove}</strong>
                      <small>
                        {primaryAction ? primaryAction.rationale : "Synchronise depuis l'analyse IA du deal."}
                      </small>
                    </button>
                  </div>
                </article>

                <article className="ae-deal-panel ae-health-panel">
                  <h3>Sante du deal</h3>
                  <div className="ae-health-grid">
                    {page.healthDimensions.map((dimension) => (
                      <HealthDimension dimension={dimension} key={dimension.id} />
                    ))}
                  </div>
                </article>

                <article className="ae-deal-panel ae-chart-panel">
                  <TrendChart points={page.probabilityTrend} />
                </article>

                <article className="ae-deal-panel">
                  <h3>Risques cles</h3>
                  <InsightRows items={analysis.risks} tone="red" />
                </article>

                <article className="ae-deal-panel">
                  <h3>Signaux positifs</h3>
                  <InsightRows items={analysis.positiveSignals} tone="green" />
                </article>

                <article className="ae-deal-panel">
                  <h3>Prochaines actions</h3>
                  <ActionRows actions={page.primaryActions} />
                  <button className="ae-link-button" disabled={taskLoading} onClick={handleCreateTask} type="button">
                    {taskLoading ? "Creation..." : "Creer une tache HubSpot"}
                  </button>
                </article>
              </section>
            </>
          ) : null}

          {activeSection === "qualification" ? (
            <QualificationSection
              error={qualificationError}
              isLoading={qualificationLoading}
              onRefresh={() => void loadQualification(true)}
              result={qualification}
            />
          ) : null}

          {activeSection === "activity" ? (
            <ActivitySection
              error={activityPlanError}
              hubspotPortalId={hubspotPortalId}
              isLoading={activityPlanLoading}
              onRefresh={() => void loadActivityPlan(true)}
              result={activityPlan}
            />
          ) : null}
        </>
      ) : (
        <AnalysisLoadingPanel
          error={null}
          idleText="Analyse IA en attente."
          isLoading={isAnalyzing}
          steps={dealAnalysisLoadingSteps}
          title="Vue d'ensemble du deal"
        />
      )}
    </section>
  );
};
