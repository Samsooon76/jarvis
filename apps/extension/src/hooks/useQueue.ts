import { useEffect, useState } from "react";
import { fetchHubSpotQueue, type HubSpotQueueData } from "../services/api";

type UseQueueState = {
  data: HubSpotQueueData | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
};

const JARVIS_DEFAULT_ORG_ID = "11111111-1111-4111-8111-111111111111";
const DEFAULT_ORG_ID = import.meta.env.VITE_DEFAULT_ORG_ID?.trim() || JARVIS_DEFAULT_ORG_ID;
const DEFAULT_HUBSPOT_OWNER_ID = import.meta.env.VITE_HUBSPOT_OWNER_ID?.trim() || null;

export const useQueue = (
  orgId: string = DEFAULT_ORG_ID,
  hubspotOwnerId: string | null = DEFAULT_HUBSPOT_OWNER_ID,
  refreshKey = 0,
): UseQueueState => {
  const [data, setData] = useState<HubSpotQueueData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const loadQueue = async () => {
      if (!orgId.trim()) {
        setData(null);
        setError("Aucune organisation Jarvis configuree pour charger HubSpot.");
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setIsRefreshing(false);
        setError(null);

        const syncedQueue = await fetchHubSpotQueue(orgId, hubspotOwnerId, false);

        if (!isCancelled) {
          setData(syncedQueue);
          setIsLoading(false);
        }
      } catch (loadError) {
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
    };
  }, [hubspotOwnerId, orgId, refreshKey]);

  return {
    data,
    isLoading,
    isRefreshing,
    error,
  };
};
