import { AlignLeft, ListChecks, ListTodo, Sparkles, Users } from "lucide-react";
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

const SectionLabel = ({
  children,
  icon: Icon,
}: {
  children: string;
  icon: typeof ListTodo;
}) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

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
  <aside className="jv-detail jv-detail-expanded" aria-label="Digest du jour">
    <header className="jv-detail-head">
      <div>
        <h2>
          {filteredTaskCount} tâche{filteredTaskCount > 1 ? "s" : ""}
        </h2>
        <p>
          Charge ouverte · {openTasksCount} à traiter
          {filteredTaskCount !== openTasksCount ? ` · ${filteredTaskCount} affichée(s)` : ""}
        </p>
      </div>
    </header>

    {selectedTaskAnalysis ? (
      <section className="jv-detail-section">
        <SectionLabel icon={Sparkles}>Analyse de tâche</SectionLabel>
        <p className="jv-prose">
          <strong>{selectedTaskAnalysis.title}</strong>
          {selectedTaskAnalysis.accountLabel ? (
            <>
              <br />
              <small>{selectedTaskAnalysis.accountLabel}</small>
            </>
          ) : null}
        </p>
        <div className="jv-analysis-tags">
          <span>{recommendationLabels[selectedTaskAnalysis.analysis.recommendation]}</span>
          <span>{taskTypeLabels[selectedTaskAnalysis.analysis.taskType]}</span>
          <span>{priorityLabels[selectedTaskAnalysis.analysis.priority]}</span>
        </div>
        <SectionLabel icon={ListChecks}>Action recommandée</SectionLabel>
        <p className="jv-prose">{selectedTaskAnalysis.analysis.suggestedAction}</p>
        <SectionLabel icon={AlignLeft}>Justification</SectionLabel>
        <p className="jv-prose">{selectedTaskAnalysis.analysis.rationale}</p>
        {selectedTaskAnalysis.analysis.shouldReschedule &&
        selectedTaskAnalysis.analysis.suggestedDueInDays !== null ? (
          <p className="jv-prose">Replanifier J+{selectedTaskAnalysis.analysis.suggestedDueInDays}</p>
        ) : null}
      </section>
    ) : (
      <div className="jv-callout">
        <Sparkles aria-hidden="true" size={16} strokeWidth={1.5} />
        <div>
          <p>Focus Jarvis — Aujourd'hui</p>
          <small>
            {overdueTaskCount > 0
              ? `${overdueTaskCount} tâche(s) en retard — commencer par ${urgentTask?.companyName ?? urgentTask?.title ?? "la priorité la plus ancienne"}.`
              : todayTaskCount > 0
                ? `${todayTaskCount} tâche(s) aujourd'hui — traiter les actions les plus proches de leur échéance.`
                : "Aucune urgence détectée sur les tâches ouvertes."}
          </small>
        </div>
      </div>
    )}

    <section className="jv-detail-section">
      <SectionLabel icon={ListTodo}>Priorités du jour</SectionLabel>
      <p className="jv-prose">
        {urgentTask
          ? `${urgentTask.title}${urgentTask.dealName ? ` sur ${urgentTask.dealName}` : ""} : ${getTaskDueLabel(urgentTask.dueAt)}.`
          : "Connectez un owner HubSpot pour afficher les priorités du jour."}
      </p>
      <p className="jv-prose">
        {nextTask
          ? `Ensuite : ${nextTask.title}${nextTask.companyName ? ` — ${nextTask.companyName}` : ""}.`
          : "La prochaine action apparaîtra ici quand la queue sera chargée."}
      </p>
    </section>

    <section className="jv-detail-section">
      <SectionLabel icon={Users}>Charge par commercial</SectionLabel>
      {ownerWorkload.length > 0 ? (
        <ul className="jv-workload-list">
          {ownerWorkload.map((owner) => (
            <li key={owner.id}>
              <span>{owner.initials}</span>
              <strong>{owner.label}</strong>
              <em>{owner.overdueCount > 0 ? `${owner.overdueCount} retard` : `${owner.taskCount} tâches`}</em>
            </li>
          ))}
        </ul>
      ) : (
        <p className="jv-prose">Aucune charge visible pour ce filtre.</p>
      )}
    </section>
  </aside>
);