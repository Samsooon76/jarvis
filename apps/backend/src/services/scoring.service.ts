import type { ProspectPriority } from "@jarvis/shared";

export type ScoringInput = {
  dealAmount: number | null;
  closeProbability: number | null;
  dealStage: string | null;
  dealStageLabel?: string | null;
  lastContactAt: string | null;
  closeDate?: string | null;
  snoozedUntil?: string | null;
  skippedAt?: string | null;
  aiSummary?: string | null;
  nextAction?: string | null;
  companyEmployeeCount?: number | null;
  companyRevenue?: number | null;
  companyLifecycleStage?: string | null;
  companyIndustry?: string | null;
  companyDomain?: string | null;
  dealName?: string | null;
  // Boucle Win Analysis: nombre de gaps d'activite vs le benchmark des deals
  // gagnes (deal en retard d'activite vs pattern gagnant -> remonte la queue).
  // Fourni uniquement quand le benchmark est significatif (>= 10 wins).
  winActivityGapCount?: number | null;
};

export type ScoringOutput = {
  ai_priority_score: number;
  priority: ProspectPriority;
  reason: string;
  next_action: string;
};

const MS_PER_DAY = 86_400_000;

const daysSince = (value: string | null, fallbackDays: number): number => {
  if (!value) {
    return fallbackDays;
  }

  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return fallbackDays;
  }

  return Math.max(0, Math.floor((Date.now() - timestamp) / MS_PER_DAY));
};

const daysUntil = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.ceil((timestamp - Date.now()) / MS_PER_DAY);
};

const formatAmount = (amount: number): string =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(amount);

const getPriority = (score: number): ProspectPriority => {
  if (score >= 80) {
    return "urgent";
  }

  if (score >= 50) {
    return "important";
  }

  return "routine";
};

const getNextAction = (input: ScoringInput, daysSinceLastContact: number): string => {
  if (input.nextAction?.trim()) {
    return input.nextAction.trim();
  }

  const stage = `${input.dealStageLabel ?? ""} ${input.dealStage ?? ""}`.toLowerCase();
  const closeDays = daysUntil(input.closeDate);

  if (closeDays !== null && closeDays >= 0 && closeDays <= 14) {
    return "Securiser le prochain pas avant la date de closing";
  }

  if ((input.closeProbability ?? 0) >= 70) {
    return "Faire avancer le deal vers la prochaine etape";
  }

  if (stage.includes("demo")) {
    return "Confirmer les enjeux avant la demo";
  }

  if (stage.includes("contract") || stage.includes("negotiation")) {
    return "Lever les derniers blocages contractuels";
  }

  if (daysSinceLastContact >= 14) {
    return "Relancer le prospect avec un angle business clair";
  }

  return "Verifier le prochain pas HubSpot";
};

const getReason = (input: ScoringInput, daysSinceLastContact: number): string => {
  if (input.aiSummary?.trim()) {
    return input.aiSummary.trim();
  }

  const amount = input.dealAmount ?? 0;
  const probability = input.closeProbability ?? 0;
  const dealName = input.dealName ?? "Deal HubSpot";
  const closeDays = daysUntil(input.closeDate);

  if (closeDays !== null && closeDays >= 0 && closeDays <= 14) {
    return `${dealName}: closing prevu dans ${closeDays} jour(s), prochain pas a verrouiller.`;
  }

  if (daysSinceLastContact >= 14 && amount > 0) {
    return `${dealName}: aucun contact depuis ${daysSinceLastContact} jours sur une opportunite de ${formatAmount(amount)}.`;
  }

  if (probability >= 70) {
    return `${dealName}: probabilite HubSpot elevee (${probability}%) et prochaine etape a securiser.`;
  }

  return `${dealName}: deal HubSpot synchronise, a qualifier avec les signaux disponibles dans le CRM.`;
};

export const scoreProspect = (input: ScoringInput): ScoringOutput => {
  if (input.skippedAt) {
    return {
      ai_priority_score: 0,
      priority: "routine",
      reason: "Prospect ignore dans la queue.",
      next_action: input.nextAction?.trim() || "Aucune action recommandee",
    };
  }

  const snoozedUntil = input.snoozedUntil ? new Date(input.snoozedUntil).getTime() : null;
  const isCurrentlySnoozed = snoozedUntil !== null && !Number.isNaN(snoozedUntil) && snoozedUntil > Date.now();
  const daysSinceLastContact = daysSince(input.lastContactAt, 14);
  const closeDays = daysUntil(input.closeDate);
  const amountScore = (input.dealAmount ?? 0) / 1000;
  const probabilityScore = (input.closeProbability ?? 0) * 0.5;
  const closeDateScore = closeDays === null ? 0 : closeDays < 0 ? -10 : Math.max(0, 20 - closeDays);
  const employeeScore =
    input.companyEmployeeCount === null || input.companyEmployeeCount === undefined
      ? 0
      : Math.min(12, Math.round(input.companyEmployeeCount / 50));
  const revenueScore =
    input.companyRevenue === null || input.companyRevenue === undefined
      ? 0
      : Math.min(10, Math.round(input.companyRevenue / 1_000_000));
  const lifecycle = input.companyLifecycleStage?.toLowerCase() ?? null;
  const lifecycleScore =
    lifecycle === "opportunity"
      ? 8
      : lifecycle === "customer"
        ? 5
        : lifecycle === "salesqualifiedlead" || lifecycle === "marketingqualifiedlead"
          ? 4
          : 0;
  const fitScore = (input.companyIndustry ? 2 : 0) + (input.companyDomain ? 2 : 0);
  const winGapScore = Math.min(12, Math.max(0, input.winActivityGapCount ?? 0) * 4);
  const rawScore = daysSinceLastContact * 2 + amountScore + probabilityScore + closeDateScore + employeeScore + revenueScore + lifecycleScore + fitScore + winGapScore;
  const aiPriorityScore = isCurrentlySnoozed ? 0 : Math.max(0, Math.round(rawScore * 100) / 100);

  return {
    ai_priority_score: aiPriorityScore,
    priority: getPriority(aiPriorityScore),
    reason: getReason(input, daysSinceLastContact),
    next_action: getNextAction(input, daysSinceLastContact),
  };
};
