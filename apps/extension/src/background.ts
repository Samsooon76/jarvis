const configureSidePanel = async () => {
  await chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true,
  });
};

// --- Jarvis Pulse: notifications Chrome natives ----------------------------

const PULSE_ALARM_NAME = "jarvis-pulse-poll";
const PULSE_ALARM_PERIOD_MINUTES = 1;
const PULSE_TOKEN_STORAGE_KEY = "jarvis.apiAuthToken";
const PULSE_SHOWN_IDS_STORAGE_KEY = "jarvis.pulse.shownNotificationIds";
const PULSE_SHOWN_IDS_MAX = 200;
const PULSE_MAX_NATIVE_NOTIFICATIONS_PER_CYCLE = 3;
const PULSE_NOTIFICATION_ID_PREFIX = "jarvis-pulse:";
const PULSE_ICON_URL = "icons/icon128.png";

const resolvePulseApiBaseUrl = (): string =>
  import.meta.env.VITE_API_URL || "https://jarvisapi-production-10cd.up.railway.app";

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

const fetchUnreadPulseNotifications = async (token: string): Promise<PulseApiNotification[] | null> => {
  const response = await fetch(
    `${resolvePulseApiBaseUrl()}/api/pulse/notifications?unreadOnly=true&limit=10`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  // 401: session expiree, 403: utilisateur sans acces Pulse (sales). On ignore.
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
    const token = await readStoredString(PULSE_TOKEN_STORAGE_KEY);

    if (!token) {
      return;
    }

    const notifications = await fetchUnreadPulseNotifications(token);

    if (notifications && notifications.length > 0) {
      await showPulseNativeNotifications(notifications);
    }
  } catch {
    // Best-effort: pas de notification plutot qu'un service worker en erreur.
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
