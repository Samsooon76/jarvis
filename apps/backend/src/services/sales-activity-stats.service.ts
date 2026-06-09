import { getSupabaseAdmin } from "../db/client.js";

// Types d'activites commerciales suivies dans ce dashboard.
export const SALES_ACTIVITY_TYPES = ["call", "sms", "meeting"] as const;
export type SalesActivityType = (typeof SALES_ACTIVITY_TYPES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
// Supabase limite la taille des filtres `.in()` : on decoupe la liste de deals.
const DEAL_ID_BATCH_SIZE = 200;

export type SalesActivityByType = Record<SalesActivityType, number>;

export type SalesActivityOutcomeStats = {
  dealCount: number;
  total: number;
  byType: SalesActivityByType;
  avgPerDeal: number;
};

export type SalesActivityStats = {
  won: SalesActivityOutcomeStats;
  lost: SalesActivityOutcomeStats;
};

type SalesActivityStatsOptions = {
  scope: "all" | "owner";
  hubspotOwnerId: string | null;
  // Filtre optionnel sur la date de cloture du deal.
  closedFrom: string | null;
  closedTo: string | null;
};

type ClosedDealRow = {
  hubspot_deal_id: string;
  deal_lifecycle_status: string | null;
};

type ActivityLinkRow = {
  activity_type: string | null;
  hubspot_deal_id: string;
};

const emptyByType = (): SalesActivityByType => ({ call: 0, sms: 0, meeting: 0 });

const emptyOutcome = (): SalesActivityOutcomeStats => ({
  dealCount: 0,
  total: 0,
  byType: emptyByType(),
  avgPerDeal: 0,
});

const isSalesActivityType = (value: string | null): value is SalesActivityType =>
  value !== null && (SALES_ACTIVITY_TYPES as readonly string[]).includes(value);

// Charge les deals clotures (gagnes/perdus) du perimetre, avec filtre date de cloture.
const loadClosedDeals = async (orgId: string, options: SalesActivityStatsOptions): Promise<ClosedDealRow[]> => {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("hubspot_deals")
    .select("hubspot_deal_id, deal_lifecycle_status")
    .eq("org_id", orgId)
    .in("deal_lifecycle_status", ["won", "lost"]);

  if (options.scope === "owner" && options.hubspotOwnerId) {
    query = query.eq("hubspot_owner_id", options.hubspotOwnerId);
  }

  if (options.closedFrom) {
    query = query.gte("closed_at", new Date(options.closedFrom).toISOString());
  }

  if (options.closedTo) {
    // Borne haute inclusive sur la journee.
    query = query.lte("closed_at", new Date(new Date(options.closedTo).getTime() + DAY_MS - 1).toISOString());
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Impossible de charger les deals clotures: ${error.message}`);
  }

  return (data ?? []) as ClosedDealRow[];
};

// Charge les liaisons activite<->deal pour les deals fournis, types commerciaux uniquement.
const loadActivityLinks = async (orgId: string, dealIds: string[]): Promise<ActivityLinkRow[]> => {
  if (dealIds.length === 0) {
    return [];
  }

  const supabase = getSupabaseAdmin();
  const links: ActivityLinkRow[] = [];

  for (let index = 0; index < dealIds.length; index += DEAL_ID_BATCH_SIZE) {
    const batch = dealIds.slice(index, index + DEAL_ID_BATCH_SIZE);
    const { data, error } = await supabase
      .from("hubspot_activity_deal_links")
      .select("activity_type, hubspot_deal_id")
      .eq("org_id", orgId)
      .in("activity_type", SALES_ACTIVITY_TYPES as unknown as string[])
      .in("hubspot_deal_id", batch);

    if (error) {
      throw new Error(`Impossible de charger les activites des deals: ${error.message}`);
    }

    links.push(...((data ?? []) as ActivityLinkRow[]));
  }

  return links;
};

const finalizeOutcome = (outcome: SalesActivityOutcomeStats): SalesActivityOutcomeStats => ({
  ...outcome,
  avgPerDeal: outcome.dealCount > 0 ? Math.round((outcome.total / outcome.dealCount) * 10) / 10 : 0,
});

// Compte les activites commerciales (call/sms/meeting) sur les deals gagnes vs perdus.
export const getSalesActivityStats = async (
  orgId: string,
  options: SalesActivityStatsOptions,
): Promise<SalesActivityStats> => {
  const deals = await loadClosedDeals(orgId, options);

  const won = emptyOutcome();
  const lost = emptyOutcome();
  const outcomeByDeal = new Map<string, "won" | "lost">();

  for (const deal of deals) {
    const outcome = deal.deal_lifecycle_status === "won" ? "won" : "lost";
    outcomeByDeal.set(deal.hubspot_deal_id, outcome);
    (outcome === "won" ? won : lost).dealCount += 1;
  }

  const links = await loadActivityLinks(orgId, [...outcomeByDeal.keys()]);

  for (const link of links) {
    const outcome = outcomeByDeal.get(link.hubspot_deal_id);

    if (!outcome || !isSalesActivityType(link.activity_type)) {
      continue;
    }

    const bucket = outcome === "won" ? won : lost;
    bucket.byType[link.activity_type] += 1;
    bucket.total += 1;
  }

  return {
    won: finalizeOutcome(won),
    lost: finalizeOutcome(lost),
  };
};
