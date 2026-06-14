import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

const PULSE_PANEL_WIDTH = 420;
const PULSE_PANEL_MAX_HEIGHT = 520;
const PULSE_PANEL_GAP = 10;

type PulsePanelPosition = {
  left: number;
  top: number;
};

const resolvePulsePanelPosition = (bellRect: DOMRect): PulsePanelPosition => {
  const panelWidth = Math.min(PULSE_PANEL_WIDTH, window.innerWidth * 0.86);
  const viewportPadding = 8;
  const isNarrowSidebar = window.innerWidth <= 760;

  if (isNarrowSidebar) {
    const left = Math.max(viewportPadding, bellRect.right - panelWidth);
    const top = Math.min(
      bellRect.bottom + PULSE_PANEL_GAP,
      window.innerHeight - PULSE_PANEL_MAX_HEIGHT - viewportPadding,
    );

    return { left, top: Math.max(viewportPadding, top) };
  }

  let left = bellRect.right + PULSE_PANEL_GAP;
  let top = bellRect.top;

  if (left + panelWidth > window.innerWidth - viewportPadding) {
    left = Math.max(viewportPadding, bellRect.left - panelWidth - PULSE_PANEL_GAP);
  }

  if (top + PULSE_PANEL_MAX_HEIGHT > window.innerHeight - viewportPadding) {
    top = Math.max(viewportPadding, window.innerHeight - PULSE_PANEL_MAX_HEIGHT - viewportPadding);
  }

  return { left, top };
};

const NotificationRow = ({
  notification,
  onMarkRead,
}: {
  notification: PulseNotification;
  onMarkRead: (notificationId: string) => void;
}) => (
  <li>
    <button
      type="button"
      className={`jv-pulse-item ${notification.readAt ? "" : "is-unread"}`}
      onClick={() => {
        if (!notification.readAt) {
          onMarkRead(notification.id);
        }
      }}
      title={notification.readAt ? undefined : "Marquer comme lu"}
    >
      <span className="jv-list-main">
        <span className="jv-item-meta">
          <span className="jv-meta-score">{eventTypeLabels[notification.eventType]}</span>
        </span>
        <strong>{notification.title}</strong>
        <small>{notification.message}</small>
      </span>
      <span className="jv-list-side">
        <time dateTime={notification.occurredAt}>{formatDateTime(notification.occurredAt)}</time>
      </span>
    </button>
  </li>
);

export const PulseNotificationCenter = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<PulsePanelPosition | null>(null);
  const [selectedEventTypes, setSelectedEventTypes] = useState<PulseEventType[]>([]);
  const bellRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { notifications, unreadCount, isLoading, error, markRead, markAllRead, refresh } = usePulseNotifications(
    true,
    selectedEventTypes,
  );

  const updatePanelPosition = useCallback((): void => {
    if (!bellRef.current) {
      return;
    }

    setPanelPosition(resolvePulsePanelPosition(bellRef.current.getBoundingClientRect()));
  }, []);

  const toggleEventType = (eventType: PulseEventType): void => {
    setSelectedEventTypes((current) =>
      current.includes(eventType) ? current.filter((selected) => selected !== eventType) : [...current, eventType],
    );
  };

  useLayoutEffect(() => {
    if (!isOpen) {
      setPanelPosition(null);
      return;
    }

    updatePanelPosition();

    const handleViewportChange = (): void => {
      updatePanelPosition();
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isOpen, updatePanelPosition]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (bellRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }

      setIsOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);

    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  const panel =
    isOpen && panelPosition ? (
      <div
        className="jv-pulse-root jv-pulse-panel jv-pulse-panel--floating"
        ref={panelRef}
        role="dialog"
        aria-label="Notifications Jarvis Pulse"
        style={{ top: panelPosition.top, left: panelPosition.left }}
      >
        <header className="jv-pulse-header">
          <Bell aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
          <div className="jv-pulse-headcopy">
            <h2>Jarvis Pulse</h2>
          </div>
          <button
            type="button"
            className="jv-pulse-mark-all"
            onClick={() => void markAllRead()}
            disabled={unreadCount === 0}
          >
            <CheckCheck size={14} aria-hidden="true" />
            Tout marquer lu
          </button>
        </header>

        <div className="jv-pulse-toolbar">
          <div className="jv-filter-pills" role="group" aria-label="Filtrer Jarvis Pulse par type d'evenement">
            <button
              type="button"
              className={selectedEventTypes.length === 0 ? "active" : ""}
              onClick={() => setSelectedEventTypes([])}
            >
              Tous
            </button>
            {pulseEventFilters.map(([eventType, label]) => (
              <button
                key={eventType}
                type="button"
                className={selectedEventTypes.includes(eventType) ? "active" : ""}
                onClick={() => toggleEventType(eventType)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {error ? <p className="jv-banner jv-banner-error">{error}</p> : null}

        <section className="jv-pulse-list-shell" aria-label="Liste des notifications Pulse">
          {isLoading && notifications.length === 0 ? (
            <LoadingState detail="On recupere les derniers changements de deals." label="Chargement Pulse" tone="inline" />
          ) : null}

          {!isLoading && notifications.length === 0 && !error ? (
            <p className="jv-pulse-list-empty">
              {selectedEventTypes.length > 0
                ? "Aucune notification pour ces evenements."
                : "Aucune notification pour le moment. Jarvis surveille vos deals."}
            </p>
          ) : null}

          {notifications.length > 0 ? (
            <ul className="jv-pulse-list-body">
              {notifications.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  onMarkRead={(notificationId) => void markRead(notificationId)}
                />
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    ) : null;

  return (
    <div className={`jv-pulse-root ${isOpen ? "is-open" : ""}`}>
      <button
        ref={bellRef}
        type="button"
        className="jv-pulse-bell"
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
        <Bell size={18} strokeWidth={1.5} aria-hidden="true" />
        {unreadCount > 0 ? <span className="jv-pulse-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
      </button>

      {panel ? createPortal(panel, document.body) : null}
    </div>
  );
};