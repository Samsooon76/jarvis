import { useEffect, useState } from "react";
import type { QueueProspect } from "@jarvis/shared";
import { dealStatusLabels } from "../config";
import { createFollowUpTask, type FollowUpTaskResult } from "../../../services/api";
import { formatAmount, formatDateTime } from "../../../utils/dashboard/formatters";
import { getDealStatus, getInitials } from "../../../utils/dashboard/prospects";

type ProspectDetailProps = {
  activeProspect: QueueProspect | null;
  orgId: string;
  onOpenDealAnalysis: () => void;
};

export const ProspectDetail = ({ activeProspect, orgId, onOpenDealAnalysis }: ProspectDetailProps) => {
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

  return (
    <aside className="ae-detail" aria-label="Selected prospect detail">
      {activeProspect ? (
        <>
          <div className="ae-detail-head">
            <span aria-hidden="true">{getInitials(activeProspect.company)}</span>
            <div>
              <h2>{activeProspect.company}</h2>
              <p>
                {activeProspect.name} · {activeProspect.title}
              </p>
            </div>
          </div>
          <button className="ae-detail-primary-action" onClick={onOpenDealAnalysis} type="button">
            Ouvrir l'analyse du deal
          </button>
          <dl>
            <div>
              <dt>Deal</dt>
              <dd>{formatAmount(activeProspect.dealAmount)}</dd>
            </div>
            <div>
              <dt>Stage</dt>
              <dd>{activeProspect.dealStage}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{dealStatusLabels[getDealStatus(activeProspect)]}</dd>
            </div>
            <div>
              <dt>Close won</dt>
              <dd>{activeProspect.closeProbability}%</dd>
            </div>
            <div>
              <dt>Next move</dt>
              <dd>{activeProspect.nextAction}</dd>
            </div>
            <div>
              <dt>Last touch</dt>
              <dd>{formatDateTime(activeProspect.lastContactAt)}</dd>
            </div>
          </dl>
          <div className="ae-ai-actions">
            <button disabled={taskLoading} onClick={handleCreateTask} type="button">
              {taskLoading ? "Creation..." : "Creer task"}
            </button>
          </div>
          {analysisError ? <p className="ae-detail-error">{analysisError}</p> : null}
          {taskResult ? (
            <p className="ae-detail-success">
              {taskResult.created ? "Task HubSpot creee." : taskResult.recommendation.rationale}
            </p>
          ) : null}
        </>
      ) : (
        <p className="ae-empty">Selectionne un deal pour voir le contexte.</p>
      )}
    </aside>
  );
};
