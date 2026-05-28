import type { ApiResponse } from "@jarvis/shared";

const resolveApiBaseUrl = (): string => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  if (import.meta.env.DEV && typeof window !== "undefined" && ["127.0.0.1", "localhost"].includes(window.location.hostname)) {
    return "http://127.0.0.1:4000";
  }

  return "https://jarvisapi-production-10cd.up.railway.app";
};

export const API_BASE_URL = resolveApiBaseUrl();
const API_AUTH_STORAGE_KEY = "jarvis.apiAuthToken";

export const setApiAuthToken = (token: string): void => {
  window.localStorage.setItem(API_AUTH_STORAGE_KEY, token);
};

export const clearApiAuthToken = (): void => {
  window.localStorage.removeItem(API_AUTH_STORAGE_KEY);
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
