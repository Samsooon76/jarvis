import { activityIconLabels, type ActivityIconType } from "../../../utils/dashboard/dealAnalysis";

export const ActivityChannelIcon = ({ channel }: { channel: ActivityIconType }) => (
  <span
    className="ae-activity-icon"
    aria-label={activityIconLabels[channel]}
    role="img"
    title={activityIconLabels[channel]}
  >
    {channel === "email" ? (
      <svg viewBox="0 0 24 24">
        <rect x="4" y="6" width="16" height="12" rx="2" />
        <path d="m5 8 7 5 7-5" />
      </svg>
    ) : null}
    {channel === "call" ? (
      <svg viewBox="0 0 24 24">
        <path d="M8.5 5.5 6.7 7.3c-.7.7-.7 2.1 0 3.3 1.8 3.2 3.5 4.9 6.7 6.7 1.2.7 2.6.7 3.3 0l1.8-1.8-3.2-3.2-1.6 1.6c-1.9-.9-2.7-1.7-3.6-3.6l1.6-1.6-3.2-3.2Z" />
      </svg>
    ) : null}
    {channel === "meeting" ? (
      <svg viewBox="0 0 24 24">
        <rect x="5" y="6" width="14" height="13" rx="2" />
        <path d="M8 4v4M16 4v4M5 10h14M8 14h3M13 14h3" />
      </svg>
    ) : null}
    {channel === "note" ? (
      <svg viewBox="0 0 24 24">
        <path d="M6 4h9l3 3v13H6z" />
        <path d="M14 4v4h4M9 12h6M9 16h4" />
      </svg>
    ) : null}
    {channel === "sms" ? (
      <svg viewBox="0 0 24 24">
        <path d="M5 6h14v10H9l-4 3z" />
        <path d="M8 10h8M8 13h5" />
      </svg>
    ) : null}
    {channel === "communication" ? (
      <svg viewBox="0 0 24 24">
        <path d="M5 6h14v9H9l-4 4z" />
        <path d="M8 10h8M8 13h6" />
      </svg>
    ) : null}
    {channel === "task" ? (
      <svg viewBox="0 0 24 24">
        <rect x="5" y="4" width="14" height="16" rx="2" />
        <path d="M9 9h6M9 13h6M9 17h3" />
      </svg>
    ) : null}
    {channel === "action" ? (
      <svg viewBox="0 0 24 24">
        <rect x="5" y="4" width="14" height="16" rx="2" />
        <path d="M9 9h6M9 13h4M9 17l2 2 4-5" />
      </svg>
    ) : null}
    {channel === "deadline" ? (
      <svg viewBox="0 0 24 24">
        <rect x="5" y="6" width="14" height="13" rx="2" />
        <path d="M8 4v4M16 4v4M5 10h14" />
        <path d="M12 14v3l2 1" />
      </svg>
    ) : null}
    {channel === "recommendation" ? (
      <svg viewBox="0 0 24 24">
        <path d="M12 4 6 14h5l-1 6 8-11h-5z" />
      </svg>
    ) : null}
    {channel === "deal" ? (
      <svg viewBox="0 0 24 24">
        <path d="M7 11V7.5A2.5 2.5 0 0 1 9.5 5h5A2.5 2.5 0 0 1 17 7.5V11" />
        <rect x="4" y="10" width="16" height="9" rx="2" />
        <path d="M9 14h6" />
      </svg>
    ) : null}
  </span>
);
