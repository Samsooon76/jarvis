import { ArrowUp, Brain, CheckCircle2, ChevronDown, CircleDot, Clock, SkipForward } from "lucide-react";
import type { HubSpotTaskListItem, HubSpotTaskPriority, TaskAnalysis } from "../../../services/api";
import {
  formatTaskText,
  getHubSpotRecordUrl,
  getTaskAccountLabel,
  getTaskDateBucket,
  getTaskDueShortLabel,
  getTaskDurationLabel,
  priorityLabels,
  statusLabels,
  taskPriorityOptions,
  taskUrgencyLabels,
  type TaskSection,
  type TaskSectionId,
} from "../../../utils/dashboard/tasks";

type TaskSectionListProps = {
  analysisApplyingId: string | null;
  analysisByTaskId: Record<string, TaskAnalysis>;
  analysisLoadingId: string | null;
  collapsedSections: Partial<Record<TaskSectionId, boolean>>;
  enrichedTasksCount: number;
  filteredTaskCount: number;
  getTaskOwnerInitials: (task: HubSpotTaskListItem) => string;
  hubspotPortalId?: string | null;
  isLoading: boolean;
  onAnalyzeTask: (taskId: string, refresh: boolean) => void;
  onCompleteSalesTask: (taskId: string) => void;
  onPriorityChange: (taskId: string, priority: HubSpotTaskPriority | null) => void;
  onSkipSalesTask: (taskId: string) => void;
  onSnoozeSalesTask: (taskId: string) => void;
  onToggleSection: (sectionId: TaskSectionId) => void;
  priorityUpdatingId: string | null;
  processingTaskIds: Record<string, boolean>;
  selectedOwnerId?: string | null;
  taskActionUpdatingId: string | null;
  taskSections: TaskSection[];
  usingSalesOperatingQueue: boolean;
};

export const TaskSectionList = ({
  analysisApplyingId,
  analysisByTaskId,
  analysisLoadingId,
  collapsedSections,
  enrichedTasksCount,
  filteredTaskCount,
  getTaskOwnerInitials,
  hubspotPortalId,
  isLoading,
  onAnalyzeTask,
  onCompleteSalesTask,
  onPriorityChange,
  onSkipSalesTask,
  onSnoozeSalesTask,
  onToggleSection,
  priorityUpdatingId,
  processingTaskIds,
  selectedOwnerId,
  taskActionUpdatingId,
  taskSections,
  usingSalesOperatingQueue,
}: TaskSectionListProps) => (
  <div className="ae-task-list">
    {taskSections.map((section) => {
      const isCollapsed = Boolean(collapsedSections[section.id]);

      return section.tasks.length > 0 ? (
        <section
          className={`ae-task-section ${section.id}${isCollapsed ? " collapsed" : ""}`}
          key={section.id}
          aria-label={section.label}
        >
          <button
            aria-expanded={!isCollapsed}
            className="ae-task-section-heading"
            onClick={() => onToggleSection(section.id)}
            type="button"
          >
            <div>
              <h3>{section.label}</h3>
              <span>{section.caption}</span>
            </div>
            <strong>{section.tasks.length}</strong>
            <ChevronDown size={16} />
          </button>
          {!isCollapsed ? (
            <div className="ae-task-section-list">
            {section.tasks.map((task) => (
              <article className="ae-task-item ae-hubspot-task-item" key={task.id}>
                <div className={`ae-task-avatar priority-${task.priority ?? "none"}`} aria-hidden="true">
                  <CircleDot size={14} />
                </div>
                <div className="ae-task-main">
                  <strong>
                    {!task.jarvisTask && getHubSpotRecordUrl(hubspotPortalId, "0-27", task.id) ? (
                      <a
                        href={getHubSpotRecordUrl(hubspotPortalId, "0-27", task.id) ?? undefined}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {task.title}
                      </a>
                    ) : (
                      task.title
                    )}
                  </strong>
                  <div className="ae-task-subline">
                    {getTaskAccountLabel(task) ? (
                      <em className="ae-task-account">
                        {task.associatedCompanyIds[0] && task.companyName ? (
                          <a
                            href={getHubSpotRecordUrl(hubspotPortalId, "0-2", task.associatedCompanyIds[0]) ?? undefined}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {task.companyName}
                          </a>
                        ) : (
                          task.companyName
                        )}
                        {task.companyName && task.contactName ? " · " : ""}
                        {task.associatedContactIds[0] && task.contactName ? (
                          <a
                            href={getHubSpotRecordUrl(hubspotPortalId, "0-1", task.associatedContactIds[0]) ?? undefined}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {task.contactName}
                          </a>
                        ) : (
                          task.contactName
                        )}
                      </em>
                    ) : (
                      <span className="ae-task-context" title={task.dealName ?? task.body ?? undefined}>
                        {task.dealName ?? formatTaskText(task.body)}
                      </span>
                    )}
                    <div className="ae-task-tags" aria-label="Priorite et urgence">
                      {task.priority ? (
                        <span className={`ae-task-tag priority-${task.priority}`}>
                          {priorityLabels[task.priority]}
                        </span>
                      ) : null}
                      <span className={`ae-task-tag urgency-${getTaskDateBucket(task.dueAt)}`}>
                        {taskUrgencyLabels[getTaskDateBucket(task.dueAt)]}
                      </span>
                      {getTaskDurationLabel(task) ? (
                        <span className="ae-task-tag">{getTaskDurationLabel(task)}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="ae-task-meta">
                  <small className={`ae-task-due ${getTaskDateBucket(task.dueAt)}`}>
                    <i aria-hidden="true" />
                    {getTaskDueShortLabel(task.dueAt)}
                  </small>
                  {task.jarvisTask ? <small>{task.jarvisTask.reason}</small> : null}
                  {!task.jarvisTask && task.lastUpdate ? <small>{task.lastUpdate.reason ?? "Webhook HubSpot"}</small> : null}
                  <span className="ae-task-owner" title={statusLabels[task.status]}>
                    {getTaskOwnerInitials(task)}
                  </span>
                </div>
                {!task.jarvisTask ? (
                  <button
                    className="ae-task-inline-analyze"
                    disabled={analysisLoadingId === task.id || analysisApplyingId === task.id || processingTaskIds[task.id]}
                    onClick={() => onAnalyzeTask(task.id, Boolean(analysisByTaskId[task.id]))}
                    type="button"
                  >
                    <Brain size={13} />
                    <span>
                      {analysisApplyingId === task.id
                        ? "Action..."
                        : analysisLoadingId === task.id || processingTaskIds[task.id]
                          ? "Analyse..."
                          : "Analyser"}
                    </span>
                  </button>
                ) : null}
                <div className="ae-task-priority-controls" aria-label="Priorite de la tache">
                  {task.jarvisTask ? (
                    <>
                      <button
                        disabled={taskActionUpdatingId === task.id || task.jarvisTask.status === "done"}
                        onClick={() => void onCompleteSalesTask(task.id)}
                        type="button"
                      >
                        <CheckCircle2 size={14} />
                        <span>Done</span>
                      </button>
                      <button
                        disabled={taskActionUpdatingId === task.id || task.jarvisTask.status === "done" || task.jarvisTask.status === "skipped"}
                        onClick={() => void onSnoozeSalesTask(task.id)}
                        type="button"
                      >
                        <Clock size={14} />
                        <span>Snooze</span>
                      </button>
                      <button
                        disabled={taskActionUpdatingId === task.id || task.jarvisTask.status === "done" || task.jarvisTask.status === "skipped"}
                        onClick={() => void onSkipSalesTask(task.id)}
                        type="button"
                      >
                        <SkipForward size={14} />
                        <span>Skip</span>
                      </button>
                    </>
                  ) : (
                    <>
                      {taskPriorityOptions.map((priority) => (
                    <button
                      aria-pressed={task.priority === priority}
                      className={task.priority === priority ? "active" : ""}
                      disabled={priorityUpdatingId === task.id}
                      key={priority ?? "none"}
                      onClick={() => onPriorityChange(task.id, priority)}
                      type="button"
                    >
                      {priority === "high" ? <ArrowUp size={14} /> : null}
                      <span>{priority ? priorityLabels[priority] : "Aucune"}</span>
                    </button>
                      ))}
                    </>
                  )}
                </div>
              </article>
            ))}
            </div>
          ) : null}
        </section>
      ) : null;
    })}
    {!selectedOwnerId ? <p className="ae-empty">Selectionne un owner HubSpot pour charger ses taches.</p> : null}
    {selectedOwnerId && enrichedTasksCount === 0 && !isLoading ? (
      <p className="ae-empty">{usingSalesOperatingQueue ? "Aucune tache Jarvis ouverte." : "Aucune tache HubSpot ouverte."}</p>
    ) : null}
    {selectedOwnerId && enrichedTasksCount > 0 && filteredTaskCount === 0 ? (
      <p className="ae-empty">Aucune tache ne correspond aux filtres.</p>
    ) : null}
  </div>
);
