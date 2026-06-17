
import {
  buildCrmFacts,
  buildDealAnalysisSnapshot,
  buildDealMetrics,
  buildHealthDimensions,
  buildPrimaryActions,
  buildProbabilityTrend,
} from "./presentation.js";
import {
  mapDealAnalysisV1ToActivityPlan,
  mapDealAnalysisV1ToIntelligence,
  mapDealAnalysisV1ToQualification,
} from "./v1-adapter.js";
import { resolveDealAnalysisV1ForProspect } from "./v1.js";
import { sanitizeDealActivityPlanAnalysis } from "./shared.js";
import type {
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
  const resolved = await resolveDealAnalysisV1ForProspect(prospectId, context);
  const analysis = mapDealAnalysisV1ToIntelligence(resolved.analysis);

  return {
    prospectId: resolved.prospectId,
    orgId: resolved.orgId,
    hubspotDealId: resolved.hubspotDealId,
    cached: resolved.cached,
    provider: resolved.provider,
    model: resolved.model,
    generatedAt: resolved.generatedAt,
    expiresAt: resolved.expiresAt,
    analysis,
  };
};

export const buildDealAnalysisPageForProspect = async (
  prospectId: string,
  context: DealIntelligenceContext = {},
): Promise<DealAnalysisPageResult> => {
  const resolved = await resolveDealAnalysisV1ForProspect(prospectId, context);
  const intelligence = mapDealAnalysisV1ToIntelligence(resolved.analysis);
  const snapshot = await buildDealAnalysisSnapshot(resolved.target, context, intelligence);
  const healthDimensions = buildHealthDimensions(intelligence, snapshot.lastContactAt);
  const metrics = buildDealMetrics(snapshot, intelligence, healthDimensions);

  return {
    prospectId: resolved.prospectId,
    orgId: resolved.orgId,
    hubspotDealId: resolved.hubspotDealId,
    cached: resolved.cached,
    provider: resolved.provider,
    model: resolved.model,
    generatedAt: resolved.generatedAt,
    expiresAt: resolved.expiresAt,
    analysis: intelligence,
    snapshot,
    metrics,
    healthDimensions,
    probabilityTrend: buildProbabilityTrend(intelligence, snapshot.lastContactAt),
    primaryActions: buildPrimaryActions(intelligence, resolved.pendingActions),
    crmFacts: buildCrmFacts(snapshot, intelligence),
    lastSyncedAt: snapshot.syncedAt,
  };
};

export const analyzeDealQualificationForProspect = async (
  prospectId: string,
  context: DealIntelligenceContext = {},
): Promise<DealQualificationResult> => {
  const resolved = await resolveDealAnalysisV1ForProspect(prospectId, context);

  return {
    prospectId: resolved.prospectId,
    orgId: resolved.orgId,
    hubspotDealId: resolved.hubspotDealId,
    cached: resolved.cached,
    provider: resolved.provider,
    model: resolved.model,
    generatedAt: resolved.generatedAt,
    expiresAt: resolved.expiresAt,
    qualification: mapDealAnalysisV1ToQualification(resolved.analysis),
  };
};

export const analyzeDealActivityPlanForProspect = async (
  prospectId: string,
  context: DealIntelligenceContext = {},
): Promise<DealActivityPlanResult> => {
  const resolved = await resolveDealAnalysisV1ForProspect(prospectId, context);
  const today = new Date();

  return {
    prospectId: resolved.prospectId,
    orgId: resolved.orgId,
    hubspotDealId: resolved.hubspotDealId,
    cached: resolved.cached,
    provider: resolved.provider,
    model: resolved.model,
    generatedAt: resolved.generatedAt,
    expiresAt: resolved.expiresAt,
    recentActivities: resolved.recentActivities,
    channelEngagement: resolved.channelEngagement,
    activityPlan: sanitizeDealActivityPlanAnalysis(
      mapDealAnalysisV1ToActivityPlan(resolved.analysis),
      today,
    ),
  };
};

const buildBundleFromResolved = async (
  resolved: Awaited<ReturnType<typeof resolveDealAnalysisV1ForProspect>>,
  context: DealIntelligenceContext,
): Promise<DealAnalysisBundleResult> => {
  const intelligence = mapDealAnalysisV1ToIntelligence(resolved.analysis);
  const snapshot = await buildDealAnalysisSnapshot(resolved.target, context, intelligence);
  const healthDimensions = buildHealthDimensions(intelligence, snapshot.lastContactAt);
  const metrics = buildDealMetrics(snapshot, intelligence, healthDimensions);
  const today = new Date();

  const page: DealAnalysisPageResult = {
    prospectId: resolved.prospectId,
    orgId: resolved.orgId,
    hubspotDealId: resolved.hubspotDealId,
    cached: resolved.cached,
    provider: resolved.provider,
    model: resolved.model,
    generatedAt: resolved.generatedAt,
    expiresAt: resolved.expiresAt,
    analysis: intelligence,
    snapshot,
    metrics,
    healthDimensions,
    probabilityTrend: buildProbabilityTrend(intelligence, snapshot.lastContactAt),
    primaryActions: buildPrimaryActions(intelligence, resolved.pendingActions),
    crmFacts: buildCrmFacts(snapshot, intelligence),
    lastSyncedAt: snapshot.syncedAt,
  };

  const qualification: DealQualificationResult = {
    prospectId: resolved.prospectId,
    orgId: resolved.orgId,
    hubspotDealId: resolved.hubspotDealId,
    cached: resolved.cached,
    provider: resolved.provider,
    model: resolved.model,
    generatedAt: resolved.generatedAt,
    expiresAt: resolved.expiresAt,
    qualification: mapDealAnalysisV1ToQualification(resolved.analysis),
  };

  const activityPlan: DealActivityPlanResult = {
    prospectId: resolved.prospectId,
    orgId: resolved.orgId,
    hubspotDealId: resolved.hubspotDealId,
    cached: resolved.cached,
    provider: resolved.provider,
    model: resolved.model,
    generatedAt: resolved.generatedAt,
    expiresAt: resolved.expiresAt,
    recentActivities: resolved.recentActivities,
    channelEngagement: resolved.channelEngagement,
    activityPlan: sanitizeDealActivityPlanAnalysis(
      mapDealAnalysisV1ToActivityPlan(resolved.analysis),
      today,
    ),
  };

  return {
    page,
    qualification,
    activityPlan,
  };
};

export const buildDealAnalysisBundleForProspect = async (
  prospectId: string,
  context: DealIntelligenceContext = {},
): Promise<DealAnalysisBundleResult> => {
  const resolved = await resolveDealAnalysisV1ForProspect(prospectId, context);

  return buildBundleFromResolved(resolved, context);
};

