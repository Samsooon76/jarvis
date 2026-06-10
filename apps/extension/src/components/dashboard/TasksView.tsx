import { ArrowUp, Brain, CheckCircle2, ChevronDown, CircleDot, Clock, RefreshCw, Search, SkipForward } from "lucide-react";
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
  type TaskAnalysisRecommendation,
  type TaskAnalysisType,
} from "../../services/api";
import { formatDateTime } from "../../utils/dashboard/formatters";

type TasksViewProps = {
  hubspotPortalId?: string | null;
  lastUpdates: HubSpotLastUpdateItem[];
  onOwnerChange?: (ownerId: string) => void;
  orgId: string;
  owners?: HubSpotOwnerOption[];
  prospects: QueueProspect[];
  selectedOwnerId?: string | null;
};

type EnrichedTask = HubSpotTaskListItem & {
  dealName: string | null;
  jarvisTask?: SalesTaskListItem;
  lastUpdate: HubSpotLastUpdateItem | null;
  sortScore: number;
};

type DisplayTask = HubSpotTaskListItem & {
  jarvisTask?: SalesTaskListItem;
};

type TaskDateBucket = "overdue" | "today" | "upcoming" | "later" | "noDueDate";
type TaskSectionId = TaskDateBucket;
type TaskDateFilter = "all" | TaskSectionId;

type TaskSection = {
  id: TaskSectionId;
  label: string;
  caption: string;
  tasks: EnrichedTask[];
};

type BatchProgress = {
  total: number;
  done: number;
  failed: number;
};

type TaskFilterTab = {
  id: TaskDateFilter;
  label: string;
};

type OwnerWorkloadItem = {
  id: string;
  initials: string;
  label: string;
  overdueCount: number;
  taskCount: number;
};

type SelectedTaskAnalysis = {
  accountLabel: string | null;
  analysis: TaskAnalysis;
  taskId: string;
  title: string;
};

const TASK_BATCH_SIZE = 5;
const TASK_MAX_ATTEMPTS = 3;
const TASK_LOCAL_CACHE_TTL_MS = 5 * 60 * 1000;
const TASK_LOCAL_CACHE_VERSION = 4;
const JARVIS_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isJarvisUserId = (value: string | null | undefined): value is string =>
  typeof value === "string" && JARVIS_UUID_PATTERN.test(value.trim());

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

const taskFilterTabs: TaskFilterTab[] = [
  { id: "all", label: "Toutes" },
  { id: "today", label: "Aujourd'hui" },
  { id: "upcoming", label: "Cette semaine" },
  { id: "overdue", label: "En retard" },
];

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

const getEndOfWeek = (): Date => {
  const date = getStartOfToday();
  const day = date.getDay();
  const daysUntilNextMonday = day === 0 ? 1 : 8 - day;
  date.setDate(date.getDate() + daysUntilNextMonday);

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

  if (dueTimestamp < getEndOfWeek().getTime()) {
    return "upcoming";
  }

  return "later";
};

const getTaskSectionId = (task: HubSpotTaskListItem): TaskSectionId => getTaskDateBucket(task.dueAt);

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

const getTaskDueShortLabel = (dueAt: string | null): string => {
  if (!dueAt) {
    return "Sans echeance";
  }

  const dueDate = new Date(dueAt);

  if (Number.isNaN(dueDate.getTime())) {
    return "Sans echeance";
  }

  const timeLabel = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(dueDate);
  const yesterday = getStartOfToday();
  yesterday.setDate(yesterday.getDate() - 1);

  if (dueDate >= getStartOfToday() && dueDate < getStartOfTomorrow()) {
    return `Aujourd'hui, ${timeLabel}`;
  }

  if (dueDate >= yesterday && dueDate < getStartOfToday()) {
    return `Hier, ${timeLabel}`;
  }

  const formatter = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    weekday: getTaskDateBucket(dueAt) === "upcoming" ? "long" : undefined,
  });

  return formatter.format(dueDate);
};

const taskUrgencyLabels: Record<TaskDateBucket, string> = {
  overdue: "En retard",
  today: "Aujourd'hui",
  upcoming: "Cette semaine",
  later: "Plus tard",
  noDueDate: "Sans echeance",
};

const isOpenTask = (task: HubSpotTaskListItem): boolean => task.status !== "completed";

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

const getTaskInitials = (task: HubSpotTaskListItem): string => {
  const label = task.contactName ?? task.companyName ?? task.title;
  const words = label
    .replace(/[^a-zA-ZÀ-ÿ0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return "JV";
  }

  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
};

const getInitialsFromLabel = (label: string): string => {
  const words = label
    .replace(/[^a-zA-ZÀ-ÿ0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return "HS";
  }

  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
};

const getOwnerInitials = (ownerHubSpotId: string | null, fallbackTask?: HubSpotTaskListItem): string => {
  const normalizedOwnerId = ownerHubSpotId?.replace(/[^a-zA-Z0-9]/g, "") ?? "";
  const ownerInitials = normalizedOwnerId.slice(-2).toUpperCase();

  if (ownerInitials.length === 2) {
    return ownerInitials;
  }

  return fallbackTask ? getTaskInitials(fallbackTask) : "HS";
};

const formatTaskText = (value: string | null): string => {
  const normalizedValue = value?.replace(/\s+/g, " ").trim();

  if (!normalizedValue) {
    return "Tache HubSpot sans deal associe";
  }

  return normalizedValue;
};

const formatTasksError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "Impossible de charger les taches HubSpot.";

  if (message === "Not Found" || message.includes("Cannot GET /api/hubspot/tasks")) {
    return "La route tasks n'est pas disponible sur l'API appelee. Deploie le backend ou pointe VITE_API_URL vers ton backend local.";
  }

  return message;
};

const isLegacyNoopApplyResult = (result: TaskAnalyzerApplyResult): boolean =>
  (result as { action?: string }).action === "not_applicable" ||
  result.message.includes("Cette recommandation demande une action commerciale manuelle") ||
  result.message.includes("ne modifie pas HubSpot automatiquement");

const getOverdueOpenTaskIds = (items: HubSpotTaskListItem[]): string[] =>
  items
    .filter((task) => isOpenTask(task) && getTaskDateBucket(task.dueAt) === "overdue")
    .map((task) => task.id);

const wait = (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });

const isDocumentVisible = (): boolean => typeof document === "undefined" || document.visibilityState === "visible";

type CachedHubSpotTasks = {
  cachedAt: number;
  tasks: DisplayTask[];
};

const getTaskCacheKey = (orgId: string, selectedOwnerId: string): string =>
  `jarvis:hubspot-tasks:v${TASK_LOCAL_CACHE_VERSION}:${orgId}:${selectedOwnerId}`;

const isHubSpotTaskListItem = (value: unknown): value is HubSpotTaskListItem => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<HubSpotTaskListItem>;

  return typeof candidate.id === "string" && typeof candidate.title === "string";
};

const readCachedTasks = (orgId: string, selectedOwnerId: string): DisplayTask[] | null => {
  try {
    const rawCache = window.localStorage.getItem(getTaskCacheKey(orgId, selectedOwnerId));

    if (!rawCache) {
      return null;
    }

    const parsedCache = JSON.parse(rawCache) as Partial<CachedHubSpotTasks>;

    if (
      typeof parsedCache.cachedAt !== "number" ||
      Date.now() - parsedCache.cachedAt > TASK_LOCAL_CACHE_TTL_MS ||
      !Array.isArray(parsedCache.tasks) ||
      !parsedCache.tasks.every(isHubSpotTaskListItem)
    ) {
      return null;
    }

    return parsedCache.tasks;
  } catch {
    return null;
  }
};

const writeCachedTasks = (orgId: string, selectedOwnerId: string, tasks: DisplayTask[]): void => {
  try {
    const cachePayload: CachedHubSpotTasks = {
      cachedAt: Date.now(),
      tasks,
    };

    window.localStorage.setItem(getTaskCacheKey(orgId, selectedOwnerId), JSON.stringify(cachePayload));
  } catch {
    // localStorage can be unavailable in restricted browser contexts; live API data still works.
  }
};

const toHubSpotPriority = (priorityScore: number): HubSpotTaskPriority =>
  priorityScore >= 75 ? "high" : priorityScore >= 45 ? "medium" : "low";

const toHubSpotStatus = (status: SalesTaskListItem["status"]): HubSpotTaskListItem["status"] => {
  if (status === "done" || status === "skipped" || status === "canceled") {
    return "completed";
  }

  if (status === "snoozed") {
    return "deferred";
  }

  return "not_started";
};

const mapSalesTaskToDisplayTask = (
  task: SalesTaskListItem,
  ownerHubSpotId: string | null | undefined,
): DisplayTask => ({
  id: task.id,
  title: task.title,
  body: task.context ?? task.reason,
  status: toHubSpotStatus(task.status),
  priority: toHubSpotPriority(task.priorityScore),
  dueAt: task.scheduledAt,
  ownerHubSpotId: ownerHubSpotId ?? null,
  taskType: task.taskType,
  contactName: task.prospect?.name ?? null,
  contactEmail: task.prospect?.email ?? null,
  companyName: task.prospect?.company ?? null,
  dealName: task.prospect?.dealName ?? null,
  createdAt: task.createdAt,
  associatedContactIds: task.hubspotContactId ? [task.hubspotContactId] : [],
  associatedCompanyIds: [],
  associatedDealIds: task.hubspotDealId ? [task.hubspotDealId] : [],
  jarvisTask: task,
});

const getTaskDurationLabel = (task: DisplayTask): string | null =>
  task.jarvisTask ? `${task.jarvisTask.estimatedDurationMinutes} min` : null;

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
    }, 60_000);

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
  const upcomingTaskCount = openTasks.filter((task) => getTaskDateBucket(task.dueAt) === "upcoming").length;
  const laterTaskCount = openTasks.filter((task) => getTaskDateBucket(task.dueAt) === "later").length;
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
    <section className="ae-view-panel ae-tasks-light-page" aria-label="Taches HubSpot">
      <div className="ae-view-title ae-task-titlebar ae-tasks-light-titlebar">
        <div>
          <h2>Taches</h2>
          <span>/ {new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(new Date())}</span>
        </div>
        <button
          aria-label="Rafraichir les taches"
          className="ae-icon-action ae-task-refresh"
          disabled={isLoading || !selectedOwnerId}
          onClick={loadTasks}
          title="Rafraichir"
          type="button"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="ae-task-filters" aria-label="Filtres des taches">
        <label className="ae-task-search">
          <Search size={15} />
          <input
            aria-label="Rechercher une tache"
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Rechercher une tache..."
            value={searchTerm}
          />
        </label>
        <select
          aria-label="Filtrer par commercial"
          onChange={(event) => onOwnerChange?.(event.target.value)}
          value={selectedOwnerId ?? ""}
        >
          <option value="">{owners.length > 0 ? "Tous les reps" : selectedOwnerName}</option>
          {selectedOwnerId && !ownerById.has(selectedOwnerId) ? (
            <option value={selectedOwnerId}>{selectedOwnerName}</option>
          ) : null}
          {owners.map((owner) => (
            <option key={owner.ownerId} value={owner.ownerId}>
              {owner.name}
            </option>
          ))}
        </select>
        {!usingSalesOperatingQueue ? (
          <button
            className="ae-task-analyze-button"
            disabled={!selectedOwnerId || overdueTasks.length === 0 || batchIsRunning}
            onClick={handleProcessOverdueTasks}
            type="button"
          >
            <Brain size={15} />
            <span>{analyzeButtonLabel}</span>
          </button>
        ) : null}
      </div>

      <div className="ae-task-metrics" aria-label="Resume des taches">
        <article className="overdue">
          <span>En retard</span>
          <strong>{overdueTaskCount}</strong>
          <small>A traiter en priorite</small>
        </article>
        <article className="today">
          <span>Aujourd'hui</span>
          <strong>{todayTaskCount}</strong>
          <small>Taches du jour restantes</small>
        </article>
        <article>
          <span>Cette semaine</span>
          <strong>{upcomingTaskCount}</strong>
          <small>Taches planifiees</small>
        </article>
        <article>
          <span>Plus tard</span>
          <strong>{laterTaskCount}</strong>
          <small>Apres cette semaine</small>
        </article>
      </div>

      <div className="ae-task-tabs" aria-label="Filtrer par periode">
        {taskFilterTabs.map((tab) => (
          <button
            className={dateFilter === tab.id ? "active" : ""}
            key={tab.id}
            onClick={() => setDateFilter(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {batchProgress ? (
        <div className="ae-task-bulkbar">
          <small>
            Batchs de {TASK_BATCH_SIZE} · {batchProgress.done} reussie(s) · {batchProgress.failed} echec(s)
          </small>
        </div>
      ) : null}

      {error ? <p className="ae-admin-error">{error}</p> : null}
      {taskActionMessage ? <p className="ae-admin-success">{taskActionMessage}</p> : null}

      <div className="ae-task-workspace">
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
                  onClick={() => toggleTaskSection(section.id)}
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
                          onClick={() => handleAnalyzeTask(task.id, Boolean(analysisByTaskId[task.id]))}
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
                              onClick={() => void handleCompleteSalesTask(task.id)}
                              type="button"
                            >
                              <CheckCircle2 size={14} />
                              <span>Done</span>
                            </button>
                            <button
                              disabled={taskActionUpdatingId === task.id || task.jarvisTask.status === "done" || task.jarvisTask.status === "skipped"}
                              onClick={() => void handleSnoozeSalesTask(task.id)}
                              type="button"
                            >
                              <Clock size={14} />
                              <span>Snooze</span>
                            </button>
                            <button
                              disabled={taskActionUpdatingId === task.id || task.jarvisTask.status === "done" || task.jarvisTask.status === "skipped"}
                              onClick={() => void handleSkipSalesTask(task.id)}
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
                            onClick={() => handlePriorityChange(task.id, priority)}
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
          {selectedOwnerId && enrichedTasks.length === 0 && !isLoading ? (
            <p className="ae-empty">{usingSalesOperatingQueue ? "Aucune tache Jarvis ouverte." : "Aucune tache HubSpot ouverte."}</p>
          ) : null}
          {selectedOwnerId && enrichedTasks.length > 0 && filteredTaskCount === 0 ? (
            <p className="ae-empty">Aucune tache ne correspond aux filtres.</p>
          ) : null}
        </div>

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
              <small>{openTasks.length} taches a traiter</small>
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
      </div>
    </section>
  );
};
