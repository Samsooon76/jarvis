import type { EventTypeMeta, SalesActivityEventType, SalesTaskStatus } from "./types.js";
import { SALES_ACTIVITY_EVENT_TYPES } from "./types.js";

export const EVENT_TYPE_META = {
  "call.received": { channel: "call", direction: "inbound" },
  "call.completed": { channel: "call", direction: "outbound" },
  "email.received": { channel: "email", direction: "inbound" },
  "email.sent": { channel: "email", direction: "outbound" },
  "sms.received": { channel: "sms", direction: "inbound" },
  "sms.sent": { channel: "sms", direction: "outbound" },
  "meeting.completed": { channel: "meeting", direction: "outbound" },
  "note.created": { channel: "note", direction: "system" },
  "deal.created": { channel: "deal", direction: "system" },
  "deal.updated": { channel: "deal", direction: "system" },
  "deal.stage_changed": { channel: "deal", direction: "system" },
  "deal.amount_changed": { channel: "deal", direction: "system" },
  "deal.probability_changed": { channel: "deal", direction: "system" },
  "deal.close_date_changed": { channel: "deal", direction: "system" },
  "deal.owner_changed": { channel: "deal", direction: "system" },
  "deal.pipeline_changed": { channel: "deal", direction: "system" },
  "deal.won": { channel: "deal", direction: "system" },
  "deal.lost": { channel: "deal", direction: "system" },
} as const satisfies Record<SalesActivityEventType, EventTypeMeta>;

const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

export const MS_PER_DAY = 86_400_000;
export const ACTIVE_TASK_STATUSES: SalesTaskStatus[] = ["pending", "snoozed"];

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

export const isSalesActivityEventType = (value: string | null): value is SalesActivityEventType =>
  SALES_ACTIVITY_EVENT_TYPES.some((eventType) => eventType === value);

export const readString = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
};

export const readNumber = (record: Record<string, unknown>, key: string): number | null => {
  const value = record[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

export const readFirstString = (record: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = readString(record, key);

    if (value) {
      return value;
    }
  }

  return null;
};

export const readFirstNumber = (record: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const value = readNumber(record, key);

    if (value !== null) {
      return value;
    }
  }

  return null;
};

export const assertUuid = (value: string, fieldName: string): void => {
  if (!UUID_V4_LIKE_PATTERN.test(value)) {
    throw new Error(`${fieldName} doit etre un UUID Jarvis valide.`);
  }
};

export const normalizeIsoDate = (value: string | null | undefined, fallback: Date): string => {
  if (!value) {
    return fallback.toISOString();
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error("occurredAt doit etre une date ISO valide.");
  }

  return parsed.toISOString();
};

export const sanitizeSource = (source: string | null | undefined): string =>
  (source?.trim() || "generic_webhook").slice(0, 80);

export const toNumber = (value: number | string | null): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

export const roundScore = (value: number): number => Math.round(value * 100) / 100;

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const getDaysUntil = (value: string | null, now: Date): number | null => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.ceil((timestamp - now.getTime()) / MS_PER_DAY);
};

export const getDaysSince = (value: string | null, now: Date): number | null => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.max(0, Math.floor((now.getTime() - timestamp) / MS_PER_DAY));
};

export const addMinutes = (date: Date, minutes: number): Date => new Date(date.getTime() + minutes * 60_000);

export const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);

  return next;
};

export const setTime = (date: Date, hour: number, minute = 0): Date => {
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);

  return next;
};

export const readRawString = (rawData: unknown, key: string): string | null => {
  if (!isRecord(rawData)) {
    return null;
  }

  return readString(rawData, key);
};

export const getProspectDealName = (rawData: unknown): string | null => readRawString(rawData, "dealName");

export const getProspectCloseDate = (rawData: unknown, payload: Record<string, unknown> = {}): string | null =>
  readFirstString(payload, ["closeDate", "closedAt", "dealCloseDate"]) ??
  readRawString(rawData, "closedAt") ??
  readRawString(rawData, "closeDate");
