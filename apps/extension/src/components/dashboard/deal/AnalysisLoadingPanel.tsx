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
      <article className="ae-deal-panel ae-analysis-loading idle">
        <h3>{title}</h3>
        {error ? <p className="ae-detail-error">{error}</p> : null}
        <p>{idleText}</p>
      </article>
    );
  }

  const activeStep = steps[activeStepIndex] ?? steps[0];

  return (
    <article className={`ae-deal-panel ae-analysis-loading${compact ? " compact" : ""}`} aria-live="polite">
      <div className="ae-loading-head">
        <div className="ae-loading-orbit" aria-hidden="true">
          <span />
          <i />
        </div>
        <div>
          <h3>{title}</h3>
          <p>{activeStep.detail}</p>
        </div>
      </div>
      {error ? <p className="ae-detail-error">{error}</p> : null}
      <ol className="ae-loading-steps">
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
      <div className="ae-loading-progress" aria-hidden="true">
        <span style={{ width: `${((activeStepIndex + 1) / steps.length) * 100}%` }} />
      </div>
    </article>
  );
};
