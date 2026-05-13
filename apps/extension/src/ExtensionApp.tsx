import { useEffect, useState } from "react";
import { QueueView } from "./components/QueueView";
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

const JARVIS_DEFAULT_ORG_ID = "11111111-1111-4111-8111-111111111111";
const DEFAULT_ORG_ID = import.meta.env.VITE_DEFAULT_ORG_ID?.trim() || JARVIS_DEFAULT_ORG_ID;

export const ExtensionApp = () => {
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [liveLastUpdates, setLiveLastUpdates] = useState<HubSpotLastUpdateItem[]>([]);
  const { data, isLoading, isRefreshing, error } = useQueue(DEFAULT_ORG_ID, selectedOwnerId, refreshKey);

  const refreshQueue = () => setRefreshKey((currentValue) => currentValue + 1);

  useEffect(() => {
    setLiveLastUpdates(data?.lastUpdates ?? []);
  }, [data?.lastUpdates]);

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

    const refreshLastUpdates = async () => {
      try {
        const updates = await fetchHubSpotLastUpdates(DEFAULT_ORG_ID);

        if (!isCancelled) {
          setLiveLastUpdates(updates);
        }
      } catch {
        // Keep the last successful snapshot; the full queue load still surfaces hard API errors.
      }
    };

    void refreshLastUpdates();
    const intervalId = window.setInterval(() => {
      void refreshLastUpdates();
    }, 10_000);

    return () => {
      isCancelled = true;
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

  const handleDisconnectHubSpot = async (): Promise<HubSpotDisconnectResult> => {
    const result = await disconnectHubSpot(DEFAULT_ORG_ID);
    setSelectedOwnerId(null);
    refreshQueue();

    return result;
  };

  if (isLoading && !data) {
    return (
      <main style={{ fontFamily: "ui-sans-serif, system-ui", minHeight: "100vh", padding: "1rem", width: "100vw" }}>
        <h1>Jarvis</h1>
        <p>Chargement des deals HubSpot...</p>
      </main>
    );
  }

  return (
    <>
      {error && !data ? (
        <div
          style={{
            position: "fixed",
            top: 12,
            left: 12,
            right: 12,
            zIndex: 10,
            border: "1px solid #efb1b1",
            borderRadius: 8,
            background: "#fff1f1",
            color: "#8f2626",
            fontFamily: "ui-sans-serif, system-ui",
            fontSize: 13,
            fontWeight: 700,
            padding: "10px 12px",
          }}
        >
          {error}
        </div>
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
      onOwnerChange={setSelectedOwnerId}
      onSyncHubSpot={handleSyncHubSpot}
      owners={data?.owners ?? []}
      ownerName={data?.owner.name}
      selectedOwnerId={data?.owner.ownerId ?? selectedOwnerId ?? undefined}
      prospects={data?.prospects ?? []}
      />
    </>
  );
};
