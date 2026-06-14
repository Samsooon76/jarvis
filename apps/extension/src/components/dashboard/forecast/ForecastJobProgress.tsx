import type { ForecastAnalyzeJobStatus } from "../../../services/api";
import { formatDateTime } from "../../../utils/dashboard/formatters";

type ForecastJobProgressProps = {
  forecastJob: ForecastAnalyzeJobStatus;
  logsOpen: boolean;
  onToggleLogs: () => void;
};

export const ForecastJobProgress = ({ forecastJob, logsOpen, onToggleLogs }: ForecastJobProgressProps) => (
  <section aria-live="polite" className="jv-run-progress">
    <div className="jv-run-progress-head">
      <span>{forecastJob.currentStep}</span>
      <strong>{forecastJob.progress}%</strong>
    </div>
    <span className="jv-run-progress-bar">
      <span style={{ width: `${forecastJob.progress}%` }} />
    </span>
    <button className="jv-btn-link" onClick={onToggleLogs} type="button">
      {logsOpen ? "Masquer les logs" : "Voir les logs"}
    </button>
    {logsOpen ? (
      <ol className="jv-run-logs">
        {forecastJob.logs.slice(-8).map((log) => (
          <li className={log.level} key={`${log.at}:${log.message}`}>
            <time>{formatDateTime(log.at)}</time>
            <span>{log.message}</span>
          </li>
        ))}
      </ol>
    ) : null}
  </section>
);