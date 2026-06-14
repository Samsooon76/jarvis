import {
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock,
  ListTodo,
  RefreshCw,
  SkipForward,
  Sparkles,
} from "lucide-react";
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

const getUrgencyMetaClass = (bucket: ReturnType<typeof getTaskDateBucket>): string => {
  if (bucket === "overdue") {
    return "jv-meta-risk";
  }

  if (bucket === "today") {
    return "jv-meta-pending";
  }

  if (bucket === "upcoming") {
    return "jv-meta-ok";
  }

  return "";
};

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
  selectedTaskId?: string | null;
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
  selectedTaskId,
  taskActionUpdatingId,
  taskSections,
  usingSalesOperatingQueue,
}: TaskSectionListProps) => {
  const visibleSections = taskSections.filter((section) => section.tasks.length > 0);

  return (
    <section className="jv-list-shell" aria-busy={isLoading} aria-label="Liste des tâches">
      <header className="jv-list-head">
        <span className="jv-section-label">
          <ListTodo aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
          Tâches groupées
        </span>
        <span className="jv-list-count">
          {filteredTaskCount} résultat{filteredTaskCount > 1 ? "s" : ""}
        </span>
      </header>

      <div className="jv-list-body">
        {isLoading && enrichedTasksCount === 0 ? (
          <p className="jv-list-empty">Chargement des tâches…</p>
        ) : null}

        {!selectedOwnerId ? (
          <p className="jv-list-empty">Sélectionnez un owner HubSpot pour charger ses tâches.</p>
        ) : null}

        {selectedOwnerId && enrichedTasksCount === 0 && !isLoading ? (
          <p className="jv-list-empty">
            {usingSalesOperatingQueue ? "Aucune tâche Jarvis ouverte." : "Aucune tâche HubSpot ouverte."}
          </p>
        ) : null}

        {selectedOwnerId && enrichedTasksCount > 0 && filteredTaskCount === 0 ? (
          <p className="jv-list-empty">Aucune tâche ne correspond aux filtres.</p>
        ) : null}

        {visibleSections.map((section) => {
          const isCollapsed = Boolean(collapsedSections[section.id]);

          return (
            <div
              className={`jv-task-group jv-task-group-${section.id}${isCollapsed ? " collapsed" : ""}`}
              key={section.id}
            >
              <button
                aria-expanded={!isCollapsed}
                className="jv-task-group-head"
                onClick={() => onToggleSection(section.id)}
                type="button"
              >
                <div>
                  <h3>{section.label}</h3>
                  <span>{section.caption}</span>
                </div>
                <strong>{section.tasks.length}</strong>
                <ChevronDown aria-hidden="true" size={16} strokeWidth={1.5} />
              </button>

              {!isCollapsed ? (
                <div>
                  {section.tasks.map((task) => {
                    const urgencyBucket = getTaskDateBucket(task.dueAt);
                    const urgencyClass = getUrgencyMetaClass(urgencyBucket);
                    const isSelected = selectedTaskId === task.id;

                    return (
                      <article
                        className={isSelected ? "jv-task-item selected" : "jv-task-item"}
                        key={task.id}
                      >
                        <div className="jv-task-item-main">
                          <div
                            aria-hidden="true"
                            className={`jv-task-priority-dot priority-${task.priority ?? "none"}`}
                          >
                            <CircleDot size={14} strokeWidth={1.5} />
                          </div>

                          <div className="jv-task-item-content">
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
                            <small>
                              {getTaskAccountLabel(task) ? (
                                <>
                                  {task.associatedCompanyIds[0] && task.companyName ? (
                                    <a
                                      href={
                                        getHubSpotRecordUrl(hubspotPortalId, "0-2", task.associatedCompanyIds[0]) ??
                                        undefined
                                      }
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
                                      href={
                                        getHubSpotRecordUrl(hubspotPortalId, "0-1", task.associatedContactIds[0]) ??
                                        undefined
                                      }
                                      rel="noreferrer"
                                      target="_blank"
                                    >
                                      {task.contactName}
                                    </a>
                                  ) : (
                                    task.contactName
                                  )}
                                </>
                              ) : (
                                task.dealName ?? formatTaskText(task.body)
                              )}
                            </small>
                            <span className="jv-item-meta">
                              {task.priority ? (
                                <span className={task.priority === "high" ? "jv-meta-risk" : "jv-meta-pending"}>
                                  {priorityLabels[task.priority]}
                                </span>
                              ) : null}
                              <span className={urgencyClass || undefined}>
                                {taskUrgencyLabels[urgencyBucket]}
                              </span>
                              {getTaskDurationLabel(task) ? <span>{getTaskDurationLabel(task)}</span> : null}
                            </span>
                          </div>

                          <div className="jv-task-item-side">
                            <time className={urgencyClass || undefined}>{getTaskDueShortLabel(task.dueAt)}</time>
                            {task.jarvisTask ? <small>{task.jarvisTask.reason}</small> : null}
                            {!task.jarvisTask && task.lastUpdate ? (
                              <small>{task.lastUpdate.reason ?? "Webhook HubSpot"}</small>
                            ) : null}
                            <span className="jv-task-owner" title={statusLabels[task.status]}>
                              {getTaskOwnerInitials(task)}
                            </span>
                          </div>
                        </div>

                        <div className="jv-task-actions" aria-label="Actions de la tâche">
                          {!task.jarvisTask ? (
                            <button
                              className="jv-btn-ghost"
                              disabled={
                                analysisLoadingId === task.id ||
                                analysisApplyingId === task.id ||
                                processingTaskIds[task.id]
                              }
                              onClick={() => onAnalyzeTask(task.id, Boolean(analysisByTaskId[task.id]))}
                              type="button"
                            >
                              {analysisLoadingId === task.id || processingTaskIds[task.id] ? (
                                <RefreshCw className="jv-spin" size={13} strokeWidth={1.5} />
                              ) : (
                                <Sparkles size={13} strokeWidth={1.5} />
                              )}
                              <span>
                                {analysisApplyingId === task.id
                                  ? "Action…"
                                  : analysisLoadingId === task.id || processingTaskIds[task.id]
                                    ? "Analyse…"
                                    : "Analyser"}
                              </span>
                            </button>
                          ) : null}

                          {task.jarvisTask ? (
                            <>
                              <button
                                disabled={taskActionUpdatingId === task.id || task.jarvisTask.status === "done"}
                                onClick={() => void onCompleteSalesTask(task.id)}
                                type="button"
                              >
                                <CheckCircle2 size={14} strokeWidth={1.5} />
                                <span>Done</span>
                              </button>
                              <button
                                disabled={
                                  taskActionUpdatingId === task.id ||
                                  task.jarvisTask.status === "done" ||
                                  task.jarvisTask.status === "skipped"
                                }
                                onClick={() => void onSnoozeSalesTask(task.id)}
                                type="button"
                              >
                                <Clock size={14} strokeWidth={1.5} />
                                <span>Snooze</span>
                              </button>
                              <button
                                disabled={
                                  taskActionUpdatingId === task.id ||
                                  task.jarvisTask.status === "done" ||
                                  task.jarvisTask.status === "skipped"
                                }
                                onClick={() => void onSkipSalesTask(task.id)}
                                type="button"
                              >
                                <SkipForward size={14} strokeWidth={1.5} />
                                <span>Skip</span>
                              </button>
                            </>
                          ) : (
                            taskPriorityOptions.map((priority) => (
                              <button
                                aria-pressed={task.priority === priority}
                                className={task.priority === priority ? "active" : ""}
                                disabled={priorityUpdatingId === task.id}
                                key={priority ?? "none"}
                                onClick={() => onPriorityChange(task.id, priority)}
                                type="button"
                              >
                                {priority === "high" ? <ArrowUp size={14} strokeWidth={1.5} /> : null}
                                <span>{priority ? priorityLabels[priority] : "Aucune"}</span>
                              </button>
                            ))
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
};