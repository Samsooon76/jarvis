import { createHash } from "node:crypto";
import { formatHubSpotTimelineForPrompt } from "../hubspot-history-formatting.service.js";
import type { HubSpotDealHistoryItem } from "../hubspot.service.js";
import { createLlmProvider } from "../llm/provider.factory.js";
import type { CloseLostDealAnalysis, CloseLostEvidenceSource, LlmProvider } from "../llm/llm.provider.js";
import type {
  CloseLostAnalysisRow,
  CloseLostAnalysisRun,
  CloseLostAnalysisRunRow,
  CloseLostAnalysisStatus,
  CloseLostDealContext,
  CloseLostRunLog,
  CloseLostScope,
  HubSpotDealRow,
} from "./types.js";

export const MAX_DEALS_PER_RUN = 80;
export const RUN_LOG_LIMIT = 100;
export const CLOSE_LOST_ANALYSIS_CONCURRENCY = 10;

export const LOSS_REASON_CATEGORY_LABELS: Record<CloseLostDealAnalysis["lossReasonCategory"], string> = {
  authority: "Autorite de decision",
  budget: "Budget",
  competition: "Concurrence",
  no_decision: "Client inconclusif",
  other: "Autre",
  pricing: "Pricing",
  product_gap: "Fonctionnalites manquantes",
  timing: "Timing",
};

export const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const readString = (record: Record<string, unknown> | null, key: string): string | null => {
  const value = record?.[key];

  return typeof value === "string" && value.trim() ? value : null;
};

export const parseNumber = (value: number | string | null | undefined): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
};

const parseDate = (value: string): Date | null => {
  const timestamp = new Date(value).getTime();

  return Number.isNaN(timestamp) ? null : new Date(timestamp);
};

export const getDateOnly = (value: string): string => value.slice(0, 10);

export const addDays = (date: Date, days: number): Date => {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);

  return copy;
};

const hashInput = (value: string): string => createHash("sha256").update(value).digest("hex");

const normalizeStageText = (value: string | null | undefined): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export const isLostDeal = (row: HubSpotDealRow): boolean => {
  if (row.deal_lifecycle_status === "lost") {
    return true;
  }

  const stage = normalizeStageText(`${row.deal_stage_label ?? ""} ${row.deal_stage ?? ""}`);

  return stage.includes("lost") || stage.includes("perdu");
};

export const buildHistoryText = (timeline: HubSpotDealHistoryItem[]): string =>
  formatHubSpotTimelineForPrompt(timeline);

const SOURCE_ACTIVITY_TYPES = new Set<HubSpotDealHistoryItem["type"]>([
  "note",
  "call",
  "meeting",
  "email",
  "sms",
  "communication",
]);

const compactSourceText = (value: string | null, maxLength: number): string => {
  const compacted = (value ?? "").replace(/\s+/g, " ").trim();

  if (compacted.length <= maxLength) {
    return compacted;
  }

  return `${compacted.slice(0, maxLength - 1).trim()}...`;
};

export const buildEvidenceSources = (timeline: HubSpotDealHistoryItem[]): CloseLostEvidenceSource[] =>
  timeline
    .filter((item) => SOURCE_ACTIVITY_TYPES.has(item.type))
    .map((item) => ({
      activityId: item.id,
      type: item.type,
      channel: item.metadata.channel ?? null,
      occurredAt: item.timestamp,
      title: compactSourceText(item.title, 120) || `${item.type} ${item.id}`,
      quote: compactSourceText(item.body, 260),
    }))
    .filter((source) => source.quote.length > 0)
    .slice(-80);

const normalizeLogs = (value: unknown): CloseLostRunLog[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is CloseLostRunLog => {
          if (!isRecord(item)) {
            return false;
          }

          return (
            typeof item.at === "string" &&
            typeof item.message === "string" &&
            (item.level === "info" || item.level === "success" || item.level === "warning" || item.level === "error")
          );
        })
        .slice(-RUN_LOG_LIMIT)
    : [];

export const mapRunRow = (row: CloseLostAnalysisRunRow): CloseLostAnalysisRun => ({
  id: row.id,
  orgId: row.org_id,
  scope: row.scope,
  hubspotOwnerId: row.hubspot_owner_id,
  salesAeOwnerIds: row.sales_ae_owner_ids ?? [],
  provider: row.provider,
  model: row.model,
  dateFrom: getDateOnly(row.date_from),
  dateTo: getDateOnly(row.date_to),
  status: row.status,
  progress: row.progress,
  currentStep: row.current_step,
  logs: normalizeLogs(row.logs),
  dealCount: row.deal_count,
  analyzedCount: row.analyzed_count,
  reusedCount: row.reused_count,
  failedCount: row.failed_count,
  result: row.result,
  error: row.error,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const getProvider = (providerId?: string | null, modelId?: string | null): LlmProvider =>
  createLlmProvider({
    provider: providerId,
    model: modelId,
  });

export const getDefaultDateRange = (
  dateFrom?: string | null,
  dateTo?: string | null,
): { dateFrom: string; dateTo: string } => {
  const now = new Date();
  const normalizedDateTo = dateTo && parseDate(dateTo) ? dateTo.slice(0, 10) : now.toISOString().slice(0, 10);
  const normalizedDateFrom =
    dateFrom && parseDate(dateFrom) ? dateFrom.slice(0, 10) : `${now.getUTCFullYear()}-01-01`;

  return {
    dateFrom: normalizedDateFrom,
    dateTo: normalizedDateTo,
  };
};

export const buildScopeLabel = (scope: CloseLostScope, ownerName: string | null): string =>
  scope === "owner" ? `Owner ${ownerName ?? "selectionne"}` : "Tous les Sales AE";

export const getAnalysisStatus = (
  deal: HubSpotDealRow,
  analysis: CloseLostAnalysisRow | null,
): CloseLostAnalysisStatus => {
  if (!analysis) {
    return "missing";
  }

  return analysis.source_synced_at && analysis.source_synced_at === deal.synced_at ? "fresh" : "stale";
};

export const buildAnalysisInputHash = (context: CloseLostDealContext, historyText: string): string =>
  hashInput(
    JSON.stringify({
      hubspotDealId: context.row.hubspot_deal_id,
      dealName: context.row.deal_name,
      amount: context.row.amount,
      stage: context.row.deal_stage,
      stageLabel: context.row.deal_stage_label,
      closedAt: context.row.closed_at,
      hubspotUpdatedAt: context.row.hubspot_updated_at,
      syncedAt: context.row.synced_at,
      primaryContactId: context.row.primary_contact_id,
      primaryCompanyId: context.row.primary_company_id,
      historyText,
    }),
  );

export const appendRunLog = (
  logs: CloseLostRunLog[],
  level: CloseLostRunLog["level"],
  message: string,
): CloseLostRunLog[] =>
  [
    ...logs,
    {
      at: new Date().toISOString(),
      level,
      message,
    },
  ].slice(-RUN_LOG_LIMIT);
