import { useEffect, useRef, useState } from "react";
import { DEFAULT_HUBSPOT_OWNER_ID, DEFAULT_ORG_ID, isAbortError } from "../config/runtime";
import { fetchHubSpotQueue, type HubSpotQueueData } from "../services/api";

const QUEUE_CACHE_TTL_MS = 5 * 60 * 1000;

type UseQueueState = {
  data: HubSpotQueueData | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
};

type CachedQueuePayload = {
  storedAt: number;
  data: HubSpotQueueData;
};

const getQueueCacheKey = (orgId: string, hubspotOwnerId: string | null): string =>
  `jarvis:queue:${orgId}:${hubspotOwnerId ?? "auto"}`;

const readCachedQueue = (orgId: string, hubspotOwnerId: string | null): HubSpotQueueData | null => {
  try {
    const rawCache = window.localStorage.getItem(getQueueCacheKey(orgId, hubspotOwnerId));

    if (!rawCache) {
      return null;
    }

    const parsed = JSON.parse(rawCache) as Partial<CachedQueuePayload>;

    if (
      typeof parsed.storedAt !== "number" ||
      Date.now() - parsed.storedAt > QUEUE_CACHE_TTL_MS ||
      !parsed.data ||
      !Array.isArray(parsed.data.prospects)
    ) {
      return null;
    }

    return parsed.data as HubSpotQueueData;
  } catch {
    return null;
  }
};

const writeCachedQueue = (orgId: string, hubspotOwnerId: string | null, data: HubSpotQueueData): void => {
  try {
    const payload: CachedQueuePayload = {
      storedAt: Date.now(),
      data,
    };
    window.localStorage.setItem(getQueueCacheKey(orgId, hubspotOwnerId), JSON.stringify(payload));
  } catch {
    // localStorage can be unavailable in restricted extension contexts.
  }
};

export const useQueue = (
  orgId: string = DEFAULT_ORG_ID,
  hubspotOwnerId: string | null = DEFAULT_HUBSPOT_OWNER_ID,
  refreshKey = 0,
): UseQueueState => {
  const initialCachedQueue = orgId.trim() ? readCachedQueue(orgId, hubspotOwnerId) : null;
  const [data, setData] = useState<HubSpotQueueData | null>(initialCachedQueue);
  const [isLoading, setIsLoading] = useState(initialCachedQueue === null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef(initialCachedQueue !== null);

  useEffect(() => {
    let isCancelled = false;
    const controller = new AbortController();

    const loadQueue = async () => {
      if (!orgId.trim()) {
        setData(null);
        setError("Aucune organisation Jarvis configuree pour charger HubSpot.");
        setIsLoading(false);
        setIsRefreshing(false);
        hasLoadedOnceRef.current = false;
        return;
      }

      try {
        const isInitialLoad = !hasLoadedOnceRef.current;

        setIsLoading(isInitialLoad);
        setIsRefreshing(!isInitialLoad);
        setError(null);

        const syncedQueue = await fetchHubSpotQueue(orgId, hubspotOwnerId, false, {
          signal: controller.signal,
        });

        if (!isCancelled) {
          setData(syncedQueue);
          writeCachedQueue(orgId, hubspotOwnerId, syncedQueue);
          hasLoadedOnceRef.current = true;
          setIsLoading(false);
        }
      } catch (loadError) {
        if (isAbortError(loadError)) {
          return;
        }

        if (!isCancelled) {
          const message =
            loadError instanceof Error ? loadError.message : "Erreur inconnue sur la queue HubSpot.";

          setError(message);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    };

    void loadQueue();

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [hubspotOwnerId, orgId, refreshKey]);

  return {
    data,
    isLoading,
    isRefreshing,
    error,
  };
};
