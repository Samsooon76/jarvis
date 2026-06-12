import { getSupabaseAdmin } from "../../db/client.js";
import { scoreProspect } from "../prospects/scoring.service.js";
import type {
  AcceptedSalesActivityEvent,
  NormalizedSalesActivityEventInput,
  ProspectRow,
  SalesActivityEvent,
  SalesTaskCancelPlan,
  SalesTaskListItem,
  SalesTaskUpsertPlan,
  TaskPlanningResult,
} from "./types.js";
import {
  ACTIVE_TASK_STATUSES,
  addMinutes,
  clamp,
  getProspectCloseDate,
  getProspectDealName,
  readFirstNumber,
  readFirstString,
  toNumber,
} from "./shared.js";
import {
  findNextAvailableWorkSlot,
  getEstimatedSalesTaskDurationMinutes,
  getExistingTaskDurationMinutes,
  normalizeWorkSlot,
} from "./scheduling.js";
import { scoreSalesTask } from "./scoring.js";
import {
  buildSalesTaskPlanForEvent,
  getPlanningProspectSnapshot,
  isIncomingClientResponse,
  isOutboundMessage,
} from "./planning.js";
import {
  insertActivityEvent,
  loadOpenTasksByProspect,
  loadOpenTasksByUser,
  loadProspectById,
  resolveProspect,
  resolveUserId,
} from "./data-access.js";
import { getTodaySalesTasks } from "./tasks.js";

const isDealAmountEvent = (eventType: SalesActivityEvent["eventType"]): boolean =>
  eventType === "deal.updated" || eventType === "deal.amount_changed";

const isDealProbabilityEvent = (eventType: SalesActivityEvent["eventType"]): boolean =>
  eventType === "deal.updated" || eventType === "deal.probability_changed" || eventType === "deal.won" || eventType === "deal.lost";

const isDealStageEvent = (eventType: SalesActivityEvent["eventType"]): boolean =>
  eventType === "deal.updated" || eventType === "deal.stage_changed" || eventType === "deal.won" || eventType === "deal.lost";

const updateProspectFromEvent = async (
  event: SalesActivityEvent,
  prospect: ProspectRow | null,
  payload: Record<string, unknown>,
): Promise<void> => {
  if (!prospect || event.duplicate) {
    return;
  }

  const updates: Record<string, unknown> = {};
  const currentDealAmount = toNumber(prospect.deal_amount);
  const nextDealAmount = isDealAmountEvent(event.eventType) ? readFirstNumber(payload, ["dealAmount", "amount"]) : null;
  const nextCloseProbability =
    isDealProbabilityEvent(event.eventType) ? readFirstNumber(payload, ["closeProbability", "probability"]) : null;
  const nextDealStage = isDealStageEvent(event.eventType) ? readFirstString(payload, ["dealStage", "stage"]) : null;
  const nextLastContactAt =
    event.channel === "deal"
      ? prospect.last_contact_at
      : event.eventType === "call.completed" ||
          event.eventType === "meeting.completed" ||
          event.eventType === "note.created" ||
          isIncomingClientResponse(event.eventType) ||
          isOutboundMessage(event.eventType)
        ? event.occurredAt
        : prospect.last_contact_at;

  if (nextDealAmount !== null) {
    updates.deal_amount = nextDealAmount;
  }

  if (nextCloseProbability !== null) {
    updates.close_probability = Math.round(clamp(nextCloseProbability, 0, 100));
  }

  if (nextDealStage) {
    updates.deal_stage = nextDealStage;
  }

  if (nextLastContactAt && nextLastContactAt !== prospect.last_contact_at) {
    updates.last_contact_at = nextLastContactAt;
  }

  if (isIncomingClientResponse(event.eventType)) {
    updates.next_action = "Repondre au client";
    updates.next_action_at = normalizeWorkSlot(
      addMinutes(new Date(event.occurredAt), 10),
      new Date(),
      getEstimatedSalesTaskDurationMinutes("respond_to_client"),
    ).toISOString();
    updates.snoozed_until = null;
    updates.skipped_at = null;
  }

  if (event.eventType === "call.completed") {
    updates.next_action = "Definir le prochain pas apres l'appel";
    updates.next_action_at = normalizeWorkSlot(
      addMinutes(new Date(event.occurredAt), 30),
      new Date(),
      getEstimatedSalesTaskDurationMinutes("post_call_next_step"),
    ).toISOString();
  }

  if (Object.keys(updates).length === 0) {
    return;
  }

  const score = scoreProspect({
    dealAmount: nextDealAmount ?? currentDealAmount,
    closeProbability: nextCloseProbability ?? prospect.close_probability,
    dealStage: nextDealStage ?? prospect.deal_stage,
    lastContactAt: nextLastContactAt,
    closeDate: getProspectCloseDate(prospect.raw_data, payload),
    snoozedUntil: updates.snoozed_until === null ? null : prospect.snoozed_until,
    skippedAt: updates.skipped_at === null ? null : prospect.skipped_at,
    aiSummary: prospect.ai_summary,
    nextAction: typeof updates.next_action === "string" ? updates.next_action : prospect.next_action,
    dealName: getProspectDealName(prospect.raw_data) ?? prospect.hubspot_deal_id,
  });

  updates.ai_priority_score = score.ai_priority_score;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("prospects").update(updates).eq("id", prospect.id);

  if (error) {
    throw new Error(`Impossible de mettre a jour le prospect: ${error.message}`);
  }
};

const upsertPlannedTask = async ({
  event,
  plan,
  prospect,
  userId,
}: {
  event: SalesActivityEvent;
  plan: SalesTaskUpsertPlan;
  prospect: ProspectRow;
  userId: string;
}): Promise<"created" | "updated"> => {
  const supabase = getSupabaseAdmin();
  const { data: existing, error: existingError } = await supabase
    .from("sales_tasks")
    .select("id")
    .eq("org_id", event.orgId)
    .eq("task_key", plan.taskKey)
    .in("status", ACTIVE_TASK_STATUSES)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Impossible de verifier la tache existante: ${existingError.message}`);
  }

  const now = new Date();
  const scheduledAt = findNextAvailableWorkSlot({
    durationMinutes: plan.estimatedDurationMinutes,
    existingTasks: await loadOpenTasksByUser(userId, plan.taskKey),
    now,
    preferredAt: new Date(plan.scheduledAt),
  }).toISOString();
  const priorityScore = scoreSalesTask(
    {
      taskType: plan.taskType,
      scheduledAt,
      status: "pending",
      dealAmount: toNumber(prospect.deal_amount),
      closeProbability: prospect.close_probability,
      closeDate: getProspectCloseDate(prospect.raw_data),
      lastContactAt: prospect.last_contact_at,
      hasIncomingClientResponse: plan.taskType === "respond_to_client",
    },
    now,
  );

  const row = {
    org_id: event.orgId,
    user_id: userId,
    prospect_id: prospect.id,
    source_event_id: event.id,
    task_key: plan.taskKey,
    task_type: plan.taskType,
    title: plan.title,
    context: plan.context,
    reason: plan.reason,
    scheduled_at: scheduledAt,
    estimated_duration_minutes: plan.estimatedDurationMinutes,
    priority_score: priorityScore,
    status: "pending" as const,
    snoozed_until: null,
    hubspot_contact_id: event.hubspotContactId ?? prospect.hubspot_contact_id,
    hubspot_deal_id: event.hubspotDealId ?? prospect.hubspot_deal_id,
    metadata: {
      planner: "deterministic_v1",
      eventType: event.eventType,
      eventId: event.id,
      preferredScheduledAt: plan.scheduledAt,
    },
    last_recalculated_at: now.toISOString(),
  };

  if (existing) {
    const { error } = await supabase.from("sales_tasks").update(row).eq("id", (existing as { id: string }).id);

    if (error) {
      throw new Error(`Impossible de mettre a jour la tache: ${error.message}`);
    }

    return "updated";
  }

  const { error } = await supabase.from("sales_tasks").insert(row);

  if (error) {
    throw new Error(`Impossible de creer la tache: ${error.message}`);
  }

  return "created";
};

const cancelPlannedTask = async (
  orgId: string,
  cancellation: SalesTaskCancelPlan,
): Promise<number> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("sales_tasks")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
      reason: cancellation.reason,
      last_recalculated_at: new Date().toISOString(),
    })
    .eq("org_id", orgId)
    .eq("task_key", cancellation.taskKey)
    .in("status", ACTIVE_TASK_STATUSES)
    .select("id");

  if (error) {
    throw new Error(`Impossible d'annuler la tache: ${error.message}`);
  }

  return (data ?? []).length;
};

const recalculateOpenTasks = async (prospect: ProspectRow): Promise<number> => {
  const openTasks = await loadOpenTasksByProspect(prospect.id);
  const now = new Date();
  const closeDate = getProspectCloseDate(prospect.raw_data);
  const supabase = getSupabaseAdmin();
  let recalculated = 0;

  for (const task of openTasks) {
    const estimatedDurationMinutes = getExistingTaskDurationMinutes(task);
    const scheduledAt =
      task.status === "snoozed" && task.snoozed_until
        ? normalizeWorkSlot(new Date(task.snoozed_until), now, estimatedDurationMinutes).toISOString()
        : task.scheduled_at;
    const priorityScore = scoreSalesTask(
      {
        taskType: task.task_type,
        scheduledAt,
        status: task.status,
        dealAmount: toNumber(prospect.deal_amount),
        closeProbability: prospect.close_probability,
        closeDate,
        lastContactAt: prospect.last_contact_at,
        hasIncomingClientResponse: task.task_type === "respond_to_client",
        snoozedUntil: task.snoozed_until,
      },
      now,
    );

    const { error } = await supabase
      .from("sales_tasks")
      .update({
        priority_score: priorityScore,
        scheduled_at: scheduledAt,
        estimated_duration_minutes: estimatedDurationMinutes,
        last_recalculated_at: now.toISOString(),
      })
      .eq("id", task.id);

    if (error) {
      throw new Error(`Impossible de recalculer une tache: ${error.message}`);
    }

    recalculated += 1;
  }

  return recalculated;
};

const loadTasksForEventUser = async (userId: string | null): Promise<SalesTaskListItem[]> => {
  if (!userId) {
    return [];
  }

  const payload = await getTodaySalesTasks(userId);

  return payload.tasks;
};

export const acceptNormalizedSalesActivityEvent = async (
  input: NormalizedSalesActivityEventInput,
): Promise<AcceptedSalesActivityEvent> => {
  const prospect = await resolveProspect(input);
  const userId = await resolveUserId(input, prospect);
  const event = await insertActivityEvent(input, prospect, userId);
  const emptyPlanning = {
    created: 0,
    updated: 0,
    canceled: 0,
    recalculated: 0,
    skippedReason: null,
    tasks: await loadTasksForEventUser(userId),
  } satisfies TaskPlanningResult;

  if (event.duplicate) {
    return {
      event,
      planning: {
        ...emptyPlanning,
        skippedReason: "Evenement deja traite.",
      },
    };
  }

  await updateProspectFromEvent(event, prospect, input.payload ?? {});

  const refreshedProspect = prospect ? await loadProspectById(prospect.org_id, prospect.id) : null;
  const effectiveProspect = refreshedProspect ?? prospect;

  if (!effectiveProspect) {
    return {
      event,
      planning: {
        ...emptyPlanning,
        skippedReason: "Aucun prospect Jarvis ne correspond a l'evenement.",
      },
    };
  }

  if (!userId) {
    return {
      event,
      planning: {
        ...emptyPlanning,
        skippedReason: "Aucun commercial Jarvis n'est rattache au prospect.",
      },
    };
  }

  const eventPlan = buildSalesTaskPlanForEvent({
    event: {
      id: event.id,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
    },
    prospect: getPlanningProspectSnapshot(effectiveProspect, input.payload ?? {}),
  });
  let created = 0;
  let updated = 0;
  let canceled = 0;

  for (const cancellation of eventPlan.cancellations) {
    canceled += await cancelPlannedTask(event.orgId, cancellation);
  }

  for (const taskPlan of eventPlan.upserts) {
    const result = await upsertPlannedTask({
      event,
      plan: taskPlan,
      prospect: effectiveProspect,
      userId,
    });

    if (result === "created") {
      created += 1;
    } else {
      updated += 1;
    }
  }

  const recalculated = await recalculateOpenTasks(effectiveProspect);

  return {
    event,
    planning: {
      created,
      updated,
      canceled,
      recalculated,
      skippedReason: eventPlan.upserts.length === 0 && eventPlan.cancellations.length === 0 ? "Aucune tache requise pour cet evenement." : null,
      tasks: await loadTasksForEventUser(userId),
    },
  };
};
