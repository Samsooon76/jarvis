import { useEffect, useState } from "react";
import type { QueueProspect } from "@jarvis/shared";
import { ListChecks, Sparkles, Target } from "lucide-react";
import { dealStatusLabels, priorityLabels } from "../config";
import { createFollowUpTask, type FollowUpTaskResult } from "../../../services/api";
import { formatAmount, formatDateTime } from "../../../utils/dashboard/formatters";
import { getDaysSince, getDealStatus } from "../../../utils/dashboard/prospects";
import type { PlannedProspectTask } from "../types";

type ProspectDetailProps = {
  activeProspect: QueueProspect | null;
  orgId: string;
  onOpenDealAnalysis: () => void;
  plannedTask: PlannedProspectTask | null;
};

const priorityClass: Record<QueueProspect["priority"], string> = {
  urgent: "jv-meta-risk",
  important: "jv-meta-pending",
  routine: "jv-meta-ok",
};

const formatRelativeTouch = (value: string): string => {
  const days = getDaysSince(value);

  if (days === 0) {
    return "Aujourd'hui";
  }

  if (days === 1) {
    return "Hier";
  }

  return `Il y a ${days}j`;
};

const ProspectMeta = ({ prospect }: { prospect: QueueProspect }) => (
  <span className="jv-item-meta">
    <span className={priorityClass[prospect.priority]}>{priorityLabels[prospect.priority]}</span>
    <span>{prospect.dealStage}</span>
    <span>{prospect.closeProbability}%</span>
    <span className="jv-meta-score">Score {prospect.closeProbability}</span>
  </span>
);

export const ProspectDetail = ({
  activeProspect,
  orgId,
  onOpenDealAnalysis,
  plannedTask,
}: ProspectDetailProps) => {
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskResult, setTaskResult] = useState<FollowUpTaskResult | null>(null);

  useEffect(() => {
    setAnalysisError(null);
    setTaskResult(null);
  }, [activeProspect?.id]);

  const handleCreateTask = async () => {
    if (!activeProspect) {
      return;
    }

    try {
      setTaskLoading(true);
      setTaskResult(null);

      const result = await createFollowUpTask(activeProspect, orgId);
      setTaskResult(result);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Impossible de creer la tache HubSpot.");
    } finally {
      setTaskLoading(false);
    }
  };

  if (!activeProspect) {
    return (
      <aside className="jv-detail" aria-label="Détail prospect">
        <div className="jv-detail-empty">
          <Target size={20} strokeWidth={1.25} />
          <strong>Sélectionnez un prospect</strong>
          <p>Deal, prochaine action et signaux de priorité Jarvis.</p>
        </div>
      </aside>
    );
  }

  const dealLabel = activeProspect.dealName ?? activeProspect.dealStage;
  const nextAction = plannedTask?.title ?? activeProspect.nextAction;

  return (
    <aside className="jv-detail" aria-label="Détail prospect">
      <header className="jv-detail-head">
        <div>
          <h2>{activeProspect.company}</h2>
          <p>
            {dealLabel} · {formatAmount(activeProspect.dealAmount)} · {activeProspect.dealStage} · {activeProspect.name}
          </p>
        </div>
        <button className="jv-btn-ghost" onClick={onOpenDealAnalysis} type="button">
          <Sparkles size={14} strokeWidth={1.5} />
          Analyse deal
        </button>
      </header>

      <ProspectMeta prospect={activeProspect} />

      <div className="jv-callout">
        <ListChecks size={15} strokeWidth={1.5} />
        <div>
          <p>{nextAction}</p>
          <small>
            {formatRelativeTouch(activeProspect.lastContactAt)} · {activeProspect.reason}
          </small>
        </div>
      </div>

      <section className="jv-detail-section">
        <ul className="jv-detail-facts">
          <li>
            <span>Statut</span>
            <strong>{dealStatusLabels[getDealStatus(activeProspect)]}</strong>
          </li>
          <li>
            <span>Close won</span>
            <strong>{activeProspect.closeProbability}%</strong>
          </li>
          <li>
            <span>Dernier contact</span>
            <strong>{formatDateTime(activeProspect.lastContactAt)}</strong>
          </li>
          <li>
            <span>Prochaine action</span>
            <strong>{activeProspect.nextAction}</strong>
          </li>
        </ul>
      </section>

      <div className="jv-detail-actions">
        <button className="jv-btn-primary" disabled={taskLoading} onClick={handleCreateTask} type="button">
          {taskLoading ? "Creation..." : "Creer task HubSpot"}
        </button>
      </div>

      {analysisError ? <p className="jv-detail-feedback error">{analysisError}</p> : null}
      {taskResult ? (
        <p className="jv-detail-feedback success">
          {taskResult.created ? "Task HubSpot creee." : taskResult.recommendation.rationale}
        </p>
      ) : null}
    </aside>
  );
};