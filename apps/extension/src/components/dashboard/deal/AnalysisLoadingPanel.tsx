import { useEffect, useState } from "react";

export type LoadingStep = {
  label: string;
  detail: string;
};

export const AnalysisLoadingPanel = ({
  error,
  idleText,
  isLoading,
  steps,
  title,
  compact = false,
}: {
  error: string | null;
  idleText: string;
  isLoading: boolean;
  steps: LoadingStep[];
  title: string;
  compact?: boolean;
}) => {
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  useEffect(() => {
    if (!isLoading) {
      setActiveStepIndex(0);
      return undefined;
    }

    setActiveStepIndex(0);

    const intervalId = window.setInterval(() => {
      setActiveStepIndex((currentStepIndex) => Math.min(currentStepIndex + 1, steps.length - 1));
    }, 1100);

    return () => window.clearInterval(intervalId);
  }, [isLoading, steps.length]);

  if (!isLoading) {
    return (
      <article className="jv-theme-block jv-loading-panel">
        <span className="jv-section-label">{title}</span>
        {error ? <p className="jv-banner jv-banner-error">{error}</p> : null}
        <p className="jv-theme-empty">{idleText}</p>
      </article>
    );
  }

  const activeStep = steps[activeStepIndex] ?? steps[0];

  return (
    <article
      className={`jv-theme-block jv-loading-panel${compact ? " compact" : ""}`}
      aria-live="polite"
    >
      <div className="jv-loading-head">
        <div aria-hidden="true" className="jv-loading-orbit">
          <span />
        </div>
        <div>
          <span className="jv-section-label">{title}</span>
          <p className="jv-prose">{activeStep.detail}</p>
        </div>
      </div>
      {error ? <p className="jv-banner jv-banner-error">{error}</p> : null}
      <ol className="jv-loading-steps">
        {steps.map((step, index) => {
          const stateClass = index < activeStepIndex ? "done" : index === activeStepIndex ? "current" : "waiting";

          return (
            <li className={stateClass} key={step.label}>
              <span aria-hidden="true" />
              <div>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </div>
            </li>
          );
        })}
      </ol>
      <div aria-hidden="true" className="jv-loading-progress">
        <span style={{ width: `${((activeStepIndex + 1) / steps.length) * 100}%` }} />
      </div>
    </article>
  );
};