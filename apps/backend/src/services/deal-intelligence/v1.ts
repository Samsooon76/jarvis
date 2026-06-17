import type { DealAnalysisV1, DealLifecycleStatus } from "@jarvis/shared";
import { logLlmDebug } from "../../lib/llm-debug.js";
import { getHubSpotAccessToken } from "../hubspot-auth.service.js";
import { isLostDeal } from "../close-lost-analysis/shared.js";
import type { HubSpotDealRow as CloseLostDealRow } from "../close-lost-analysis/types.js";
import { createLlmProvider } from "../llm/provider.factory.js";

import type { AnalyzeDealAnalysisV1Input } from "../llm/llm.provider.js";
import { buildDealAnalysisV1UserPrompt } from "../llm/deal-analysis-v1.js";
import {
  buildLightDealUserPrompt,
  mapTimelineToParsedActivities,
  parseContextSummary,
} from "./prompt-normalizer.js";
import { compareDealToBenchmark } from "../win-analysis/benchmark.js";
import { buildWinBenchmarkSummaryForPrompt } from "../win-analysis.service.js";
import { isWonDeal } from "../win-analysis/shared.js";
import type { HubSpotDealRow as WonDealRow } from "../win-analysis/types.js";
import { buildExpiresAt, loadCachedAnalysis, loadReusableCachedAnalysis, persistAnalysis } from "./cache.js";
import {
  loadDealHistoryForAnalysis,
  loadHubSpotCompanySnapshot,
  loadHubSpotDealSnapshot,
  loadOwnerUserName,
  loadPendingActions,
  resolveDealTarget,
  updateProspectWithAnalysis,
} from "./data-access.js";
import {
  buildChannelEngagement,
  buildRecentActivities,
  summarizeChannelEngagement,
  summarizePendingActions,
  summarizeRecentActivities,
} from "./presentation.js";
import { mapDealAnalysisV1ToIntelligence } from "./v1-adapter.js";
import {
  asRecord,
  buildHistoryText,
  firstDefined,
  firstNonEmptyString,
  hashInput,
  isUuid,
  normalizeTimestamp,
  parseNumber,
  parseProbability,
  readNestedRecord,
  readNestedString,
  readString,
} from "./shared.js";
import type {
  DealActivityPlanCacheContext,
  DealChannelEngagement,
  DealIntelligenceContext,
  DealRecentActivity,
  HubSpotDealSnapshotRow,
  ResolvedDealTarget,
} from "./types.js";

export type DealAnalysisV1CachePayload = DealAnalysisV1 & {
  cachedContext?: DealActivityPlanCacheContext;
};

export type DealAnalysisV1Resolved = {
  prospectId: string;
  orgId: string;
  hubspotDealId: string;
  cached: boolean;
  provider: string;
  model: string;
  generatedAt: string;
  expiresAt: string;
  analysis: DealAnalysisV1;
  target: ResolvedDealTarget;
  recentActivities: DealRecentActivity[];
  channelEngagement: DealChannelEngagement[];
  pendingActions: Awaited<ReturnType<typeof loadPendingActions>>;
  hubspotDeal: HubSpotDealSnapshotRow | null;
  companyIndustry: string | null;
};

const resolveLifecycleStatus = (deal: HubSpotDealSnapshotRow | null): DealLifecycleStatus => {
  if (!deal) {
    return "open";
  }

  const row = {
    deal_lifecycle_status: deal.deal_lifecycle_status ?? null,
    deal_stage: deal.deal_stage,
    deal_stage_label: deal.deal_stage_label ?? null,
    is_closed_deal: deal.is_closed_deal ?? null,
  } as CloseLostDealRow & WonDealRow;

  if (isLostDeal(row)) {
    return "lost";
  }

  if (isWonDeal(row)) {
    return "won";
  }

  return "open";
};

const buildBenchmarkSummaryForDeal = async (orgId: string, hubspotDealId: string): Promise<string | null> => {
  try {
    const [comparison, orgBenchmark] = await Promise.all([
      compareDealToBenchmark(orgId, hubspotDealId),
      buildWinBenchmarkSummaryForPrompt(orgId),
    ]);
    const lines: string[] = [];

    if (orgBenchmark) {
      lines.push(orgBenchmark);
    }

    if (comparison.reliable && comparison.gaps.length > 0) {
      lines.push(
        ...comparison.gaps.map(
          (gap) => `${gap.label}: actuel=${gap.actual}, benchmark=${gap.benchmark} (${gap.metric})`,
        ),
      );
    }

    return lines.length > 0 ? lines.join("\n") : null;
  } catch {
    return null;
  }
};

const buildActivitySignalsSummary = (
  recentActivities: DealRecentActivity[],
  channelEngagement: DealChannelEngagement[],
  lastContactAt: string | null,
): string => {
  const lines = [
    `Dernier contact connu: ${lastContactAt ?? "inconnu"}`,
    `Activites recentes analysees: ${recentActivities.length}`,
    summarizeRecentActivities(recentActivities),
    summarizeChannelEngagement(channelEngagement),
  ].filter(Boolean);

  return lines.join("\n");
};

const buildInputHash = (payload: Record<string, unknown>): string => hashInput(JSON.stringify(payload));

const loadPreparedContext = async (
  prospectId: string,
  context: DealIntelligenceContext,
): Promise<{
  target: ResolvedDealTarget;
  dealHistory: Awaited<ReturnType<typeof loadDealHistoryForAnalysis>>;
  hubspotDeal: HubSpotDealSnapshotRow | null;
  companyIndustry: string | null;
  ownerName: string | null;
  recentActivities: DealRecentActivity[];
  channelEngagement: DealChannelEngagement[];
  pendingActions: Awaited<ReturnType<typeof loadPendingActions>>;
  historyText: string;
  companyName: string | null;
  dealName: string | null;
  dealStage: string | null;
  pipeline: string | null;
  currentCloseProbability: number | null;
  dealAmount: number | null;
  closeDate: string | null;
  contactNames: string[];
  lastContactAt: string | null;
  nextAction: string | null;
  lifecycleStatus: DealLifecycleStatus;
}> => {
  const target = await resolveDealTarget(prospectId, context);
  const accessToken = await getHubSpotAccessToken(target.orgId);
  const [dealHistory, hubspotDeal, ownerNameFromUser, pendingActions] = await Promise.all([
    loadDealHistoryForAnalysis(target.orgId, accessToken, target.hubspotDealId),
    loadHubSpotDealSnapshot(target.orgId, target.hubspotDealId),
    loadOwnerUserName(target.prospect?.owner_user_id ?? null),
    loadPendingActions(target.prospect?.id ?? (isUuid(prospectId) ? prospectId : null), 8),
  ]);
  const companySnapshot = await loadHubSpotCompanySnapshot(
    target.orgId,
    hubspotDeal?.primary_company_id ?? null,
  );
  const rawData = asRecord(target.prospect?.raw_data);
  const rawDeal = readNestedRecord(rawData, "deal");
  const rawDealProperties = readNestedRecord(rawDeal, "properties");
  const ownerName = firstNonEmptyString(
    context.ownerName,
    ownerNameFromUser,
    readString(rawData, "hubspotOwnerName"),
    hubspotDeal?.hubspot_owner_id ? `Owner ${hubspotDeal.hubspot_owner_id}` : null,
  );
  const recentActivities = buildRecentActivities(dealHistory.timeline, ownerName);
  const channelEngagement = buildChannelEngagement(dealHistory.timeline);
  const historyText = buildHistoryText(dealHistory.timeline);
  const companyName = firstNonEmptyString(
    context.companyName,
    dealHistory.companyName,
    target.prospect?.company,
    companySnapshot?.name,
    readNestedString(rawData, ["company", "properties", "name"]),
  );
  const dealName = firstNonEmptyString(dealHistory.dealName, hubspotDeal?.deal_name, readString(rawData, "dealName"));
  const dealStage = firstNonEmptyString(
    hubspotDeal?.deal_stage_label ?? null,
    hubspotDeal?.deal_stage,
    target.prospect?.deal_stage,
    context.dealStage,
    readString(rawDealProperties, "dealstage"),
  );
  const pipeline = firstNonEmptyString(hubspotDeal?.pipeline_label ?? null, readString(rawDealProperties, "pipeline"));
  const currentCloseProbability = firstDefined(
    parseProbability(hubspotDeal?.close_probability),
    target.prospect?.close_probability ?? null,
    context.currentCloseProbability ?? null,
    parseProbability(readString(rawDealProperties, "hs_deal_stage_probability")),
  );
  const dealAmount = firstDefined(
    parseNumber(hubspotDeal?.amount),
    target.prospect?.deal_amount ?? null,
    context.dealAmount ?? null,
    parseNumber(readString(rawDealProperties, "amount")),
  );
  const closeDate = firstNonEmptyString(
    normalizeTimestamp(context.closeDate),
    normalizeTimestamp(hubspotDeal?.closed_at),
    normalizeTimestamp(readString(rawDealProperties, "closedate")),
  );
  const contactNames =
    dealHistory.contactNames.length > 0
      ? dealHistory.contactNames
      : [context.contactName, target.prospect?.name].filter((value): value is string => Boolean(value?.trim()));
  const lastContactAt = firstNonEmptyString(target.prospect?.last_contact_at, context.lastContactAt);
  const nextAction = firstNonEmptyString(target.prospect?.next_action, context.nextAction);

  return {
    target,
    dealHistory,
    hubspotDeal,
    companyIndustry: companySnapshot?.industry ?? null,
    ownerName,
    recentActivities,
    channelEngagement,
    pendingActions,
    historyText,
    companyName,
    dealName,
    dealStage,
    pipeline,
    currentCloseProbability,
    dealAmount,
    closeDate,
    contactNames,
    lastContactAt,
    nextAction,
    lifecycleStatus: resolveLifecycleStatus(hubspotDeal),
  };
};

const OPENAI_DEAL_ANALYSIS_V1_SYSTEM_MESSAGE =
  "Tu reponds uniquement en json valide, sans markdown. Tu n'inventes pas de faits absents des donnees fournies.";

const buildDealContextRecord = (
  prepared: Awaited<ReturnType<typeof loadPreparedContext>>,
  todayIso: string,
): Record<string, string> => {
  const fromDealHistory = parseContextSummary(prepared.dealHistory.dealContext);
  const contacts =
    prepared.contactNames.length > 0 ? prepared.contactNames.join(", ") : fromDealHistory.Contacts;

  return {
    ...fromDealHistory,
    Entreprise: prepared.companyName ?? fromDealHistory.Entreprise ?? "inconnue",
    Industrie: prepared.companyIndustry ?? fromDealHistory.Industrie ?? fromDealHistory.Secteur ?? "inconnue",
    Contacts: contacts ?? "inconnus",
    Deal: prepared.dealName ?? fromDealHistory.Deal ?? fromDealHistory["Nom du deal"] ?? "inconnu",
    Owner: prepared.ownerName ?? fromDealHistory.Owner ?? "inconnu",
    Stage: prepared.dealStage ?? fromDealHistory.Stage ?? "inconnu",
    Pipeline: prepared.pipeline ?? fromDealHistory.Pipeline ?? "inconnu",
    Montant:
      prepared.dealAmount !== null && prepared.dealAmount !== undefined
        ? String(prepared.dealAmount)
        : (fromDealHistory.Montant ?? "inconnu"),
    "Probabilite HubSpot actuelle":
      prepared.currentCloseProbability !== null && prepared.currentCloseProbability !== undefined
        ? String(prepared.currentCloseProbability)
        : (fromDealHistory.Probabilite ?? fromDealHistory["Probabilite HubSpot actuelle"] ?? "inconnue"),
    "Date de cloture": prepared.closeDate ?? fromDealHistory["Date de closing"] ?? fromDealHistory["Date de cloture"] ?? "inconnue",
    "Dernier contact connu": prepared.lastContactAt ?? fromDealHistory["Dernier contact connu"] ?? "inconnu",
    "Prochaine action stockee": prepared.nextAction ?? fromDealHistory["Prochaine action stockee"] ?? "aucune",
    "Statut lifecycle": prepared.lifecycleStatus,
    "Aujourd'hui": todayIso,
    Objectif: "Produire une analyse deal complete et actionnable (qualification, forecast, plan d'action)",
  };
};

const buildLightUserPromptFromPrepared = (
  prepared: Awaited<ReturnType<typeof loadPreparedContext>>,
  todayIso: string,
  winBenchmarkSummary: string | null,
): string => {
  const normalized = buildLightDealUserPrompt({
    dealContext: buildDealContextRecord(prepared, todayIso),
    companyContext: parseContextSummary(prepared.dealHistory.companyContext),
    channelEngagement: Object.fromEntries(
      prepared.channelEngagement
        .filter((item) => item.count > 0)
        .map((item) => [item.label, item.count]),
    ),
    lastContactAt: prepared.lastContactAt,
    benchmarkLines: (winBenchmarkSummary ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    storedActions: prepared.pendingActions.map((action) =>
      [
        action.title,
        action.description ?? null,
        action.due_at ? `due: ${normalizeTimestamp(action.due_at) ?? action.due_at}` : null,
        `status: ${action.status}`,
        action.ai_generated ? "source: ia" : "source: crm/local",
      ]
        .filter(Boolean)
        .join(" | "),
    ),
    activities: mapTimelineToParsedActivities(prepared.dealHistory.timeline, prepared.ownerName),
  });

  return normalized.lightPrompt;
};

const buildDealAnalysisV1LlmInput = async (
  prepared: Awaited<ReturnType<typeof loadPreparedContext>>,
  inputHash: string,
  todayIso: string,
): Promise<AnalyzeDealAnalysisV1Input> => {
  const winBenchmarkSummary = await buildBenchmarkSummaryForDeal(
    prepared.target.orgId,
    prepared.target.hubspotDealId,
  );
  const lightUserPrompt = buildLightUserPromptFromPrepared(prepared, todayIso, winBenchmarkSummary);

  return {
    orgId: prepared.target.orgId,
    hubspotDealId: prepared.target.hubspotDealId,
    hubspotOwnerId: prepared.hubspotDeal?.hubspot_owner_id ?? null,
    primaryContactId: prepared.hubspotDeal?.primary_contact_id ?? null,
    primaryCompanyId: prepared.hubspotDeal?.primary_company_id ?? null,
    prospectId: prepared.target.prospect?.id ?? null,
    pipeline: prepared.pipeline,
    lifecycleStatus: prepared.lifecycleStatus,
    companyIndustry: prepared.companyIndustry,
    activitySignalsSummary: buildActivitySignalsSummary(
      prepared.recentActivities,
      prepared.channelEngagement,
      prepared.lastContactAt,
    ),
    winBenchmarkSummary,
    analysisType: "deal_full",
    inputHash,
    sourceSyncedAt: prepared.hubspotDeal?.synced_at ?? prepared.target.prospect?.synced_at ?? null,
    history: prepared.historyText || "Aucun historique HubSpot exploitable.",
    companyName: prepared.companyName,
    dealName: prepared.dealName,
    companyContext: prepared.dealHistory.companyContext,
    dealContext: prepared.dealHistory.dealContext,
    dealStage: prepared.dealStage,
    objective: "Produire une analyse deal complete et actionnable (qualification, forecast, plan d'action)",
    today: todayIso,
    lastContactAt: prepared.lastContactAt,
    nextAction: prepared.nextAction,
    contactNames: prepared.contactNames,
    currentCloseProbability: prepared.currentCloseProbability,
    dealAmount: prepared.dealAmount,
    closeDate: prepared.closeDate,
    ownerName: prepared.ownerName,
    crmActivitySummary: summarizeRecentActivities(prepared.recentActivities),
    pendingActionsSummary: summarizePendingActions(prepared.pendingActions),
    channelEngagementSummary: summarizeChannelEngagement(prepared.channelEngagement),
    lightUserPrompt,
  };
};

export type DealAnalysisV1LlmRequestPreview = {
  prospectId: string;
  orgId: string;
  hubspotDealId: string;
  dealName: string | null;
  companyName: string | null;
  lifecycleStatus: DealLifecycleStatus;
  inputHash: string;
  llmInput: AnalyzeDealAnalysisV1Input;
  systemMessage: string;
  userPrompt: string;
  openAiChatCompletionsBody: {
    model: string;
    messages: Array<{ role: "system" | "user"; content: string }>;
    response_format: { type: "json_object" };
    reasoning_effort: "minimal";
    max_completion_tokens: number;
    stream: false;
  };
  geminiGenerateContentBody: {
    contents: Array<{ role: "user"; parts: Array<{ text: string }> }>;
    generationConfig: {
      temperature: number;
      responseMimeType: "application/json";
    };
  };
};

export const previewDealAnalysisV1LlmRequestForProspect = async (
  prospectId: string,
  context: DealIntelligenceContext = {},
  model = "gpt-4.1",
): Promise<DealAnalysisV1LlmRequestPreview> => {
  const prepared = await loadPreparedContext(prospectId, context);
  const todayIso = new Date().toISOString();
  const inputHash = buildInputHash({
    analysisType: "deal_analysis_v1",
    lifecycleStatus: prepared.lifecycleStatus,
    companyName: prepared.companyName,
    dealName: prepared.dealName,
    companyContext: prepared.dealHistory.companyContext,
    dealContext: prepared.dealHistory.dealContext,
    historyText: prepared.historyText,
    dealStage: prepared.dealStage,
    pipeline: prepared.pipeline,
    currentCloseProbability: prepared.currentCloseProbability,
    dealAmount: prepared.dealAmount,
    closeDate: prepared.closeDate,
    ownerName: prepared.ownerName,
    contactNames: prepared.contactNames,
    recentActivities: prepared.recentActivities,
    channelEngagement: prepared.channelEngagement,
    pendingActionsSummary: summarizePendingActions(prepared.pendingActions),
    referenceDay: todayIso.slice(0, 10),
  });
  const llmInput = await buildDealAnalysisV1LlmInput(prepared, inputHash, todayIso);
  const userPrompt = buildDealAnalysisV1UserPrompt(llmInput);

  return {
    prospectId: prepared.target.prospect?.id ?? prospectId,
    orgId: prepared.target.orgId,
    hubspotDealId: prepared.target.hubspotDealId,
    dealName: prepared.dealName,
    companyName: prepared.companyName,
    lifecycleStatus: prepared.lifecycleStatus,
    inputHash,
    llmInput,
    systemMessage: OPENAI_DEAL_ANALYSIS_V1_SYSTEM_MESSAGE,
    userPrompt,
    openAiChatCompletionsBody: {
      model,
      messages: [
        { role: "system", content: OPENAI_DEAL_ANALYSIS_V1_SYSTEM_MESSAGE },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      reasoning_effort: "minimal",
      max_completion_tokens: 12_000,
      stream: false,
    },
    geminiGenerateContentBody: {
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    },
  };
};

const inFlightResolves = new Map<string, Promise<DealAnalysisV1Resolved>>();

const buildInFlightKey = (prospectId: string, context: DealIntelligenceContext): string =>
  [
    prospectId,
    context.orgId ?? "",
    context.hubspotDealId ?? "",
    context.llmProvider ?? "",
    context.llmModel ?? "",
    context.refresh ? "refresh" : "stable",
  ].join("|");

const resolveDealAnalysisV1ForProspectInternal = async (
  prospectId: string,
  context: DealIntelligenceContext = {},
): Promise<DealAnalysisV1Resolved> => {
  const prepared = await loadPreparedContext(prospectId, context);
  const provider = createLlmProvider({
    provider: context.llmProvider,
    model: context.llmModel,
  });
  const providerName = provider.providerName;
  const modelName = provider.modelName;
  const todayIso = new Date().toISOString();
  const inputHash = buildInputHash({
    analysisType: "deal_analysis_v1",
    lifecycleStatus: prepared.lifecycleStatus,
    companyName: prepared.companyName,
    dealName: prepared.dealName,
    companyContext: prepared.dealHistory.companyContext,
    dealContext: prepared.dealHistory.dealContext,
    historyText: prepared.historyText,
    dealStage: prepared.dealStage,
    pipeline: prepared.pipeline,
    currentCloseProbability: prepared.currentCloseProbability,
    dealAmount: prepared.dealAmount,
    closeDate: prepared.closeDate,
    ownerName: prepared.ownerName,
    contactNames: prepared.contactNames,
    recentActivities: prepared.recentActivities,
    channelEngagement: prepared.channelEngagement,
    pendingActionsSummary: summarizePendingActions(prepared.pendingActions),
    referenceDay: todayIso.slice(0, 10),
  });

  if (!context.refresh) {
    const cached =
      (await loadReusableCachedAnalysis<DealAnalysisV1CachePayload>(
        "deal_analysis_v1",
        prepared.target.orgId,
        prepared.target.hubspotDealId,
        providerName,
        modelName,
        inputHash,
      )) ??
      (await loadCachedAnalysis<DealAnalysisV1CachePayload>(
        "deal_analysis_v1",
        prepared.target.orgId,
        prepared.target.hubspotDealId,
        providerName,
        modelName,
      ));

    if (cached) {
      const cachedContext = cached.analysis.cachedContext;

      return {
        prospectId: prepared.target.prospect?.id ?? prospectId,
        orgId: prepared.target.orgId,
        hubspotDealId: prepared.target.hubspotDealId,
        cached: true,
        provider: cached.provider,
        model: cached.model,
        generatedAt: cached.generated_at,
        expiresAt: cached.expires_at,
        analysis: cached.analysis,
        target: prepared.target,
        recentActivities: cachedContext?.recentActivities ?? prepared.recentActivities,
        channelEngagement: cachedContext?.channelEngagement ?? prepared.channelEngagement,
        pendingActions: prepared.pendingActions,
        hubspotDeal: prepared.hubspotDeal,
        companyIndustry: prepared.companyIndustry,
      };
    }
  }

  const llmInput = await buildDealAnalysisV1LlmInput(prepared, inputHash, todayIso);
  const generatedAt = new Date().toISOString();
  const rawResponse = await provider.analyzeDealAnalysisV1(llmInput);
  const analysis: DealAnalysisV1 = {
    ...rawResponse,
    metadata: {
      ...rawResponse.metadata,
      cache: {
        ...rawResponse.metadata.cache,
        inputHash,
        sourceSyncedAt: llmInput.sourceSyncedAt ?? null,
      },
    },
  };
  const expiresAt = buildExpiresAt();
  const cachePayload: DealAnalysisV1CachePayload = {
    ...analysis,
    cachedContext: {
      recentActivities: prepared.recentActivities,
      channelEngagement: prepared.channelEngagement,
    },
  };
  const savedAnalysis = await persistAnalysis<DealAnalysisV1CachePayload>({
    analysisType: "deal_analysis_v1",
    orgId: prepared.target.orgId,
    hubspotDealId: prepared.target.hubspotDealId,
    provider: providerName,
    model: modelName,
    inputHash,
    analysis: cachePayload,
    closeWonProbability: mapDealAnalysisV1ToIntelligence(analysis).closeWonProbability,
    expiresAt,
  });

  await updateProspectWithAnalysis(prepared.target.prospect, mapDealAnalysisV1ToIntelligence(analysis));

  return {
    prospectId: prepared.target.prospect?.id ?? prospectId,
    orgId: prepared.target.orgId,
    hubspotDealId: prepared.target.hubspotDealId,
    cached: false,
    provider: savedAnalysis?.provider ?? providerName,
    model: savedAnalysis?.model ?? modelName,
    generatedAt: savedAnalysis?.generated_at ?? generatedAt,
    expiresAt: savedAnalysis?.expires_at ?? expiresAt,
    analysis,
    target: prepared.target,
    recentActivities: prepared.recentActivities,
    channelEngagement: prepared.channelEngagement,
    pendingActions: prepared.pendingActions,
    hubspotDeal: prepared.hubspotDeal,
    companyIndustry: prepared.companyIndustry,
  };
};

export const resolveDealAnalysisV1ForProspect = async (
  prospectId: string,
  context: DealIntelligenceContext = {},
): Promise<DealAnalysisV1Resolved> => {
  const inFlightKey = buildInFlightKey(prospectId, context);
  const pending = inFlightResolves.get(inFlightKey);

  if (pending) {
    logLlmDebug("resolve.joined_in_flight", {
      label: "deal_analysis_v1",
      inFlightKey,
      refresh: context.refresh === true,
    });

    return pending;
  }

  const promise = resolveDealAnalysisV1ForProspectInternal(prospectId, context);
  inFlightResolves.set(inFlightKey, promise);

  try {
    return await promise;
  } finally {
    inFlightResolves.delete(inFlightKey);
  }
};