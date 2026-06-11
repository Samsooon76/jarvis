import { getHubSpotAccessToken } from "../hubspot-auth.service.js";
import { createLlmProvider } from "../llm/provider.factory.js";
import type {
  DealFullAnalysis,
  DealIntelligenceAnalysis,
  DealQualificationAnalysis,
} from "../llm/llm.provider.js";
import { buildExpiresAt, loadCachedAnalysis, loadReusableCachedAnalysis, persistAnalysis } from "./cache.js";
import {
  loadDealHistoryForAnalysis,
  loadHubSpotDealSnapshot,
  loadOwnerUserName,
  loadPendingActions,
  resolveDealTarget,
  updateProspectWithAnalysis,
} from "./data-access.js";
import {
  buildChannelEngagement,
  buildCrmFacts,
  buildDealAnalysisSnapshot,
  buildDealMetrics,
  buildHealthDimensions,
  buildPrimaryActions,
  buildProbabilityTrend,
  buildRecentActivities,
  summarizeChannelEngagement,
  summarizePendingActions,
  summarizeRecentActivities,
} from "./presentation.js";
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
  sanitizeDealActivityPlanAnalysis,
  splitDealActivityPlanCachePayload,
} from "./shared.js";
import type {
  DealActivityPlanCachePayload,
  DealActivityPlanResult,
  DealAnalysisBundleResult,
  DealAnalysisPageResult,
  DealIntelligenceContext,
  DealIntelligenceResult,
  DealQualificationResult,
} from "./types.js";

export const analyzeDealIntelligenceForProspect = async (
  prospectId: string,
  context: DealIntelligenceContext = {},
): Promise<DealIntelligenceResult> => {
  const target = await resolveDealTarget(prospectId, context);
  const provider = createLlmProvider({
    provider: context.llmProvider,
    model: context.llmModel,
  });
  const providerName = provider.providerName;
  const modelName = provider.modelName;

  if (!context.refresh) {
    const cachedAnalysis = await loadCachedAnalysis<DealIntelligenceAnalysis>(
      "deal_intelligence",
      target.orgId,
      target.hubspotDealId,
      providerName,
      modelName,
    );

    if (cachedAnalysis) {
      return {
        prospectId: target.prospect?.id ?? prospectId,
        orgId: target.orgId,
        hubspotDealId: target.hubspotDealId,
        cached: true,
        provider: cachedAnalysis.provider,
        model: cachedAnalysis.model,
        generatedAt: cachedAnalysis.generated_at,
        expiresAt: cachedAnalysis.expires_at,
        analysis: cachedAnalysis.analysis,
      };
    }
  }

  const accessToken = await getHubSpotAccessToken(target.orgId);
  const dealHistory = await loadDealHistoryForAnalysis(target.orgId, accessToken, target.hubspotDealId);
  const historyText = buildHistoryText(dealHistory.timeline);
  const currentCloseProbability = target.prospect?.close_probability ?? context.currentCloseProbability ?? null;
  const dealAmount = target.prospect?.deal_amount ?? context.dealAmount ?? null;
  const dealStage = target.prospect?.deal_stage ?? context.dealStage ?? null;
  const lastContactAt = target.prospect?.last_contact_at ?? context.lastContactAt ?? null;
  const nextAction = target.prospect?.next_action ?? context.nextAction ?? null;
  const today = new Date();
  const todayIso = today.toISOString();
  const inputHash = hashInput(
    JSON.stringify({
      companyName: dealHistory.companyName ?? target.prospect?.company ?? null,
      dealName: dealHistory.dealName,
      companyContext: dealHistory.companyContext,
      dealContext: dealHistory.dealContext,
      historyText,
      currentCloseProbability,
      dealAmount,
      referenceDay: todayIso.slice(0, 10),
    }),
  );

  if (!context.refresh) {
    const cachedAnalysis = await loadReusableCachedAnalysis<DealIntelligenceAnalysis>(
      "deal_intelligence",
      target.orgId,
      target.hubspotDealId,
      providerName,
      modelName,
      inputHash,
    );

    if (cachedAnalysis) {
      return {
        prospectId: target.prospect?.id ?? prospectId,
        orgId: target.orgId,
        hubspotDealId: target.hubspotDealId,
        cached: true,
        provider: cachedAnalysis.provider,
        model: cachedAnalysis.model,
        generatedAt: cachedAnalysis.generated_at,
        expiresAt: cachedAnalysis.expires_at,
        analysis: cachedAnalysis.analysis,
      };
    }
  }

  const analysis = await provider.analyzeDealIntelligence({
    history: historyText || "Aucun historique HubSpot exploitable.",
    companyName: dealHistory.companyName ?? target.prospect?.company ?? null,
    dealName: dealHistory.dealName,
    companyContext: dealHistory.companyContext,
    dealContext: dealHistory.dealContext,
    dealStage,
    objective: "Calculer le close won, expliquer le deal et planifier les next steps factuels",
    today: todayIso,
    lastContactAt,
    nextAction,
    contactNames: dealHistory.contactNames,
    currentCloseProbability,
    dealAmount,
  });
  const expiresAt = buildExpiresAt();
  const savedAnalysis = await persistAnalysis<DealIntelligenceAnalysis>({
    analysisType: "deal_intelligence",
    orgId: target.orgId,
    hubspotDealId: target.hubspotDealId,
    provider: providerName,
    model: modelName,
    inputHash,
    analysis,
    closeWonProbability: analysis.closeWonProbability,
    expiresAt,
  });

  await updateProspectWithAnalysis(target.prospect, analysis);

  return {
    prospectId: target.prospect?.id ?? prospectId,
    orgId: target.orgId,
    hubspotDealId: target.hubspotDealId,
    cached: false,
    provider: savedAnalysis?.provider ?? providerName,
    model: savedAnalysis?.model ?? modelName,
    generatedAt: savedAnalysis?.generated_at ?? new Date().toISOString(),
    expiresAt: savedAnalysis?.expires_at ?? expiresAt,
    analysis: savedAnalysis?.analysis ?? analysis,
  };
};

export const buildDealAnalysisPageForProspect = async (
  prospectId: string,
  context: DealIntelligenceContext = {},
): Promise<DealAnalysisPageResult> => {
  const [target, intelligence] = await Promise.all([
    resolveDealTarget(prospectId, context),
    analyzeDealIntelligenceForProspect(prospectId, context),
  ]);
  const snapshot = await buildDealAnalysisSnapshot(target, context, intelligence.analysis);
  const pendingActions = await loadPendingActions(target.prospect?.id ?? (isUuid(prospectId) ? prospectId : null));
  const healthDimensions = buildHealthDimensions(intelligence.analysis, snapshot.lastContactAt);
  const metrics = buildDealMetrics(snapshot, intelligence.analysis, healthDimensions);

  return {
    ...intelligence,
    snapshot,
    metrics,
    healthDimensions,
    probabilityTrend: buildProbabilityTrend(intelligence.analysis, snapshot.lastContactAt),
    primaryActions: buildPrimaryActions(intelligence.analysis, pendingActions),
    crmFacts: buildCrmFacts(snapshot, intelligence.analysis),
    lastSyncedAt: snapshot.syncedAt,
  };
};

export const analyzeDealQualificationForProspect = async (
  prospectId: string,
  context: DealIntelligenceContext = {},
): Promise<DealQualificationResult> => {
  const target = await resolveDealTarget(prospectId, context);
  const provider = createLlmProvider({
    provider: context.llmProvider,
    model: context.llmModel,
  });

  if (!context.refresh) {
    const cachedQualification = await loadCachedAnalysis<DealQualificationAnalysis>(
      "deal_qualification",
      target.orgId,
      target.hubspotDealId,
      provider.providerName,
      provider.modelName,
    );

    if (cachedQualification) {
      return {
        prospectId: target.prospect?.id ?? prospectId,
        orgId: target.orgId,
        hubspotDealId: target.hubspotDealId,
        cached: true,
        provider: cachedQualification.provider,
        model: cachedQualification.model,
        generatedAt: cachedQualification.generated_at,
        expiresAt: cachedQualification.expires_at,
        qualification: cachedQualification.analysis,
      };
    }
  }

  const accessToken = await getHubSpotAccessToken(target.orgId);
  const [dealHistory, hubspotDeal, ownerNameFromUser] = await Promise.all([
    loadDealHistoryForAnalysis(target.orgId, accessToken, target.hubspotDealId),
    loadHubSpotDealSnapshot(target.orgId, target.hubspotDealId),
    loadOwnerUserName(target.prospect?.owner_user_id ?? null),
  ]);
  const rawData = asRecord(target.prospect?.raw_data);
  const rawDeal = readNestedRecord(rawData, "deal");
  const rawDealProperties = readNestedRecord(rawDeal, "properties");
  const historyText = buildHistoryText(dealHistory.timeline);
  const companyName = firstNonEmptyString(
    context.companyName,
    dealHistory.companyName,
    target.prospect?.company,
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
  const ownerName = firstNonEmptyString(
    context.ownerName,
    ownerNameFromUser,
    readString(rawData, "hubspotOwnerName"),
    hubspotDeal?.hubspot_owner_id ? `Owner ${hubspotDeal.hubspot_owner_id}` : null,
  );
  const contactNames =
    dealHistory.contactNames.length > 0
      ? dealHistory.contactNames
      : [context.contactName, target.prospect?.name].filter((value): value is string => Boolean(value?.trim()));
  const lastContactAt = firstNonEmptyString(target.prospect?.last_contact_at, context.lastContactAt);
  const nextAction = firstNonEmptyString(target.prospect?.next_action, context.nextAction);
  const today = new Date();
  const todayIso = today.toISOString();
  const inputHash = hashInput(
    JSON.stringify({
      analysisType: "deal_qualification",
      companyName,
      dealName,
      companyContext: dealHistory.companyContext,
      dealContext: dealHistory.dealContext,
      historyText,
      dealStage,
      currentCloseProbability,
      dealAmount,
      closeDate,
      ownerName,
      contactNames,
      referenceDay: todayIso.slice(0, 10),
    }),
  );

  if (!context.refresh) {
    const cachedQualification = await loadReusableCachedAnalysis<DealQualificationAnalysis>(
      "deal_qualification",
      target.orgId,
      target.hubspotDealId,
      provider.providerName,
      provider.modelName,
      inputHash,
    );

    if (cachedQualification) {
      return {
        prospectId: target.prospect?.id ?? prospectId,
        orgId: target.orgId,
        hubspotDealId: target.hubspotDealId,
        cached: true,
        provider: cachedQualification.provider,
        model: cachedQualification.model,
        generatedAt: cachedQualification.generated_at,
        expiresAt: cachedQualification.expires_at,
        qualification: cachedQualification.analysis,
      };
    }
  }

  const qualification = await provider.analyzeDealQualification({
    history: historyText || "Aucun historique HubSpot exploitable.",
    companyName,
    dealName,
    companyContext: dealHistory.companyContext,
    dealContext: dealHistory.dealContext,
    dealStage,
    objective: "Qualifier le comite d'achat, MEDDICC, le processus de decision et les risques a partir du CRM",
    today: todayIso,
    lastContactAt,
    nextAction,
    contactNames,
    currentCloseProbability,
    dealAmount,
    closeDate,
    ownerName,
  });
  const expiresAt = buildExpiresAt();
  const savedQualification = await persistAnalysis<DealQualificationAnalysis>({
    analysisType: "deal_qualification",
    orgId: target.orgId,
    hubspotDealId: target.hubspotDealId,
    provider: provider.providerName,
    model: provider.modelName,
    inputHash,
    analysis: qualification,
    closeWonProbability: currentCloseProbability ?? 0,
    expiresAt,
  });

  return {
    prospectId: target.prospect?.id ?? prospectId,
    orgId: target.orgId,
    hubspotDealId: target.hubspotDealId,
    cached: false,
    provider: savedQualification?.provider ?? provider.providerName,
    model: savedQualification?.model ?? provider.modelName,
    generatedAt: savedQualification?.generated_at ?? new Date().toISOString(),
    expiresAt: savedQualification?.expires_at ?? expiresAt,
    qualification: savedQualification?.analysis ?? qualification,
  };
};

export const analyzeDealActivityPlanForProspect = async (
  prospectId: string,
  context: DealIntelligenceContext = {},
): Promise<DealActivityPlanResult> => {
  const target = await resolveDealTarget(prospectId, context);
  const provider = createLlmProvider({
    provider: context.llmProvider,
    model: context.llmModel,
  });

  if (!context.refresh) {
    const earlyCachedActivityPlan = await loadCachedAnalysis<DealActivityPlanCachePayload>(
      "deal_activity_plan",
      target.orgId,
      target.hubspotDealId,
      provider.providerName,
      provider.modelName,
    );

    if (earlyCachedActivityPlan) {
      const { activityPlan, cachedContext } = splitDealActivityPlanCachePayload(earlyCachedActivityPlan.analysis);

      if (cachedContext) {
        return {
          prospectId: target.prospect?.id ?? prospectId,
          orgId: target.orgId,
          hubspotDealId: target.hubspotDealId,
          cached: true,
          provider: earlyCachedActivityPlan.provider,
          model: earlyCachedActivityPlan.model,
          generatedAt: earlyCachedActivityPlan.generated_at,
          expiresAt: earlyCachedActivityPlan.expires_at,
          recentActivities: cachedContext.recentActivities,
          channelEngagement: cachedContext.channelEngagement,
          activityPlan: sanitizeDealActivityPlanAnalysis(activityPlan, new Date()),
        };
      }
    }
  }

  const accessToken = await getHubSpotAccessToken(target.orgId);
  const [dealHistory, hubspotDeal, ownerNameFromUser, pendingActions] = await Promise.all([
    loadDealHistoryForAnalysis(target.orgId, accessToken, target.hubspotDealId),
    loadHubSpotDealSnapshot(target.orgId, target.hubspotDealId),
    loadOwnerUserName(target.prospect?.owner_user_id ?? null),
    loadPendingActions(target.prospect?.id ?? (isUuid(prospectId) ? prospectId : null), 8),
  ]);
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
  const crmActivitySummary = summarizeRecentActivities(recentActivities);
  const pendingActionsSummary = summarizePendingActions(pendingActions);
  const channelEngagementSummary = summarizeChannelEngagement(channelEngagement);
  const today = new Date();
  const todayIso = today.toISOString();
  const inputHash = hashInput(
    JSON.stringify({
      analysisType: "deal_activity_plan",
      companyName,
      dealName,
      companyContext: dealHistory.companyContext,
      dealContext: dealHistory.dealContext,
      historyText,
      recentActivities,
      channelEngagement,
      pendingActionsSummary,
      dealStage,
      currentCloseProbability,
      dealAmount,
      closeDate,
      ownerName,
      contactNames,
      referenceDay: todayIso.slice(0, 10),
    }),
  );

  if (!context.refresh) {
    const cachedActivityPlan = await loadReusableCachedAnalysis<DealActivityPlanCachePayload>(
      "deal_activity_plan",
      target.orgId,
      target.hubspotDealId,
      provider.providerName,
      provider.modelName,
      inputHash,
    );

    if (cachedActivityPlan) {
      return {
        prospectId: target.prospect?.id ?? prospectId,
        orgId: target.orgId,
        hubspotDealId: target.hubspotDealId,
        cached: true,
        provider: cachedActivityPlan.provider,
        model: cachedActivityPlan.model,
        generatedAt: cachedActivityPlan.generated_at,
        expiresAt: cachedActivityPlan.expires_at,
        recentActivities,
        channelEngagement,
        activityPlan: sanitizeDealActivityPlanAnalysis(
          splitDealActivityPlanCachePayload(cachedActivityPlan.analysis).activityPlan,
          today,
        ),
      };
    }
  }

  const activityPlan = sanitizeDealActivityPlanAnalysis(await provider.analyzeDealActivityPlan({
    history: historyText || "Aucun historique HubSpot exploitable.",
    companyName,
    dealName,
    companyContext: dealHistory.companyContext,
    dealContext: dealHistory.dealContext,
    dealStage,
    objective: "Construire l'activite recente, le plan d'action mutuel, les echeances et la prochaine meilleure action a partir du CRM",
    today: todayIso,
    lastContactAt,
    nextAction,
    contactNames,
    currentCloseProbability,
    dealAmount,
    closeDate,
    ownerName,
    crmActivitySummary,
    pendingActionsSummary,
    channelEngagementSummary,
  }), today);
  const expiresAt = buildExpiresAt();
  const savedActivityPlan = await persistAnalysis<DealActivityPlanCachePayload>({
    analysisType: "deal_activity_plan",
    orgId: target.orgId,
    hubspotDealId: target.hubspotDealId,
    provider: provider.providerName,
    model: provider.modelName,
    inputHash,
    analysis: { ...activityPlan, cachedContext: { recentActivities, channelEngagement } },
    closeWonProbability: currentCloseProbability ?? 0,
    expiresAt,
  });

  return {
    prospectId: target.prospect?.id ?? prospectId,
    orgId: target.orgId,
    hubspotDealId: target.hubspotDealId,
    cached: false,
    provider: savedActivityPlan?.provider ?? provider.providerName,
    model: savedActivityPlan?.model ?? provider.modelName,
    generatedAt: savedActivityPlan?.generated_at ?? new Date().toISOString(),
    expiresAt: savedActivityPlan?.expires_at ?? expiresAt,
    recentActivities,
    channelEngagement,
    activityPlan,
  };
};

const buildDealAnalysisBundleWithSingleCompletion = async (
  prospectId: string,
  context: DealIntelligenceContext,
): Promise<DealAnalysisBundleResult> => {
  const target = await resolveDealTarget(prospectId, context);
  const provider = createLlmProvider({
    provider: context.llmProvider,
    model: context.llmModel,
  });
  const accessToken = await getHubSpotAccessToken(target.orgId);
  const [dealHistory, hubspotDeal, ownerNameFromUser, pendingActions] = await Promise.all([
    loadDealHistoryForAnalysis(target.orgId, accessToken, target.hubspotDealId),
    loadHubSpotDealSnapshot(target.orgId, target.hubspotDealId),
    loadOwnerUserName(target.prospect?.owner_user_id ?? null),
    loadPendingActions(target.prospect?.id ?? (isUuid(prospectId) ? prospectId : null), 8),
  ]);
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
  const today = new Date();
  const todayIso = today.toISOString();
  const fullInput = {
    history: historyText || "Aucun historique HubSpot exploitable.",
    companyName,
    dealName,
    companyContext: dealHistory.companyContext,
    dealContext: dealHistory.dealContext,
    dealStage,
    objective: "Generer en une seule analyse l'overview, la qualification et le plan d'action du deal",
    today: todayIso,
    lastContactAt,
    nextAction,
    contactNames,
    currentCloseProbability,
    dealAmount,
    closeDate,
    ownerName,
    crmActivitySummary: summarizeRecentActivities(recentActivities),
    pendingActionsSummary: summarizePendingActions(pendingActions),
    channelEngagementSummary: summarizeChannelEngagement(channelEngagement),
  };
  const fullAnalysis: DealFullAnalysis = await provider.analyzeDealFull(fullInput);
  const expiresAt = buildExpiresAt();
  const baseHashPayload = {
    companyName,
    dealName,
    companyContext: dealHistory.companyContext,
    dealContext: dealHistory.dealContext,
    historyText,
    dealStage,
    currentCloseProbability,
    dealAmount,
    closeDate,
    ownerName,
    contactNames,
    referenceDay: todayIso.slice(0, 10),
  };
  const [savedIntelligence, savedQualification, savedActivityPlan] = await Promise.all([
    persistAnalysis<DealIntelligenceAnalysis>({
      analysisType: "deal_intelligence",
      orgId: target.orgId,
      hubspotDealId: target.hubspotDealId,
      provider: provider.providerName,
      model: provider.modelName,
      inputHash: hashInput(JSON.stringify({ ...baseHashPayload, analysisType: "deal_intelligence" })),
      analysis: fullAnalysis.intelligence,
      closeWonProbability: fullAnalysis.intelligence.closeWonProbability,
      expiresAt,
    }),
    persistAnalysis<DealQualificationAnalysis>({
      analysisType: "deal_qualification",
      orgId: target.orgId,
      hubspotDealId: target.hubspotDealId,
      provider: provider.providerName,
      model: provider.modelName,
      inputHash: hashInput(JSON.stringify({ ...baseHashPayload, analysisType: "deal_qualification" })),
      analysis: fullAnalysis.qualification,
      closeWonProbability: currentCloseProbability ?? 0,
      expiresAt,
    }),
    persistAnalysis<DealActivityPlanCachePayload>({
      analysisType: "deal_activity_plan",
      orgId: target.orgId,
      hubspotDealId: target.hubspotDealId,
      provider: provider.providerName,
      model: provider.modelName,
      inputHash: hashInput(JSON.stringify({
        ...baseHashPayload,
        analysisType: "deal_activity_plan",
        recentActivities,
        channelEngagement,
        pendingActionsSummary: summarizePendingActions(pendingActions),
      })),
      analysis: { ...fullAnalysis.activityPlan, cachedContext: { recentActivities, channelEngagement } },
      closeWonProbability: currentCloseProbability ?? 0,
      expiresAt,
    }),
  ]);

  await updateProspectWithAnalysis(target.prospect, fullAnalysis.intelligence);

  const intelligence = savedIntelligence?.analysis ?? fullAnalysis.intelligence;
  const snapshot = await buildDealAnalysisSnapshot(target, context, intelligence);
  const healthDimensions = buildHealthDimensions(intelligence, snapshot.lastContactAt);
  const metrics = buildDealMetrics(snapshot, intelligence, healthDimensions);
  const page: DealAnalysisPageResult = {
    prospectId: target.prospect?.id ?? prospectId,
    orgId: target.orgId,
    hubspotDealId: target.hubspotDealId,
    cached: false,
    provider: savedIntelligence?.provider ?? provider.providerName,
    model: savedIntelligence?.model ?? provider.modelName,
    generatedAt: savedIntelligence?.generated_at ?? new Date().toISOString(),
    expiresAt: savedIntelligence?.expires_at ?? expiresAt,
    analysis: intelligence,
    snapshot,
    metrics,
    healthDimensions,
    probabilityTrend: buildProbabilityTrend(intelligence, snapshot.lastContactAt),
    primaryActions: buildPrimaryActions(intelligence, pendingActions),
    crmFacts: buildCrmFacts(snapshot, intelligence),
    lastSyncedAt: snapshot.syncedAt,
  };

  return {
    page,
    qualification: {
      prospectId: target.prospect?.id ?? prospectId,
      orgId: target.orgId,
      hubspotDealId: target.hubspotDealId,
      cached: false,
      provider: savedQualification?.provider ?? provider.providerName,
      model: savedQualification?.model ?? provider.modelName,
      generatedAt: savedQualification?.generated_at ?? new Date().toISOString(),
      expiresAt: savedQualification?.expires_at ?? expiresAt,
      qualification: savedQualification?.analysis ?? fullAnalysis.qualification,
    },
    activityPlan: {
      prospectId: target.prospect?.id ?? prospectId,
      orgId: target.orgId,
      hubspotDealId: target.hubspotDealId,
      cached: false,
      provider: savedActivityPlan?.provider ?? provider.providerName,
      model: savedActivityPlan?.model ?? provider.modelName,
      generatedAt: savedActivityPlan?.generated_at ?? new Date().toISOString(),
      expiresAt: savedActivityPlan?.expires_at ?? expiresAt,
      recentActivities,
      channelEngagement,
      activityPlan: sanitizeDealActivityPlanAnalysis(fullAnalysis.activityPlan, today),
    },
  };
};

export const buildDealAnalysisBundleForProspect = async (
  prospectId: string,
  context: DealIntelligenceContext = {},
): Promise<DealAnalysisBundleResult> => {
  if (context.refresh) {
    return buildDealAnalysisBundleWithSingleCompletion(prospectId, context);
  }

  const target = await resolveDealTarget(prospectId, context);
  const provider = createLlmProvider({
    provider: context.llmProvider,
    model: context.llmModel,
  });
  const [cachedIntelligence, cachedQualification, cachedActivityPlan] = await Promise.all([
    loadCachedAnalysis<DealIntelligenceAnalysis>(
      "deal_intelligence",
      target.orgId,
      target.hubspotDealId,
      provider.providerName,
      provider.modelName,
    ),
    loadCachedAnalysis<DealQualificationAnalysis>(
      "deal_qualification",
      target.orgId,
      target.hubspotDealId,
      provider.providerName,
      provider.modelName,
    ),
    loadCachedAnalysis<DealActivityPlanCachePayload>(
      "deal_activity_plan",
      target.orgId,
      target.hubspotDealId,
      provider.providerName,
      provider.modelName,
    ),
  ]);

  if (!cachedIntelligence || !cachedQualification || !cachedActivityPlan) {
    return buildDealAnalysisBundleWithSingleCompletion(prospectId, context);
  }

  const snapshot = await buildDealAnalysisSnapshot(target, context, cachedIntelligence.analysis);
  const pendingActions = await loadPendingActions(target.prospect?.id ?? (isUuid(prospectId) ? prospectId : null));
  const healthDimensions = buildHealthDimensions(cachedIntelligence.analysis, snapshot.lastContactAt);
  const metrics = buildDealMetrics(snapshot, cachedIntelligence.analysis, healthDimensions);
  const page: DealAnalysisPageResult = {
    prospectId: target.prospect?.id ?? prospectId,
    orgId: target.orgId,
    hubspotDealId: target.hubspotDealId,
    cached: true,
    provider: cachedIntelligence.provider,
    model: cachedIntelligence.model,
    generatedAt: cachedIntelligence.generated_at,
    expiresAt: cachedIntelligence.expires_at,
    analysis: cachedIntelligence.analysis,
    snapshot,
    metrics,
    healthDimensions,
    probabilityTrend: buildProbabilityTrend(cachedIntelligence.analysis, snapshot.lastContactAt),
    primaryActions: buildPrimaryActions(cachedIntelligence.analysis, pendingActions),
    crmFacts: buildCrmFacts(snapshot, cachedIntelligence.analysis),
    lastSyncedAt: snapshot.syncedAt,
  };
  const { activityPlan: cachedPlanAnalysis, cachedContext } = splitDealActivityPlanCachePayload(
    cachedActivityPlan.analysis,
  );
  let recentActivities = cachedContext?.recentActivities ?? null;
  let channelEngagement = cachedContext?.channelEngagement ?? null;

  if (!recentActivities || !channelEngagement) {
    const accessToken = await getHubSpotAccessToken(target.orgId);
    const dealHistory = await loadDealHistoryForAnalysis(target.orgId, accessToken, target.hubspotDealId);
    recentActivities = buildRecentActivities(dealHistory.timeline, snapshot.ownerName);
    channelEngagement = buildChannelEngagement(dealHistory.timeline);
  }

  const qualification: DealQualificationResult = {
    prospectId: target.prospect?.id ?? prospectId,
    orgId: target.orgId,
    hubspotDealId: target.hubspotDealId,
    cached: true,
    provider: cachedQualification.provider,
    model: cachedQualification.model,
    generatedAt: cachedQualification.generated_at,
    expiresAt: cachedQualification.expires_at,
    qualification: cachedQualification.analysis,
  };
  const activityPlan: DealActivityPlanResult = {
    prospectId: target.prospect?.id ?? prospectId,
    orgId: target.orgId,
    hubspotDealId: target.hubspotDealId,
    cached: true,
    provider: cachedActivityPlan.provider,
    model: cachedActivityPlan.model,
    generatedAt: cachedActivityPlan.generated_at,
    expiresAt: cachedActivityPlan.expires_at,
    recentActivities,
    channelEngagement,
    activityPlan: sanitizeDealActivityPlanAnalysis(cachedPlanAnalysis, new Date()),
  };

  return {
    page,
    qualification,
    activityPlan,
  };
};
