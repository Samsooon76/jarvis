import { createHash } from "node:crypto";
import { formatHubSpotTimelineForPrompt } from "../hubspot-history-formatting.service.js";
import type { HubSpotDealHistoryItem } from "../hubspot.service.js";
import type { DealActivityPlanAnalysis } from "../llm/llm.provider.js";
import type {
  DealActivityPlanCacheContext,
  DealActivityPlanCachePayload,
  JsonRecord,
  SupabaseErrorLike,
} from "./types.js";

export const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const splitDealActivityPlanCachePayload = (
  payload: DealActivityPlanCachePayload,
): { activityPlan: DealActivityPlanAnalysis; cachedContext: DealActivityPlanCacheContext | null } => {
  const { cachedContext, ...activityPlan } = payload;

  return {
    activityPlan,
    cachedContext:
      cachedContext && Array.isArray(cachedContext.recentActivities) && Array.isArray(cachedContext.channelEngagement)
        ? cachedContext
        : null,
  };
};

export const isUuid = (value: string): boolean => UUID_V4_LIKE_PATTERN.test(value.trim());

export const parseCompositeProspectId = (prospectId: string): { hubspotContactId: string; hubspotDealId: string | null } | null => {
  const separatorIndex = prospectId.indexOf(":");

  if (separatorIndex <= 0) {
    return null;
  }

  const hubspotContactId = prospectId.slice(0, separatorIndex).trim();
  const rawDealId = prospectId.slice(separatorIndex + 1).trim();
  const hubspotDealId = rawDealId && rawDealId !== "contact" ? rawDealId : null;

  if (!hubspotContactId) {
    return null;
  }

  return {
    hubspotContactId,
    hubspotDealId,
  };
};

export const buildHistoryText = (timeline: HubSpotDealHistoryItem[]): string => formatHubSpotTimelineForPrompt(timeline);

export const hashInput = (value: string): string => createHash("sha256").update(value).digest("hex");

export const isMissingDealAiAnalysesTableError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const typedError = error as SupabaseErrorLike;
  const message = typedError.message ?? "";

  return typedError.code === "42P01" || typedError.code === "PGRST205" || message.includes("deal_ai_analyses");
};

export const isMissingAnalysisTypeColumnError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const typedError = error as SupabaseErrorLike;
  const message = typedError.message ?? "";

  return typedError.code === "42703" || typedError.code === "PGRST204" || message.includes("analysis_type");
};

export const asRecord = (value: unknown): JsonRecord | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;

export const readString = (record: JsonRecord | null, key: string): string | null => {
  const value = record?.[key];

  return typeof value === "string" && value.trim() ? value : null;
};

export const readNestedRecord = (record: JsonRecord | null, key: string): JsonRecord | null => asRecord(record?.[key]);

export const readNestedString = (record: JsonRecord | null, keys: string[]): string | null => {
  let cursor = record;

  for (const key of keys.slice(0, -1)) {
    cursor = readNestedRecord(cursor, key);

    if (!cursor) {
      return null;
    }
  }

  return readString(cursor, keys[keys.length - 1] ?? "");
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

export const clampInteger = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value)));

export const parseProbability = (value: number | string | null | undefined): number | null => {
  const parsed = parseNumber(value);

  if (parsed === null) {
    return null;
  }

  return clampInteger(parsed >= 0 && parsed <= 1 ? parsed * 100 : parsed, 0, 100);
};

export const firstDefined = <T>(...values: Array<T | null | undefined>): T | null => {
  for (const value of values) {
    if (value !== null && value !== undefined) {
      return value;
    }
  }

  return null;
};

export const firstNonEmptyString = (...values: Array<string | null | undefined>): string | null => {
  for (const value of values) {
    const normalizedValue = value?.trim();

    if (normalizedValue) {
      return normalizedValue;
    }
  }

  return null;
};

export const compactText = (value: string, maxLength: number): string => {
  const compacted = value.replace(/\s+/g, " ").trim();

  if (compacted.length <= maxLength) {
    return compacted;
  }

  return `${compacted.slice(0, maxLength - 3).trim()}...`;
};

export const stripMarkup = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const stripped = value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  return stripped || null;
};

export const normalizeTimestamp = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();

  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
};

export const getLocalDayStartMs = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

export const isKnownFutureOrTodayDate = (value: string | null, referenceDate: Date): boolean => {
  if (!value) {
    return false;
  }

  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return false;
  }

  return timestamp >= getLocalDayStartMs(referenceDate);
};

export const sanitizeDealActivityPlanAnalysis = (
  analysis: DealActivityPlanAnalysis,
  referenceDate: Date,
): DealActivityPlanAnalysis => ({
  ...analysis,
  upcomingDeadlines: analysis.upcomingDeadlines
    .filter((deadline) => isKnownFutureOrTodayDate(deadline.date, referenceDate))
    .sort((left, right) => {
      const leftTime = left.date ? new Date(left.date).getTime() : Number.MAX_SAFE_INTEGER;
      const rightTime = right.date ? new Date(right.date).getTime() : Number.MAX_SAFE_INTEGER;

      return leftTime - rightTime;
    }),
});

export const getDaysSince = (value: string | null): number => {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
};

export const addDays = (date: Date, days: number): string => {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);

  return copy.toISOString();
};
