import type { MetricIconName } from "./types";

type MetricIconProps = {
  name: MetricIconName;
};

export const MetricIcon = ({ name }: MetricIconProps) => (
  <span className="ae-metric-icon" aria-hidden="true">
    {name === "pulse" ? (
      <svg viewBox="0 0 24 24">
        <path d="M3 12h4l2-7 4 14 3-7h5" />
      </svg>
    ) : null}
    {name === "money" ? (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v10M15 9.5c-1.8-1-6-1-6 1.2 0 2 6 1.1 6 3.2 0 2.1-4.2 2.1-6 .8" />
      </svg>
    ) : null}
    {name === "clock" ? (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5h5" />
      </svg>
    ) : null}
    {name === "check" ? (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8" />
        <path d="m8.5 12.2 2.3 2.3 4.9-5" />
      </svg>
    ) : null}
    {name === "x" ? (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8" />
        <path d="m9 9 6 6M15 9l-6 6" />
      </svg>
    ) : null}
    {name === "trend" ? (
      <svg viewBox="0 0 24 24">
        <path d="M4 16l5-5 4 4 7-8" />
        <path d="M15 7h5v5" />
      </svg>
    ) : null}
  </span>
);
