import { getJson, type ApiRequestOptions } from "./client";

export const ANALYTICS_OVERVIEW_CACHE_TTL_MS = 300_000;
export const ANALYTICS_DETAIL_CACHE_TTL_MS = 300_000;
export const HUBSPOT_TASKS_CACHE_TTL_MS = 20_000;
export const HUBSPOT_LEADS_CACHE_TTL_MS = 60_000;

export const HUBSPOT_TASKS_CACHE_PREFIX = "hubspot-tasks:";
export const HUBSPOT_LEADS_CACHE_PREFIX = "hubspot-leads:";

type CachedApiEntry<T> = {
  expiresAt: number;
  promise: Promise<T>;
};

const analyticsGetCache = new Map<string, CachedApiEntry<unknown>>();

// Wraps a shared (cached) promise so that each caller can still cancel its own
// awaiting via its AbortSignal without aborting the underlying request that
// other callers might be sharing.
const withAbort = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) {
    return promise;
  }

  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(new DOMException("Aborted", "AbortError"));
    };

    signal.addEventListener("abort", onAbort, { once: true });

    void promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
};

export const getCachedJson = async <T>(
  cacheKey: string,
  path: string,
  ttlMs: number,
  forceRefresh = false,
  options: ApiRequestOptions = {},
): Promise<T> => {
  const now = Date.now();
  const cached = analyticsGetCache.get(cacheKey);

  if (!forceRefresh && cached && cached.expiresAt > now) {
    return withAbort(cached.promise as Promise<T>, options.signal);
  }

  // The shared request is intentionally launched without the caller's signal so
  // that one caller unmounting does not cancel the in-flight fetch for others.
  const promise = getJson<T>(path).catch((error: unknown) => {
    analyticsGetCache.delete(cacheKey);
    throw error;
  });

  analyticsGetCache.set(cacheKey, {
    expiresAt: now + ttlMs,
    promise,
  });

  return withAbort(promise, options.signal);
};

// Registre des caches module-level (vues lazy-loadees) a purger en meme temps
// que le cache API: chaque module s'enregistre a son chargement.
const cacheClearers = new Set<() => void>();

export const registerCacheClearer = (clearer: () => void): void => {
  cacheClearers.add(clearer);
};

const runRegisteredCacheClearers = (): void => {
  for (const clearer of cacheClearers) {
    clearer();
  }
};

const clearAnalyticsCache = (): void => {
  analyticsGetCache.clear();
  runRegisteredCacheClearers();
};

export const clearAnalyticsCacheByPrefix = (prefix: string): void => {
  for (const key of analyticsGetCache.keys()) {
    if (key.startsWith(prefix)) {
      analyticsGetCache.delete(key);
    }
  }
};

export const clearApiResponseCaches = (): void => {
  clearAnalyticsCache();
};

export const clearHubSpotOrgCaches = (orgId: string): void => {
  clearAnalyticsCacheByPrefix(`hubspot-`);
  clearAnalyticsCacheByPrefix(`forecast-`);
  clearAnalyticsCacheByPrefix(`close-lost-`);
  clearAnalyticsCacheByPrefix(HUBSPOT_TASKS_CACHE_PREFIX);
  clearAnalyticsCacheByPrefix(HUBSPOT_LEADS_CACHE_PREFIX);
  clearAnalyticsCacheByPrefix(`sales-activity:${orgId}:`);
  clearAnalyticsCacheByPrefix(`probability-timeline:${orgId}:`);
  clearAnalyticsCacheByPrefix("calls:");
  runRegisteredCacheClearers();
};

export const wait = async (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });

// Garde-fous pour les boucles de polling : evite les boucles infinies si le
// backend ne termine jamais le job, et espace progressivement les appels.
const POLL_BASE_DELAY_MS = 1000;
const POLL_MAX_DELAY_MS = 5000;
export const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Backoff exponentiel plafonne : 1s, 2s, 4s, puis 5s.
export const pollDelayMs = (attempt: number): number =>
  Math.min(POLL_BASE_DELAY_MS * 2 ** attempt, POLL_MAX_DELAY_MS);
