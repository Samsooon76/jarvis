const JARVIS_DEFAULT_ORG_ID = "11111111-1111-4111-8111-111111111111";

export const DEFAULT_ORG_ID = import.meta.env.VITE_DEFAULT_ORG_ID?.trim() || JARVIS_DEFAULT_ORG_ID;
export const DEFAULT_HUBSPOT_OWNER_ID = import.meta.env.VITE_HUBSPOT_OWNER_ID?.trim() || null;

export const getHubSpotOwnerStorageKey = (orgId: string): string => `jarvis.hubspotOwnerId:${orgId}`;

export const isAbortError = (error: unknown): boolean => error instanceof Error && error.name === "AbortError";
