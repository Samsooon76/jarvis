import type { ForecastAnalyzeJobStatus } from "../../../services/api";
import { formatDateTime } from "../../../utils/dashboard/formatters";

type ForecastJobProgressProps = {
  forecastJob: ForecastAnalyzeJobStatus;
  logsOpen: boolean;
  onToggleLogs: () => void;
};

export const ForecastJobProgress = ({ forecastJob, logsOpen, onToggleLogs }: ForecastJobProgressProps) => (
  <div className="ae-sync-progress" aria-live="polite">
    <div className="ae-sync-progress-head">
      <span>{forecastJob.currentStep}</span>
      <strong>{forecastJob.progress}%</strong>
    </div>
    <div className="ae-sync-progress-track">
      <div style={{ width: `${forecastJob.progress}%` }} />
    </div>
    <button className="ae-forecast-link" onClick={onToggleLogs} type="button">
      {logsOpen ? "Masquer les logs" : "Voir les logs"}
    </button>
    {logsOpen ? (
      <ol className="ae-sync-logs">
        {forecastJob.logs.slice(-8).map((log) => (
          <li className={log.level} key={`${log.at}:${log.message}`}>
            <time>{formatDateTime(log.at)}</time>
            <span>{log.message}</span>
          </li>
        ))}
      </ol>
    ) : null}
  </div>
);
