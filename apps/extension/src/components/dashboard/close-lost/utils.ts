import type {
  CloseLostDealDetailResult,
  CloseLostDealListItem,
  CloseLostMetric,
  CloseLostOverviewResult,
  HubSpotOwnerOption,
} from "../../../services/api";
import { formatAmount, formatDate } from "../../../utils/dashboard/formatters";

export type CloseLostAnalysisViewProps = {
  orgId: string;
  owners: HubSpotOwnerOption[];
  selectedOwnerId?: string;
  selectedAiProvider: import("../../../services/api").AiProviderOption;
};

export type BreakdownTableRow = {
  id: string;
  label: string;
  dealCount: number;
  lostValue: number;
  averageLoss: number;
  share: number;
};

export type TrendPoint = {
  key: string;
  label: string;
  value: number;
  cumulativeValue: number;
};

export const wait = async (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });

// Plafond de securite pour le polling du run close-lost (evite une boucle infinie
// si le backend ne termine jamais le run).
export const CLOSE_LOST_POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export const formatInputDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

export const getDefaultDateRange = (): { dateFrom: string; dateTo: string } => {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);

  return {
    dateFrom: formatInputDate(yearStart),
    dateTo: formatInputDate(now),
  };
};

export const getSalesAeOwners = (owners: HubSpotOwnerOption[]): HubSpotOwnerOption[] => {
  const salesAeOwners = owners.filter((owner) => owner.teamName?.toLowerCase().includes("sales ae"));

  return salesAeOwners.length > 0 ? salesAeOwners : owners;
};

export const formatMetricValue = (metric: CloseLostMetric): string => {
  if (metric.unit === "currency") {
    return formatAmount(metric.value);
  }

  if (metric.unit === "score") {
    return `${metric.value}/100`;
  }

  return String(metric.value);
};

export const getMetricTone = (metric: CloseLostMetric): string => {
  if (metric.id === "lostDeals" || metric.id === "analyzedDeals") {
    return "down";
  }

  if (metric.id === "reactivationScore") {
    return "up";
  }

  return "neutral";
};

export const analysisStatusLabels: Record<CloseLostDealListItem["analysisStatus"], string> = {
  fresh: "Analysee",
  missing: "Non analysee",
  stale: "Analysee",
};

export const severityLabels: Record<string, string> = {
  high: "Eleve",
  low: "Faible",
  medium: "Moyen",
};

export const getDateRangeLabel = (dateFrom: string, dateTo: string): string => {
  const from = dateFrom ? formatDate(dateFrom) : "Debut";
  const to = dateTo ? formatDate(dateTo) : "Aujourd'hui";

  return `${from} - ${to}`;
};

export const getKeyInsight = (overview: CloseLostOverviewResult | null): { title: string; detail: string } => {
  if (overview?.portfolio) {
    return {
      title: overview.portfolio.keyInsight,
      detail: overview.portfolio.executiveSummary,
    };
  }

  const topReason = overview?.lossReasons[0] ?? null;

  if (topReason) {
    return {
      title: `${topReason.label} est la premiere raison de perte (${topReason.share}% de la valeur perdue).`,
      detail: "Lance l'analyse IA globale pour confirmer les causes recurrentes et generer les recommandations manager.",
    };
  }

  return {
    title: "Aucune perte analysee sur ce perimetre.",
    detail: "Ajuste les filtres ou relance une synchronisation HubSpot pour alimenter cette vue.",
  };
};

export const getOwnerDisplayName = (
  ownerHubSpotId: string | null,
  fallbackName: string | null,
  ownersById: Map<string, HubSpotOwnerOption>,
): string => {
  if (ownerHubSpotId) {
    const owner = ownersById.get(ownerHubSpotId);

    if (owner) {
      return owner.name;
    }
  }

  return fallbackName ?? "Owner non assigne";
};

export const getDealOwnerDisplayName = (
  deal: Pick<CloseLostDealListItem, "ownerHubSpotId" | "ownerName">,
  ownersById: Map<string, HubSpotOwnerOption>,
): string => getOwnerDisplayName(deal.ownerHubSpotId, deal.ownerName, ownersById);

export const getDetailOwnerDisplayName = (
  detail: CloseLostDealDetailResult,
  ownersById: Map<string, HubSpotOwnerOption>,
): string => getOwnerDisplayName(detail.deal.ownerHubSpotId, detail.deal.ownerName, ownersById);

export const buildBreakdownRows = (
  deals: CloseLostDealListItem[],
  getKey: (deal: CloseLostDealListItem) => string | null,
  fallbackLabel: string,
): BreakdownTableRow[] => {
  const lostValue = deals.reduce((sum, deal) => sum + deal.amount, 0);
  const rowsByLabel = new Map<string, BreakdownTableRow>();

  for (const deal of deals) {
    const label = getKey(deal)?.trim() || fallbackLabel;
    const id = label.toLowerCase();
    const row = rowsByLabel.get(id) ?? {
      id,
      label,
      dealCount: 0,
      lostValue: 0,
      averageLoss: 0,
      share: 0,
    };

    row.dealCount += 1;
    row.lostValue += deal.amount;
    rowsByLabel.set(id, row);
  }

  return Array.from(rowsByLabel.values())
    .map((row) => ({
      ...row,
      averageLoss: row.dealCount > 0 ? Math.round(row.lostValue / row.dealCount) : 0,
      share: lostValue > 0 ? Math.round((row.lostValue / lostValue) * 100) : 0,
    }))
    .sort((left, right) => right.lostValue - left.lostValue)
    .slice(0, 5);
};

export const buildMonthlyTrend = (deals: CloseLostDealListItem[]): TrendPoint[] => {
  const formatter = new Intl.DateTimeFormat("fr-FR", { month: "short" });
  const rowsByMonth = new Map<string, { date: Date; value: number }>();

  for (const deal of deals) {
    if (!deal.closedAt) {
      continue;
    }

    const closedAt = new Date(deal.closedAt);

    if (Number.isNaN(closedAt.getTime())) {
      continue;
    }

    const date = new Date(closedAt.getFullYear(), closedAt.getMonth(), 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const current = rowsByMonth.get(key) ?? { date, value: 0 };
    current.value += deal.amount;
    rowsByMonth.set(key, current);
  }

  let cumulativeValue = 0;

  return Array.from(rowsByMonth.entries())
    .sort(([, left], [, right]) => left.date.getTime() - right.date.getTime())
    .map(([key, row]) => {
      cumulativeValue += row.value;

      return {
        key,
        label: formatter.format(row.date).replace(".", ""),
        value: row.value,
        cumulativeValue,
      };
    });
};
