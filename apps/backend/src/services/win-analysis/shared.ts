import type { WinAnalysisRun, WinAnalysisRunLog } from "@jarvis/shared";
import { createLlmProvider } from "../llm/provider.factory.js";
import { resolveLlmProviderPreference } from "../llm/provider-preference.service.js";
import type { LlmProvider } from "../llm/llm.provider.js";
import type { HubSpotDealRow, WinRunRow } from "./types.js";

// Boucle Win Analysis: miroir du close-lost pour les deals GAGNES.
// - Benchmark quantitatif: pur SQL/TS, 0 LLM, recalcul lazy (TTL 7 jours).
// - Analyse qualitative: 1 appel LLM par deal gagne, cachee dans deal_ai_analyses
//   (analysis_type='close_won', TTL 30 jours - un deal gagne ne change plus).
// - Comparaison deal ouvert vs benchmark: diff numerique en TS, 0 LLM.

export const CLOSE_WON_ANALYSIS_TYPE = "close_won";
export const CLOSE_WON_ANALYSIS_TTL_DAYS = 30;
// Borne du plan: 30 derniers deals gagnes max par run.
export const MAX_DEALS_PER_RUN = 30;
export const RUN_LOG_LIMIT = 100;
export const CLOSE_WON_ANALYSIS_CONCURRENCY = 5;
export const BENCHMARK_PERIOD_MONTHS = 12;
export const BENCHMARK_TTL_DAYS = 7;
// Biais de survivant: en dessous de 10 wins, le benchmark n'alimente ni le
// scoring queue ni les prompts.
export const MIN_BENCHMARK_SAMPLE_SIZE = 10;

export const WIN_FACTOR_LABELS: Record<string, string> = {
  champion: "Champion interne",
  timing: "Timing",
  product_fit: "Fit produit",
  pricing: "Pricing",
  process: "Process de vente",
  relationship: "Relation",
  other: "Autre",
};

export const parseNumber = (value: number | string | null): number | null => {
  const parsed = typeof value === "string" ? Number(value) : value;

  return parsed !== null && Number.isFinite(parsed) ? Number(parsed) : null;
};

const normalizeStageText = (value: string | null | undefined): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const isLostDeal = (row: HubSpotDealRow): boolean => {
  if (row.deal_lifecycle_status === "lost") {
    return true;
  }

  const stage = normalizeStageText(`${row.deal_stage_label ?? ""} ${row.deal_stage ?? ""}`);

  return stage.includes("lost") || stage.includes("perdu");
};

export const isWonDeal = (row: HubSpotDealRow): boolean =>
  !isLostDeal(row) && (row.deal_lifecycle_status === "won" || row.is_closed_deal === true);

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

export const getDefaultDateRange = (dateFrom?: string | null, dateTo?: string | null): { dateFrom: string; dateTo: string } => {
  const now = new Date();
  const from = new Date(now);
  from.setUTCMonth(from.getUTCMonth() - BENCHMARK_PERIOD_MONTHS);

  return {
    dateFrom: dateFrom?.slice(0, 10) || toIsoDate(from),
    dateTo: dateTo?.slice(0, 10) || toIsoDate(now),
  };
};

const normalizeLogs = (value: unknown): WinAnalysisRunLog[] =>
  Array.isArray(value)
    ? (value as WinAnalysisRunLog[]).filter(
        (item) => item && typeof item.at === "string" && typeof item.message === "string",
      )
    : [];

export const mapRunRow = (row: WinRunRow): WinAnalysisRun => ({
  id: row.id,
  orgId: row.org_id,
  status: row.status,
  progress: row.progress,
  currentStep: row.current_step,
  logs: normalizeLogs(row.logs),
  dealCount: row.deal_count,
  analyzedCount: row.analyzed_count,
  reusedCount: row.reused_count,
  failedCount: row.failed_count,
  dateFrom: row.date_from.slice(0, 10),
  dateTo: row.date_to.slice(0, 10),
  result: row.result,
  error: row.error,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
});

export const resolveProvider = async (orgId: string): Promise<LlmProvider> => {
  const preference = await resolveLlmProviderPreference(orgId);

  return createLlmProvider({ provider: preference.provider, model: preference.model });
};

export const appendRunLog = (
  logs: WinAnalysisRunLog[],
  level: WinAnalysisRunLog["level"],
  message: string,
): WinAnalysisRunLog[] => [...logs, { at: new Date().toISOString(), level, message }].slice(-RUN_LOG_LIMIT);

export const average = (values: number[]): number | null =>
  values.length > 0 ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null;

export const median = (values: number[]): number | null => {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
};
