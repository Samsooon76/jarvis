import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchPulseNotifications,
  markAllPulseNotificationsRead,
  markPulseNotificationRead,
  type PulseEventType,
  type PulseNotification,
} from "../services/api";

const PULSE_POLL_INTERVAL_MS = 30_000;
const PULSE_PAGE_SIZE = 30;

export type UsePulseNotificationsResult = {
  notifications: PulseNotification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  markRead: (notificationId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
};

// Polling court (~30s): le webhook HubSpot garantit deja la fraicheur cote serveur.
export const usePulseNotifications = (enabled: boolean, eventTypes: PulseEventType[] = []): UsePulseNotificationsResult => {
  const [notifications, setNotifications] = useState<PulseNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled) {
      return;
    }

    try {
      const result = await fetchPulseNotifications({ limit: PULSE_PAGE_SIZE, eventTypes });

      if (!isMountedRef.current) {
        return;
      }

      setNotifications(result.notifications);
      setUnreadCount(result.unreadCount);
      setError(null);
    } catch (refreshError) {
      if (!isMountedRef.current) {
        return;
      }

      setError(refreshError instanceof Error ? refreshError.message : "Impossible de charger Jarvis Pulse.");
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [enabled, eventTypes]);

  useEffect(() => {
    if (!enabled) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    setIsLoading(true);
    void refresh();

    const intervalId = window.setInterval(() => {
      void refresh();
    }, PULSE_POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [enabled, refresh]);

  const markRead = useCallback(
    async (notificationId: string): Promise<void> => {
      // Mise a jour optimiste pour une UI reactive.
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === notificationId && !notification.readAt
            ? { ...notification, readAt: new Date().toISOString() }
            : notification,
        ),
      );
      setUnreadCount((current) => Math.max(0, current - 1));

      try {
        await markPulseNotificationRead(notificationId);
      } catch {
        await refresh();
      }
    },
    [refresh],
  );

  const markAllRead = useCallback(async (): Promise<void> => {
    const readAt = new Date().toISOString();

    setNotifications((current) =>
      current.map((notification) => (notification.readAt ? notification : { ...notification, readAt })),
    );
    setUnreadCount(0);

    try {
      await markAllPulseNotificationsRead();
    } catch {
      await refresh();
    }
  }, [refresh]);

  return {
    notifications,
    unreadCount,
    isLoading,
    error,
    refresh,
    markRead,
    markAllRead,
  };
};
