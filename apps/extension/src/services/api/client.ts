import type { ApiResponse } from "@jarvis/shared";
import type { Session } from "@supabase/supabase-js";
import {
  API_BASE_URL,
  API_AUTH_SESSION_STORAGE_KEY,
  API_AUTH_TOKEN_STORAGE_KEY as API_AUTH_STORAGE_KEY,
} from "../../config/runtime";

export { API_BASE_URL };

type StoredApiAuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
};

const PULSE_SESSION_UPDATED_MESSAGE = "jarvis:pulse-session-updated";

type ChromeRuntimeLike = {
  sendMessage?: (message: { type: string }) => void;
};

// Le service worker de l'extension (Jarvis Pulse) n'a pas acces au localStorage
// de la page: on duplique le token dans chrome.storage.local quand il est disponible.
const mirrorAuthTokenToChromeStorage = (token: string | null): void => {
  try {
    const chromeStorage = (globalThis as { chrome?: { storage?: { local?: { set?: (items: Record<string, unknown>) => void; remove?: (key: string) => void } } } }).chrome?.storage?.local;

    if (!chromeStorage) {
      return;
    }

    if (token) {
      chromeStorage.set?.({ [API_AUTH_STORAGE_KEY]: token });
    } else {
      chromeStorage.remove?.(API_AUTH_STORAGE_KEY);
    }
  } catch {
    // Hors contexte extension (dashboard web): on ignore silencieusement.
  }
};

const mirrorAuthSessionToChromeStorage = (session: StoredApiAuthSession | null): void => {
  try {
    const chromeStorage = (globalThis as { chrome?: { storage?: { local?: { set?: (items: Record<string, unknown>) => void; remove?: (key: string) => void } } } }).chrome?.storage?.local;

    if (!chromeStorage) {
      return;
    }

    if (session) {
      chromeStorage.set?.({ [API_AUTH_SESSION_STORAGE_KEY]: session });
    } else {
      chromeStorage.remove?.(API_AUTH_SESSION_STORAGE_KEY);
    }
  } catch {
    // Hors contexte extension (dashboard web): on ignore silencieusement.
  }
};

const notifyPulseSessionUpdated = (): void => {
  try {
    const runtime = (globalThis as { chrome?: { runtime?: ChromeRuntimeLike } }).chrome?.runtime;

    runtime?.sendMessage?.({ type: PULSE_SESSION_UPDATED_MESSAGE });
  } catch {
    // Hors contexte extension ou service worker non disponible: l'alarme prendra le relais.
  }
};

export const setApiAuthSession = (session: Session): void => {
  const storedSession: StoredApiAuthSession = {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? null,
  };

  window.localStorage.setItem(API_AUTH_STORAGE_KEY, session.access_token);
  mirrorAuthTokenToChromeStorage(session.access_token);
  mirrorAuthSessionToChromeStorage(storedSession);
  notifyPulseSessionUpdated();
};

export const setApiAuthToken = (token: string): void => {
  window.localStorage.setItem(API_AUTH_STORAGE_KEY, token);
  mirrorAuthTokenToChromeStorage(token);
  notifyPulseSessionUpdated();
};

export const clearApiAuthToken = (): void => {
  window.localStorage.removeItem(API_AUTH_STORAGE_KEY);
  mirrorAuthTokenToChromeStorage(null);
  mirrorAuthSessionToChromeStorage(null);
};

export type ApiRequestOptions = {
  signal?: AbortSignal;
};

type ApiQueryValue = string | number | boolean | null | undefined;

export const apiPath = (path: string, query: Record<string, ApiQueryValue> = {}): string => {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") {
      continue;
    }

    searchParams.set(key, String(value));
  }

  const queryString = searchParams.toString();

  return queryString ? `${path}?${queryString}` : path;
};

const getApiAuthToken = (): string | null => {
  if (typeof window === "undefined") {
    return import.meta.env.VITE_API_AUTH_TOKEN?.trim() || null;
  }

  return window.localStorage.getItem(API_AUTH_STORAGE_KEY)?.trim() || import.meta.env.VITE_API_AUTH_TOKEN?.trim() || null;
};

const buildApiHeaders = (headers: Record<string, string> = {}): Record<string, string> => {
  const authToken = getApiAuthToken();

  return authToken
    ? {
        ...headers,
        Authorization: `Bearer ${authToken}`,
      }
    : headers;
};

const parseApiResponse = async <T>(response: Response): Promise<T> => {
  const responseText = await response.text();

  if (!responseText) {
    throw new Error(response.ok ? "La reponse API est vide." : `Erreur API (${response.status}).`);
  }

  let payload: ApiResponse<T>;

  try {
    payload = JSON.parse(responseText) as ApiResponse<T>;
  } catch {
    throw new Error(response.ok ? "La reponse API n'est pas du JSON valide." : `Erreur API (${response.status}).`);
  }

  if (!response.ok || !payload.success) {
    throw new Error(payload.error ?? `Erreur API (${response.status}).`);
  }

  if (payload.data === undefined) {
    throw new Error(payload.error ?? "La reponse API ne contient pas de donnees.");
  }

  return payload.data;
};

export const getJson = async <T>(path: string, options: ApiRequestOptions = {}): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: buildApiHeaders(),
    signal: options.signal,
  });

  return parseApiResponse<T>(response);
};

export const postJson = async <T>(
  path: string,
  body: unknown,
  options: ApiRequestOptions = {},
): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: buildApiHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(body),
    signal: options.signal,
  });

  return parseApiResponse<T>(response);
};

export const putJson = async <T>(
  path: string,
  body: unknown,
  options: ApiRequestOptions = {},
): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "PUT",
    headers: buildApiHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(body),
    signal: options.signal,
  });

  return parseApiResponse<T>(response);
};
