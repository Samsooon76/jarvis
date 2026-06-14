import type {
  CallAnalysisDetail,
  CallAnalysisListItem,
  CallInsightSummary,
  CallRiskLevel,
  CallSentiment as BackendCallSentiment,
} from "@jarvis/shared";
import { apiPath, getJson, postJson, type ApiRequestOptions } from "./client";
import { ANALYTICS_DETAIL_CACHE_TTL_MS, ANALYTICS_OVERVIEW_CACHE_TTL_MS, getCachedJson, POLL_TIMEOUT_MS, pollDelayMs, wait } from "./cache";

export type CallDirection = "inbound" | "outbound";
export type CallAnalysisStatus = "analyzed" | "pending" | "failed" | "not_analyzed";
export type CallOutcome = "connected" | "no_answer" | "left_voicemail" | "meeting_booked" | "next_step" | "lost" | "unknown";
export type CallPeriodFilter = "7d" | "30d" | "90d";
export type CallTypeFilter = "all" | CallDirection;
export type CallActorRole = "manager" | "sales";

export type CallSentiment = "positive" | "neutral" | "negative" | "mixed";
export type CallPriority = "low" | "medium" | "high";

export type CallListItem = {
  id: string;
  orgId: string;
  userId: string | null;
  hubspotCallId: string | null;
  hubspotDealId: string | null;
  prospectId: string | null;
  contactName: string | null;
  companyName: string | null;
  dealName: string | null;
  ownerName: string | null;
  ownerHubSpotId: string | null;
  direction: CallDirection;
  outcome: CallOutcome;
  analysisStatus: CallAnalysisStatus;
  sentiment: CallSentiment | null;
  priority: CallPriority | null;
  startedAt: string;
  durationSeconds: number | null;
  mergedCallCount: number;
  summary: string | null;
  nextStep: string | null;
  riskSignals: string[];
  positiveSignals: string[];
};

export type CallDetail = CallListItem & {
  recordingUrl: string | null;
  transcript: string | null;
  sourceKind: "transcript" | "notes" | "summary" | null;
  analysis: {
    generatedAt: string | null;
    provider: string | null;
    model: string | null;
    summary: string | null;
    customerNeeds: string[];
    objections: string[];
    risks: string[];
    nextSteps: string[];
    coachingNotes: string[];
  } | null;
};

export type CallInsights = {
  orgId: string;
  period: CallPeriodFilter;
  generatedAt: string;
  totalCalls: number;
  analyzedCalls: number;
  connectedCalls: number;
  averageDurationSeconds: number;
  positiveSentimentRate: number;
  riskCallCount: number;
  topObjections: Array<{ label: string; count: number }>;
  coachingThemes: Array<{ label: string; count: number }>;
  followUpGaps: Array<{ callId: string; label: string; ownerName: string | null; startedAt: string }>;
};

export type CallsListResult = {
  orgId: string;
  period: CallPeriodFilter;
  type: CallTypeFilter;
  generatedAt: string;
  calls: CallListItem[];
};

export type AnalyzeCallsRunResult = {
  orgId: string;
  requestedCount: number;
  analyzedCount: number;
  skippedCount: number;
  failedCount: number;
  generatedAt: string;
};

type BackfillJobResult = {
  id: string;
  orgId: string | null;
  status: "queued" | "running" | "completed" | "failed";
  result?: {
    processed?: number;
    analyzed?: number;
    skipped?: number;
    failed?: number;
  } | null;
};

// Defense en profondeur: les analyses cachees avant le nettoyage backend peuvent
// encore contenir du HTML HubSpot (<p>, <br>, entites). On nettoie a l'affichage.
const stripHtml = (value: string): string =>
  value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// Lignes de plomberie Onoff/Modjo/HubSpot qui peuvent rester dans les analyses
// cachees avant le filtrage backend: on les ecarte aussi a l'affichage.
const BOILERPLATE_PATTERNS: RegExp[] = [
  /^appel (sortant|entrant)/i,
  /^destinataire de l'appel/i,
  /^date\s*:/i,
  /^dur[eé]e\s*:?/i,
  /^duration\s*:/i,
  /^titre\s*:/i,
  /^disposition\s*:/i,
  /^contexte\s*:/i,
  /^resume ia\s*:/i,
  /^resume prospect\s*:/i,
  /^prochaine action\s*:/i,
  /^notes\s*:/i,
  /^\(ajoutez vos notes ici\)/i,
  /^would like to go deeper/i,
  /^this call on modjo/i,
  /^tags on this call/i,
  /^statut (hubspot )?/i,
];

const isBoilerplate = (line: string): boolean =>
  BOILERPLATE_PATTERNS.some((pattern) => pattern.test(line.trim()));

const cleanText = (value: string | null): string | null => {
  if (!value) {
    return value;
  }

  const stripped = stripHtml(value)
    .split("\n")
    .filter((line) => line.trim() && !isBoilerplate(line))
    .join("\n");

  return stripped || null;
};

const cleanList = (values: string[] | undefined): string[] =>
  (values ?? []).map((value) => stripHtml(value)).filter((value) => value && !isBoilerplate(value));

const toStartedAt = (value: string | null): string => value ?? new Date(0).toISOString();

const toAnalysisStatus = (call: CallAnalysisListItem): CallAnalysisStatus =>
  call.analyzedAt ? "analyzed" : "not_analyzed";

const toOutcome = (call: CallAnalysisListItem): CallOutcome => {
  if (call.durationSeconds === null) {
    return "unknown";
  }

  if (call.durationSeconds <= 0) {
    return "no_answer";
  }

  return call.durationSeconds < 45 ? "left_voicemail" : "connected";
};

const toPriority = (riskLevel: CallRiskLevel | null): CallPriority | null => riskLevel;

const mapCallListItem = (call: CallAnalysisListItem): CallListItem => ({
  id: call.callId,
  orgId: call.orgId,
  userId: call.userId,
  hubspotCallId: null,
  hubspotDealId: null,
  prospectId: call.prospectId,
  contactName: call.contactName,
  companyName: call.companyName,
  dealName: null,
  ownerName: call.ownerName,
  ownerHubSpotId: null,
  direction: call.direction,
  outcome: toOutcome(call),
  analysisStatus: toAnalysisStatus(call),
  sentiment: call.sentiment,
  priority: toPriority(call.riskLevel),
  startedAt: toStartedAt(call.startedAt),
  durationSeconds: call.durationSeconds,
  mergedCallCount: call.mergedCallCount,
  summary: cleanText(call.summary),
  nextStep: null,
  riskSignals: call.riskLevel === "high" ? ["Risque eleve detecte"] : [],
  positiveSignals: call.sentiment === "positive" ? ["Sentiment positif"] : [],
});

const mapCallDetail = (detail: CallAnalysisDetail): CallDetail => {
  const base = mapCallListItem(detail);
  const nextStep = detail.analysis?.nextSteps[0]?.title ?? null;

  return {
    ...base,
    nextStep: cleanText(nextStep),
    riskSignals: cleanList(detail.analysis?.risks) ?? base.riskSignals,
    positiveSignals: cleanList(detail.analysis?.opportunities) ?? base.positiveSignals,
    recordingUrl: null,
    transcript: cleanText(detail.sourceText),
    sourceKind: detail.sourceKind,
    analysis: detail.analysis
      ? {
          generatedAt: detail.analyzedAt,
          provider: detail.provider,
          model: detail.model,
          summary: cleanText(detail.analysis.summary),
          customerNeeds: cleanList(detail.analysis.customerSignals),
          objections: cleanList(detail.analysis.objections),
          risks: cleanList(detail.analysis.risks),
          nextSteps: cleanList(detail.analysis.nextSteps.map((step) => step.title)),
          coachingNotes: cleanList(detail.analysis.coachingTips),
        }
      : null,
  };
};

const sumRecord = <T extends string>(record: Record<T, number>): number =>
  (Object.values(record) as number[]).reduce((sum, value) => sum + value, 0);

const mapInsights = (orgId: string, period: CallPeriodFilter, insights: CallInsightSummary): CallInsights => {
  const totalAnalyzed = insights.totalAnalyzed;
  const positiveCount = (insights.sentiment as Record<BackendCallSentiment, number>).positive ?? 0;
  const sentimentTotal = sumRecord(insights.sentiment);

  return {
    orgId,
    period,
    generatedAt: insights.generatedAt,
    totalCalls: insights.totalCalls,
    analyzedCalls: totalAnalyzed,
    connectedCalls: insights.connectedCalls,
    averageDurationSeconds: insights.averageDurationSeconds,
    positiveSentimentRate: sentimentTotal > 0 ? Math.round((positiveCount / sentimentTotal) * 100) : 0,
    riskCallCount: (insights.riskLevel as Record<CallRiskLevel, number>).high ?? 0,
    topObjections: insights.topObjections.map((item) => ({ ...item, label: stripHtml(item.label) })),
    coachingThemes: insights.topCoachingTips.map((item) => ({ ...item, label: stripHtml(item.label) })),
    followUpGaps: [],
  };
};

export const fetchCalls = async (
  orgId: string,
  period: CallPeriodFilter,
  type: CallTypeFilter,
  userId: string | null = null,
  options: ApiRequestOptions = {},
  forceRefresh = false,
): Promise<CallsListResult> => {
  const path = apiPath("/api/calls", { orgId, period, type, userId });
  const calls = await getCachedJson<CallAnalysisListItem[]>(
    `calls:list:${path}`,
    path,
    ANALYTICS_OVERVIEW_CACHE_TTL_MS,
    forceRefresh,
    options,
  );

  return {
    orgId,
    period,
    type,
    generatedAt: new Date().toISOString(),
    calls: calls.map(mapCallListItem).filter((call) => type === "all" || call.direction === type),
  };
};

export const fetchCallDetail = (
  orgId: string,
  callId: string,
  options: ApiRequestOptions = {},
  forceRefresh = false,
): Promise<CallDetail> => {
  const path = apiPath(`/api/calls/${encodeURIComponent(callId)}`, { orgId });

  return getCachedJson<CallAnalysisDetail>(
    `calls:detail:${path}`,
    path,
    ANALYTICS_DETAIL_CACHE_TTL_MS,
    forceRefresh,
    options,
  ).then(mapCallDetail);
};

export const analyzeSingleCall = (
  orgId: string,
  callId: string,
  refresh = false,
): Promise<CallDetail> =>
  postJson<CallAnalysisDetail>(`/api/calls/${encodeURIComponent(callId)}/analyze`, { orgId, refresh }).then(mapCallDetail);

export const fetchCallInsights = (
  orgId: string,
  period: CallPeriodFilter,
  userId: string | null = null,
  options: ApiRequestOptions = {},
  forceRefresh = false,
): Promise<CallInsights> => {
  const path = apiPath("/api/calls/insights", { orgId, period, userId });

  return getCachedJson<CallInsightSummary>(
    `calls:insights:${path}`,
    path,
    ANALYTICS_OVERVIEW_CACHE_TTL_MS,
    forceRefresh,
    options,
  ).then((insights) => mapInsights(orgId, period, insights));
};

// Lance le backfill puis poll le job jusqu'a sa fin: la route repond 202 avec un
// job "queued", le resultat n'existe qu'une fois le job complete.
export const runCallAnalysis = async (orgId: string, period: CallPeriodFilter): Promise<AnalyzeCallsRunResult> => {
  const queued = await postJson<BackfillJobResult>("/api/calls/analyze/run", { orgId, period });
  const startedAt = Date.now();
  let job = queued;
  let attempt = 0;

  while (job.status === "queued" || job.status === "running") {
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      throw new Error("L'analyse des appels prend trop de temps. Reessayez plus tard.");
    }

    await wait(pollDelayMs(attempt));
    attempt += 1;
    job = await getJson<BackfillJobResult>(`/api/calls/backfill/jobs/${encodeURIComponent(queued.id)}`);
  }

  if (job.status === "failed") {
    throw new Error("L'analyse des appels a echoue. Consultez les logs backend.");
  }

  return {
    orgId,
    requestedCount: job.result?.processed ?? 0,
    analyzedCount: job.result?.analyzed ?? 0,
    skippedCount: job.result?.skipped ?? 0,
    failedCount: job.result?.failed ?? 0,
    generatedAt: new Date().toISOString(),
  };
};
