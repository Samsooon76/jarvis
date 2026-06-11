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
  <div className={`ae-loading-state ${tone === "inline" ? "inline" : "panel"}`} aria-busy="true" aria-live="polite">
    <div className="ae-loading-orbit small" aria-hidden="true">
      <span />
      <i />
    </div>
    <div>
      <strong>{label}</strong>
      {detail ? <p>{detail}</p> : null}
    </div>
  </div>
);
