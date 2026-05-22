import { useEffect, useState } from "react";
import { QueueView } from "./components/QueueView";
import { DEFAULT_ORG_ID, getHubSpotOwnerStorageKey, isAbortError } from "./config/runtime";
import { useQueue } from "./hooks/useQueue";
import {
  buildHubSpotConnectUrl,
  disconnectHubSpot,
  fetchHubSpotLastUpdates,
  syncHubSpotToSupabase,
  type HubSpotLastUpdateItem,
  type HubSpotDisconnectResult,
  type HubSpotSyncJobStatus,
  type HubSpotSyncResult,
} from "./services/api";

const HUBSPOT_OWNER_STORAGE_KEY = getHubSpotOwnerStorageKey(DEFAULT_ORG_ID);

const getStoredHubSpotOwnerId = (): string | null => {
  const storedOwnerId = window.localStorage.getItem(HUBSPOT_OWNER_STORAGE_KEY)?.trim();

  return storedOwnerId || null;
};

export const ExtensionApp = () => {
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(getStoredHubSpotOwnerId);
  const [refreshKey, setRefreshKey] = useState(0);
  const [liveLastUpdates, setLiveLastUpdates] = useState<HubSpotLastUpdateItem[]>([]);
  const { data, isLoading, isRefreshing, error } = useQueue(DEFAULT_ORG_ID, selectedOwnerId, refreshKey);

  const refreshQueue = () => setRefreshKey((currentValue) => currentValue + 1);

  useEffect(() => {
    setLiveLastUpdates(data?.lastUpdates ?? []);
  }, [data?.lastUpdates]);

  useEffect(() => {
    const loadedOwnerId = data?.owner.ownerId;

    if (!loadedOwnerId || selectedOwnerId) {
      return;
    }

    setSelectedOwnerId(loadedOwnerId);
    window.localStorage.setItem(HUBSPOT_OWNER_STORAGE_KEY, loadedOwnerId);
  }, [data?.owner.ownerId, selectedOwnerId]);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);

    if (searchParams.get("hubspot")) {
      refreshQueue();
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      const payload = event.data as { type?: string } | null;

      if (payload?.type === "jarvis:hubspot-connected") {
        refreshQueue();
      }
    };

    window.addEventListener("message", handleOAuthMessage);

    return () => window.removeEventListener("message", handleOAuthMessage);
  }, []);

  useEffect(() => {
    if (!data?.hubspotPortalId) {
      return;
    }

    let isCancelled = false;
    let isRefreshInFlight = false;
    const controller = new AbortController();

    const refreshLastUpdates = async () => {
      if (isRefreshInFlight) {
        return;
      }

      isRefreshInFlight = true;

      try {
        const updates = await fetchHubSpotLastUpdates(DEFAULT_ORG_ID, 12, {
          signal: controller.signal,
        });

        if (!isCancelled) {
          setLiveLastUpdates(updates);
        }
      } catch (refreshError) {
        if (isAbortError(refreshError)) {
          return;
        }
        // Keep the last successful snapshot; the full queue load still surfaces hard API errors.
      } finally {
        isRefreshInFlight = false;
      }
    };

    void refreshLastUpdates();
    const intervalId = window.setInterval(() => {
      void refreshLastUpdates();
    }, 10_000);

    return () => {
      isCancelled = true;
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [data?.hubspotPortalId]);

  const handleConnectHubSpot = () => {
    const connectUrl = buildHubSpotConnectUrl(DEFAULT_ORG_ID, window.location.origin);
    const popupWidth = 640;
    const popupHeight = 760;
    const left = window.screenX + Math.max(0, (window.outerWidth - popupWidth) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - popupHeight) / 2);
    const popup = window.open(
      connectUrl,
      "hubspot-oauth",
      `popup=yes,width=${popupWidth},height=${popupHeight},left=${Math.round(left)},top=${Math.round(top)}`,
    );

    if (!popup) {
      window.location.href = connectUrl;
      return;
    }

    const popupWatcher = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(popupWatcher);
        refreshQueue();
      }
    }, 800);
  };

  const handleSyncHubSpot = async (onProgress?: (status: HubSpotSyncJobStatus) => void): Promise<HubSpotSyncResult> => {
    const hubspotOwnerIds = data?.owners.map((owner) => owner.ownerId) ?? [];
    const result = await syncHubSpotToSupabase(DEFAULT_ORG_ID, hubspotOwnerIds, onProgress);
    refreshQueue();

    return result;
  };

  const handleOwnerChange = (ownerId: string) => {
    const nextOwnerId = ownerId.trim() || null;
    setSelectedOwnerId(nextOwnerId);

    if (nextOwnerId) {
      window.localStorage.setItem(HUBSPOT_OWNER_STORAGE_KEY, nextOwnerId);
      return;
    }

    window.localStorage.removeItem(HUBSPOT_OWNER_STORAGE_KEY);
  };

  const handleDisconnectHubSpot = async (): Promise<HubSpotDisconnectResult> => {
    const result = await disconnectHubSpot(DEFAULT_ORG_ID);
    setSelectedOwnerId(null);
    window.localStorage.removeItem(HUBSPOT_OWNER_STORAGE_KEY);
    refreshQueue();

    return result;
  };

  if (isLoading && !data) {
    return (
      <main className="ae-loading-screen">
        <h1>Jarvis</h1>
        <p>Chargement des deals HubSpot...</p>
      </main>
    );
  }

  return (
    <>
      {error && !data ? (
        <div className="ae-app-error">{error}</div>
      ) : null}
      <QueueView
        orgId={DEFAULT_ORG_ID}
        generatedAt={data?.generatedAt}
        hubspotDealCount={data?.hubspotDealCount}
        hubspotPortalId={data?.hubspotPortalId}
        isConnected={Boolean(data?.hubspotPortalId)}
        isRefreshing={isRefreshing}
        lastUpdates={liveLastUpdates}
        onConnectHubSpot={handleConnectHubSpot}
        onDisconnectHubSpot={handleDisconnectHubSpot}
        onOwnerChange={handleOwnerChange}
        onSyncHubSpot={handleSyncHubSpot}
        owners={data?.owners ?? []}
        ownerName={data?.owner.name}
        selectedOwnerId={selectedOwnerId ?? data?.owner.ownerId}
        prospects={data?.prospects ?? []}
      />
    </>
  );
};
