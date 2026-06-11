import type { PulseEventType, PulseNotificationList, PulsePreferences } from "@jarvis/shared";
import { apiPath, getJson, postJson, putJson, type ApiRequestOptions } from "./client";

export const fetchPulseNotifications = async (
  {
    unreadOnly = false,
    limit,
    offset,
    eventTypes,
  }: {
    unreadOnly?: boolean;
    limit?: number;
    offset?: number;
    eventTypes?: PulseEventType[];
  } = {},
  options: ApiRequestOptions = {},
): Promise<PulseNotificationList> =>
  getJson<PulseNotificationList>(
    apiPath("/api/pulse/notifications", {
      unreadOnly: unreadOnly ? "true" : undefined,
      limit,
      offset,
      eventTypes: eventTypes && eventTypes.length > 0 ? eventTypes.join(",") : undefined,
    }),
    options,
  );

export const markPulseNotificationRead = async (notificationId: string): Promise<{ id: string }> =>
  postJson<{ id: string }>(`/api/pulse/notifications/${notificationId}/read`, {});

export const markAllPulseNotificationsRead = async (): Promise<{ done: boolean }> =>
  postJson<{ done: boolean }>("/api/pulse/notifications/read-all", {});

export const fetchPulsePreferences = async (options: ApiRequestOptions = {}): Promise<PulsePreferences> =>
  getJson<PulsePreferences>("/api/pulse/preferences", options);

export const savePulsePreferences = async (preferences: PulsePreferences): Promise<PulsePreferences> =>
  putJson<PulsePreferences>("/api/pulse/preferences", preferences);
