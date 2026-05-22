import type { QueueProspect } from "@jarvis/shared";
import { BarChart3 } from "lucide-react";
import { buckets, dealStatusLabels, priorityLabels } from "../config";
import type { PlannedProspectTask } from "../types";
import { formatAmount, formatDate } from "../../../utils/dashboard/formatters";
import { getBucket, getDaysSince, getDealStatus, getInitials } from "../../../utils/dashboard/prospects";

type ProspectTableProps = {
  activeProspectId: string | null;
  filteredProspects: QueueProspect[];
  isLoadingLiveDeals: boolean;
  onActiveProspectChange: (prospectId: string) => void;
  onOpenDealAnalysis: (prospectId: string) => void;
  plannedTasksByProspectId: Map<string, PlannedProspectTask>;
};

const getTaskDueLabel = (dueAt: string | null): string => {
  if (!dueAt) {
    return "Planifiee sans date";
  }

  const dueDate = new Date(dueAt);

  if (Number.isNaN(dueDate.getTime())) {
    return "Planifiee";
  }

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dueStart = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
  const dayDelta = Math.round((dueStart.getTime() - todayStart.getTime()) / 86_400_000);

  if (dayDelta < 0) {
    return `En retard · ${formatDate(dueAt)}`;
  }

  if (dayDelta === 0) {
    return "Aujourd'hui";
  }

  if (dayDelta === 1) {
    return "Demain";
  }

  return formatDate(dueAt);
};

export const ProspectTable = ({
  activeProspectId,
  filteredProspects,
  isLoadingLiveDeals,
  onActiveProspectChange,
  onOpenDealAnalysis,
  plannedTasksByProspectId,
}: ProspectTableProps) => (
  <div className="ae-table" role="region" aria-label="AE inbox items">
    <table>
      <thead>
        <tr>
          <th>Account</th>
          <th>Status</th>
          <th>When</th>
          <th>Next move</th>
          <th>Value</th>
          <th aria-label="Deal analysis" />
        </tr>
      </thead>
      <tbody>
        {filteredProspects.map((prospect) => {
          const bucket = getBucket(prospect);
          const isActive = activeProspectId === prospect.id;
          const daysSinceContact = getDaysSince(prospect.lastContactAt);
          const dealStatus = getDealStatus(prospect);
          const plannedTask = plannedTasksByProspectId.get(prospect.id) ?? null;

          return (
            <tr className={isActive ? "selected" : ""} key={prospect.id} onClick={() => onActiveProspectChange(prospect.id)}>
              <td>
                <div className="ae-account">
                  <span aria-hidden="true">{getInitials(prospect.company)}</span>
                  <div>
                    <strong>{prospect.company}</strong>
                    <small>
                      {prospect.name} · {prospect.dealStage}
                    </small>
                  </div>
                </div>
              </td>
              <td>
                <span className={`ae-status-pill ${dealStatus}`}>{dealStatusLabels[dealStatus]}</span>
                <small>{prospect.closeDate ? formatDate(prospect.closeDate) : "Sans date"}</small>
              </td>
              <td>
                <span className={`ae-pill ${bucket}`}>{buckets.find((item) => item.id === bucket)?.label}</span>
              </td>
              <td>
                {plannedTask ? (
                  <>
                    <strong className="ae-next ae-planned-task-title">{plannedTask.title}</strong>
                    <small className="ae-planned-task-meta">
                      Tache HubSpot · {getTaskDueLabel(plannedTask.dueAt)}
                      {plannedTask.extraCount > 0 ? ` · +${plannedTask.extraCount}` : ""}
                    </small>
                  </>
                ) : (
                  <>
                    <strong className="ae-next">{prospect.nextAction}</strong>
                    <small>{daysSinceContact === 0 ? "Contact today" : `No touch ${daysSinceContact}d`}</small>
                  </>
                )}
              </td>
              <td>
                <strong>{formatAmount(prospect.dealAmount)}</strong>
                <small>
                  {priorityLabels[prospect.priority]} · {prospect.closeProbability}%
                </small>
              </td>
              <td className="ae-table-action-cell">
                <button
                  aria-label={`Ouvrir l'analyse du deal ${prospect.company}`}
                  className="ae-table-analysis-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenDealAnalysis(prospect.id);
                  }}
                  title="Ouvrir l'analyse du deal"
                  type="button"
                >
                  <BarChart3 aria-hidden="true" size={15} />
                  <span>Analyse</span>
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    {filteredProspects.length === 0 ? (
      <p className="ae-empty">
        {isLoadingLiveDeals ? "Chargement des deals HubSpot..." : "Aucun deal ne correspond a ce filtre."}
      </p>
    ) : null}
  </div>
);
