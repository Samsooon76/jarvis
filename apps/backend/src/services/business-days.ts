const WEEKEND_DAYS_UTC = new Set([0, 6]);

const isWeekendUtc = (date: Date): boolean => WEEKEND_DAYS_UTC.has(date.getUTCDay());

export const moveToNextBusinessDayUtc = (date: Date): Date => {
  const nextDate = new Date(date.getTime());

  while (isWeekendUtc(nextDate)) {
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  }

  return nextDate;
};

export const buildBusinessDueAtFromDays = (dueInDays: number, baseDate = new Date()): string => {
  const dueAt = new Date(baseDate.getTime());
  dueAt.setUTCDate(dueAt.getUTCDate() + Math.max(0, Math.trunc(dueInDays)));
  dueAt.setUTCHours(9, 0, 0, 0);

  return moveToNextBusinessDayUtc(dueAt).toISOString();
};
