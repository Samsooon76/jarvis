import type {
  CallAnalysisDetail,
  CallAnalysisListItem,
  CallInsightSummary,
  CallRiskLevel,
  CallSentiment as BackendCallSentiment,
} from "@jarvis/shared";
import { apiPath, getJson, postJson, type ApiRequestOptions } from "./client";

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
  summary: string | null;
  nextStep: string | null;
  riskSignals: string[];
  positiveSignals: string[];
};

export type CallDetail = CallListItem & {
  recordingUrl: string | null;
  transcript: string | null;
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
  hubspotCallId: null,
  hubspotDealId: null,
  prospectId: call.prospectId,
  contactName: null,
  companyName: null,
  dealName: null,
  ownerName: null,
  ownerHubSpotId: null,
  direction: "outbound",
  outcome: toOutcome(call),
  analysisStatus: toAnalysisStatus(call),
  sentiment: call.sentiment,
  priority: toPriority(call.riskLevel),
  startedAt: toStartedAt(call.startedAt),
  durationSeconds: call.durationSeconds,
  summary: call.summary,
  nextStep: null,
  riskSignals: call.riskLevel === "high" ? ["Risque eleve detecte"] : [],
  positiveSignals: call.sentiment === "positive" ? ["Sentiment positif"] : [],
});

const mapCallDetail = (detail: CallAnalysisDetail): CallDetail => {
  const base = mapCallListItem(detail);
  const nextStep = detail.analysis?.nextSteps[0]?.title ?? null;

  return {
    ...base,
    nextStep,
    riskSignals: detail.analysis?.risks ?? base.riskSignals,
    positiveSignals: detail.analysis?.opportunities ?? base.positiveSignals,
    recordingUrl: null,
    transcript: null,
    analysis: detail.analysis
      ? {
          generatedAt: detail.analyzedAt,
          provider: detail.provider,
          model: detail.model,
          summary: detail.analysis.summary,
          customerNeeds: detail.analysis.customerSignals,
          objections: detail.analysis.objections,
          risks: detail.analysis.risks,
          nextSteps: detail.analysis.nextSteps.map((step) => step.title),
          coachingNotes: detail.analysis.coachingTips,
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
    totalCalls: totalAnalyzed,
    analyzedCalls: totalAnalyzed,
    connectedCalls: totalAnalyzed,
    averageDurationSeconds: 0,
    positiveSentimentRate: sentimentTotal > 0 ? Math.round((positiveCount / sentimentTotal) * 100) : 0,
    riskCallCount: (insights.riskLevel as Record<CallRiskLevel, number>).high ?? 0,
    topObjections: insights.topObjections,
    coachingThemes: insights.topCoachingTips,
    followUpGaps: [],
  };
};

export const fetchCalls = (
  orgId: string,
  period: CallPeriodFilter,
  type: CallTypeFilter,
  options: ApiRequestOptions = {},
): Promise<CallsListResult> =>
  getJson<CallAnalysisListItem[]>(apiPath("/api/calls", { orgId, period, type }), options).then((calls) => ({
    orgId,
    period,
    type,
    generatedAt: new Date().toISOString(),
    calls: calls.map(mapCallListItem).filter((call) => type === "all" || call.direction === type),
  }));

export const fetchCallDetail = (
  orgId: string,
  callId: string,
  options: ApiRequestOptions = {},
): Promise<CallDetail> =>
  getJson<CallAnalysisDetail>(apiPath(`/api/calls/${encodeURIComponent(callId)}`, { orgId }), options).then(mapCallDetail);

export const fetchCallInsights = (
  orgId: string,
  period: CallPeriodFilter,
  options: ApiRequestOptions = {},
): Promise<CallInsights> =>
  getJson<CallInsightSummary>(apiPath("/api/calls/insights", { orgId, period }), options).then((insights) =>
    mapInsights(orgId, period, insights),
  );

export const runCallAnalysis = (orgId: string, period: CallPeriodFilter): Promise<AnalyzeCallsRunResult> =>
  postJson<BackfillJobResult>("/api/calls/analyze/run", { orgId, period }).then((job) => ({
    orgId,
    requestedCount: job.result?.processed ?? 0,
    analyzedCount: job.result?.analyzed ?? 0,
    skippedCount: job.result?.skipped ?? 0,
    failedCount: job.result?.failed ?? 0,
    generatedAt: new Date().toISOString(),
  }));
