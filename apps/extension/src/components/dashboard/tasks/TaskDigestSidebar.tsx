import { CheckCircle2 } from "lucide-react";
import type { TaskAnalysis } from "../../../services/api";
import {
  getTaskDueLabel,
  priorityLabels,
  recommendationLabels,
  taskTypeLabels,
  type EnrichedTask,
  type OwnerWorkloadItem,
} from "../../../utils/dashboard/tasks";

export type SelectedTaskAnalysis = {
  accountLabel: string | null;
  analysis: TaskAnalysis;
  taskId: string;
  title: string;
};

type TaskDigestSidebarProps = {
  filteredTaskCount: number;
  nextTask: EnrichedTask | null;
  openTasksCount: number;
  overdueTaskCount: number;
  ownerWorkload: OwnerWorkloadItem[];
  selectedTaskAnalysis: SelectedTaskAnalysis | null;
  todayTaskCount: number;
  urgentTask: EnrichedTask | null;
};

export const TaskDigestSidebar = ({
  filteredTaskCount,
  nextTask,
  openTasksCount,
  overdueTaskCount,
  ownerWorkload,
  selectedTaskAnalysis,
  todayTaskCount,
  urgentTask,
}: TaskDigestSidebarProps) => (
  <aside className="ae-task-digest" aria-label="Digest du jour">
    <div>
      <strong>{filteredTaskCount}</strong>
      <span>{filteredTaskCount === 1 ? "tache" : "taches"}</span>
      <small>{filteredTaskCount === 1 ? "affichee" : "affichees"}</small>
    </div>
    <div className="ae-task-completion">
      <CheckCircle2 size={16} />
      <div>
        <strong>Charge ouverte</strong>
        <small>{openTasksCount} taches a traiter</small>
      </div>
    </div>
    {selectedTaskAnalysis ? (
      <section className="ae-task-analysis-panel">
        <h3>Analyse de tache</h3>
        <strong>{selectedTaskAnalysis.title}</strong>
        {selectedTaskAnalysis.accountLabel ? <small>{selectedTaskAnalysis.accountLabel}</small> : null}
        <div>
          <span>{recommendationLabels[selectedTaskAnalysis.analysis.recommendation]}</span>
          <span>{taskTypeLabels[selectedTaskAnalysis.analysis.taskType]}</span>
          <span>{priorityLabels[selectedTaskAnalysis.analysis.priority]}</span>
        </div>
        <div className="ae-task-analysis-detail">
          <span>Action recommandee</span>
          <p>{selectedTaskAnalysis.analysis.suggestedAction}</p>
        </div>
        <div className="ae-task-analysis-detail">
          <span>Justification</span>
          <p>{selectedTaskAnalysis.analysis.rationale}</p>
        </div>
        {selectedTaskAnalysis.analysis.shouldReschedule && selectedTaskAnalysis.analysis.suggestedDueInDays !== null ? (
          <small>Replanifier J+{selectedTaskAnalysis.analysis.suggestedDueInDays}</small>
        ) : null}
      </section>
    ) : null}
    <section>
      <h3>Focus Jarvis — Aujourd'hui</h3>
      <p>
        {overdueTaskCount > 0
          ? `${overdueTaskCount} tache(s) en retard - commencer par ${urgentTask?.companyName ?? urgentTask?.title ?? "la priorite la plus ancienne"}.`
          : todayTaskCount > 0
            ? `${todayTaskCount} tache(s) aujourd'hui - traiter les actions les plus proches de leur echeance.`
            : "Aucune urgence detectee sur les taches ouvertes."}
      </p>
      <p>
        {urgentTask
          ? `${urgentTask.title}${urgentTask.dealName ? ` sur ${urgentTask.dealName}` : ""}: ${getTaskDueLabel(urgentTask.dueAt)}.`
          : "Connecte un owner HubSpot pour afficher les priorites du jour."}
      </p>
      <p>
        {nextTask
          ? `${nextTask.title}${nextTask.companyName ? ` - ${nextTask.companyName}` : ""}.`
          : "La prochaine action apparaitra ici quand la queue sera chargee."}
      </p>
    </section>
    <section className="ae-task-load">
      <h3>Charge par commercial</h3>
      {ownerWorkload.length > 0 ? (
        ownerWorkload.map((owner) => (
          <div key={owner.id}>
            <span>{owner.initials}</span>
            <strong>{owner.label}</strong>
            <small>{owner.overdueCount > 0 ? `${owner.overdueCount} retard` : `${owner.taskCount} taches`}</small>
          </div>
        ))
      ) : (
        <p>Aucune charge visible pour ce filtre.</p>
      )}
    </section>
  </aside>
);
