export const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

export const compactText = (value: string, maxLength?: number): string => {
  const normalized = normalizeText(value);

  if (maxLength === undefined || normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};