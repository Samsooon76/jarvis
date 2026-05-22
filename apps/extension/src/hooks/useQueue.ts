import { useEffect, useRef, useState } from "react";
import { DEFAULT_HUBSPOT_OWNER_ID, DEFAULT_ORG_ID, isAbortError } from "../config/runtime";
import { fetchHubSpotQueue, type HubSpotQueueData } from "../services/api";

type UseQueueState = {
  data: HubSpotQueueData | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
};

export const useQueue = (
  orgId: string = DEFAULT_ORG_ID,
  hubspotOwnerId: string | null = DEFAULT_HUBSPOT_OWNER_ID,
  refreshKey = 0,
): UseQueueState => {
  const [data, setData] = useState<HubSpotQueueData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef(false);

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
