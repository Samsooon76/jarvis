export const formatAmount = (amount: number): string =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(amount);

export const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export const formatDate = (value: string): string =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));

export const formatMonth = (value: Date): string =>
  new Intl.DateTimeFormat("fr-FR", {
    month: "short",
    year: "2-digit",
  }).format(value);

export const formatShortMonth = (value: Date): string =>
  new Intl.DateTimeFormat("fr-FR", {
    month: "short",
  }).format(value);
