const WEEKEND_DAYS_UTC = new Set([0, 6]);
const DEFAULT_DUE_HOUR_UTC = 9;
const MINIMUM_SAME_DAY_LEAD_MINUTES = 30;
const LATEST_SAME_DAY_DUE_HOUR_UTC = 16;

const isWeekendUtc = (date: Date): boolean => WEEKEND_DAYS_UTC.has(date.getUTCDay());

export const moveToNextBusinessDayUtc = (date: Date): Date => {
  const nextDate = new Date(date.getTime());

  while (isWeekendUtc(nextDate)) {
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  }

  return nextDate;
};

const moveToNextBusinessMorningUtc = (date: Date): Date => {
  const nextDate = new Date(date.getTime());
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  nextDate.setUTCHours(DEFAULT_DUE_HOUR_UTC, 0, 0, 0);

  return moveToNextBusinessDayUtc(nextDate);
};

const roundUpToNextQuarterHour = (date: Date): Date => {
  const roundedDate = new Date(date.getTime());
  const minutes = roundedDate.getUTCMinutes();
  const roundedMinutes = Math.ceil(minutes / 15) * 15;

  roundedDate.setUTCMinutes(roundedMinutes, 0, 0);

  return roundedDate;
};

export const buildBusinessDueAtFromDays = (dueInDays: number, baseDate = new Date()): string => {
  const dueAt = new Date(baseDate.getTime());
  const normalizedDueInDays = Math.max(0, Math.trunc(dueInDays));

  dueAt.setUTCDate(dueAt.getUTCDate() + normalizedDueInDays);
  dueAt.setUTCHours(DEFAULT_DUE_HOUR_UTC, 0, 0, 0);

  if (normalizedDueInDays === 0) {
    const minimumDueAt = roundUpToNextQuarterHour(
      new Date(baseDate.getTime() + MINIMUM_SAME_DAY_LEAD_MINUTES * 60_000),
    );

    if (dueAt.getTime() < minimumDueAt.getTime()) {
      dueAt.setTime(minimumDueAt.getTime());
    }

    if (dueAt.getUTCHours() >= LATEST_SAME_DAY_DUE_HOUR_UTC) {
      return moveToNextBusinessMorningUtc(baseDate).toISOString();
    }
  }

  if (isWeekendUtc(dueAt)) {
    dueAt.setUTCHours(DEFAULT_DUE_HOUR_UTC, 0, 0, 0);
  }

  return moveToNextBusinessDayUtc(dueAt).toISOString();
};
