import type { QueueProspect } from "@jarvis/shared";
import {
  lostStageKeys,
  openStageKeys,
  stageFilterKeys,
  wonStageKeys,
} from "../../components/dashboard/config";
import type {
  CloseDatePreset,
  DealStatus,
  DealStatusFilter,
  QueueBucket,
  StageFilter,
} from "../../components/dashboard/types";

const normalizeStageKey = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const compactStageKey = (value: string): string => normalizeStageKey(value).replace(/\s+/g, "");

const stageMatchesKey = (stage: string, key: string): boolean => {
  if (stage === key) {
    return true;
  }

  const compactStage = compactStageKey(stage);
  const compactKey = compactStageKey(key);

  return compactStage === compactKey || compactStage.includes(compactKey) || compactKey.includes(compactStage);
};

const matchesStageSet = (stage: string, keys: Set<string>): boolean => {
  for (const key of keys) {
    if (stageMatchesKey(stage, key)) {
      return true;
    }
  }

  return false;
};

export const getDaysSince = (value: string): number => {
  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
};

export const getBucket = (prospect: QueueProspect): QueueBucket => {
  const daysSinceContact = getDaysSince(prospect.lastContactAt);

  if (prospect.priority === "urgent" || prospect.closeProbability >= 75 || daysSinceContact >= 21) {
    return "actNow";
  }

  if (prospect.priority === "important" || prospect.closeProbability >= 45 || daysSinceContact >= 10) {
    return "thisWeek";
  }

  return "watch";
};

export const getDealStatus = (prospect: QueueProspect): DealStatus => {
  const stage = normalizeStageKey(prospect.dealStage);

  if (matchesStageSet(stage, lostStageKeys)) {
    return "lost";
  }

  if (matchesStageSet(stage, wonStageKeys)) {
    return "won";
  }

  if (matchesStageSet(stage, openStageKeys)) {
    return "open";
  }

  return "other";
};

export const getDateOnly = (value: string): Date | null => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

const getDateInputDate = (value: string): Date | null => {
  if (!value) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

  return new Date(year, month - 1, day);
};

const isDateBetween = (date: Date, from: Date, to: Date): boolean =>
  date.getTime() >= from.getTime() && date.getTime() < to.getTime();

export const matchesStatusFilter = (prospect: QueueProspect, filter: DealStatusFilter): boolean =>
  filter === "all" || getDealStatus(prospect) === filter;

export const matchesCloseDateFilter = (
  prospect: QueueProspect,
  preset: CloseDatePreset,
  customFrom: string,
  customTo: string,
): boolean => {
  const closeDate = prospect.closeDate ? getDateOnly(prospect.closeDate) : null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const customFromDate = getDateInputDate(customFrom);
  const customToDate = getDateInputDate(customTo);

  if (preset === "noDate") {
    return !closeDate;
  }

  if (!closeDate) {
    return preset === "all" && !customFromDate && !customToDate;
  }

  if (preset === "thisMonth") {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    const to = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    if (!isDateBetween(closeDate, from, to)) {
      return false;
    }
  }

  if (preset === "nextMonth") {
    const from = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const to = new Date(today.getFullYear(), today.getMonth() + 2, 1);

    if (!isDateBetween(closeDate, from, to)) {
      return false;
    }
  }

  if (preset === "thisQuarter") {
    const quarterStartMonth = Math.floor(today.getMonth() / 3) * 3;
    const from = new Date(today.getFullYear(), quarterStartMonth, 1);
    const to = new Date(today.getFullYear(), quarterStartMonth + 3, 1);

    if (!isDateBetween(closeDate, from, to)) {
      return false;
    }
  }

  if (preset === "overdue" && (getDealStatus(prospect) !== "open" || closeDate.getTime() >= today.getTime())) {
    return false;
  }

  if (customFromDate && closeDate.getTime() < customFromDate.getTime()) {
    return false;
  }

  if (customToDate) {
    const exclusiveTo = new Date(customToDate.getFullYear(), customToDate.getMonth(), customToDate.getDate() + 1);

    if (closeDate.getTime() >= exclusiveTo.getTime()) {
      return false;
    }
  }

  return true;
};

export const matchesStageFilter = (prospect: QueueProspect, filter: StageFilter): boolean => {
  const stage = normalizeStageKey(prospect.dealStage);

  if (filter === "late") {
    return getDaysSince(prospect.lastContactAt) >= 14;
  }

  if (filter === "all") {
    return true;
  }

  const filterStage = stageFilterKeys[filter];

  if (!filterStage) {
    return true;
  }

  return (
    stageMatchesKey(stage, filterStage) ||
    (filter === "negociation" && stageMatchesKey(stage, "negotiation"))
  );
};

export const getInitials = (value: string): string =>
  value
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
