import { ArrowUp, Brain, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { QueueProspect } from "@jarvis/shared";
import {
  fetchHubSpotTasks,
  analyzeAndApplyHubSpotTask,
  updateHubSpotTaskPriority,
  type HubSpotLastUpdateItem,
  type HubSpotTaskListItem,
  type HubSpotTaskPriority,
  type TaskAnalysis,
  type TaskAnalyzerApplyResult,
  type TaskAnalysisRecommendation,
  type TaskAnalysisType,
} from "../../services/api";
import { formatDateTime } from "../../utils/dashboard/formatters";

type TasksViewProps = {
  hubspotPortalId?: string | null;
  lastUpdates: HubSpotLastUpdateItem[];
  orgId: string;
  prospects: QueueProspect[];
  selectedOwnerId?: string | null;
};

type EnrichedTask = HubSpotTaskListItem & {
  dealName: string | null;
  lastUpdate: HubSpotLastUpdateItem | null;
  sortScore: number;
};

type TaskDateBucket = "overdue" | "today" | "upcoming" | "noDueDate";
type TaskDateFilter = "all" | TaskDateBucket;
type TaskPriorityFilter = "all" | "none" | HubSpotTaskPriority;

type TaskSection = {
  id: TaskDateBucket;
  label: string;
  caption: string;
  tasks: EnrichedTask[];
};

type BatchProgress = {
  total: number;
  done: number;
  failed: number;
};

const TASK_BATCH_SIZE = 5;
const TASK_MAX_ATTEMPTS = 2;

const priorityLabels: Record<HubSpotTaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

const taskTypeLabels: Record<TaskAnalysisType, string> = {
  cold_call: "Cold call",
  deal_follow_up: "Follow-up deal",
  post_meeting_follow_up: "Post-meeting",
  no_show_recovery: "No-show",
  admin_crm: "Admin CRM",
  renewal_or_upsell: "Renewal / upsell",
  obsolete: "Obsolete",
  unknown: "Inconnu",
};

const recommendationLabels: Record<TaskAnalysisRecommendation, string> = {
  do_now: "Faire maintenant",
  reschedule: "Repositionner",
  keep_planned: "Garder",
  skip: "Ignorer",
  merge: "Fusionner",
  clarify: "Clarifier",
};

const taskPriorityOptions = [null, "high", "medium", "low"] as const satisfies ReadonlyArray<HubSpotTaskPriority | null>;

const priorityScore: Record<HubSpotTaskPriority, number> = {
  high: 300,
  medium: 200,
  low: 100,
};

const statusLabels: Record<HubSpotTaskListItem["status"], string> = {
  not_started: "A faire",
  in_progress: "En cours",
  waiting: "En attente",
  completed: "Terminee",
  deferred: "Reportee",
  unknown: "Statut inconnu",
};

const getDueTimeScore = (dueAt: string | null): number => {
  if (!dueAt) {
    return 0;
  }

  const daysUntilDue = Math.floor((new Date(dueAt).getTime() - Date.now()) / 86_400_000);

  if (daysUntilDue <= 0) {
    return 90;
  }

  if (daysUntilDue <= 2) {
    return 60;
  }

  if (daysUntilDue <= 7) {
    return 30;
  }

  return 0;
};

const getStartOfToday = (): Date => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);

  return date;
};

const getStartOfTomorrow = (): Date => {
  const date = getStartOfToday();
  date.setDate(date.getDate() + 1);

  return date;
};

const getTaskDateBucket = (dueAt: string | null): TaskDateBucket => {
  if (!dueAt) {
    return "noDueDate";
  }

  const dueTimestamp = new Date(dueAt).getTime();

  if (Number.isNaN(dueTimestamp)) {
    return "noDueDate";
  }

  if (dueTimestamp < getStartOfToday().getTime()) {
    return "overdue";
  }

  if (dueTimestamp < getStartOfTomorrow().getTime()) {
    return "today";
  }

  return "upcoming";
};

const getTaskDueLabel = (dueAt: string | null): string => {
  const bucket = getTaskDateBucket(dueAt);

  if (!dueAt || bucket === "noDueDate") {
    return "Pas d'echeance";
  }

  if (bucket === "overdue") {
    return `En retard · ${formatDateTime(dueAt)}`;
  }

  if (bucket === "today") {
    return `Aujourd'hui · ${formatDateTime(dueAt)}`;
  }

  return formatDateTime(dueAt);
};

const getTaskDealId = (task: HubSpotTaskListItem): string | null => task.associatedDealIds[0] ?? null;

const getHubSpotRecordUrl = (
  portalId: string | null | undefined,
  objectTypeId: "0-1" | "0-2" | "0-3" | "0-27",
  recordId: string | null | undefined,
): string | null => {
  const trimmedPortalId = portalId?.trim();
  const trimmedRecordId = recordId?.trim();

  if (!trimmedPortalId || !trimmedRecordId) {
    return null;
  }

  return `https://app.hubspot.com/contacts/${encodeURIComponent(trimmedPortalId)}/record/${objectTypeId}/${encodeURIComponent(trimmedRecordId)}`;
};

const getTaskAccountLabel = (task: HubSpotTaskListItem): string | null => {
  const parts = [task.companyName, task.contactName].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(" · ") : null;
};

const truncateTaskText = (value: string | null, maxLength = 220): string => {
  const normalizedValue = value?.replace(/\s+/g, " ").trim();

  if (!normalizedValue) {
    return "Tache HubSpot sans deal associe";
  }

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength).trim()}...`;
};

const formatTasksError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "Impossible de charger les taches HubSpot.";

  if (message === "Not Found" || message.includes("Cannot GET /api/hubspot/tasks")) {
    return "La route tasks n'est pas disponible sur l'API appelee. Deploie le backend ou pointe VITE_API_URL vers ton backend local.";
  }

  return message;
};

const wait = (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });

export const TasksView = ({ hubspotPortalId, lastUpdates, orgId, prospects, selectedOwnerId }: TasksViewProps) => {
  const [tasks, setTasks] = useState<HubSpotTaskListItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState<TaskDateFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriorityFilter>("all");
  const [isLoading, setIsLoading] = useState(false);
  const [priorityUpdatingId, setPriorityUpdatingId] = useState<string | null>(null);
  const [analysisLoadingId, setAnalysisLoadingId] = useState<string | null>(null);
  const [analysisApplyingId, setAnalysisApplyingId] = useState<string | null>(null);
  const [processingTaskIds, setProcessingTaskIds] = useState<Record<string, boolean>>({});
  const [analysisByTaskId, setAnalysisByTaskId] = useState<Record<string, TaskAnalysis>>({});
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [taskActionMessage, setTaskActionMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadTasksInFlightRef = useRef(false);

  const loadTasks = async () => {
    if (!selectedOwnerId) {
      setTasks([]);
      return;
    }

    if (loadTasksInFlightRef.current || analysisLoadingId || analysisApplyingId) {
      return;
    }

    try {
      loadTasksInFlightRef.current = true;
      setIsLoading(true);
      setError(null);
      const hubspotTasks = await fetchHubSpotTasks(orgId, selectedOwnerId);
      setTasks(hubspotTasks);
    } catch (loadError) {
      setError(formatTasksError(loadError));
    } finally {
      loadTasksInFlightRef.current = false;
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadTasks();

    const intervalId = window.setInterval(() => {
      void loadTasks();
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, [analysisApplyingId, analysisLoadingId, orgId, selectedOwnerId]);

  const dealLabelById = useMemo(() => {
    const labels = new Map<string, string>();

    for (const prospect of prospects) {
      if (prospect.hubspotDealId) {
        labels.set(prospect.hubspotDealId, prospect.dealName ?? prospect.company);
      }
    }

    for (const update of lastUpdates) {
      labels.set(update.hubspotDealId, update.dealName ?? update.companyName ?? `Deal ${update.hubspotDealId}`);
    }

    return labels;
  }, [lastUpdates, prospects]);

  const updateByDealId = useMemo(
    () => new Map(lastUpdates.map((update) => [update.hubspotDealId, update])),
    [lastUpdates],
  );

  const enrichedTasks = useMemo<EnrichedTask[]>(
    () =>
      tasks
        .map((task) => {
          const dealId = getTaskDealId(task);
          const lastUpdate = dealId ? updateByDealId.get(dealId) ?? null : null;
          const updateScore = lastUpdate ? Math.max(0, 120 - Math.floor((Date.now() - new Date(lastUpdate.receivedAt).getTime()) / 3_600_000)) : 0;

          return {
            ...task,
            dealName: task.dealName ?? (dealId ? dealLabelById.get(dealId) ?? `Deal ${dealId}` : null),
            lastUpdate,
            sortScore: priorityScore[task.priority ?? "low"] + getDueTimeScore(task.dueAt) + updateScore,
          };
        })
        .sort((left, right) => {
          if (right.sortScore !== left.sortScore) {
            return right.sortScore - left.sortScore;
          }

          return new Date(left.dueAt ?? "9999-12-31").getTime() - new Date(right.dueAt ?? "9999-12-31").getTime();
        }),
    [dealLabelById, tasks, updateByDealId],
  );

  const overdueTasks = useMemo(
    () => enrichedTasks.filter((task) => getTaskDateBucket(task.dueAt) === "overdue"),
    [enrichedTasks],
  );

  const taskSections = useMemo<TaskSection[]>(() => {
    const sections: TaskSection[] = [
      {
        id: "overdue",
        label: "En retard",
        caption: "A traiter en premier",
        tasks: [],
      },
      {
        id: "today",
        label: "Aujourd'hui",
        caption: "A faire avant la fin de journee",
        tasks: [],
      },
      {
        id: "upcoming",
        label: "A venir",
        caption: "Planifiees plus tard",
        tasks: [],
      },
      {
        id: "noDueDate",
        label: "Sans echeance",
        caption: "A requalifier dans HubSpot",
        tasks: [],
      },
    ];
    const sectionById = new Map(sections.map((section) => [section.id, section]));

    const normalizedSearchTerm = searchTerm.trim().toLowerCase();
    const filteredTasks = enrichedTasks.filter((task) => {
      const taskBucket = getTaskDateBucket(task.dueAt);
      const matchesDate = dateFilter === "all" || taskBucket === dateFilter;
      const matchesPriority =
        priorityFilter === "all" ||
        (priorityFilter === "none" ? task.priority === null : task.priority === priorityFilter);
      const matchesSearch =
        !normalizedSearchTerm ||
        [task.title, task.body, task.dealName]
          .concat([task.companyName, task.contactName, task.contactEmail])
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase().includes(normalizedSearchTerm));

      return matchesDate && matchesPriority && matchesSearch;
    });

    for (const task of filteredTasks) {
      sectionById.get(getTaskDateBucket(task.dueAt))?.tasks.push(task);
    }

    return sections;
  }, [dateFilter, enrichedTasks, priorityFilter, searchTerm]);

  const filteredTaskCount = taskSections.reduce((count, section) => count + section.tasks.length, 0);

  const handlePriorityChange = async (taskId: string, priority: HubSpotTaskPriority | null) => {
    try {
      setPriorityUpdatingId(taskId);
      setError(null);
      const updatedTask = await updateHubSpotTaskPriority(orgId, taskId, priority);
      setTasks((currentTasks) => currentTasks.map((task) => (task.id === taskId ? updatedTask : task)));
    } catch (updateError) {
      setError(formatTasksError(updateError));
    } finally {
      setPriorityUpdatingId(null);
    }
  };

  const applyTaskResultToState = (taskId: string, result: TaskAnalyzerApplyResult): void => {
    setAnalysisByTaskId((current) => ({
      ...current,
      [taskId]: result.analysis,
    }));

    if (result.action === "completed") {
      setTasks((currentTasks) => currentTasks.filter((task) => task.id !== taskId));
    }

    if (result.action === "rescheduled") {
      setTasks((currentTasks) => [
        ...(result.createdTask ? [result.createdTask] : []),
        ...currentTasks.filter((task) => task.id !== taskId),
      ]);
    }
  };

  const runTaskAnalysisWithRetry = async (taskId: string, refresh = false): Promise<TaskAnalyzerApplyResult> => {
    let lastError: unknown = null;

    setProcessingTaskIds((current) => ({
      ...current,
      [taskId]: true,
    }));

    try {
      for (let attempt = 1; attempt <= TASK_MAX_ATTEMPTS; attempt += 1) {
        try {
          const result = await analyzeAndApplyHubSpotTask(orgId, taskId, refresh);
          applyTaskResultToState(taskId, result);

          return result;
        } catch (taskError) {
          lastError = taskError;

          if (attempt < TASK_MAX_ATTEMPTS) {
            await wait(600 * attempt);
          }
        }
      }
    } finally {
      setProcessingTaskIds((current) => {
        const next = { ...current };
        delete next[taskId];

        return next;
      });
    }

    throw lastError instanceof Error ? lastError : new Error("Analyse de tache echouee.");
  };

  const handleAnalyzeTask = async (taskId: string, refresh = false) => {
    try {
      setAnalysisLoadingId(taskId);
      setError(null);
      setTaskActionMessage(null);
      const result = await runTaskAnalysisWithRetry(taskId, refresh);
      setTaskActionMessage(result.message);
    } catch (analysisError) {
      setError(formatTasksError(analysisError));
    } finally {
      setAnalysisLoadingId(null);
      setAnalysisApplyingId(null);
    }
  };

  const handleProcessOverdueTasks = async () => {
    const taskIds = overdueTasks.map((task) => task.id);

    if (taskIds.length === 0) {
      return;
    }

    setBatchProgress({
      total: taskIds.length,
      done: 0,
      failed: 0,
    });
    setError(null);
    setTaskActionMessage(null);

    let done = 0;
    let failed = 0;

    for (let index = 0; index < taskIds.length; index += TASK_BATCH_SIZE) {
      const batch = taskIds.slice(index, index + TASK_BATCH_SIZE);
      const results = await Promise.allSettled(batch.map((taskId) => runTaskAnalysisWithRetry(taskId, true)));

      done += results.filter((result) => result.status === "fulfilled").length;
      failed += results.filter((result) => result.status === "rejected").length;
      setBatchProgress({
        total: taskIds.length,
        done,
        failed,
      });
    }

    setTaskActionMessage(`${done} tache(s) en retard traitee(s), ${failed} echec(s).`);

    if (failed > 0) {
      setError(`${failed} tache(s) n'ont pas pu etre traitees apres retry.`);
    }
  };

  const batchIsRunning = batchProgress !== null && batchProgress.done + batchProgress.failed < batchProgress.total;

  return (
    <section className="ae-view-panel" aria-label="Taches HubSpot">
      <div className="ae-view-title ae-task-titlebar">
        <div>
          <p className="ae-eyebrow">Taches</p>
          <h2>Actions HubSpot live</h2>
        </div>
        <button className="ae-icon-action" disabled={isLoading || !selectedOwnerId} onClick={loadTasks} type="button">
          <RefreshCw size={16} />
          <span>{isLoading ? "Refresh..." : "Refresh"}</span>
        </button>
      </div>

      <div className="ae-task-bulkbar">
        <button
          disabled={!selectedOwnerId || overdueTasks.length === 0 || batchIsRunning}
          onClick={handleProcessOverdueTasks}
          type="button"
        >
          <Brain size={15} />
          <span>
            {batchIsRunning
              ? `Traitement ${batchProgress.done + batchProgress.failed}/${batchProgress.total}`
              : `Traiter ${overdueTasks.length} en retard`}
          </span>
        </button>
        {batchProgress ? (
          <small>
            Batchs de {TASK_BATCH_SIZE} · {batchProgress.done} reussie(s) · {batchProgress.failed} echec(s)
          </small>
        ) : null}
      </div>

      {error ? <p className="ae-admin-error">{error}</p> : null}
      {taskActionMessage ? <p className="ae-admin-success">{taskActionMessage}</p> : null}

      <div className="ae-task-filters" aria-label="Filtres des taches">
        <label className="ae-task-search">
          <Search size={15} />
          <input
            aria-label="Rechercher une tache"
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Rechercher par titre, deal ou contenu"
            value={searchTerm}
          />
        </label>
        <select
          aria-label="Filtrer par periode"
          onChange={(event) => setDateFilter(event.target.value as TaskDateFilter)}
          value={dateFilter}
        >
          <option value="all">Toutes les periodes</option>
          <option value="overdue">En retard</option>
          <option value="today">Aujourd'hui</option>
          <option value="upcoming">A venir</option>
          <option value="noDueDate">Sans echeance</option>
        </select>
        <select
          aria-label="Filtrer par priorite"
          onChange={(event) => setPriorityFilter(event.target.value as TaskPriorityFilter)}
          value={priorityFilter}
        >
          <option value="all">Toutes les priorites</option>
          <option value="none">Sans priorite</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <strong>{filteredTaskCount} / {enrichedTasks.length}</strong>
      </div>

      <div className="ae-task-list">
        {taskSections.map((section) =>
          section.tasks.length > 0 ? (
            <section className={`ae-task-section ${section.id}`} key={section.id} aria-label={section.label}>
              <div className="ae-task-section-heading">
                <div>
                  <h3>{section.label}</h3>
                  <span>{section.caption}</span>
                </div>
                <strong>{section.tasks.length}</strong>
              </div>
              <div className="ae-task-section-list">
                {section.tasks.map((task) => (
                  <article className="ae-task-item ae-hubspot-task-item" key={task.id}>
                    <div>
                      <strong>
                        {getHubSpotRecordUrl(hubspotPortalId, "0-27", task.id) ? (
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
                      ) : null}
                      <span title={task.dealName ?? task.body ?? undefined}>
                        {task.dealName ?? truncateTaskText(task.body)}
                      </span>
                      <small>
                        {statusLabels[task.status]} · {getTaskDueLabel(task.dueAt)}
                        {task.lastUpdate ? ` · Last update: ${task.lastUpdate.reason ?? "Webhook HubSpot"}` : ""}
                      </small>
                      {analysisByTaskId[task.id] ? (
                        <div className="ae-task-analysis">
                          <strong>
                            {taskTypeLabels[analysisByTaskId[task.id].taskType]} ·{" "}
                            {recommendationLabels[analysisByTaskId[task.id].recommendation]} ·{" "}
                            {priorityLabels[analysisByTaskId[task.id].priority]}
                          </strong>
                          <span>{analysisByTaskId[task.id].suggestedAction}</span>
                          <small>
                            {analysisByTaskId[task.id].rationale}
                            {analysisByTaskId[task.id].shouldReschedule &&
                            analysisByTaskId[task.id].suggestedDueInDays !== null
                              ? ` · Replanifier J+${analysisByTaskId[task.id].suggestedDueInDays}`
                              : ""}
                          </small>
                        </div>
                      ) : null}
                    </div>
                    <div className="ae-task-priority-controls" aria-label="Priorite de la tache">
                      <button
                        disabled={analysisLoadingId === task.id || analysisApplyingId === task.id || processingTaskIds[task.id]}
                        onClick={() => handleAnalyzeTask(task.id, Boolean(analysisByTaskId[task.id]))}
                        type="button"
                      >
                        <Brain size={14} />
                        <span>
                          {analysisApplyingId === task.id
                            ? "Action..."
                            : analysisLoadingId === task.id || processingTaskIds[task.id]
                              ? "Analyse..."
                              : "Analyser"}
                        </span>
                      </button>
                      {taskPriorityOptions.map((priority) => (
                        <button
                          aria-pressed={task.priority === priority}
                          className={task.priority === priority ? "active" : ""}
                          disabled={priorityUpdatingId === task.id}
                          key={priority ?? "none"}
                          onClick={() => handlePriorityChange(task.id, priority)}
                          type="button"
                        >
                          {priority === "high" ? <ArrowUp size={14} /> : null}
                          <span>{priority ? priorityLabels[priority] : "Aucune"}</span>
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null,
        )}
        {selectedOwnerId && enrichedTasks.length > 0 ? (
          <div className="ae-task-summary" aria-label="Resume des taches">
            <span>{taskSections.find((section) => section.id === "overdue")?.tasks.length ?? 0} en retard</span>
            <span>{taskSections.find((section) => section.id === "today")?.tasks.length ?? 0} aujourd'hui</span>
            <span>{taskSections.find((section) => section.id === "upcoming")?.tasks.length ?? 0} a venir</span>
          </div>
        ) : null}
        {!selectedOwnerId ? <p className="ae-empty">Selectionne un owner HubSpot pour charger ses taches.</p> : null}
        {selectedOwnerId && enrichedTasks.length === 0 && !isLoading ? (
          <p className="ae-empty">Aucune tache HubSpot ouverte.</p>
        ) : null}
        {selectedOwnerId && enrichedTasks.length > 0 && filteredTaskCount === 0 ? (
          <p className="ae-empty">Aucune tache ne correspond aux filtres.</p>
        ) : null}
      </div>
    </section>
  );
};
