import { useCallback, useEffect, useState } from "react";
import { QueueView } from "./components/QueueView";
import { AuthLanding, OnboardingGate } from "./components/auth/AuthLanding";
import { FirstRunOnboarding } from "./components/dashboard/FirstRunOnboarding";
import { DEFAULT_ORG_ID, getHubSpotOwnerStorageKey, isAbortError } from "./config/runtime";
import { useQueue } from "./hooks/useQueue";
import {
  completeMemberOnboarding,
  fetchCurrentUserProfile,
  buildHubSpotConnectUrl,
  disconnectHubSpot,
  fetchHubSpotLastUpdates,
  fetchHubSpotSyncJob,
  syncHubSpotToSupabase,
  type HubSpotLastUpdateItem,
  type HubSpotDisconnectResult,
  type HubSpotSyncJobStatus,
  type HubSpotSyncResult,
  type AppUserProfile,
} from "./services/api";
import { clearApiAuthToken, setApiAuthToken } from "./services/api/client";
import { getSupabaseClient, isSupabaseAuthConfigured, type JarvisSession } from "./services/supabase";
import { setSentryUser } from "./sentry";

const getStoredHubSpotOwnerId = (orgId: string): string | null => {
  const storedOwnerId = window.localStorage.getItem(getHubSpotOwnerStorageKey(orgId))?.trim();

  return storedOwnerId || null;
};

export const ExtensionApp = () => {
  const [authProfile, setAuthProfile] = useState<AppUserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [liveLastUpdates, setLiveLastUpdates] = useState<HubSpotLastUpdateItem[]>([]);
  const [hubSpotConnectionError, setHubSpotConnectionError] = useState<string | null>(null);
  const [connectionSyncJobId, setConnectionSyncJobId] = useState<string | null>(null);
  const [connectionSyncJob, setConnectionSyncJob] = useState<HubSpotSyncJobStatus | null>(null);
  const activeOrgId = authProfile?.orgId ?? DEFAULT_ORG_ID;
  const activeOwnerId = authProfile?.role === "sales" ? authProfile.hubspotOwnerId : selectedOwnerId;
  const { data, isLoading, isRefreshing, error } = useQueue(
    authProfile?.orgId ?? "",
    activeOwnerId,
    refreshKey,
  );

  const refreshQueue = () => setRefreshKey((currentValue) => currentValue + 1);

  const loadProfileForSession = useCallback(async (session: JarvisSession | null): Promise<void> => {
    if (!session) {
      clearApiAuthToken();
      setAuthProfile(null);
      setAuthLoading(false);
      setAuthError(null);
      return;
    }

    try {
      setAuthLoading(true);
      setAuthError(null);
      setApiAuthToken(session.access_token);

      const profile = await fetchCurrentUserProfile();

      if (profile.onboardingRequired) {
        try {
          const joinedProfile = await completeMemberOnboarding();
          setAuthProfile(joinedProfile);
          return;
        } catch {
          setAuthProfile(profile);
          return;
        }
      }

      setAuthProfile(profile);
    } catch (profileError) {
      setAuthError(profileError instanceof Error ? profileError.message : "Impossible de charger la session Jarvis.");
      setAuthProfile(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseAuthConfigured) {
      setAuthLoading(false);
      return;
    }

    let isCancelled = false;

    const initSession = async () => {
      const { data: sessionData } = await getSupabaseClient().auth.getSession();

      if (!isCancelled) {
        await loadProfileForSession(sessionData.session);
      }
    };

    void initSession();

    const { data: listener } = getSupabaseClient().auth.onAuthStateChange((_event, session) => {
      if (!isCancelled) {
        void loadProfileForSession(session);
      }
    });

    return () => {
      isCancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [loadProfileForSession]);

  useEffect(() => {
    if (!authProfile?.orgId) {
      setSelectedOwnerId(null);
      return;
    }

    if (authProfile.role === "sales") {
      setSelectedOwnerId(authProfile.hubspotOwnerId);
      return;
    }

    setSelectedOwnerId(getStoredHubSpotOwnerId(authProfile.orgId));
  }, [authProfile?.hubspotOwnerId, authProfile?.orgId, authProfile?.role]);

  useEffect(() => {
    setLiveLastUpdates(data?.lastUpdates ?? []);
  }, [data?.lastUpdates]);

  useEffect(() => {
    setSentryUser(
      authProfile
        ? {
            id: authProfile.id ?? authProfile.authUserId,
            orgId: authProfile.orgId,
            role: authProfile.role,
          }
        : null,
    );
  }, [authProfile]);

  useEffect(() => {
    const loadedOwnerId = data?.owner.ownerId;

    if (!loadedOwnerId || selectedOwnerId || !authProfile?.orgId || authProfile.role === "sales") {
      return;
    }

    setSelectedOwnerId(loadedOwnerId);
    window.localStorage.setItem(getHubSpotOwnerStorageKey(authProfile.orgId), loadedOwnerId);
  }, [authProfile?.orgId, authProfile?.role, data?.owner.ownerId, selectedOwnerId]);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);

    if (searchParams.get("hubspot")) {
      const syncJobId = searchParams.get("syncJobId")?.trim();

      if (searchParams.get("hubspot") === "connected" && syncJobId) {
        setHubSpotConnectionError(null);
        setConnectionSyncJobId(syncJobId);
      } else {
        refreshQueue();
      }

      searchParams.delete("hubspot");
      searchParams.delete("sync");
      searchParams.delete("syncJobId");
      searchParams.delete("reason");
      const nextSearch = searchParams.toString();
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
      window.history.replaceState({}, document.title, nextUrl);
    }
  }, []);

  useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      const payload = event.data as { targetUrl?: string; type?: string } | null;

      if (payload?.type === "jarvis:hubspot-connected") {
        const targetUrl = (() => {
          if (!payload.targetUrl) {
            return null;
          }

          try {
            return new URL(payload.targetUrl);
          } catch {
            return null;
          }
        })();
        const syncJobId = targetUrl?.searchParams.get("syncJobId")?.trim() ?? null;

        setHubSpotConnectionError(null);

        if (syncJobId) {
          setConnectionSyncJobId(syncJobId);
          return;
        }

        refreshQueue();
      }

      if (payload?.type === "jarvis:hubspot-error") {
        const targetUrl = (() => {
          if (!payload.targetUrl) {
            return null;
          }

          try {
            return new URL(payload.targetUrl);
          } catch {
            return null;
          }
        })();
        setHubSpotConnectionError(
          targetUrl?.searchParams.get("reason") ?? "La connexion HubSpot a echoue pendant le callback OAuth.",
        );
      }
    };

    window.addEventListener("message", handleOAuthMessage);

    return () => window.removeEventListener("message", handleOAuthMessage);
  }, []);

  useEffect(() => {
    if (!connectionSyncJobId) {
      return;
    }

    let isCancelled = false;
    let timeoutId: number | undefined;

    const pollSyncJob = async () => {
      try {
        const job = await fetchHubSpotSyncJob(connectionSyncJobId);

        if (isCancelled) {
          return;
        }

        setConnectionSyncJob(job);

        if (job.status === "completed") {
          setConnectionSyncJobId(null);
          refreshQueue();
          return;
        }

        if (job.status === "failed") {
          setConnectionSyncJobId(null);
          setHubSpotConnectionError(job.error ?? "La sync HubSpot a echoue apres connexion.");
          refreshQueue();
          return;
        }

        timeoutId = window.setTimeout(() => {
          void pollSyncJob();
        }, 1000);
      } catch (syncError) {
        if (isCancelled) {
          return;
        }

        setConnectionSyncJobId(null);
        setHubSpotConnectionError(
          syncError instanceof Error ? syncError.message : "Impossible de suivre la sync HubSpot.",
        );
        refreshQueue();
      }
    };

    setConnectionSyncJob({
      jobId: connectionSyncJobId,
      orgId: activeOrgId,
      status: "queued",
      progress: 0,
      currentStep: "Initialisation de la sync HubSpot",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: null,
      logs: [],
      result: null,
      error: null,
    });
    void pollSyncJob();

    return () => {
      isCancelled = true;

      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [activeOrgId, connectionSyncJobId]);

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
        const updates = await fetchHubSpotLastUpdates(activeOrgId, 12, {
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
  }, [activeOrgId, data?.hubspotPortalId]);

  const handleConnectHubSpot = () => {
    setHubSpotConnectionError(null);

    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete("hubspot");
    currentUrl.searchParams.delete("sync");
    currentUrl.searchParams.delete("reason");

    const connectUrl = buildHubSpotConnectUrl(activeOrgId, currentUrl.toString());
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
    const hubspotOwnerIds =
      authProfile?.role === "sales" && authProfile.hubspotOwnerId
        ? [authProfile.hubspotOwnerId]
        : data?.owners.map((owner) => owner.ownerId) ?? [];
    const result = await syncHubSpotToSupabase(activeOrgId, hubspotOwnerIds, onProgress);
    refreshQueue();

    return result;
  };

  const handleOwnerChange = (ownerId: string) => {
    if (!authProfile?.orgId || authProfile.role === "sales") {
      return;
    }

    const nextOwnerId = ownerId.trim() || null;
    setSelectedOwnerId(nextOwnerId);

    if (nextOwnerId) {
      window.localStorage.setItem(getHubSpotOwnerStorageKey(authProfile.orgId), nextOwnerId);
      return;
    }

    window.localStorage.removeItem(getHubSpotOwnerStorageKey(authProfile.orgId));
  };

  const handleDisconnectHubSpot = async (): Promise<HubSpotDisconnectResult> => {
    const result = await disconnectHubSpot(activeOrgId);
    setSelectedOwnerId(null);
    window.localStorage.removeItem(getHubSpotOwnerStorageKey(activeOrgId));
    refreshQueue();

    return result;
  };

  const handleSignOut = async () => {
    clearApiAuthToken();
    setAuthProfile(null);
    await getSupabaseClient().auth.signOut();
  };

  if (!authProfile && !authLoading) {
    return <AuthLanding error={authError} onAuthenticated={setAuthProfile} />;
  }

  if (authLoading) {
    return (
      <main className="ae-loading-screen">
        <h1>Jarvis</h1>
        <p>Verification de la session...</p>
      </main>
    );
  }

  if (authProfile?.onboardingRequired || !authProfile?.orgId) {
    return (
      <OnboardingGate
        error={authError}
        fullName={authProfile?.name ?? "Compte Jarvis"}
        onCompleted={setAuthProfile}
        onSignOut={handleSignOut}
      />
    );
  }

  if (connectionSyncJobId) {
    const progress = connectionSyncJob?.progress ?? 0;

    return (
      <main className="ae-loading-screen ae-hubspot-sync-screen">
        <div className="ae-loading-head">
          <div className="ae-loading-orbit" aria-hidden="true">
            <span />
            <i />
          </div>
          <div>
            <h1>Sync HubSpot vers Supabase</h1>
            <p>{connectionSyncJob?.currentStep ?? "Preparation de la synchronisation..."}</p>
          </div>
        </div>
        <div className="ae-loading-progress" aria-label={`Progression ${progress}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <ol className="ae-loading-steps">
          <li className={progress >= 10 ? "done" : "current"}>
            <span />
            <div>
              <strong>Connexion validee</strong>
              <small>Les tokens HubSpot sont stockes cote backend.</small>
            </div>
          </li>
          <li className={progress >= 68 ? "done" : progress >= 10 ? "current" : "waiting"}>
            <span />
            <div>
              <strong>CRM et leads</strong>
              <small>Contacts, deals, companies et leads sont ecrits dans Supabase.</small>
            </div>
          </li>
          <li className={progress >= 100 ? "done" : progress >= 68 ? "current" : "waiting"}>
            <span />
            <div>
              <strong>Queue Jarvis</strong>
              <small>La morning queue est rechargee avec la derniere data synchronisee.</small>
            </div>
          </li>
        </ol>
      </main>
    );
  }

  if (isLoading && !data) {
    return (
      <main className="ae-loading-screen">
        <h1>Jarvis</h1>
        <p>Chargement des deals HubSpot...</p>
      </main>
    );
  }

  const isHubSpotConnected = Boolean(data?.hubspotPortalId);
  const hasInitialSync = Boolean(data?.generatedAt);
  const shouldShowFirstRunOnboarding =
    !error &&
    Boolean(authProfile) &&
    (!isHubSpotConnected || (!hasInitialSync && (data?.prospects.length ?? 0) === 0));

  if (shouldShowFirstRunOnboarding) {
    return (
      <>
        {hubSpotConnectionError ? <div className="ae-app-error">{hubSpotConnectionError}</div> : null}
        <FirstRunOnboarding
          canManageHubSpot={Boolean(authProfile?.canManageHubSpot)}
          generatedAt={data?.generatedAt}
          hubspotPortalId={data?.hubspotPortalId}
          isConnected={isHubSpotConnected}
          onConnectHubSpot={authProfile?.canManageHubSpot ? handleConnectHubSpot : undefined}
          onSignOut={handleSignOut}
          onSyncHubSpot={authProfile?.canManageHubSpot ? handleSyncHubSpot : undefined}
          prospectCount={data?.prospects.length ?? 0}
        />
      </>
    );
  }

  return (
    <>
      {error && !data ? (
        <div className="ae-app-error">{error}</div>
      ) : null}
      {hubSpotConnectionError ? <div className="ae-app-error">{hubSpotConnectionError}</div> : null}
      <QueueView
        orgId={activeOrgId}
        generatedAt={data?.generatedAt}
        hubspotDealCount={data?.hubspotDealCount}
        hubspotPortalId={data?.hubspotPortalId}
        isConnected={isHubSpotConnected}
        isRefreshing={isRefreshing}
        lastUpdates={liveLastUpdates}
        onConnectHubSpot={authProfile.canManageHubSpot ? handleConnectHubSpot : undefined}
        onDisconnectHubSpot={authProfile.canManageHubSpot ? handleDisconnectHubSpot : undefined}
        onOwnerChange={handleOwnerChange}
        onSignOut={handleSignOut}
        onSyncHubSpot={handleSyncHubSpot}
        owners={
          authProfile.role === "sales" && authProfile.hubspotOwnerId
            ? (data?.owners ?? []).filter((owner) => owner.ownerId === authProfile.hubspotOwnerId)
            : data?.owners ?? []
        }
        ownerName={data?.owner.name}
        selectedOwnerId={activeOwnerId ?? data?.owner.ownerId}
        canViewTeamForecast={authProfile.role !== "sales"}
        prospects={data?.prospects ?? []}
      />
    </>
  );
};
