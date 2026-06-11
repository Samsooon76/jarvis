import {
  asRecord,
  getAnalysisStatus,
  LOSS_REASON_CATEGORY_LABELS,
  parseNumber,
  readString,
} from "./shared.js";
import type {
  CloseLostAnalysisRow,
  CloseLostBreakdownRow,
  CloseLostDealContext,
  CloseLostDealListItem,
  CloseLostMetric,
} from "./types.js";

export const buildDealListItem = (
  context: CloseLostDealContext,
  analysisRow: CloseLostAnalysisRow | null,
): CloseLostDealListItem => {
  const analysis = analysisRow?.analysis ?? null;
  const properties = asRecord(context.row.properties);
  const dealName = context.row.deal_name ?? readString(properties, "dealname");
  const companyName =
    context.company?.name ??
    context.contact?.company_name ??
    readString(properties, "company") ??
    dealName ??
    "Entreprise inconnue";

  return {
    hubspotDealId: context.row.hubspot_deal_id,
    dealName,
    companyName,
    contactName: context.contact?.name ?? null,
    ownerName: context.ownerName ?? (context.row.hubspot_owner_id ? `Owner ${context.row.hubspot_owner_id}` : null),
    ownerHubSpotId: context.row.hubspot_owner_id,
    amount: parseNumber(context.row.amount) ?? 0,
    stage: context.row.deal_stage_label ?? context.row.deal_stage ?? "Closed lost",
    closedAt: context.row.closed_at,
    syncedAt: context.row.synced_at,
    analysisStatus: getAnalysisStatus(context.row, analysisRow),
    analyzedAt: analysisRow?.generated_at ?? null,
    primaryLossReason: analysis?.primaryLossReason ?? null,
    lossReasonCategory: analysis?.lossReasonCategory ?? null,
    competitorName: analysis?.competitorName ?? null,
    reactivationScore: analysis?.reactivationScore ?? null,
    confidence: analysis?.confidence ?? null,
  };
};

export const buildBreakdown = (
  deals: CloseLostDealListItem[],
  getKey: (deal: CloseLostDealListItem) => string | null,
  fallbackLabel: string,
): CloseLostBreakdownRow[] => {
  const totalValue = deals.reduce((sum, deal) => sum + deal.amount, 0);
  const rowsById = new Map<string, CloseLostBreakdownRow>();

  for (const deal of deals) {
    const label = getKey(deal)?.trim() || fallbackLabel;
    const id = label.toLowerCase();
    const current = rowsById.get(id) ?? {
      id,
      label,
      dealCount: 0,
      lostValue: 0,
      share: 0,
    };

    current.dealCount += 1;
    current.lostValue += deal.amount;
    rowsById.set(id, current);
  }

  return Array.from(rowsById.values())
    .map((row) => ({
      ...row,
      share: totalValue > 0 ? Math.round((row.lostValue / totalValue) * 100) : 0,
    }))
    .sort((left, right) => right.lostValue - left.lostValue)
    .slice(0, 8);
};

export const getLossReasonBreakdownLabel = (deal: CloseLostDealListItem): string | null => {
  if (deal.lossReasonCategory) {
    return LOSS_REASON_CATEGORY_LABELS[deal.lossReasonCategory];
  }

  return deal.primaryLossReason;
};

export const buildMetrics = (deals: CloseLostDealListItem[]): CloseLostMetric[] => {
  const lostValue = deals.reduce((sum, deal) => sum + deal.amount, 0);
  const analyzedDeals = deals.filter((deal) => deal.analysisStatus === "fresh").length;
  const scoredDeals = deals.filter((deal) => typeof deal.reactivationScore === "number");
  const averageReactivationScore =
    scoredDeals.length > 0
      ? Math.round(scoredDeals.reduce((sum, deal) => sum + (deal.reactivationScore ?? 0), 0) / scoredDeals.length)
      : 0;

  return [
    {
      id: "lostDeals",
      label: "Deals close lost",
      value: deals.length,
      unit: "count",
      caption: "Dans le scope choisi",
    },
    {
      id: "lostValue",
      label: "Valeur perdue",
      value: lostValue,
      unit: "currency",
      caption: "Somme HubSpot",
    },
    {
      id: "averageLoss",
      label: "Perte moyenne",
      value: deals.length > 0 ? Math.round(lostValue / deals.length) : 0,
      unit: "currency",
      caption: "Par deal perdu",
    },
    {
      id: "analyzedDeals",
      label: "Analyses IA",
      value: analyzedDeals,
      unit: "count",
      caption: `${deals.length - analyzedDeals} a analyser`,
    },
    {
      id: "reactivationScore",
      label: "Reactivation",
      value: averageReactivationScore,
      unit: "score",
      caption: "Score moyen",
    },
  ];
};
