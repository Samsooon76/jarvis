const JARVIS_DEFAULT_ORG_ID = "11111111-1111-4111-8111-111111111111";

const getRuntimeHostname = (): string | null => {
  if (typeof window !== "undefined") {
    return window.location.hostname;
  }

  return globalThis.location?.hostname ?? null;
};

const resolveApiBaseUrl = (): string => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  if (import.meta.env.DEV && ["127.0.0.1", "localhost"].includes(getRuntimeHostname() ?? "")) {
    return "http://127.0.0.1:4000";
  }

  return "https://jarvisapi-production-10cd.up.railway.app";
};

export const API_BASE_URL = resolveApiBaseUrl();
export const API_AUTH_TOKEN_STORAGE_KEY = "jarvis.apiAuthToken";
export const API_AUTH_SESSION_STORAGE_KEY = "jarvis.apiAuthSession";
export const PULSE_SHOWN_IDS_STORAGE_KEY = "jarvis.pulse.shownNotificationIds";

export const DEFAULT_ORG_ID = import.meta.env.VITE_DEFAULT_ORG_ID?.trim() || JARVIS_DEFAULT_ORG_ID;
export const DEFAULT_HUBSPOT_OWNER_ID = import.meta.env.VITE_HUBSPOT_OWNER_ID?.trim() || null;

export const getHubSpotOwnerStorageKey = (orgId: string): string => `jarvis.hubspotOwnerId:${orgId}`;

export const isAbortError = (error: unknown): boolean => error instanceof Error && error.name === "AbortError";
