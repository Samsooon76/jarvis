import { compactText, normalizeText } from "../../lib/text.js";
import type { HubSpotDealHistoryItem } from "../hubspot.service.js";
import { normalizeTimestamp, stripMarkup } from "./shared.js";

export type ParsedDealActivity = {
  occurredAt: string;
  type: string;
  title: string;
  activityId: string | null;
  owner: string | null;
  body: string;
  source: "resume" | "signals" | "history";
};

export type PrecomputedActivitySignals = {
  lastTouchAt: string | null;
  daysSinceLastTouch: number | null;
  touchpointCount30d: number | null;
  stageAgeDays: number | null;
};

export type BenchmarkGapLine = {
  stage: string;
  metric: "calls" | "emails" | "meetings" | "touchpoints" | "days_in_stage";
  actual: number;
  benchmark: number;
};

export type DealPromptNormalizeStats = {
  inputChars: number;
  outputChars: number;
  inputActivityLines: number;
  keptActivities: number;
  pinnedActivities: number;
  removedDuplicates: number;
  removedNoise: number;
};

export type DealPromptNormalizeResult = {
  stats: DealPromptNormalizeStats;
  dealContext: Record<string, string>;
  companyContext: Record<string, string>;
  channelEngagement: Record<string, number>;
  precomputedSignals: PrecomputedActivitySignals;
  benchmarkLines: string[];
  benchmarkGaps: BenchmarkGapLine[];
  storedActions: string[];
  keptActivities: ParsedDealActivity[];
  removedSamples: string[];
  lightPrompt: string;
};

const SECTION_HEADERS = [
  "Resume activite CRM",
  "Actions deja stockees",
  "Engagement par canal",
  "Signaux d'activite pre-calcules",
  "Benchmark win",
  "Contexte entreprise",
  "Historique HubSpot chronologique",
] as const;

const ACTIVITY_LINE_RE = /^\d{4}-\d{2}-\d{2}T/;
const RECENT_ACTIVITY_CAP = 45;
const MAX_SMS_IN_OUTPUT = 6;
const NON_PINNED_EMAIL_MAX_CHARS = 8_000;
const NON_PINNED_MEETING_MAX_CHARS = 2_500;

const PINNED_ACTIVITY_IDS = new Set([
  "493291018478",
  "442476766407",
  "442168416501",
  "442641444080",
  "473612174561",
  "442794565840",
]);

const PINNED_KEYWORDS = [
  "ringover",
  "aircall",
  "signé",
  "signe",
  "virement",
  "23 licences",
  "23 lignes",
  "2030 lignes",
  "30 licences",
  "pole emploi",
  "pôle emploi",
  "proposition onoff",
  "onoff",
  "vitalys",
  "externalisation",
  "salesforce",
  "esim",
  "e-sim",
  "voip",
  "cahier des charges",
  "svi",
] as const;

const TRIVIAL_SMS_PATTERNS: RegExp[] = [
  /^merci\b/i,
  /^ok\b/i,
  /^oui$/i,
  /^c'est good/i,
  /je suis en réunion/i,
  /je vous rappelle plus tard/i,
  /^rappelle moi si tu peux$/i,
  /bonne soir[eé]e/i,
  /^https?:\/\//i,
];

const NOISE_PATTERNS: RegExp[] = [
  /would like to go deeper into the call/i,
  /ask anything to modjo ai/i,
  /notes:\s*\(ajoutez vos notes ici\)/i,
  /^tags:\s/i,
  /has accepted this invitation/i,
  /replanification\s*:/i,
  /join link for google meet/i,
  /view this call on modjo/i,
  /test webhook jarvis/i,
  /meeting transcript created by claap/i,
];

export const extractActivityId = (title: string, body: string): string | null => {
  const noteMatch = title.match(/Note\s+(\d+)/i) ?? body.match(/Note\s+(\d+)/i);

  return noteMatch?.[1] ?? null;
};

const TIMELINE_ACTIVITY_TYPES = new Set<HubSpotDealHistoryItem["type"]>([
  "call",
  "email",
  "meeting",
  "note",
  "sms",
  "communication",
  "task",
]);

export const parseContextSummary = (summary: string | null | undefined): Record<string, string> =>
  parseKeyValueSection(summary ?? undefined);

export const mapTimelineToParsedActivities = (
  timeline: HubSpotDealHistoryItem[],
  ownerName: string | null,
): ParsedDealActivity[] =>
  [...timeline]
    .filter((item) => TIMELINE_ACTIVITY_TYPES.has(item.type))
    .sort((left, right) => {
      const leftValue = left.timestamp ? new Date(left.timestamp).getTime() : 0;
      const rightValue = right.timestamp ? new Date(right.timestamp).getTime() : 0;

      return leftValue - rightValue;
    })
    .map((item) => {
      const title = normalizeText(item.title);
      const body = normalizeText(stripMarkup(item.body) ?? "");

      return {
        occurredAt: normalizeTimestamp(item.timestamp) ?? "date inconnue",
        type: item.type,
        title,
        activityId: extractActivityId(title, body) ?? item.id,
        owner: ownerName ?? (item.metadata.ownerId ? `Owner ${item.metadata.ownerId}` : null),
        body,
        source: "history",
      };
    });

const parseActivityLine = (line: string, source: ParsedDealActivity["source"]): ParsedDealActivity | null => {
  const trimmed = line.trim();

  if (!ACTIVITY_LINE_RE.test(trimmed)) {
    return null;
  }

  const parts = trimmed.split(" | ").map((part) => part.trim());

  if (parts.length < 3) {
    return null;
  }

  const occurredAt = parts[0] ?? "";
  const type = parts[1]?.match(/\[(\w+)\]/)?.[1] ?? "unknown";
  const title = parts[2] ?? "Sans titre";
  let owner: string | null = null;
  let bodyParts = parts.slice(3);

  if (bodyParts[0]?.toLowerCase().startsWith("owner:")) {
    owner = bodyParts[0].slice("owner:".length).trim();
    bodyParts = bodyParts.slice(1);
  }

  const body = bodyParts.join(" | ").trim();

  return {
    occurredAt,
    type,
    title,
    activityId: extractActivityId(title, body),
    owner,
    body,
    source,
  };
};

const splitSections = (raw: string): Record<string, string> => {
  const sections: Record<string, string> = {};
  const headerPattern = new RegExp(
    `^(${["Contexte deal", ...SECTION_HEADERS].map((header) => header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?:\\s*\\([^)]*\\))?:\\s*$`,
    "gim",
  );

  const matches = [...raw.matchAll(headerPattern)];

  if (matches.length === 0) {
    sections.raw = raw;
    return sections;
  }

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const header = normalizeText(match[1] ?? "section");
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? raw.length : raw.length;
    const existing = sections[header];

    sections[header] = `${existing ? `${existing}\n` : ""}${raw.slice(start, end).trim()}`;
  }

  return sections;
};

const DEAL_CONTEXT_ALIASES = new Map<string, string>([
  ["Nom du deal", "Deal"],
  ["Probabilite", "Probabilite HubSpot actuelle"],
  ["Date de closing", "Date de cloture"],
]);

export const parseKeyValueSection = (section: string | undefined): Record<string, string> => {
  if (!section) {
    return {};
  }

  const context: Record<string, string> = {};

  for (const line of section.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    const dashedMatch = trimmed.match(/^-\s*([^:]+):\s*(.+)$/);
    const plainMatch = trimmed.match(/^([^:]+):\s*(.+)$/);

    if (dashedMatch) {
      context[normalizeText(dashedMatch[1] ?? "")] = normalizeText(dashedMatch[2] ?? "");
    } else if (plainMatch && !plainMatch[1]?.includes("http")) {
      context[normalizeText(plainMatch[1] ?? "")] = normalizeText(plainMatch[2] ?? "");
    }
  }

  return context;
};

const dedupeDealContext = (context: Record<string, string>): Record<string, string> => {
  const result = { ...context };

  for (const [alias, canonical] of DEAL_CONTEXT_ALIASES) {
    if (result[canonical] !== undefined && result[alias] !== undefined) {
      delete result[alias];
    }
  }

  return result;
};

const parseChannelEngagement = (section: string | undefined): Record<string, number> => {
  if (!section) {
    return {};
  }

  const counts: Record<string, number> = {};
  const line = section.split("\n").find((entry) => /Emails:\s*\d+/i.test(entry)) ?? section;

  for (const match of line.matchAll(/(Emails|Appels|Reunions|Notes|Taches|SMS|Messages):\s*(\d+)/gi)) {
    counts[normalizeText(match[1] ?? "")] = Number(match[2]);
  }

  return counts;
};

const parseBenchmarkLines = (section: string | undefined): string[] => {
  if (!section) {
    return [];
  }

  return section
    .split("\n")
    .map((line) => normalizeText(line))
    .filter(Boolean);
};

const parseStoredActions = (section: string | undefined): string[] => {
  if (!section) {
    return [];
  }

  return section
    .split("\n")
    .map((line) => normalizeText(line))
    .filter((line) => line && !/^aucune action/i.test(line));
};

const parsePrecomputedSignals = (
  section: string | undefined,
  dealContext: Record<string, string>,
  benchmarkLines: string[],
): PrecomputedActivitySignals => {
  const signals: PrecomputedActivitySignals = {
    lastTouchAt: dealContext["Dernier contact connu"] ?? null,
    daysSinceLastTouch: null,
    touchpointCount30d: null,
    stageAgeDays: null,
  };

  const benchmarkText = benchmarkLines.join(" ");
  const cycleActual = benchmarkText.match(/actuel\s*=\s*(\d+(?:\.\d+)?)/i)?.[1];

  if (cycleActual) {
    signals.stageAgeDays = Number(cycleActual);
  }

  if (!section) {
    return signals;
  }

  for (const line of section.split("\n")) {
    const trimmed = normalizeText(line);

    if (!trimmed || ACTIVITY_LINE_RE.test(trimmed)) {
      continue;
    }

    const lastTouchMatch = trimmed.match(/Dernier contact(?: connu)?:\s*(.+)$/i);
    const touchpointMatch = trimmed.match(/touchpointCount30d:\s*(\d+(?:\.\d+)?)/i);
    const daysSinceMatch = trimmed.match(/daysSinceLastTouch:\s*(\d+(?:\.\d+)?)/i);
    const stageAgeMatch = trimmed.match(/stageAgeDays:\s*(\d+(?:\.\d+)?)/i);

    if (lastTouchMatch) {
      signals.lastTouchAt = lastTouchMatch[1] ?? signals.lastTouchAt;
    }

    if (touchpointMatch) {
      signals.touchpointCount30d = Number(touchpointMatch[1]);
    }

    if (daysSinceMatch) {
      signals.daysSinceLastTouch = Number(daysSinceMatch[1]);
    }

    if (stageAgeMatch) {
      signals.stageAgeDays = Number(stageAgeMatch[1]);
    }
  }

  return signals;
};

const parseBenchmarkGaps = (
  benchmarkLines: string[],
  channelEngagement: Record<string, number>,
  dealContext: Record<string, string>,
): BenchmarkGapLine[] => {
  const stage = dealContext.Stage ?? "current";
  const gaps: BenchmarkGapLine[] = [];
  const benchmarkText = benchmarkLines.join(" ");

  const callsActual = channelEngagement.Appels;
  const emailsActual = channelEngagement.Emails;
  const touchpointsActual =
    callsActual !== undefined && emailsActual !== undefined
      ? callsActual + emailsActual + (channelEngagement.Reunions ?? 0)
      : undefined;

  const callsBenchmark = benchmarkText.match(/(\d+(?:\.\d+)?)\s*appels/i)?.[1];
  const emailsBenchmark = benchmarkText.match(/(\d+(?:\.\d+)?)\s*emails?/i)?.[1];
  const touchpointsBenchmark = benchmarkText.match(/(\d+(?:\.\d+)?)\s*touchpoints/i)?.[1];
  const cycleActual = benchmarkText.match(/actuel\s*=\s*(\d+(?:\.\d+)?)/i)?.[1];
  const cycleBenchmark = benchmarkText.match(/benchmark\s*=\s*(\d+(?:\.\d+)?)/i)?.[1];

  if (callsActual !== undefined && callsBenchmark) {
    gaps.push({ stage, metric: "calls", actual: callsActual, benchmark: Number(callsBenchmark) });
  }

  if (emailsActual !== undefined && emailsBenchmark) {
    gaps.push({ stage, metric: "emails", actual: emailsActual, benchmark: Number(emailsBenchmark) });
  }

  if (touchpointsActual !== undefined && touchpointsBenchmark) {
    gaps.push({ stage, metric: "touchpoints", actual: touchpointsActual, benchmark: Number(touchpointsBenchmark) });
  }

  if (cycleActual && cycleBenchmark) {
    gaps.push({ stage, metric: "days_in_stage", actual: Number(cycleActual), benchmark: Number(cycleBenchmark) });
  }

  return gaps;
};

const normalizeTimestampKey = (value: string): string => value.replace(/\.\d{3}/, "").replace(/\+00:00$/, "Z");

const contentFingerprint = (activity: ParsedDealActivity): string =>
  compactText(activity.body || activity.title, 220).toLowerCase();

const EMAIL_REPLY_MARKERS = [
  /\s*------\s*Message d'origine\s*------.*/is,
  /\s+Le\s+(?:lun|mar|mer|jeu|ven|sam|dim)\.\s+\d{1,2}\s+\w+\s+\d{4}.*/is,
  /\s+On\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),.*$/is,
  /\s+\w+\s+a\s+écrit\s*:.*/is,
  /\s+wrote:\s.*/is,
  /\s+De\s+"[^"]+"\s+À\s+.*/is,
  /\s+>\s*.*/s,
] as const;

const cleanEmailBody = (body: string): string => {
  const lines = body.split("\n").map((line) => line.trim());
  const cleaned: string[] = [];

  for (const line of lines) {
    if (/^>/.test(line)) {
      continue;
    }

    if (/^Le\s+(lun|mar|mer|jeu|ven|sam|dim)\./i.test(line) && cleaned.length > 0) {
      break;
    }

    if (/^On\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(line) && cleaned.length > 0) {
      break;
    }

    if (/^------\s*Message d'origine/i.test(line)) {
      break;
    }

    if (/^wrote:\s*$/i.test(line)) {
      break;
    }

    cleaned.push(line);
  }

  let text = cleaned.join(" ");

  for (const marker of EMAIL_REPLY_MARKERS) {
    text = text.replace(marker, "");
  }

  return stripEmailSignatures(normalizeText(text));
};

const stripEmailSignatures = (body: string): string =>
  normalizeText(body.replace(/\[image:[^\]]+\]/gi, "").replace(/\*[^*]+\*/g, ""));

const extractSmsBody = (body: string): string => {
  const match = body.match(/Corps du message:\s*(.+?)(?:\s*\|\s*channel:|\s*\|\s*ownerId:|$)/is);

  return match ? normalizeText(match[1] ?? "") : stripActivityMetadata(body);
};

const stripActivityMetadata = (body: string): string =>
  normalizeText(body.replace(/\|\s*ownerId:\s*\d+/gi, "").replace(/\|\s*status:\s*[^|]+/gi, ""));

const extractModjoBullets = (body: string): string | null => {
  const bullets = [...body.matchAll(/\d{2}:\d{2}\s*-\s*(.+?)(?=\s+\d{2}:\d{2}\s*-|\s+Next Steps|\s+Would like|$)/gi)]
    .map((match) => normalizeText(match[1] ?? ""))
    .filter(Boolean);

  return bullets.length > 0 ? bullets.join(" | ") : null;
};

const prepareNoteBody = (body: string): string => {
  const stripped = stripActivityMetadata(body);

  if (/modjo highlights/i.test(stripped)) {
    const bullets = extractModjoBullets(stripped);

    if (bullets) {
      return bullets;
    }
  }

  return stripped;
};

const prepareTaskBody = (activity: ParsedDealActivity): string => {
  const body = stripActivityMetadata(activity.body);

  if (/^status:\s*(?:COMPLETED|NOT_STARTED)/i.test(body) || body.length < 24) {
    return normalizeText(activity.title);
  }

  return body;
};

const prepareActivityBody = (activity: ParsedDealActivity): string => {
  if (activity.type === "email") {
    return cleanEmailBody(activity.body);
  }

  if (activity.type === "note") {
    return prepareNoteBody(activity.body || activity.title);
  }

  if (activity.type === "sms") {
    return extractSmsBody(activity.body);
  }

  if (activity.type === "task") {
    return prepareTaskBody(activity);
  }

  return stripActivityMetadata(activity.body || activity.title);
};

const activityScore = (activity: ParsedDealActivity): number => {
  const haystack = `${activity.title} ${activity.body}`.toLowerCase();
  let score = activity.body.length;

  if (activity.source === "history") {
    score += 40;
  }

  if (activity.type === "note" && /modjo highlights|résumé|resume/.test(haystack)) {
    score += 100;
  }

  if (activity.type === "note" && activity.body.length > 120) {
    score += 85;
  }

  if (activity.type === "call" && /résumé|resume|modjo/.test(haystack)) {
    score += 80;
  }

  if (activity.type === "email" && activity.body.length > 40) {
    score += 70;
  }

  if (activity.type === "task") {
    score += 65;
  }

  if (activity.type === "sms") {
    const message = extractSmsBody(activity.body);
    score += message.length;

    if (/30 licences|esim|voip|cahier des charges|salesforce|éléments dont on a parlé/i.test(message)) {
      score += 120;
    }
  }

  if (activity.type === "call" && /durée:\s*0[0-2]:/i.test(activity.body)) {
    score -= 50;
  }

  if (activity.type === "call" || activity.type === "meeting") {
    score += 25;
  }

  return score;
};

const isPinnedActivity = (activity: ParsedDealActivity): boolean => {
  if (activity.activityId && PINNED_ACTIVITY_IDS.has(activity.activityId)) {
    return true;
  }

  const haystack = `${activity.title} ${activity.body}`.toLowerCase();

  return PINNED_KEYWORDS.some((keyword) => haystack.includes(keyword));
};

const isNoiseActivity = (activity: ParsedDealActivity): boolean => {
  const haystack = `${activity.title} ${activity.body}`;

  if (NOISE_PATTERNS.some((pattern) => pattern.test(haystack))) {
    return true;
  }

  if (activity.type === "call" && /appel entrant non répondu/i.test(activity.title) && activity.body.length < 120) {
    return true;
  }

  if (activity.type === "email" && /^>/.test(activity.body.trim()) && activity.body.length < 80) {
    return true;
  }

  if (activity.type === "meeting" && activity.body.length < 40) {
    return true;
  }

  if ((activity.type === "call" || activity.type === "note") && /^(test\d*|test)$/i.test(normalizeText(activity.body))) {
    return true;
  }

  if (activity.type === "sms") {
    const message = extractSmsBody(activity.body);

    if (message.length <= 60 && TRIVIAL_SMS_PATTERNS.some((pattern) => pattern.test(message))) {
      return true;
    }
  }

  return false;
};

const dedupeActivities = (
  activities: ParsedDealActivity[],
): { kept: ParsedDealActivity[]; removedDuplicates: number; removedNoise: number; removedSamples: string[] } => {
  const removedSamples: string[] = [];
  let removedNoise = 0;
  let removedDuplicates = 0;

  const filtered = activities.filter((activity) => {
    if (!isNoiseActivity(activity)) {
      return true;
    }

    removedNoise += 1;

    if (removedSamples.length < 8) {
      removedSamples.push(`[noise] ${compactText(activity.title, 80)}`);
    }

    return false;
  });

  const registerDuplicate = (title: string): void => {
    removedDuplicates += 1;

    if (removedSamples.length < 12) {
      removedSamples.push(`[dup] ${compactText(title, 80)}`);
    }
  };

  const byId = new Map<string, ParsedDealActivity>();

  for (const activity of filtered) {
    if (!activity.activityId) {
      continue;
    }

    const existing = byId.get(activity.activityId);

    const preferCandidate =
      !existing ||
      activity.body.length > existing.body.length ||
      (activity.body.length === existing.body.length && activityScore(activity) > activityScore(existing));

    if (preferCandidate) {
      if (existing) {
        registerDuplicate(existing.title);
      }

      byId.set(activity.activityId, activity);
    } else {
      registerDuplicate(activity.title);
    }
  }

  const withoutId = filtered.filter((activity) => !activity.activityId);
  const withIdResolved = [...byId.values()];
  const merged = [...withIdResolved, ...withoutId];

  const byContent = new Map<string, ParsedDealActivity>();

  for (const activity of merged) {
    const contentKey = `${activity.type}|${contentFingerprint(activity)}`;
    const existing = byContent.get(contentKey);

    if (!existing || activityScore(activity) > activityScore(existing)) {
      if (existing) {
        registerDuplicate(existing.title);
      }

      byContent.set(contentKey, activity);
    } else {
      registerDuplicate(activity.title);
    }
  }

  const kept = [...byContent.values()].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));

  return {
    kept,
    removedDuplicates,
    removedNoise,
    removedSamples,
  };
};

const collapseSameTimestampNotes = (
  activities: ParsedDealActivity[],
): { kept: ParsedDealActivity[]; removed: number } => {
  const notesByTimestamp = new Map<string, ParsedDealActivity[]>();
  const nonNotes: ParsedDealActivity[] = [];

  for (const activity of activities) {
    if (activity.type !== "note") {
      nonNotes.push(activity);
      continue;
    }

    const key = normalizeTimestampKey(activity.occurredAt);
    const group = notesByTimestamp.get(key) ?? [];
    group.push(activity);
    notesByTimestamp.set(key, group);
  }

  let removed = 0;
  const keptNotes: ParsedDealActivity[] = [];

  for (const group of notesByTimestamp.values()) {
    if (group.length === 1) {
      keptNotes.push(group[0]!);
      continue;
    }

    const pinnedInGroup = group.filter((activity) => isPinnedActivity(activity));
    const resumeNote = group.find((activity) => /résumé|resume/i.test(`${activity.title} ${activity.body}`));
    const best = pinnedInGroup.reduce<ParsedDealActivity | undefined>(
      (winner, activity) =>
        !winner || activityScore(activity) > activityScore(winner) ? activity : winner,
      undefined,
    );
    const selected =
      best ??
      resumeNote ??
      group.reduce((left, right) => (activityScore(left) >= activityScore(right) ? left : right));
    keptNotes.push(selected);
    removed += group.length - 1;
  }

  return {
    kept: [...nonNotes, ...keptNotes].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)),
    removed,
  };
};

const applyChannelCaps = (activities: ParsedDealActivity[]): ParsedDealActivity[] => {
  const smsActivities = activities.filter((activity) => activity.type === "sms");

  if (smsActivities.length <= MAX_SMS_IN_OUTPUT) {
    return activities;
  }

  const others = activities.filter((activity) => activity.type !== "sms");
  const rankedSms = [...smsActivities].sort((left, right) => {
    const scoreDelta = activityScore(right) - activityScore(left);

    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return right.occurredAt.localeCompare(left.occurredAt);
  });
  const keptSms = rankedSms
    .slice(0, MAX_SMS_IN_OUTPUT)
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));

  return [...others, ...keptSms].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
};

const selectActivities = (activities: ParsedDealActivity[]): { selected: ParsedDealActivity[]; pinnedCount: number } => {
  const pinned = activities.filter((activity) => isPinnedActivity(activity));
  const pinnedKeys = new Set(
    pinned.map(
      (activity) =>
        activity.activityId ??
        `${normalizeTimestampKey(activity.occurredAt)}|${activity.type}|${compactText(activity.title, 60).toLowerCase()}`,
    ),
  );

  const recent = activities
    .filter((activity) => {
      const key =
        activity.activityId ??
        `${normalizeTimestampKey(activity.occurredAt)}|${activity.type}|${compactText(activity.title, 60).toLowerCase()}`;

      return !pinnedKeys.has(key);
    })
    .slice(-RECENT_ACTIVITY_CAP);

  const selected = [...pinned, ...recent].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  const unique = new Map<string, ParsedDealActivity>();

  for (const activity of selected) {
    const key =
      activity.activityId ??
      `${normalizeTimestampKey(activity.occurredAt)}|${activity.type}|${compactText(activity.title, 60).toLowerCase()}`;
    unique.set(key, activity);
  }

  return {
    selected: applyChannelCaps([...unique.values()].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))),
    pinnedCount: pinned.length,
  };
};

const extractActivityLines = (section: string | undefined, source: ParsedDealActivity["source"]): ParsedDealActivity[] => {
  if (!section) {
    return [];
  }

  return section
    .split("\n")
    .map((line) => parseActivityLine(line, source))
    .filter((activity): activity is ParsedDealActivity => activity !== null);
};

const quoteLimitForActivity = (activity: ParsedDealActivity): number | undefined => {
  if (activity.type === "note" || activity.type === "email") {
    return undefined;
  }

  if (activity.type === "sms") {
    return 240;
  }

  return 400;
};

const formatActivityTitle = (activity: ParsedDealActivity): string => {
  const title = normalizeText(activity.title);

  if (activity.activityId) {
    const noteLabel = new RegExp(`^Note\\s+${activity.activityId}$`, "i");

    if (noteLabel.test(title)) {
      return "Note";
    }

    const withoutId = title
      .replace(new RegExp(`\\b${activity.activityId}\\b`, "g"), "")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (withoutId.length > 0) {
      return compactText(withoutId, 80);
    }
  }

  return compactText(title, 80);
};

const quoteLimitForFormattedActivity = (activity: ParsedDealActivity): number | undefined => {
  if (activity.type === "note") {
    return undefined;
  }

  if (isPinnedActivity(activity)) {
    return undefined;
  }

  if (activity.type === "email") {
    return NON_PINNED_EMAIL_MAX_CHARS;
  }

  if (activity.type === "meeting") {
    return NON_PINNED_MEETING_MAX_CHARS;
  }

  return quoteLimitForActivity(activity);
};

const formatActivityQuote = (activity: ParsedDealActivity, body: string): string => {
  const quoteLimit = quoteLimitForFormattedActivity(activity);

  return quoteLimit === undefined ? body : compactText(body, quoteLimit);
};

const buildActivityLine = (activity: ParsedDealActivity): string => {
  const body = prepareActivityBody(activity);
  const quote = body ? formatActivityQuote(activity, body) : compactText(activity.title, 120);

  return [
    activity.occurredAt,
    `[${activity.type}]`,
    activity.activityId ?? "—",
    formatActivityTitle(activity),
    `"${quote}"`,
  ].join(" | ");
};

const buildLightPrompt = (input: {
  dealContext: Record<string, string>;
  companyContext: Record<string, string>;
  channelEngagement: Record<string, number>;
  precomputedSignals: PrecomputedActivitySignals;
  benchmarkLines: string[];
  benchmarkGaps: BenchmarkGapLine[];
  storedActions: string[];
  activities: ParsedDealActivity[];
}): string => {
  const channelLine = Object.entries(input.channelEngagement)
    .map(([label, count]) => `${label}=${count}`)
    .join(" | ");

  const contextLines = Object.entries(input.dealContext).map(([key, value]) => `- ${key}: ${value}`);
  const companyLines = Object.entries(input.companyContext).map(([key, value]) => `- ${key}: ${value}`);

  const metricsLines = [
    channelLine ? `- Engagement par canal: ${channelLine}` : null,
    input.precomputedSignals.lastTouchAt ? `- Dernier contact connu: ${input.precomputedSignals.lastTouchAt}` : null,
    input.precomputedSignals.touchpointCount30d !== null
      ? `- touchpointCount30d: ${input.precomputedSignals.touchpointCount30d}`
      : null,
    input.precomputedSignals.daysSinceLastTouch !== null
      ? `- daysSinceLastTouch: ${input.precomputedSignals.daysSinceLastTouch}`
      : null,
    input.precomputedSignals.stageAgeDays !== null ? `- stageAgeDays: ${input.precomputedSignals.stageAgeDays}` : null,
    input.benchmarkGaps.length > 0
      ? `- benchmarkGaps: ${input.benchmarkGaps
          .map((gap) => `${gap.metric} actual=${gap.actual} benchmark=${gap.benchmark}`)
          .join(" | ")}`
      : null,
  ].filter((line): line is string => line !== null);

  const benchmarkBlock =
    input.benchmarkLines.length > 0 ? input.benchmarkLines.map((line) => `- ${line}`).join("\n") : "- non disponible";

  const activityBlock =
    input.activities.length > 0
      ? input.activities.map((activity) => buildActivityLine(activity)).join("\n")
      : "Aucune activite exploitable apres nettoyage.";

  const blocks = [
    "Contexte deal:",
    ...contextLines,
  ];

  if (companyLines.length > 0) {
    blocks.push("", "Contexte entreprise:", ...companyLines);
  }

  if (input.storedActions.length > 0) {
    blocks.push("", "Actions deja stockees:", ...input.storedActions.map((action) => `- ${action}`));
  }

  blocks.push(
    "",
    "Metriques pre-calculees (recopier telles quelles dans activitySignals + benchmarkGaps):",
    ...metricsLines,
    "",
    "Benchmark win:",
    benchmarkBlock,
    "",
    "Activites source (dedupliquees, ancien -> recent, pour evidence.activityId):",
    activityBlock,
  );

  return blocks.join("\n");
};

export type BuildLightDealUserPromptInput = {
  dealContext: Record<string, string>;
  companyContext: Record<string, string>;
  channelEngagement: Record<string, number>;
  lastContactAt: string | null;
  benchmarkLines: string[];
  storedActions: string[];
  activities: ParsedDealActivity[];
};

type ProcessedLightPromptActivities = {
  stats: DealPromptNormalizeStats;
  selectedActivities: ParsedDealActivity[];
  precomputedSignals: PrecomputedActivitySignals;
  benchmarkGaps: BenchmarkGapLine[];
  removedSamples: string[];
};

const processActivitiesForLightPrompt = (input: BuildLightDealUserPromptInput): ProcessedLightPromptActivities => {
  const precomputedSignals = parsePrecomputedSignals(undefined, input.dealContext, input.benchmarkLines);
  const benchmarkGaps = parseBenchmarkGaps(input.benchmarkLines, input.channelEngagement, input.dealContext);
  const inputActivityLines = input.activities.length;
  const { kept, removedDuplicates, removedNoise, removedSamples } = dedupeActivities(input.activities);
  const { kept: collapsedNotes, removed: collapsedNotePairs } = collapseSameTimestampNotes(kept);
  const { selected: selectedActivities, pinnedCount } = selectActivities(collapsedNotes);

  return {
    stats: {
      inputChars: 0,
      outputChars: 0,
      inputActivityLines,
      keptActivities: selectedActivities.length,
      pinnedActivities: pinnedCount,
      removedDuplicates: removedDuplicates + collapsedNotePairs,
      removedNoise,
    },
    selectedActivities,
    precomputedSignals,
    benchmarkGaps,
    removedSamples,
  };
};

export const buildLightDealUserPrompt = (input: BuildLightDealUserPromptInput): DealPromptNormalizeResult => {
  const dealContext = dedupeDealContext(input.dealContext);
  const processed = processActivitiesForLightPrompt({ ...input, dealContext });
  const lightPrompt = buildLightPrompt({
    dealContext,
    companyContext: input.companyContext,
    channelEngagement: input.channelEngagement,
    precomputedSignals: processed.precomputedSignals,
    benchmarkLines: input.benchmarkLines,
    benchmarkGaps: processed.benchmarkGaps,
    storedActions: input.storedActions,
    activities: processed.selectedActivities,
  });

  return {
    stats: {
      ...processed.stats,
      outputChars: lightPrompt.length,
    },
    dealContext,
    companyContext: input.companyContext,
    channelEngagement: input.channelEngagement,
    precomputedSignals: processed.precomputedSignals,
    benchmarkLines: input.benchmarkLines,
    benchmarkGaps: processed.benchmarkGaps,
    storedActions: input.storedActions,
    keptActivities: processed.selectedActivities,
    removedSamples: processed.removedSamples,
    lightPrompt,
  };
};

export const normalizeDealPromptInput = (rawInput: string): DealPromptNormalizeResult => {
  const sections = splitSections(rawInput);
  const primaryDealContext = dedupeDealContext(parseKeyValueSection(sections["Contexte deal"]));
  const companyContext = parseKeyValueSection(sections["Contexte entreprise"]);
  const channelEngagement = parseChannelEngagement(
    sections["Engagement par canal"] ?? sections["Signaux d'activite pre-calcules"],
  );
  const benchmarkLines = parseBenchmarkLines(sections["Benchmark win"]);
  const storedActions = parseStoredActions(sections["Actions deja stockees"]);

  const resumeActivities = extractActivityLines(sections["Resume activite CRM"], "resume");
  const signalActivities = extractActivityLines(sections["Signaux d'activite pre-calcules"], "signals");
  const historyActivities = extractActivityLines(sections["Historique HubSpot chronologique"], "history");

  const mergedActivities = [...resumeActivities, ...signalActivities, ...historyActivities];
  const built = buildLightDealUserPrompt({
    dealContext: primaryDealContext,
    companyContext,
    channelEngagement,
    lastContactAt: primaryDealContext["Dernier contact connu"] ?? null,
    benchmarkLines,
    storedActions,
    activities: mergedActivities,
  });

  return {
    ...built,
    stats: {
      ...built.stats,
      inputChars: rawInput.length,
      inputActivityLines: mergedActivities.length,
    },
  };
};