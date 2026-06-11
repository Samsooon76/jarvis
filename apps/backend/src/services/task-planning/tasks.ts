import { getSupabaseAdmin } from "../../db/client.js";
import type { AuthContext } from "../app-auth.service.js";
import type {
  SalesTaskActionResult,
  SalesTaskListItem,
  SalesTaskRow,
  SalesTaskStatus,
  SalesTasksTodayPayload,
} from "./types.js";
import { ACTIVE_TASK_STATUSES, assertUuid } from "./shared.js";
import { normalizeWorkSlot } from "./scheduling.js";
import { scoreSalesTask } from "./scoring.js";
import {
  buildEmptySalesTasksTodayPayload,
  isSupabaseSchemaUnavailableError,
  loadProspectSummaries,
  loadTasksByIds,
  loadUserRecordById,
  mapSalesTaskRow,
} from "./data-access.js";

const getTaskSortValue = (task: SalesTaskListItem): number => {
  const statusRank: Record<SalesTaskStatus, number> = {
    pending: 0,
    snoozed: 1,
    done: 2,
    skipped: 3,
    canceled: 4,
  };

  return statusRank[task.status] * 1_000_000_000_000 + new Date(task.scheduledAt).getTime() - task.priorityScore * 60_000;
};

const isTaskVisibleToday = (task: SalesTaskListItem, startOfToday: Date, endOfToday: Date): boolean => {
  const scheduledAt = new Date(task.scheduledAt).getTime();
  const scheduledBeforeTomorrow = !Number.isNaN(scheduledAt) && scheduledAt < endOfToday.getTime();
  const completedAt = task.completedAt ? new Date(task.completedAt).getTime() : null;
  const skippedAt = task.skippedAt ? new Date(task.skippedAt).getTime() : null;

  if (task.status === "pending") {
    return scheduledBeforeTomorrow;
  }

  if (task.status === "snoozed") {
    const snoozedUntil = task.snoozedUntil ? new Date(task.snoozedUntil).getTime() : null;

    return scheduledBeforeTomorrow || (snoozedUntil !== null && snoozedUntil < endOfToday.getTime());
  }

  if (task.status === "done") {
    return completedAt !== null && completedAt >= startOfToday.getTime();
  }

  if (task.status === "skipped") {
    return skippedAt !== null && skippedAt >= startOfToday.getTime();
  }

  return false;
};

export const getTodaySalesTasks = async (userId: string): Promise<SalesTasksTodayPayload> => {
  assertUuid(userId, "userId");

  const user = await loadUserRecordById(userId);

  if (!user?.org_id) {
    throw new Error("Commercial introuvable ou sans organisation.");
  }

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("sales_tasks")
    .select(
      "id, org_id, user_id, prospect_id, source_event_id, task_key, task_type, title, context, reason, scheduled_at, estimated_duration_minutes, priority_score, status, snoozed_until, completed_at, skipped_at, canceled_at, hubspot_contact_id, hubspot_deal_id, created_at, updated_at",
    )
    .eq("user_id", userId)
    .neq("status", "canceled")
    .lt("scheduled_at", endOfToday.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(500);

  if (error) {
    if (isSupabaseSchemaUnavailableError(error)) {
      return buildEmptySalesTasksTodayPayload(userId, user.org_id, now.toISOString());
    }

    throw new Error(`Impossible de charger les taches du jour: ${error.message}`);
  }

  const rows = (data ?? []) as SalesTaskRow[];
  const prospectById = await loadProspectSummaries(rows.map((row) => row.prospect_id).filter((id): id is string => Boolean(id)));
  const tasks = rows
    .map((row) => mapSalesTaskRow(row, prospectById))
    .filter((task) => isTaskVisibleToday(task, startOfToday, endOfToday))
    .sort((left, right) => getTaskSortValue(left) - getTaskSortValue(right));
  const openTasks = tasks.filter((task) => task.status === "pending" || task.status === "snoozed");
  const nowTask =
    openTasks.find((task) => new Date(task.scheduledAt).getTime() <= now.getTime()) ?? openTasks[0] ?? null;
  const nextTask = openTasks.find((task) => task.id !== nowTask?.id) ?? null;

  return {
    userId,
    orgId: user.org_id,
    generatedAt: now.toISOString(),
    tasks,
    nowTask,
    nextTask,
    counts: {
      pending: tasks.filter((task) => task.status === "pending").length,
      snoozed: tasks.filter((task) => task.status === "snoozed").length,
      skipped: tasks.filter((task) => task.status === "skipped").length,
      done: tasks.filter((task) => task.status === "done").length,
    },
  };
};

const loadTaskById = async (taskId: string): Promise<SalesTaskListItem | null> => {
  assertUuid(taskId, "taskId");

  const tasks = await loadTasksByIds([taskId]);

  return tasks[0] ?? null;
};

const assertTaskActionAccess = (task: SalesTaskListItem, auth: AuthContext): void => {
  if (auth.orgId && task.orgId !== auth.orgId) {
    throw new Error("Cette session n'a pas acces a cette tache.");
  }

  if (auth.role === "sales" && (!auth.appUserId || task.userId !== auth.appUserId)) {
    throw new Error("Un commercial ne peut modifier que ses propres taches.");
  }
};

export const completeSalesTask = async (taskId: string, auth: AuthContext): Promise<SalesTaskActionResult> => {
  const currentTask = await loadTaskById(taskId);

  if (!currentTask) {
    throw new Error("Tache introuvable.");
  }

  assertTaskActionAccess(currentTask, auth);

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("sales_tasks")
    .update({
      status: "done",
      completed_at: now,
      snoozed_until: null,
      priority_score: 0,
      last_recalculated_at: now,
    })
    .eq("id", taskId)
    .in("status", ACTIVE_TASK_STATUSES);

  if (error) {
    throw new Error(`Impossible de terminer la tache: ${error.message}`);
  }

  const task = await loadTaskById(taskId);

  if (!task) {
    throw new Error("Tache introuvable.");
  }

  return { task };
};

export const snoozeSalesTask = async (
  taskId: string,
  snoozedUntil: string,
  auth: AuthContext,
  reason?: string | null,
): Promise<SalesTaskActionResult> => {
  assertUuid(taskId, "taskId");
  const snoozeDate = new Date(snoozedUntil);

  if (Number.isNaN(snoozeDate.getTime())) {
    throw new Error("snoozedUntil doit etre une date ISO valide.");
  }

  const currentTask = await loadTaskById(taskId);

  if (!currentTask) {
    throw new Error("Tache introuvable.");
  }

  assertTaskActionAccess(currentTask, auth);

  const nowDate = new Date();
  const scheduledAt = normalizeWorkSlot(
    snoozeDate,
    nowDate,
    currentTask.estimatedDurationMinutes,
  ).toISOString();
  const priorityScore = scoreSalesTask({
    taskType: currentTask.taskType,
    scheduledAt,
    status: "snoozed",
    dealAmount: currentTask.prospect?.dealAmount ?? null,
    closeProbability: currentTask.prospect?.closeProbability ?? null,
    closeDate: null,
    lastContactAt: null,
    hasIncomingClientResponse: currentTask.taskType === "respond_to_client",
    snoozedUntil: scheduledAt,
  });
  const now = nowDate.toISOString();
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("sales_tasks")
    .update({
      status: "snoozed",
      scheduled_at: scheduledAt,
      snoozed_until: scheduledAt,
      estimated_duration_minutes: currentTask.estimatedDurationMinutes,
      priority_score: priorityScore,
      reason: reason?.trim() ? `${currentTask.reason} Snooze: ${reason.trim()}` : currentTask.reason,
      last_recalculated_at: now,
    })
    .eq("id", taskId)
    .in("status", ACTIVE_TASK_STATUSES);

  if (error) {
    throw new Error(`Impossible de snoozer la tache: ${error.message}`);
  }

  const task = await loadTaskById(taskId);

  if (!task) {
    throw new Error("Tache introuvable.");
  }

  return { task };
};

export const skipSalesTask = async (
  taskId: string,
  auth: AuthContext,
  reason?: string | null,
): Promise<SalesTaskActionResult> => {
  assertUuid(taskId, "taskId");

  const currentTask = await loadTaskById(taskId);

  if (!currentTask) {
    throw new Error("Tache introuvable.");
  }

  assertTaskActionAccess(currentTask, auth);

  const now = new Date().toISOString();
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("sales_tasks")
    .update({
      status: "skipped",
      skipped_at: now,
      priority_score: 0,
      reason: reason?.trim() ? `${currentTask.reason} Skip: ${reason.trim()}` : currentTask.reason,
      last_recalculated_at: now,
    })
    .eq("id", taskId)
    .in("status", ACTIVE_TASK_STATUSES);

  if (error) {
    throw new Error(`Impossible d'ignorer la tache: ${error.message}`);
  }

  const task = await loadTaskById(taskId);

  if (!task) {
    throw new Error("Tache introuvable.");
  }

  return { task };
};
