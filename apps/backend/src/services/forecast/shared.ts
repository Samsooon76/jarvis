import { createLlmProvider } from "../llm/provider.factory.js";

export const chunkArray = <T>(items: T[], chunkSize: number): T[][] => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
};

export const wait = async (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

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

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const normalizeDateInput = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();

  return Number.isNaN(timestamp) ? null : value.slice(0, 10);
};

export const getDefaultDateRange = (dateFrom?: string | null, dateTo?: string | null): { dateFrom: string; dateTo: string } => {
  const now = new Date();
  const firstDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));

  return {
    dateFrom: normalizeDateInput(dateFrom) ?? firstDay.toISOString().slice(0, 10),
    dateTo: normalizeDateInput(dateTo) ?? lastDay.toISOString().slice(0, 10),
  };
};

export const getMonthStart = (date: Date): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

export const getMonthEnd = (date: Date): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));

export const getMonthKey = (date: Date): string => getMonthStart(date).toISOString().slice(0, 10);

export const getMonthLabel = (month: string): string =>
  new Intl.DateTimeFormat("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${month}T00:00:00.000Z`));

export const getMonthsBetween = (dateFrom: string, dateTo: string): string[] => {
  const start = getMonthStart(new Date(`${dateFrom}T00:00:00.000Z`));
  const end = getMonthStart(new Date(`${dateTo}T00:00:00.000Z`));
  const months: string[] = [];
  const cursor = new Date(start);

  while (cursor.getTime() <= end.getTime()) {
    months.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return months;
};

export const addDays = (date: Date, days: number): Date => {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);

  return copy;
};

export const toUtcDateString = (date: Date): string => date.toISOString().slice(0, 10);

export const periodIncludesDate = (dateFrom: string, dateTo: string, date: string): boolean =>
  dateFrom <= date && date <= dateTo;

export const periodIncludesToday = (dateFrom: string, dateTo: string, referenceDate = new Date()): boolean =>
  periodIncludesDate(dateFrom, dateTo, toUtcDateString(referenceDate));

export const normalizeText = (value: string | null | undefined): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export const getProvider = (providerId?: string | null, modelId?: string | null) =>
  createLlmProvider({
    provider: providerId,
    model: modelId,
  });
