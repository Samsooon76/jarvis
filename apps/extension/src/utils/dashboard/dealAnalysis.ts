import type {
  ActivityPlanAction,
  AiProviderOption,
  BuyingCommitteeMember,
  DealAnalysisAction,
  DealAnalysisHealthDimension,
  DealAnalysisMetric,
  DealAnalysisPageResult,
  DealQualificationStatus,
  DealRecentActivity,
  DecisionProcess,
  QualificationRisk,
} from "../../services/api";
import { formatAmount, formatDate, formatDateTime } from "./formatters";

export const forecastLabels: Record<DealAnalysisPageResult["snapshot"]["forecastLabel"], string> = {
  at_risk: "At risk",
  best_case: "Best case",
  commit: "Commit",
  pipeline: "Pipeline",
};

export const levelLabels: Record<DealAnalysisHealthDimension["level"], string> = {
  high: "Eleve",
  low: "Faible",
  medium: "Moyen",
};

export const priorityLabels: Record<DealAnalysisAction["priority"], string> = {
  high: "Haute",
  low: "Basse",
  medium: "Moyenne",
};

export const qualificationStatusLabels: Record<DealQualificationStatus, string> = {
  confirmed: "Confirme",
  missing: "Manquant",
  partial: "Partiel",
  weak: "Faible",
};

export const qualificationStatusTones: Record<DealQualificationStatus, "green" | "amber" | "red" | "muted"> = {
  confirmed: "green",
  missing: "muted",
  partial: "amber",
  weak: "red",
};

export const influenceLabels: Record<BuyingCommitteeMember["influence"], string> = {
  high: "Elevee",
  low: "Faible",
  medium: "Moyenne",
};

export const sentimentLabels: Record<BuyingCommitteeMember["sentiment"], string> = {
  negative: "Negatif",
  neutral: "Neutre",
  positive: "Positif",
  unknown: "Inconnu",
};

export const dealRoleLabels: Record<BuyingCommitteeMember["dealRole"], string> = {
  blocker: "Bloqueur",
  champion: "Champion",
  decision_maker: "Decideur",
  influencer: "Influenceur",
  unknown: "Inconnu",
  user: "Utilisateur",
};

export const riskSeverityLabels: Record<QualificationRisk["severity"], string> = {
  high: "Eleve",
  low: "Faible",
  medium: "Moyen",
};

export const activityStatusLabels: Record<ActivityPlanAction["status"], string> = {
  done: "Fait",
  in_progress: "En cours",
  planned: "Planifie",
  todo: "A faire",
};

export const activityPriorityLabels: Record<ActivityPlanAction["priority"], string> = {
  high: "Elevee",
  low: "Faible",
  medium: "Moyenne",
};

export const budgetStatusLabels: Record<DecisionProcess["budgetStatus"], string> = {
  blocked: "Bloque",
  to_confirm: "A preciser",
  unknown: "Inconnu",
  validated: "Valide",
};

export const purchaseProcessLabels: Record<DecisionProcess["purchaseProcess"], string> = {
  blocked: "Bloque",
  clear: "Clair",
  to_confirm: "A preciser",
  unknown: "Inconnu",
};

export const legalStatusLabels: Record<DecisionProcess["legalStatus"], string> = {
  approved: "Valide",
  blocked: "Bloque",
  in_review: "En revue",
  unknown: "Inconnu",
};

export const metricIcons: Record<DealAnalysisMetric["id"], "money" | "clock" | "trend"> = {
  dealValue: "money",
  engagementScore: "trend",
  stageAge: "clock",
  weightedValue: "money",
};

export const activityChannelLabels: Record<DealRecentActivity["channel"], string> = {
  call: "Appel",
  communication: "Message",
  deal: "Deal",
  email: "Email",
  meeting: "Rendez-vous",
  note: "Note",
  sms: "SMS",
  task: "Tache",
};

export type ActivityNextStepSource = "action" | "deadline" | "recommendation";
export type ActivityIconType = DealRecentActivity["channel"] | ActivityNextStepSource;

export const activityIconLabels: Record<ActivityIconType, string> = {
  ...activityChannelLabels,
  action: "Action",
  deadline: "Echeance",
  recommendation: "Recommandation IA",
};

export const compactText = (value: string | undefined, maxLength: number): string => {
  const compacted = (value ?? "").replace(/\s+/g, " ").trim();

  if (compacted.length <= maxLength) {
    return compacted;
  }

  return `${compacted.slice(0, maxLength - 3).trim()}...`;
};

export const getDealAnalysisCacheKey = (
  orgId: string,
  selectedAiProvider: AiProviderOption,
  prospectId: string,
): string => `${orgId}:${selectedAiProvider.id}:${selectedAiProvider.model}:${prospectId}`;

export const getHubSpotDealUrl = (
  portalId: string | null | undefined,
  dealId: string | null | undefined,
): string | null => {
  const trimmedPortalId = portalId?.trim();
  const trimmedDealId = dealId?.trim();

  if (!trimmedPortalId || !trimmedDealId) {
    return null;
  }

  return `https://app.hubspot.com/contacts/${encodeURIComponent(trimmedPortalId)}/record/0-3/${encodeURIComponent(trimmedDealId)}`;
};

export const formatOptionalDate = (value: string | null | undefined): string => {
  if (!value) {
    return "Non renseigne";
  }

  return formatDate(value);
};

export const formatOptionalDateTime = (value: string | null | undefined): string => {
  if (!value) {
    return "Non renseigne";
  }

  return formatDateTime(value);
};

export const formatActivityTime = (value: string | null | undefined): string => {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
};

export const buildScoreExplanation = (analysis: DealAnalysisPageResult["analysis"]): string[] => {
  const signals = [
    analysis.whyNow,
    analysis.detailedAnalysis[0],
    ...analysis.positiveSignals.slice(0, 2),
    ...analysis.risks.slice(0, 2),
    ...analysis.evidence.slice(0, 2),
  ];

  return Array.from(new Set(signals.map((signal) => signal.trim()).filter(Boolean))).slice(0, 5);
};

export const formatCloseDelta = (value: string | null): string => {
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

export const formatMetricValue = (metric: DealAnalysisMetric): string => {
  if (metric.unit === "currency") {
    return formatAmount(metric.value);
  }

  if (metric.unit === "days") {
    return `${metric.value} jours`;
  }

  return `${metric.value}/100`;
};

export const formatMetricCaption = (metric: DealAnalysisMetric): string => {
  if (metric.id !== "stageAge" || !metric.caption.startsWith("Depuis ")) {
    return metric.caption;
  }

  const rawDate = metric.caption.replace("Depuis ", "");

  return `Depuis ${formatOptionalDate(rawDate)}`;
};

export const getInfluenceScore = (influence: BuyingCommitteeMember["influence"]): number => {
  if (influence === "high") {
    return 86;
  }

  if (influence === "medium") {
    return 56;
  }

  return 26;
};

export const getSentimentTone = (sentiment: BuyingCommitteeMember["sentiment"]): "green" | "amber" | "red" | "muted" => {
  if (sentiment === "positive") {
    return "green";
  }

  if (sentiment === "negative") {
    return "red";
  }

  return sentiment === "neutral" ? "muted" : "amber";
};

export const getDealRoleTone = (dealRole: BuyingCommitteeMember["dealRole"]): "green" | "amber" | "red" | "muted" => {
  if (dealRole === "champion" || dealRole === "decision_maker") {
    return "green";
  }

  if (dealRole === "blocker") {
    return "red";
  }

  return dealRole === "unknown" ? "muted" : "amber";
};

export const getRiskTone = (severity: QualificationRisk["severity"]): "amber" | "red" | "muted" => {
  if (severity === "high") {
    return "red";
  }

  return severity === "medium" ? "amber" : "muted";
};

export const buildRecommendationDateLabel = (dueInDays: number): string => {
  if (dueInDays <= 0) {
    return "Aujourd'hui";
  }

  if (dueInDays === 1) {
    return "Demain";
  }

  return `Sous ${dueInDays} jours`;
};
