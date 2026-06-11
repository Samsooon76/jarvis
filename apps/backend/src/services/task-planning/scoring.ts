import type { TaskPriorityInput } from "./types.js";
import { clamp, getDaysSince, getDaysUntil, roundScore } from "./shared.js";

export const scoreSalesTask = (input: TaskPriorityInput, now: Date = new Date()): number => {
  if (input.status === "skipped" || input.status === "done" || input.status === "canceled") {
    return 0;
  }

  const scheduledTimestamp = new Date(input.scheduledAt).getTime();
  const minutesUntil = Number.isNaN(scheduledTimestamp)
    ? 24 * 60
    : Math.floor((scheduledTimestamp - now.getTime()) / 60_000);
  const closeDays = getDaysUntil(input.closeDate, now);
  const daysSinceLastContact = getDaysSince(input.lastContactAt, now);
  const amountScore = Math.min(20, (input.dealAmount ?? 0) / 2_500);
  const probabilityScore = Math.min(25, (input.closeProbability ?? 0) * 0.25);
  const scheduleScore =
    minutesUntil <= 0
      ? 35
      : minutesUntil <= 30
        ? 30
        : minutesUntil <= 120
          ? 22
          : minutesUntil <= 8 * 60
            ? 14
            : 6;
  const closeDateScore =
    closeDays === null
      ? 0
      : closeDays < 0
        ? -8
        : closeDays <= 3
          ? 22
          : closeDays <= 14
            ? 14
            : 0;
  const staleInteractionScore =
    daysSinceLastContact === null ? 8 : daysSinceLastContact >= 14 ? 18 : daysSinceLastContact >= 7 ? 10 : 0;
  const incomingScore = input.hasIncomingClientResponse ? 42 : 0;
  const taskTypeScore =
    input.taskType === "respond_to_client"
      ? 12
      : input.taskType === "deal_review"
        ? 8
        : input.taskType === "post_call_next_step"
          ? 6
          : 0;
  const snoozePenalty =
    input.status === "snoozed" && input.snoozedUntil && new Date(input.snoozedUntil).getTime() > now.getTime()
      ? 45
      : input.status === "snoozed"
        ? 20
        : 0;

  return roundScore(
    clamp(
      amountScore +
        probabilityScore +
        scheduleScore +
        closeDateScore +
        staleInteractionScore +
        incomingScore +
        taskTypeScore -
        snoozePenalty,
      0,
      100,
    ),
  );
};
