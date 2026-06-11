import type {
  HubSpotLastUpdateItem,
  HubSpotTaskListItem,
  HubSpotTaskPriority,
  SalesTaskListItem,
  TaskAnalysisRecommendation,
  TaskAnalysisType,
  TaskAnalyzerApplyResult,
} from "../../services/api";
import { formatDateTime } from "./formatters";

export type EnrichedTask = HubSpotTaskListItem & {
  dealName: string | null;
  jarvisTask?: SalesTaskListItem;
  lastUpdate: HubSpotLastUpdateItem | null;
  sortScore: number;
};

export type DisplayTask = HubSpotTaskListItem & {
  jarvisTask?: SalesTaskListItem;
};

export type TaskDateBucket = "overdue" | "today" | "upcoming" | "later" | "noDueDate";
export type TaskSectionId = TaskDateBucket;
export type TaskDateFilter = "all" | TaskSectionId;

export type TaskSection = {
  id: TaskSectionId;
  label: string;
  caption: string;
  tasks: EnrichedTask[];
};

export type BatchProgress = {
  total: number;
  done: number;
  failed: number;
};

export type TaskFilterTab = {
  id: TaskDateFilter;
  label: string;
};

export type OwnerWorkloadItem = {
  id: string;
  initials: string;
  label: string;
  overdueCount: number;
  taskCount: number;
};

export const TASK_BATCH_SIZE = 5;
export const TASK_MAX_ATTEMPTS = 3;
const TASK_LOCAL_CACHE_TTL_MS = 5 * 60 * 1000;
const TASK_LOCAL_CACHE_VERSION = 4;
const JARVIS_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isJarvisUserId = (value: string | null | undefined): value is string =>
  typeof value === "string" && JARVIS_UUID_PATTERN.test(value.trim());

export const priorityLabels: Record<HubSpotTaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const taskTypeLabels: Record<TaskAnalysisType, string> = {
  cold_call: "Cold call",
  deal_follow_up: "Follow-up deal",
  post_meeting_follow_up: "Post-meeting",
  no_show_recovery: "No-show",
  admin_crm: "Admin CRM",
  renewal_or_upsell: "Renewal / upsell",
  obsolete: "Obsolete",
  unknown: "Inconnu",
};

export const recommendationLabels: Record<TaskAnalysisRecommendation, string> = {
  do_now: "Faire maintenant",
  reschedule: "Repositionner",
  keep_planned: "Garder",
  skip: "Ignorer",
  merge: "Fusionner",
  clarify: "Clarifier",
};

export const taskPriorityOptions = [null, "high", "medium", "low"] as const satisfies ReadonlyArray<HubSpotTaskPriority | null>;

export const taskFilterTabs: TaskFilterTab[] = [
  { id: "all", label: "Toutes" },
  { id: "today", label: "Aujourd'hui" },
  { id: "upcoming", label: "Cette semaine" },
  { id: "overdue", label: "En retard" },
];

export const priorityScore: Record<HubSpotTaskPriority, number> = {
  high: 300,
  medium: 200,
  low: 100,
};

export const statusLabels: Record<HubSpotTaskListItem["status"], string> = {
  not_started: "A faire",
  in_progress: "En cours",
  waiting: "En attente",
  completed: "Terminee",
  deferred: "Reportee",
  unknown: "Statut inconnu",
};

export const getDueTimeScore = (dueAt: string | null): number => {
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

export const getTaskDateBucket = (dueAt: string | null): TaskDateBucket => {
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

export const getTaskSectionId = (task: HubSpotTaskListItem): TaskSectionId => getTaskDateBucket(task.dueAt);

export const getTaskDueLabel = (dueAt: string | null): string => {
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

export const getTaskDueShortLabel = (dueAt: string | null): string => {
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

export const taskUrgencyLabels: Record<TaskDateBucket, string> = {
  overdue: "En retard",
  today: "Aujourd'hui",
  upcoming: "Cette semaine",
  later: "Plus tard",
  noDueDate: "Sans echeance",
};

export const isOpenTask = (task: HubSpotTaskListItem): boolean => task.status !== "completed";

export const getTaskDealId = (task: HubSpotTaskListItem): string | null => task.associatedDealIds[0] ?? null;

export const getHubSpotRecordUrl = (
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

export const getTaskAccountLabel = (task: HubSpotTaskListItem): string | null => {
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

export const getInitialsFromLabel = (label: string): string => {
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

export const getOwnerInitials = (ownerHubSpotId: string | null, fallbackTask?: HubSpotTaskListItem): string => {
  const normalizedOwnerId = ownerHubSpotId?.replace(/[^a-zA-Z0-9]/g, "") ?? "";
  const ownerInitials = normalizedOwnerId.slice(-2).toUpperCase();

  if (ownerInitials.length === 2) {
    return ownerInitials;
  }

  return fallbackTask ? getTaskInitials(fallbackTask) : "HS";
};

export const formatTaskText = (value: string | null): string => {
  const normalizedValue = value?.replace(/\s+/g, " ").trim();

  if (!normalizedValue) {
    return "Tache HubSpot sans deal associe";
  }

  return normalizedValue;
};

export const formatTasksError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "Impossible de charger les taches HubSpot.";

  if (message === "Not Found" || message.includes("Cannot GET /api/hubspot/tasks")) {
    return "La route tasks n'est pas disponible sur l'API appelee. Deploie le backend ou pointe VITE_API_URL vers ton backend local.";
  }

  return message;
};

export const isLegacyNoopApplyResult = (result: TaskAnalyzerApplyResult): boolean =>
  (result as { action?: string }).action === "not_applicable" ||
  result.message.includes("Cette recommandation demande une action commerciale manuelle") ||
  result.message.includes("ne modifie pas HubSpot automatiquement");

export const getOverdueOpenTaskIds = (items: HubSpotTaskListItem[]): string[] =>
  items
    .filter((task) => isOpenTask(task) && getTaskDateBucket(task.dueAt) === "overdue")
    .map((task) => task.id);

export const wait = (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });

export const isDocumentVisible = (): boolean => typeof document === "undefined" || document.visibilityState === "visible";

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

export const readCachedTasks = (orgId: string, selectedOwnerId: string): DisplayTask[] | null => {
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

export const writeCachedTasks = (orgId: string, selectedOwnerId: string, tasks: DisplayTask[]): void => {
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

export const mapSalesTaskToDisplayTask = (
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

export const getTaskDurationLabel = (task: DisplayTask): string | null =>
  task.jarvisTask ? `${task.jarvisTask.estimatedDurationMinutes} min` : null;
