import { RefreshCw } from "lucide-react";
import "../styles/loading.css";

type LoadingStateTone = "panel" | "inline";

export const LoadingState = ({
  detail,
  label = "Chargement en cours",
  tone = "panel",
}: {
  detail?: string;
  label?: string;
  tone?: LoadingStateTone;
}) => (
  <div
    className={`jv-loading-state ${tone === "inline" ? "inline" : "panel"}`}
    aria-busy="true"
    aria-live="polite"
  >
    <RefreshCw aria-hidden="true" className="jv-loading-icon jv-spin" size={18} strokeWidth={1.5} />
    <div>
      <strong>{label}</strong>
      {detail ? <p>{detail}</p> : null}
    </div>
  </div>
);