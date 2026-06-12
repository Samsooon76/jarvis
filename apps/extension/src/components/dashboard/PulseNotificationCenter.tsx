import { useEffect, useRef, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import type { PulseEventType, PulseNotification } from "../../services/api";
import { usePulseNotifications } from "../../hooks/usePulseNotifications";
import { formatDateTime } from "../../utils/dashboard/formatters";
import { LoadingState } from "./LoadingState";

const eventTypeLabels: Record<PulseEventType, string> = {
  deal_created: "Nouveau deal",
  probability: "Probabilite",
  amount: "Montant",
  stage: "Stage",
  close_date: "Date de closing",
  owner: "Owner",
  pipeline: "Pipeline",
  playbook_suggestion: "Playbook",
};

const pulseEventFilters = Object.entries(eventTypeLabels) as Array<[PulseEventType, string]>;

const NotificationRow = ({
  notification,
  onMarkRead,
}: {
  notification: PulseNotification;
  onMarkRead: (notificationId: string) => void;
}) => (
  <li className={`pulse-notification ${notification.readAt ? "is-read" : "is-unread"}`}>
    <button
      type="button"
      className="pulse-notification-body"
      onClick={() => {
        if (!notification.readAt) {
          onMarkRead(notification.id);
        }
      }}
      title={notification.readAt ? undefined : "Marquer comme lu"}
    >
      <span className="pulse-notification-top">
        <span className="pulse-notification-type">{eventTypeLabels[notification.eventType]}</span>
        <span className="pulse-notification-date">{formatDateTime(notification.occurredAt)}</span>
      </span>
      <strong className="pulse-notification-title">{notification.title}</strong>
      <span className="pulse-notification-message">{notification.message}</span>
    </button>
  </li>
);

export const PulseNotificationCenter = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedEventTypes, setSelectedEventTypes] = useState<PulseEventType[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { notifications, unreadCount, isLoading, error, markRead, markAllRead, refresh } = usePulseNotifications(
    true,
    selectedEventTypes,
  );

  const toggleEventType = (eventType: PulseEventType): void => {
    setSelectedEventTypes((current) =>
      current.includes(eventType) ? current.filter((selected) => selected !== eventType) : [...current, eventType],
    );
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      if (containerRef.current && event.target instanceof Node && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);

    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  return (
    <div className="pulse-center" ref={containerRef}>
      <button
        type="button"
        className="pulse-bell"
        aria-label={
          unreadCount > 0
            ? `Jarvis Pulse: ${unreadCount} notification${unreadCount > 1 ? "s" : ""} non lue${unreadCount > 1 ? "s" : ""}`
            : "Jarvis Pulse: aucune notification non lue"
        }
        aria-expanded={isOpen}
        onClick={() => {
          setIsOpen((current) => !current);
          void refresh();
        }}
      >
        <Bell size={18} aria-hidden="true" />
        {unreadCount > 0 ? <span className="pulse-bell-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
      </button>

      {isOpen ? (
        <div className="pulse-panel" role="dialog" aria-label="Notifications Jarvis Pulse">
          <header className="pulse-panel-header">
            <div>
              <strong>Jarvis Pulse</strong>
              <span className="pulse-panel-subtitle">Changements de deals en quasi temps reel</span>
            </div>
            <button
              type="button"
              className="pulse-mark-all"
              onClick={() => void markAllRead()}
              disabled={unreadCount === 0}
            >
              <CheckCheck size={14} aria-hidden="true" />
              Tout marquer lu
            </button>
          </header>

          <div className="pulse-filter-bar" aria-label="Filtrer Jarvis Pulse par type d'evenement">
            <button
              type="button"
              className={`pulse-filter-chip ${selectedEventTypes.length === 0 ? "is-active" : ""}`}
              onClick={() => setSelectedEventTypes([])}
            >
              Tous
            </button>
            {pulseEventFilters.map(([eventType, label]) => (
              <button
                key={eventType}
                type="button"
                className={`pulse-filter-chip ${selectedEventTypes.includes(eventType) ? "is-active" : ""}`}
                onClick={() => toggleEventType(eventType)}
              >
                {label}
              </button>
            ))}
          </div>

          {error ? <p className="pulse-panel-error">{error}</p> : null}

          {isLoading && notifications.length === 0 ? (
            <LoadingState detail="On recupere les derniers changements de deals." label="Chargement Pulse" tone="inline" />
          ) : null}

          {!isLoading && notifications.length === 0 && !error ? (
            <p className="pulse-panel-empty">
              {selectedEventTypes.length > 0
                ? "Aucune notification pour ces evenements."
                : "Aucune notification pour le moment. Jarvis surveille vos deals."}
            </p>
          ) : null}

          {notifications.length > 0 ? (
            <ul className="pulse-notification-list">
              {notifications.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  onMarkRead={(notificationId) => void markRead(notificationId)}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
