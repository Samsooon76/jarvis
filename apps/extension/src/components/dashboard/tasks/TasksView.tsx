import { AlertTriangle, ListTodo, Users, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { QueueProspect } from "@jarvis/shared";
import {
  fetchHubSpotTasks,
  fetchSalesTasksToday,
  analyzeAndApplyHubSpotTask,
  completeSalesTask,
  skipSalesTask,
  snoozeSalesTask,
  updateHubSpotTaskPriority,
  type HubSpotLastUpdateItem,
  type HubSpotOwnerOption,
  type HubSpotTaskListItem,
  type HubSpotTaskPriority,
  type SalesTaskListItem,
  type TaskAnalysis,
  type TaskAnalyzerApplyResult,
} from "../../../services/api";
import {
  TASK_BATCH_SIZE,
  TASK_MAX_ATTEMPTS,
  formatTasksError,
  getDueTimeScore,
  getInitialsFromLabel,
  getOverdueOpenTaskIds,
  getOwnerInitials,
  getTaskAccountLabel,
  getTaskDateBucket,
  getTaskDealId,
  getTaskSectionId,
  isDocumentVisible,
  isJarvisUserId,
  isLegacyNoopApplyResult,
  isOpenTask,
  mapSalesTaskToDisplayTask,
  priorityScore,
  readCachedTasks,
  wait,
  writeCachedTasks,
  type BatchProgress,
  type DisplayTask,
  type EnrichedTask,
  type OwnerWorkloadItem,
  type TaskDateFilter,
  type TaskSection,
  type TaskSectionId,
} from "../../../utils/dashboard/tasks";
import "../../styles/tasks.css";
import { TaskDigestSidebar, type SelectedTaskAnalysis } from "./TaskDigestSidebar";
import { TaskFiltersBar } from "./TaskFiltersBar";
import { TaskMetrics } from "./TaskMetrics";
import { TaskSectionList } from "./TaskSectionList";

const SectionLabel = ({ children, icon: Icon }: { children: string; icon: LucideIcon }) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

const ThemeBlock = ({
  empty,
  icon,
  items,
  title,
}: {
  empty: string;
  icon: LucideIcon;
  items: Array<{ label: string; count: number }>;
  title: string;
}) => (
  <div className="jv-theme-block">
    <SectionLabel icon={icon}>{title}</SectionLabel>
    {items.length > 0 ? (
      <ul className="jv-theme-list">
        {items.slice(0, 5).map((item) => (
          <li key={item.label}>
            <span>{item.label}</span>
            <em>{item.count}</em>
          </li>
        ))}
      </ul>
    ) : (
      <p className="jv-theme-empty">{empty}</p>
    )}
  </div>
);

type TasksViewProps = {
  hubspotPortalId?: string | null;
  lastUpdates: HubSpotLastUpdateItem[];
  onOwnerChange?: (ownerId: string) => void;
  orgId: string;
  owners?: HubSpotOwnerOption[];
  prospects: QueueProspect[];
  selectedOwnerId?: string | null;
};

export const TasksView = ({
  hubspotPortalId,
  lastUpdates,
  onOwnerChange,
  orgId,
  owners = [],
  prospects,
  selectedOwnerId,
}: TasksViewProps) => {
  const [tasks, setTasks] = useState<DisplayTask[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState<TaskDateFilter>("all");
  const [isLoading, setIsLoading] = useState(false);
  const [priorityUpdatingId, setPriorityUpdatingId] = useState<string | null>(null);
  const [taskActionUpdatingId, setTaskActionUpdatingId] = useState<string | null>(null);
  const [analysisLoadingId, setAnalysisLoadingId] = useState<string | null>(null);
  const [analysisApplyingId, setAnalysisApplyingId] = useState<string | null>(null);
  const [processingTaskIds, setProcessingTaskIds] = useState<Record<string, boolean>>({});
  const [analysisByTaskId, setAnalysisByTaskId] = useState<Record<string, TaskAnalysis>>({});
  const [selectedTaskAnalysis, setSelectedTaskAnalysis] = useState<SelectedTaskAnalysis | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Partial<Record<TaskSectionId, boolean>>>({});
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [taskActionMessage, setTaskActionMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadTasksInFlightRef = useRef(false);
  const displayedOwnerIdRef = useRef<string | null>(null);
  const tasksRef = useRef<DisplayTask[]>([]);
  const ownerById = useMemo(() => new Map(owners.map((owner) => [owner.ownerId, owner])), [owners]);
  const selectedOwner = selectedOwnerId ? ownerById.get(selectedOwnerId) ?? null : null;
  const selectedOwnerUserId = isJarvisUserId(selectedOwner?.userId) ? selectedOwner.userId : null;
  const selectedOwnerName = selectedOwnerId ? selectedOwner?.name ?? "Owner actif" : "Tous les reps";
  const usingSalesOperatingQueue = Boolean(selectedOwnerUserId);

  const commitTasks = (nextTasks: DisplayTask[]): void => {
    tasksRef.current = nextTasks;
    setTasks(nextTasks);
  };

  const fetchAndCommitTasks = async (ownerId: string): Promise<DisplayTask[]> => {
    const owner = ownerById.get(ownerId);
    const localUserId = isJarvisUserId(owner?.userId) ? owner.userId : null;
    let nextTasks: DisplayTask[];

    if (localUserId) {
      try {
        const salesTasks = (await fetchSalesTasksToday(localUserId)).tasks.map((task) =>
          mapSalesTaskToDisplayTask(task, ownerId),
        );
        nextTasks = salesTasks.length > 0 ? salesTasks : await fetchHubSpotTasks(orgId, ownerId);
      } catch {
        nextTasks = await fetchHubSpotTasks(orgId, ownerId);
      }
    } else {
      nextTasks = await fetchHubSpotTasks(orgId, ownerId);
    }

    commitTasks(nextTasks);
    displayedOwnerIdRef.current = ownerId;
    writeCachedTasks(orgId, ownerId, nextTasks);

    return nextTasks;
  };

  const loadTasks = async () => {
    if (!selectedOwnerId) {
      commitTasks([]);
      displayedOwnerIdRef.current = null;
      return;
    }

    if (loadTasksInFlightRef.current || analysisLoadingId || analysisApplyingId) {
      return;
    }

    try {
      loadTasksInFlightRef.current = true;
      const cachedTasks = readCachedTasks(orgId, selectedOwnerId);

      if (cachedTasks && (tasks.length === 0 || displayedOwnerIdRef.current !== selectedOwnerId)) {
        commitTasks(cachedTasks);
        displayedOwnerIdRef.current = selectedOwnerId;
      } else if (!cachedTasks && displayedOwnerIdRef.current && displayedOwnerIdRef.current !== selectedOwnerId) {
        commitTasks([]);
      }

      setIsLoading(!cachedTasks);
      setError(null);
      await fetchAndCommitTasks(selectedOwnerId);
    } catch (loadError) {
      setError(formatTasksError(loadError));
    } finally {
      loadTasksInFlightRef.current = false;
      setIsLoading(false);
    }
  };

  // Keep a stable reference to the latest loadTasks so the polling interval
  // always runs the freshest closure without being torn down/recreated every
  // time an unrelated dependency (analysis state, owner map) changes.
  const loadTasksRef = useRef(loadTasks);
  loadTasksRef.current = loadTasks;

  useEffect(() => {
    void loadTasksRef.current();

    const intervalId = window.setInterval(() => {
      if (!isDocumentVisible()) {
        return;
      }

      void loadTasksRef.current();
    }, 30_000);

    return () => window.clearInterval(intervalId);
  }, [orgId, selectedOwnerId]);

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
  const getTaskOwnerInitials = (task: HubSpotTaskListItem): string => {
    const ownerName = task.ownerHubSpotId ? ownerById.get(task.ownerHubSpotId)?.name : null;

    if (ownerName) {
      return getInitialsFromLabel(ownerName);
    }

    if (selectedOwnerId && task.ownerHubSpotId === selectedOwnerId) {
      return getInitialsFromLabel(selectedOwnerName);
    }

    return getOwnerInitials(task.ownerHubSpotId, task);
  };

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
    () => enrichedTasks.filter((task) => isOpenTask(task) && getTaskDateBucket(task.dueAt) === "overdue"),
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
        label: "Cette semaine",
        caption: "Taches planifiees",
        tasks: [],
      },
      {
        id: "later",
        label: "Plus tard",
        caption: "Apres cette semaine",
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
      const taskSectionId = getTaskSectionId(task);
      const matchesDate =
        dateFilter === "all" ||
        taskSectionId === dateFilter;
      const matchesSearch =
        !normalizedSearchTerm ||
        [task.title, task.body, task.dealName]
          .concat([task.companyName, task.contactName, task.contactEmail])
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase().includes(normalizedSearchTerm));

      return matchesDate && matchesSearch;
    });

    for (const task of filteredTasks) {
      sectionById.get(getTaskSectionId(task))?.tasks.push(task);
    }

    return sections;
  }, [dateFilter, enrichedTasks, searchTerm]);

  const filteredTaskCount = taskSections.reduce((count, section) => count + section.tasks.length, 0);
  const openTasks = enrichedTasks.filter(isOpenTask);
  const todayTaskCount = openTasks.filter((task) => getTaskDateBucket(task.dueAt) === "today").length;
  const overdueTaskCount = overdueTasks.length;
  const completedTaskCount = tasks.filter((task) => !isOpenTask(task)).length;
  const batchIsRunning = batchProgress !== null && batchProgress.done + batchProgress.failed < batchProgress.total;
  const analyzeButtonLabel = batchIsRunning
    ? `${batchProgress.done + batchProgress.failed}/${batchProgress.total}`
    : overdueTaskCount === 0
      ? "A jour"
      : "Analyser";
  const urgentTask = overdueTasks[0] ?? taskSections.find((section) => section.id === "today")?.tasks[0] ?? null;
  const nextTask = taskSections.find((section) => section.id === "today")?.tasks[1] ?? taskSections.find((section) => section.id === "upcoming")?.tasks[0] ?? null;

  useEffect(() => {
    if (overdueTaskCount !== 0 || batchProgress === null) {
      return;
    }

    setBatchProgress(null);
    setError(null);
    setTaskActionMessage("Toutes les taches en retard sont traitees.");
  }, [batchProgress, overdueTaskCount]);

  const ownerWorkload = useMemo<OwnerWorkloadItem[]>(() => {
    const workloadByOwner = new Map<string, OwnerWorkloadItem>();

    for (const task of openTasks) {
      const ownerId = task.ownerHubSpotId ?? "unassigned";
      const existingItem = workloadByOwner.get(ownerId);

      if (existingItem) {
        existingItem.taskCount += 1;
        existingItem.overdueCount += getTaskDateBucket(task.dueAt) === "overdue" ? 1 : 0;
        continue;
      }

      const owner = ownerById.get(ownerId);
      const initials = owner ? getInitialsFromLabel(owner.name) : getOwnerInitials(task.ownerHubSpotId, task);
      const label =
        owner?.name ??
        (selectedOwnerId && ownerId === selectedOwnerId
          ? selectedOwnerName
          : ownerId === "unassigned"
            ? "Non assigne"
            : `Owner ${initials}`);

      workloadByOwner.set(ownerId, {
        id: ownerId,
        initials,
        label,
        overdueCount: getTaskDateBucket(task.dueAt) === "overdue" ? 1 : 0,
        taskCount: 1,
      });
    }

    return Array.from(workloadByOwner.values())
      .sort((left, right) => right.taskCount - left.taskCount)
      .slice(0, 4);
  }, [openTasks, ownerById, selectedOwnerId, selectedOwnerName]);

  const blockingThemes = useMemo(
    () =>
      overdueTasks.slice(0, 5).map((task) => ({
        label: task.dealName ?? task.companyName ?? task.title,
        count: 1,
      })),
    [overdueTasks],
  );

  const teamReminderThemes = useMemo(
    () =>
      ownerWorkload.slice(0, 5).map((owner) => ({
        label: owner.label,
        count: owner.taskCount,
      })),
    [ownerWorkload],
  );

  const applySalesTaskToState = (salesTask: SalesTaskListItem): void => {
    const displayTask = mapSalesTaskToDisplayTask(salesTask, selectedOwnerId);

    setTasks((currentTasks) => {
      const nextTasks = currentTasks.map((task) => (task.id === salesTask.id ? displayTask : task));
      tasksRef.current = nextTasks;

      if (selectedOwnerId) {
        writeCachedTasks(orgId, selectedOwnerId, nextTasks);
      }

      return nextTasks;
    });
  };

  const handleCompleteSalesTask = async (taskId: string): Promise<void> => {
    try {
      setTaskActionUpdatingId(taskId);
      setError(null);
      const updatedTask = await completeSalesTask(taskId);
      applySalesTaskToState(updatedTask);
      setTaskActionMessage("Tache terminee.");
    } catch (actionError) {
      setError(formatTasksError(actionError));
    } finally {
      setTaskActionUpdatingId(null);
    }
  };

  const handleSnoozeSalesTask = async (taskId: string): Promise<void> => {
    const snoozedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    try {
      setTaskActionUpdatingId(taskId);
      setError(null);
      const updatedTask = await snoozeSalesTask(taskId, snoozedUntil);
      applySalesTaskToState(updatedTask);
      setTaskActionMessage("Tache snoozee.");
    } catch (actionError) {
      setError(formatTasksError(actionError));
    } finally {
      setTaskActionUpdatingId(null);
    }
  };

  const handleSkipSalesTask = async (taskId: string): Promise<void> => {
    try {
      setTaskActionUpdatingId(taskId);
      setError(null);
      const updatedTask = await skipSalesTask(taskId);
      applySalesTaskToState(updatedTask);
      setTaskActionMessage("Tache ignoree.");
    } catch (actionError) {
      setError(formatTasksError(actionError));
    } finally {
      setTaskActionUpdatingId(null);
    }
  };

  const handlePriorityChange = async (taskId: string, priority: HubSpotTaskPriority | null) => {
    try {
      setPriorityUpdatingId(taskId);
      setError(null);
      const updatedTask = await updateHubSpotTaskPriority(orgId, taskId, priority);
      setTasks((currentTasks) => {
        const nextTasks = currentTasks.map((task) => (task.id === taskId ? updatedTask : task));
        tasksRef.current = nextTasks;

        if (selectedOwnerId) {
          writeCachedTasks(orgId, selectedOwnerId, nextTasks);
        }

        return nextTasks;
      });
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

    const completedTaskIds = new Set(result.completedTaskIds ?? (result.completedTask ? [taskId] : []));

    if (completedTaskIds.size > 0) {
      setTasks((currentTasks) => {
        const nextTasks = currentTasks.filter((task) => !completedTaskIds.has(task.id));
        tasksRef.current = nextTasks;

        if (selectedOwnerId) {
          writeCachedTasks(orgId, selectedOwnerId, nextTasks);
        }

        return nextTasks;
      });
    }

    const createdTask = result.createdTask ?? result.retainedTask ?? null;

    if (createdTask) {
      setTasks((currentTasks) => {
        const nextTasks = [
          createdTask,
          ...currentTasks.filter((task) => task.id !== taskId && task.id !== createdTask.id),
        ];
        tasksRef.current = nextTasks;

        if (selectedOwnerId) {
          writeCachedTasks(orgId, selectedOwnerId, nextTasks);
        }

        return nextTasks;
      });
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
          if (isLegacyNoopApplyResult(result)) {
            throw new Error(
              "L'API appelee a renvoye une ancienne reponse qui laisse la tache en retard. Redemarre le backend local et relance l'analyse.",
            );
          }
          applyTaskResultToState(taskId, result);

          return result;
        } catch (taskError) {
          lastError = taskError;

          if (attempt < TASK_MAX_ATTEMPTS) {
            await wait(1_200 * attempt);
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
    const sourceTask = tasks.find((task) => task.id === taskId) ?? null;

    try {
      setAnalysisLoadingId(taskId);
      setError(null);
      setTaskActionMessage(null);
      const result = await runTaskAnalysisWithRetry(taskId, refresh);
      setSelectedTaskAnalysis({
        accountLabel: sourceTask ? getTaskAccountLabel(sourceTask) : null,
        analysis: result.analysis,
        taskId,
        title: sourceTask?.title ?? result.createdTask?.title ?? result.completedTask?.title ?? `Tache ${taskId}`,
      });
      setTaskActionMessage(result.message);
    } catch (analysisError) {
      setError(formatTasksError(analysisError));
    } finally {
      setAnalysisLoadingId(null);
      setAnalysisApplyingId(null);
    }
  };

  const handleProcessOverdueTasks = async () => {
    if (!selectedOwnerId) {
      return;
    }

    setError(null);
    setTaskActionMessage(null);

    let taskIds = getOverdueOpenTaskIds(await fetchAndCommitTasks(selectedOwnerId));

    if (taskIds.length === 0) {
      return;
    }

    setBatchProgress({
      total: taskIds.length,
      done: 0,
      failed: 0,
    });
    let done = 0;
    let failed = 0;
    const processedTaskIds = new Set<string>();

    for (let pass = 0; pass < 10 && taskIds.length > 0; pass += 1) {
      for (let index = 0; index < taskIds.length; index += TASK_BATCH_SIZE) {
        const batch = taskIds.slice(index, index + TASK_BATCH_SIZE);
        const results = await Promise.allSettled(batch.map((taskId) => runTaskAnalysisWithRetry(taskId, true)));

        for (const taskId of batch) {
          processedTaskIds.add(taskId);
        }

        done += results.filter((result) => result.status === "fulfilled").length;
        failed += results.filter((result) => result.status === "rejected").length;
        setBatchProgress({
          total: done + failed + Math.max(0, taskIds.length - index - TASK_BATCH_SIZE),
          done,
          failed,
        });
      }

      const refreshedTasks = await fetchAndCommitTasks(selectedOwnerId);
      taskIds = getOverdueOpenTaskIds(refreshedTasks).filter((taskId) => !processedTaskIds.has(taskId));

      if (taskIds.length > 0) {
        setBatchProgress({
          total: done + failed + taskIds.length,
          done,
          failed,
        });
      }
    }

    const remainingOverdueCount = getOverdueOpenTaskIds(tasksRef.current).length;

    setBatchProgress({
      total: done + failed,
      done,
      failed,
    });

    setTaskActionMessage(
      remainingOverdueCount === 0
        ? `${done} tache(s) en retard traitee(s), ${failed} echec(s).`
        : `${done} tache(s) traitee(s), ${failed} echec(s), ${remainingOverdueCount} encore en retard apres refresh.`,
    );

    if (failed > 0) {
      setError(`${failed} tache(s) n'ont pas pu etre traitees apres retry.`);
    } else if (remainingOverdueCount > 0) {
      setError(`${remainingOverdueCount} tache(s) restent en retard. Relance l'analyse pour traiter la vague suivante.`);
    }
  };

  const toggleTaskSection = (sectionId: TaskSectionId): void => {
    setCollapsedSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  };

  return (
    <div className="jv-tasks-page" aria-label="Tâches HubSpot">
      <header className="jv-page-header">
        <ListTodo aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
        <h1>Tâches</h1>
      </header>

      <TaskFiltersBar
        analyzeButtonLabel={analyzeButtonLabel}
        batchIsRunning={batchIsRunning}
        dateFilter={dateFilter}
        isLoading={isLoading}
        onDateFilterChange={setDateFilter}
        onOwnerChange={onOwnerChange}
        onProcessOverdueTasks={() => void handleProcessOverdueTasks()}
        onRefresh={() => void loadTasks()}
        onSearchTermChange={setSearchTerm}
        ownerById={ownerById}
        owners={owners}
        overdueTasksCount={overdueTasks.length}
        searchTerm={searchTerm}
        selectedOwnerId={selectedOwnerId}
        selectedOwnerName={selectedOwnerName}
        usingSalesOperatingQueue={usingSalesOperatingQueue}
      />

      <TaskMetrics
        completedTaskCount={completedTaskCount}
        overdueTaskCount={overdueTaskCount}
        todayTaskCount={todayTaskCount}
        totalTaskCount={openTasks.length}
      />

      <section className="jv-themes-row" aria-label="Insights tâches">
        <ThemeBlock
          empty="Aucun bloquant."
          icon={AlertTriangle}
          items={blockingThemes}
          title="Bloquants"
        />
        <ThemeBlock
          empty="Aucun rappel équipe."
          icon={Users}
          items={teamReminderThemes}
          title="Rappels équipe"
        />
      </section>

      {batchProgress ? (
        <p className="jv-bulkbar">
          Batchs de {TASK_BATCH_SIZE} · {batchProgress.done} réussie(s) · {batchProgress.failed} échec(s)
        </p>
      ) : null}

      {error ? <p className="jv-banner jv-banner-error">{error}</p> : null}
      {taskActionMessage ? <p className="jv-banner jv-banner-success">{taskActionMessage}</p> : null}

      <div className="jv-workspace">
        <TaskSectionList
          analysisApplyingId={analysisApplyingId}
          analysisByTaskId={analysisByTaskId}
          analysisLoadingId={analysisLoadingId}
          collapsedSections={collapsedSections}
          enrichedTasksCount={enrichedTasks.length}
          filteredTaskCount={filteredTaskCount}
          getTaskOwnerInitials={getTaskOwnerInitials}
          hubspotPortalId={hubspotPortalId}
          isLoading={isLoading}
          onAnalyzeTask={(taskId, refresh) => void handleAnalyzeTask(taskId, refresh)}
          onCompleteSalesTask={(taskId) => void handleCompleteSalesTask(taskId)}
          onPriorityChange={(taskId, priority) => void handlePriorityChange(taskId, priority)}
          onSkipSalesTask={(taskId) => void handleSkipSalesTask(taskId)}
          onSnoozeSalesTask={(taskId) => void handleSnoozeSalesTask(taskId)}
          onToggleSection={toggleTaskSection}
          priorityUpdatingId={priorityUpdatingId}
          processingTaskIds={processingTaskIds}
          selectedOwnerId={selectedOwnerId}
          selectedTaskId={selectedTaskAnalysis?.taskId ?? null}
          taskActionUpdatingId={taskActionUpdatingId}
          taskSections={taskSections}
          usingSalesOperatingQueue={usingSalesOperatingQueue}
        />

        <TaskDigestSidebar
          filteredTaskCount={filteredTaskCount}
          nextTask={nextTask}
          openTasksCount={openTasks.length}
          overdueTaskCount={overdueTaskCount}
          ownerWorkload={ownerWorkload}
          selectedTaskAnalysis={selectedTaskAnalysis}
          todayTaskCount={todayTaskCount}
          urgentTask={urgentTask}
        />
      </div>
    </div>
  );
};
