const configureSidePanel = async () => {
  await chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true,
  });
};

// --- Jarvis Pulse: notifications Chrome natives ----------------------------

const PULSE_ALARM_NAME = "jarvis-pulse-poll";
const PULSE_ALARM_PERIOD_MINUTES = 1;
const PULSE_TOKEN_STORAGE_KEY = "jarvis.apiAuthToken";
const PULSE_SESSION_STORAGE_KEY = "jarvis.apiAuthSession";
const PULSE_SHOWN_IDS_STORAGE_KEY = "jarvis.pulse.shownNotificationIds";
const PULSE_SHOWN_IDS_MAX = 200;
const PULSE_MAX_NATIVE_NOTIFICATIONS_PER_CYCLE = 3;
const PULSE_NOTIFICATION_ID_PREFIX = "jarvis-pulse:";
const PULSE_ICON_URL = "icons/icon128.png";

const resolvePulseApiBaseUrl = (): string =>
  import.meta.env.VITE_API_URL || "https://jarvisapi-production-10cd.up.railway.app";

const resolveSupabaseUrl = (): string => import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const resolveSupabaseAnonKey = (): string =>
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ??
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ??
  "";

type StoredPulseSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
};

type PulseApiNotification = {
  id: string;
  title: string;
  message: string;
  occurredAt: string;
};

type PulseApiResponse = {
  success: boolean;
  data?: {
    notifications: PulseApiNotification[];
    unreadCount: number;
  };
  error?: string;
};

const readStoredString = async (key: string): Promise<string | null> => {
  const stored = await chrome.storage.local.get(key);
  const value = stored[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const readStoredPulseSession = async (): Promise<StoredPulseSession | null> => {
  const stored = await chrome.storage.local.get(PULSE_SESSION_STORAGE_KEY);
  const value = stored[PULSE_SESSION_STORAGE_KEY];

  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<StoredPulseSession>;

  if (typeof candidate.accessToken !== "string" || typeof candidate.refreshToken !== "string") {
    return null;
  }

  return {
    accessToken: candidate.accessToken,
    refreshToken: candidate.refreshToken,
    expiresAt: typeof candidate.expiresAt === "number" ? candidate.expiresAt : null,
  };
};

const saveStoredPulseSession = async (session: StoredPulseSession): Promise<void> => {
  await chrome.storage.local.set({
    [PULSE_TOKEN_STORAGE_KEY]: session.accessToken,
    [PULSE_SESSION_STORAGE_KEY]: session,
  });
};

const clearStoredPulseSession = async (): Promise<void> => {
  await chrome.storage.local.remove([PULSE_TOKEN_STORAGE_KEY, PULSE_SESSION_STORAGE_KEY]);
};

const refreshPulseSession = async (): Promise<string | null> => {
  const session = await readStoredPulseSession();
  const supabaseUrl = resolveSupabaseUrl();
  const supabaseAnonKey = resolveSupabaseAnonKey();

  if (!session?.refreshToken || !supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      refresh_token: session.refreshToken,
    }),
  });

  if (!response.ok) {
    await clearStoredPulseSession();
    return null;
  }

  const payload = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_at?: unknown;
    expires_in?: unknown;
  };
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : null;
  const refreshToken =
    typeof payload.refresh_token === "string" && payload.refresh_token.trim()
      ? payload.refresh_token
      : session.refreshToken;

  if (!accessToken) {
    await clearStoredPulseSession();
    return null;
  }

  const expiresAt =
    typeof payload.expires_at === "number"
      ? payload.expires_at
      : typeof payload.expires_in === "number"
        ? Math.floor(Date.now() / 1000) + payload.expires_in
        : null;

  await saveStoredPulseSession({
    accessToken,
    refreshToken,
    expiresAt,
  });

  return accessToken;
};

const readShownNotificationIds = async (): Promise<string[]> => {
  const stored = await chrome.storage.local.get(PULSE_SHOWN_IDS_STORAGE_KEY);
  const value = stored[PULSE_SHOWN_IDS_STORAGE_KEY];

  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
};

const saveShownNotificationIds = async (ids: string[]): Promise<void> => {
  await chrome.storage.local.set({
    [PULSE_SHOWN_IDS_STORAGE_KEY]: ids.slice(-PULSE_SHOWN_IDS_MAX),
  });
};

const fetchUnreadPulseNotifications = async (
  token: string,
  retryAfterRefresh = true,
): Promise<PulseApiNotification[] | null> => {
  const response = await fetch(
    `${resolvePulseApiBaseUrl()}/api/pulse/notifications?unreadOnly=true&limit=10`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (response.status === 401) {
    if (retryAfterRefresh) {
      const refreshedToken = await refreshPulseSession();

      if (refreshedToken) {
        return fetchUnreadPulseNotifications(refreshedToken, false);
      }
    }

    return null;
  }

  // 403: utilisateur sans acces Pulse (sales). On ignore.
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as PulseApiResponse;

  if (!payload.success || !payload.data) {
    return null;
  }

  return payload.data.notifications;
};

const showPulseNativeNotifications = async (notifications: PulseApiNotification[]): Promise<void> => {
  const shownIds = await readShownNotificationIds();
  const shownIdSet = new Set(shownIds);
  const freshNotifications = notifications.filter((notification) => !shownIdSet.has(notification.id));

  if (freshNotifications.length === 0) {
    return;
  }

  const toDisplay = freshNotifications.slice(0, PULSE_MAX_NATIVE_NOTIFICATIONS_PER_CYCLE);
  const overflowCount = freshNotifications.length - toDisplay.length;

  for (const notification of toDisplay) {
    chrome.notifications.create(`${PULSE_NOTIFICATION_ID_PREFIX}${notification.id}`, {
      type: "basic",
      iconUrl: PULSE_ICON_URL,
      title: notification.title,
      message: notification.message,
      priority: 1,
    });
  }

  if (overflowCount > 0) {
    chrome.notifications.create(`${PULSE_NOTIFICATION_ID_PREFIX}overflow:${Date.now()}`, {
      type: "basic",
      iconUrl: PULSE_ICON_URL,
      title: "Jarvis Pulse",
      message: `${overflowCount} autre${overflowCount > 1 ? "s" : ""} changement${overflowCount > 1 ? "s" : ""} de deal a consulter dans Jarvis.`,
      priority: 1,
    });
  }

  await saveShownNotificationIds([...shownIds, ...freshNotifications.map((notification) => notification.id)]);
};

const pollPulseNotifications = async (): Promise<void> => {
  try {
    const session = await readStoredPulseSession();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token =
      session?.expiresAt && session.expiresAt <= nowSeconds + 60
        ? await refreshPulseSession()
        : session?.accessToken ?? await readStoredString(PULSE_TOKEN_STORAGE_KEY);

    if (!token) {
      return;
    }

    const notifications = await fetchUnreadPulseNotifications(token);

    if (notifications && notifications.length > 0) {
      await showPulseNativeNotifications(notifications);
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("Jarvis Pulse polling failed", error);
    }
  }
};

const schedulePulseAlarm = async (): Promise<void> => {
  await chrome.alarms.create(PULSE_ALARM_NAME, {
    periodInMinutes: PULSE_ALARM_PERIOD_MINUTES,
    delayInMinutes: PULSE_ALARM_PERIOD_MINUTES,
  });
};

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PULSE_ALARM_NAME) {
    void pollPulseNotifications();
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith(PULSE_NOTIFICATION_ID_PREFIX)) {
    return;
  }

  chrome.notifications.clear(notificationId);
  void chrome.windows.getLastFocused().then((window) => {
    if (window.id !== undefined) {
      void chrome.sidePanel.open({ windowId: window.id });
    }
  });
});

chrome.runtime.onInstalled.addListener(() => {
  void configureSidePanel();
  void schedulePulseAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  void configureSidePanel();
  void schedulePulseAlarm();
});
