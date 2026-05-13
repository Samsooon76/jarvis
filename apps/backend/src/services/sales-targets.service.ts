import { getSupabaseAdmin } from "../db/client.js";

export type MonthlySalesTarget = {
  id: string;
  orgId: string;
  hubspotOwnerId: string;
  ownerName: string;
  targetMonth: string;
  objectiveAmount: number;
  createdAt: string;
  updatedAt: string;
};

export type MonthlySalesTargetInput = {
  hubspotOwnerId: string;
  ownerName: string;
  targetMonth: string;
  objectiveAmount: number;
};

type MonthlySalesTargetRow = {
  id: string;
  org_id: string;
  hubspot_owner_id: string;
  owner_name: string;
  target_month: string;
  objective_amount: number | string;
  created_at: string;
  updated_at: string;
};

const toAmount = (value: number | string): number => {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
};

const toTarget = (row: MonthlySalesTargetRow): MonthlySalesTarget => ({
  id: row.id,
  orgId: row.org_id,
  hubspotOwnerId: row.hubspot_owner_id,
  ownerName: row.owner_name,
  targetMonth: row.target_month,
  objectiveAmount: toAmount(row.objective_amount),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const normalizeTargetMonth = (value: string): string | null => {
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(value)) {
    return null;
  }

  const candidate = value.length === 7 ? `${value}-01` : value;
  const date = new Date(`${candidate}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
};

export const listMonthlySalesTargets = async (orgId: string, year: number): Promise<MonthlySalesTarget[]> => {
  const supabase = getSupabaseAdmin();
  const dateFrom = `${year}-01-01`;
  const dateTo = `${year + 1}-01-01`;
  const { data, error } = await supabase
    .from("monthly_sales_targets")
    .select("id, org_id, hubspot_owner_id, owner_name, target_month, objective_amount, created_at, updated_at")
    .eq("org_id", orgId)
    .gte("target_month", dateFrom)
    .lt("target_month", dateTo)
    .order("target_month", { ascending: true })
    .order("owner_name", { ascending: true });

  if (error) {
    throw new Error(`Impossible de charger les objectifs mensuels: ${error.message}`);
  }

  return ((data ?? []) as MonthlySalesTargetRow[]).map(toTarget);
};

export const upsertMonthlySalesTargets = async (
  orgId: string,
  targets: MonthlySalesTargetInput[],
): Promise<MonthlySalesTarget[]> => {
  const rows = targets.map((target) => ({
    org_id: orgId,
    hubspot_owner_id: target.hubspotOwnerId.trim(),
    owner_name: target.ownerName.trim(),
    target_month: target.targetMonth,
    objective_amount: target.objectiveAmount,
  }));

  if (rows.length === 0) {
    return [];
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("monthly_sales_targets")
    .upsert(rows, { onConflict: "org_id,hubspot_owner_id,target_month" })
    .select("id, org_id, hubspot_owner_id, owner_name, target_month, objective_amount, created_at, updated_at")
    .order("target_month", { ascending: true })
    .order("owner_name", { ascending: true });

  if (error) {
    throw new Error(`Impossible d'enregistrer les objectifs mensuels: ${error.message}`);
  }

  return ((data ?? []) as MonthlySalesTargetRow[]).map(toTarget);
};

export const getObjectiveAmountForForecast = async ({
  orgId,
  scope,
  hubspotOwnerId,
  dateFrom,
  dateTo,
}: {
  orgId: string;
  scope: "all" | "owner";
  hubspotOwnerId: string | null;
  dateFrom: string;
  dateTo: string;
}): Promise<number | null> => {
  const supabase = getSupabaseAdmin();
  const startMonth = normalizeTargetMonth(dateFrom);
  const endMonth = normalizeTargetMonth(dateTo);

  if (!startMonth || !endMonth) {
    return null;
  }

  let query = supabase
    .from("monthly_sales_targets")
    .select("objective_amount")
    .eq("org_id", orgId)
    .gte("target_month", startMonth)
    .lte("target_month", endMonth);

  if (scope === "owner") {
    if (!hubspotOwnerId) {
      return null;
    }

    query = query.eq("hubspot_owner_id", hubspotOwnerId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Impossible de charger l'objectif forecast: ${error.message}`);
  }

  const total = ((data ?? []) as Array<{ objective_amount: number | string }>).reduce(
    (sum, row) => sum + toAmount(row.objective_amount),
    0,
  );

  return total > 0 ? total : null;
};
