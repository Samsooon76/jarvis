import type { HubSpotCompany } from "./types.js";

export const parseNumericValue = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
};

export const parseBooleanValue = (value: string | null | undefined): boolean | null => {
  if (!value) {
    return null;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === "true") {
    return true;
  }

  if (normalizedValue === "false") {
    return false;
  }

  return null;
};

export const readProperty = (properties: Record<string, string | null | undefined>, key: string): string | null =>
  properties[key] ?? null;

export const toNullablePropertiesRecord = (
  properties: Record<string, string | null | undefined>,
  keys: string[],
): Record<string, string | null> =>
  Object.fromEntries(keys.map((key) => [key, readProperty(properties, key)]));

export const getCompanyName = (
  company: HubSpotCompany | null,
  fallbackName: string | null | undefined,
): string | null => readProperty(company?.properties ?? {}, "name") ?? fallbackName ?? null;

export const buildContextSummary = (entries: Array<[label: string, value: string | null | undefined]>): string | null => {
  const lines = entries
    .map(([label, value]) => {
      const normalizedValue = value?.trim();

      return normalizedValue ? `${label}: ${normalizedValue}` : null;
    })
    .filter((value): value is string => Boolean(value));

  return lines.length > 0 ? lines.join("\n") : null;
};

export const parsePercentage = (value: string | null | undefined): number => {
  if (!value) {
    return 0;
  }

  const normalizedValue = value.trim().replace("%", "");
  const parsed = Number(normalizedValue);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  const percentage = parsed >= 0 && parsed <= 1 ? parsed * 100 : parsed;

  return Math.max(0, Math.min(100, Math.round(percentage)));
};

export const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");

export const buildContactName = (properties: Record<string, string | null | undefined>): string => {
  const firstName = properties.firstname?.trim();
  const lastName = properties.lastname?.trim();
  const joinedName = [firstName, lastName].filter(Boolean).join(" ").trim();

  if (joinedName) {
    return joinedName;
  }

  return properties.email?.trim() || properties.phone?.trim() || "Prospect HubSpot";
};

export const normalizeClassifierText = (value: string | null | undefined): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

export const compactClassifierText = (value: string | null | undefined): string =>
  normalizeClassifierText(value).replace(/[^a-z0-9]+/g, "");
