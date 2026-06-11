import type { SalesTaskRow, SalesTaskType } from "./types.js";
import { addMinutes, addDays, setTime, toNumber } from "./shared.js";

const WORKDAY_START_HOUR = 9;
const WORKDAY_START_MINUTE = 30;
const LUNCH_START_HOUR = 12;
const LUNCH_START_MINUTE = 30;
const LUNCH_END_HOUR = 14;
const WORKDAY_END_HOUR = 18;

const ESTIMATED_TASK_DURATION_MINUTES = {
  respond_to_client: 20,
  follow_up: 15,
  post_call_next_step: 30,
  deal_review: 40,
  crm_update: 20,
} as const satisfies Record<SalesTaskType, number>;

const getWorkdayStart = (date: Date): Date => setTime(date, WORKDAY_START_HOUR, WORKDAY_START_MINUTE);
const getLunchStart = (date: Date): Date => setTime(date, LUNCH_START_HOUR, LUNCH_START_MINUTE);
const getLunchEnd = (date: Date): Date => setTime(date, LUNCH_END_HOUR);
const getWorkdayEnd = (date: Date): Date => setTime(date, WORKDAY_END_HOUR);

const isWeekend = (date: Date): boolean => date.getDay() === 0 || date.getDay() === 6;

const moveToNextWorkdayMorning = (date: Date): Date => {
  const next = addDays(date, 1);
  const morning = getWorkdayStart(next);

  while (isWeekend(morning)) {
    morning.setDate(morning.getDate() + 1);
  }

  return morning;
};

export const getEstimatedSalesTaskDurationMinutes = (taskType: SalesTaskType): number =>
  ESTIMATED_TASK_DURATION_MINUTES[taskType];

export const normalizeWorkSlot = (target: Date, now: Date, durationMinutes = 20): Date => {
  const minimumStart = addMinutes(now, 5);
  const next = new Date(Math.max(target.getTime(), minimumStart.getTime()));
  const durationMs = Math.max(5, durationMinutes) * 60_000;

  while (isWeekend(next)) {
    next.setDate(next.getDate() + 1);
    next.setHours(WORKDAY_START_HOUR, WORKDAY_START_MINUTE, 0, 0);
  }

  const workdayStart = getWorkdayStart(next);
  const lunchStart = getLunchStart(next);
  const lunchEnd = getLunchEnd(next);
  const workdayEnd = getWorkdayEnd(next);

  if (next < workdayStart) {
    return workdayStart;
  }

  if (next >= lunchStart && next < lunchEnd) {
    return lunchEnd;
  }

  if (next.getTime() < lunchStart.getTime() && next.getTime() + durationMs > lunchStart.getTime()) {
    return lunchEnd;
  }

  if (next.getTime() + durationMs > workdayEnd.getTime()) {
    return moveToNextWorkdayMorning(next);
  }

  return next;
};

const intervalsOverlap = (
  leftStart: Date,
  leftDurationMinutes: number,
  rightStart: Date,
  rightDurationMinutes: number,
): boolean => {
  const leftEnd = addMinutes(leftStart, leftDurationMinutes).getTime();
  const rightEnd = addMinutes(rightStart, rightDurationMinutes).getTime();

  return leftStart.getTime() < rightEnd && rightStart.getTime() < leftEnd;
};

export const getExistingTaskDurationMinutes = (task: Pick<SalesTaskRow, "estimated_duration_minutes">): number =>
  Math.max(5, toNumber(task.estimated_duration_minutes) ?? 20);

export const findNextAvailableWorkSlot = ({
  durationMinutes,
  existingTasks,
  now,
  preferredAt,
}: {
  durationMinutes: number;
  existingTasks: SalesTaskRow[];
  now: Date;
  preferredAt: Date;
}): Date => {
  let candidate = normalizeWorkSlot(preferredAt, now, durationMinutes);
  const sortedTasks = existingTasks
    .map((task) => ({
      start: new Date(task.scheduled_at),
      durationMinutes: getExistingTaskDurationMinutes(task),
    }))
    .filter((task) => !Number.isNaN(task.start.getTime()))
    .sort((left, right) => left.start.getTime() - right.start.getTime());

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const overlap = sortedTasks.find((task) =>
      intervalsOverlap(candidate, durationMinutes, normalizeWorkSlot(task.start, now, task.durationMinutes), task.durationMinutes),
    );

    if (!overlap) {
      return candidate;
    }

    candidate = normalizeWorkSlot(addMinutes(overlap.start, overlap.durationMinutes + 5), now, durationMinutes);
  }

  return candidate;
};
