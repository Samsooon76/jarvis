import { createHash } from "node:crypto";
import { env } from "../config/env.js";
import { getSupabaseAdmin } from "../db/client.js";
import { loadLocalHubSpotDealHistory } from "./hubspot-activity-history.service.js";
import { formatHubSpotTimelineForPrompt } from "./hubspot-history-formatting.service.js";
import { hubSpotService, type HubSpotDealHistoryItem } from "./hubspot.service.js";
import { getHubSpotAccessToken } from "./hubspot-auth.service.js";
import { createLlmProvider } from "./llm/provider.factory.js";
import type {
  DealActivityPlanAnalysis,
  DealFullAnalysis,
  DealIntelligenceAnalysis,
  DealQualificationAnalysis,
} from "./llm/llm.provider.js";

const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DealIntelligenceContext = {
  orgId?: string | null;
  hubspotDealId?: string | null;
  llmProvider?: string | null;
  llmModel?: string | null;
  contactName?: string | null;
  contactTitle?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  companyName?: string | null;
  ownerName?: string | null;
  closeDate?: string | null;
  currentCloseProbability?: number | null;
  dealAmount?: number | null;
  dealStage?: string | null;
  lastContactAt?: string | null;
  nextAction?: string | null;
  refresh?: boolean;
};

type ProspectRow = {
  id: string;
  org_id: string;
  owner_user_id: string | null;
  hubspot_contact_id: string;
  hubspot_deal_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  deal_stage: string | null;
  deal_amount: number | null;
  close_probability: number;
  last_contact_at: string | null;
  next_action: string | null;
  next_action_at: string | null;
  raw_data: unknown;
  synced_at: string;
};

type DealAiAnalysisRow = {
  id: string;
  analysis: DealIntelligenceAnalysis;
  analysis_type?: string;
  provider: string;
  model: string;
  input_hash: string;
  generated_at: string;
  expires_at: string;
};

type DealAiAnalysisType = "deal_intelligence" | "deal_qualification" | "deal_activity_plan";

type DealAiAnalysisCacheRow<TAnalysis> = Omit<DealAiAnalysisRow, "analysis"> & {
  analysis: TAnalysis;
};

type SupabaseErrorLike = {
  code?: string;
  message?: string;
};

type ResolvedDealTarget = {
  prospect: ProspectRow | null;
  orgId: string;
  hubspotContactId: string | null;
  hubspotDealId: string;
};

export type DealIntelligenceResult = {
  prospectId: string;
  orgId: string;
  hubspotDealId: string;
  cached: boolean;
  provider: string;
  model: string;
  generatedAt: string;
  expiresAt: string;
  analysis: DealIntelligenceAnalysis;
};

export type DealAnalysisMetric = {
  id: "dealValue" | "weightedValue" | "stageAge" | "engagementScore";
  label: string;
  value: number;
  unit: "currency" | "days" | "score";
  caption: string;
};

export type DealAnalysisHealthDimension = {
  id: "intent" | "momentum" | "competition";
  label: string;
  level: "low" | "medium" | "high";
  score: number;
  tone: "green" | "amber" | "red";
  rationale: string;
};

export type DealAnalysisTrendPoint = {
  date: string;
  label: string;
  probability: number;
};

export type DealAnalysisAction = {
  title: string;
  rationale: string;
  dueAt: string;
  priority: "low" | "medium" | "high";
  source: "ai" | "crm";
};

export type DealAnalysisSnapshot = {
  prospectId: string;
  orgId: string;
  hubspotDealId: string;
  hubspotContactId: string | null;
  dealName: string | null;
  companyName: string;
  contactName: string;
  contactTitle: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  ownerName: string | null;
  ownerHubSpotId: string | null;
  amount: number;
  weightedAmount: number;
  stage: string;
  closeProbability: number;
  forecastLabel: "best_case" | "commit" | "pipeline" | "at_risk";
  closeDate: string | null;
  stageEnteredAt: string | null;
  stageAgeDays: number;
  lastContactAt: string | null;
  syncedAt: string | null;
};

export type DealAnalysisPageResult = DealIntelligenceResult & {
  snapshot: DealAnalysisSnapshot;
  metrics: DealAnalysisMetric[];
  healthDimensions: DealAnalysisHealthDimension[];
  probabilityTrend: DealAnalysisTrendPoint[];
  primaryActions: DealAnalysisAction[];
  crmFacts: string[];
  lastSyncedAt: string | null;
};

export type DealQualificationResult = {
  prospectId: string;
  orgId: string;
  hubspotDealId: string;
  cached: boolean;
  provider: string;
  model: string;
  generatedAt: string;
  expiresAt: string;
  qualification: DealQualificationAnalysis;
};

export type DealRecentActivity = {
  id: string;
  type: "note" | "call" | "meeting" | "email" | "sms" | "communication" | "deal" | "task";
  occurredAt: string | null;
  title: string;
  body: string | null;
  actorName: string | null;
  channel: "email" | "call" | "meeting" | "note" | "sms" | "communication" | "deal" | "task";
};

export type DealChannelEngagement = {
  channel: "email" | "call" | "meeting" | "note" | "sms" | "communication" | "task";
  label: string;
  count: number;
  responseRate: number | null;
  caption: string;
};

export type DealActivityPlanResult = {
  prospectId: string;
  orgId: string;
  hubspotDealId: string;
  cached: boolean;
  provider: string;
  model: string;
  generatedAt: string;
  expiresAt: string;
  recentActivities: DealRecentActivity[];
  channelEngagement: DealChannelEngagement[];
  activityPlan: DealActivityPlanAnalysis;
};

export type DealAnalysisBundleResult = {
  page: DealAnalysisPageResult;
  qualification: DealQualificationResult;
  activityPlan: DealActivityPlanResult;
};

const isUuid = (value: string): boolean => UUID_V4_LIKE_PATTERN.test(value.trim());

const parseCompositeProspectId = (prospectId: string): { hubspotContactId: string; hubspotDealId: string | null } | null => {
  const separatorIndex = prospectId.indexOf(":");

  if (separatorIndex <= 0) {
    return null;
  }

  const hubspotContactId = prospectId.slice(0, separatorIndex).trim();
  const rawDealId = prospectId.slice(separatorIndex + 1).trim();
  const hubspotDealId = rawDealId && rawDealId !== "contact" ? rawDealId : null;

  if (!hubspotContactId) {
    return null;
  }

  return {
    hubspotContactId,
    hubspotDealId,
  };
};

const resolveDealTarget = async (prospectId: string, context: DealIntelligenceContext): Promise<ResolvedDealTarget> => {
  const supabase = getSupabaseAdmin();

  if (isUuid(prospectId)) {
    const { data, error } = await supabase
      .from("prospects")
      .select(
        "id, org_id, owner_user_id, hubspot_contact_id, hubspot_deal_id, name, email, phone, company, title, deal_stage, deal_amount, close_probability, last_contact_at, next_action, next_action_at, raw_data, synced_at",
      )
      .eq("id", prospectId)
      .maybeSingle();

    if (error) {
      throw new Error(`Impossible de charger le prospect: ${error.message}`);
    }

    const prospect = data as ProspectRow | null;

    if (!prospect) {
      throw new Error("Prospect introuvable.");
    }

    if (!prospect.hubspot_deal_id) {
      throw new Error("Ce prospect n'a pas de deal HubSpot associe.");
    }

    return {
      prospect,
      orgId: prospect.org_id,
      hubspotContactId: prospect.hubspot_contact_id,
      hubspotDealId: prospect.hubspot_deal_id,
    };
  }

  const compositeId = parseCompositeProspectId(prospectId);
  const orgId = context.orgId?.trim() || null;
  const contextHubSpotDealId = context.hubspotDealId?.trim() || null;

  if (!orgId) {
    throw new Error("orgId est obligatoire pour analyser un deal non synchronise localement.");
  }

  if (!contextHubSpotDealId && !compositeId?.hubspotDealId) {
    throw new Error("hubspotDealId est obligatoire pour analyser ce deal.");
  }

  return {
    prospect: null,
    orgId,
    hubspotContactId: compositeId?.hubspotContactId ?? null,
    hubspotDealId: contextHubSpotDealId ?? compositeId?.hubspotDealId ?? "",
  };
};

const buildHistoryText = (timeline: HubSpotDealHistoryItem[]): string => formatHubSpotTimelineForPrompt(timeline);

const hashInput = (value: string): string => createHash("sha256").update(value).digest("hex");

const isMissingDealAiAnalysesTableError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const typedError = error as SupabaseErrorLike;
  const message = typedError.message ?? "";

  return typedError.code === "42P01" || typedError.code === "PGRST205" || message.includes("deal_ai_analyses");
};

const isMissingAnalysisTypeColumnError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const typedError = error as SupabaseErrorLike;
  const message = typedError.message ?? "";

  return typedError.code === "42703" || typedError.code === "PGRST204" || message.includes("analysis_type");
};

const buildExpiresAt = (): string => {
  const ttlHours = Number.isFinite(env.dealAiCacheTtlHours) && env.dealAiCacheTtlHours > 0 ? env.dealAiCacheTtlHours : 6;
  const expiresAt = new Date();
  expiresAt.setUTCHours(expiresAt.getUTCHours() + ttlHours);

  return expiresAt.toISOString();
};

type JsonRecord = Record<string, unknown>;

type HubSpotDealSnapshotRow = {
  hubspot_owner_id: string | null;
  primary_contact_id: string | null;
  primary_company_id: string | null;
  deal_name: string | null;
  amount: number | string | null;
  deal_stage: string | null;
  deal_stage_label?: string | null;
  close_probability: number | string | null;
  closed_at: string | null;
  hubspot_created_at: string | null;
  hubspot_updated_at: string | null;
  properties: unknown;
  synced_at: string;
};

type HubSpotContactSnapshotRow = {
  email: string | null;
  name: string;
  phone: string | null;
  title: string | null;
  company_name: string | null;
  properties: unknown;
};

type HubSpotCompanySnapshotRow = {
  name: string | null;
  domain: string | null;
  industry: string | null;
  country: string | null;
  properties: unknown;
};

type OwnerUserSnapshotRow = {
  name: string;
};

type ActionSnapshotRow = {
  title: string;
  description: string | null;
  due_at: string | null;
  status: string;
  ai_generated: boolean;
};

const asRecord = (value: unknown): JsonRecord | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;

const readString = (record: JsonRecord | null, key: string): string | null => {
  const value = record?.[key];

  return typeof value === "string" && value.trim() ? value : null;
};

const readNestedRecord = (record: JsonRecord | null, key: string): JsonRecord | null => asRecord(record?.[key]);

const readNestedString = (record: JsonRecord | null, keys: string[]): string | null => {
  let cursor = record;

  for (const key of keys.slice(0, -1)) {
    cursor = readNestedRecord(cursor, key);

    if (!cursor) {
      return null;
    }
  }

  return readString(cursor, keys[keys.length - 1] ?? "");
};

const parseNumber = (value: number | string | null | undefined): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
};

const clampInteger = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value)));

const parseProbability = (value: number | string | null | undefined): number | null => {
  const parsed = parseNumber(value);

  if (parsed === null) {
    return null;
  }

  return clampInteger(parsed >= 0 && parsed <= 1 ? parsed * 100 : parsed, 0, 100);
};

const firstDefined = <T>(...values: Array<T | null | undefined>): T | null => {
  for (const value of values) {
    if (value !== null && value !== undefined) {
      return value;
    }
  }

  return null;
};

const firstNonEmptyString = (...values: Array<string | null | undefined>): string | null => {
  for (const value of values) {
    const normalizedValue = value?.trim();

    if (normalizedValue) {
      return normalizedValue;
    }
  }

  return null;
};

const compactText = (value: string, maxLength: number): string => {
  const compacted = value.replace(/\s+/g, " ").trim();

  if (compacted.length <= maxLength) {
    return compacted;
  }

  return `${compacted.slice(0, maxLength - 3).trim()}...`;
};

const stripMarkup = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const stripped = value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  return stripped || null;
};

const normalizeTimestamp = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();

  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
};

const getLocalDayStartMs = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const isKnownFutureOrTodayDate = (value: string | null, referenceDate: Date): boolean => {
  if (!value) {
    return false;
  }

  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return false;
  }

  return timestamp >= getLocalDayStartMs(referenceDate);
};

const sanitizeDealActivityPlanAnalysis = (
  analysis: DealActivityPlanAnalysis,
  referenceDate: Date,
): DealActivityPlanAnalysis => ({
  ...analysis,
  upcomingDeadlines: analysis.upcomingDeadlines
    .filter((deadline) => isKnownFutureOrTodayDate(deadline.date, referenceDate))
    .sort((left, right) => {
      const leftTime = left.date ? new Date(left.date).getTime() : Number.MAX_SAFE_INTEGER;
      const rightTime = right.date ? new Date(right.date).getTime() : Number.MAX_SAFE_INTEGER;

      return leftTime - rightTime;
    }),
});

const getDaysSince = (value: string | null): number => {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
};

const addDays = (date: Date, days: number): string => {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);

  return copy.toISOString();
};

const loadHubSpotDealSnapshot = async (
  orgId: string,
  hubspotDealId: string,
): Promise<HubSpotDealSnapshotRow | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("hubspot_deals")
    .select(
      "hubspot_owner_id, primary_contact_id, primary_company_id, deal_name, amount, deal_stage, deal_stage_label, close_probability, closed_at, hubspot_created_at, hubspot_updated_at, properties, synced_at",
    )
    .eq("org_id", orgId)
    .eq("hubspot_deal_id", hubspotDealId)
    .maybeSingle();

  if (error) {
    if (isMissingDealAiAnalysesTableError(error)) {
      return null;
    }

    throw new Error(`Impossible de charger le snapshot HubSpot du deal: ${error.message}`);
  }

  return data as HubSpotDealSnapshotRow | null;
};

const loadHubSpotContactSnapshot = async (
  orgId: string,
  hubspotContactId: string | null,
): Promise<HubSpotContactSnapshotRow | null> => {
  if (!hubspotContactId) {
    return null;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("hubspot_contacts")
    .select("email, name, phone, title, company_name, properties")
    .eq("org_id", orgId)
    .eq("hubspot_contact_id", hubspotContactId)
    .maybeSingle();

  if (error) {
    if (isMissingDealAiAnalysesTableError(error)) {
      return null;
    }

    throw new Error(`Impossible de charger le contact HubSpot du deal: ${error.message}`);
  }

  return data as HubSpotContactSnapshotRow | null;
};

const loadHubSpotCompanySnapshot = async (
  orgId: string,
  hubspotCompanyId: string | null,
): Promise<HubSpotCompanySnapshotRow | null> => {
  if (!hubspotCompanyId) {
    return null;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("hubspot_companies")
    .select("name, domain, industry, country, properties")
    .eq("org_id", orgId)
    .eq("hubspot_company_id", hubspotCompanyId)
    .maybeSingle();

  if (error) {
    if (isMissingDealAiAnalysesTableError(error)) {
      return null;
    }

    throw new Error(`Impossible de charger l'entreprise HubSpot du deal: ${error.message}`);
  }

  return data as HubSpotCompanySnapshotRow | null;
};

const loadOwnerUserName = async (ownerUserId: string | null): Promise<string | null> => {
  if (!ownerUserId) {
    return null;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("users")
    .select("name")
    .eq("id", ownerUserId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le proprietaire du deal: ${error.message}`);
  }

  return (data as OwnerUserSnapshotRow | null)?.name ?? null;
};

const loadPendingActions = async (prospectId: string | null, limit = 3): Promise<ActionSnapshotRow[]> => {
  if (!prospectId || !isUuid(prospectId)) {
    return [];
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("actions")
    .select("title, description, due_at, status, ai_generated")
    .eq("prospect_id", prospectId)
    .in("status", ["pending", "snoozed"])
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) {
    throw new Error(`Impossible de charger les prochaines actions du deal: ${error.message}`);
  }

  return (data ?? []) as ActionSnapshotRow[];
};

const loadDealHistoryForAnalysis = async (
  orgId: string,
  accessToken: string,
  hubspotDealId: string,
) => {
  return hubSpotService.fetchDealHistory(accessToken, hubspotDealId).catch((error: unknown) => {
    return loadLocalHubSpotDealHistory(orgId, hubspotDealId).then((localHistory) => {
      if (localHistory) {
        return localHistory;
      }

      throw error;
    });
  });
};

const resolveForecastLabel = (probability: number, health: DealIntelligenceAnalysis["dealHealth"]): DealAnalysisSnapshot["forecastLabel"] => {
  if (health === "blocked" || health === "at_risk" || probability < 15) {
    return "at_risk";
  }

  if (probability >= 70) {
    return "commit";
  }

  if (probability >= 30) {
    return "best_case";
  }

  return "pipeline";
};

const getLevelLabel = (level: DealAnalysisHealthDimension["level"]): string => {
  if (level === "high") {
    return "Eleve";
  }

  if (level === "medium") {
    return "Moyen";
  }

  return "Faible";
};

const buildHealthDimensions = (
  analysis: DealIntelligenceAnalysis,
  lastContactAt: string | null,
): DealAnalysisHealthDimension[] => {
  const risksText = analysis.risks.join(" ").toLowerCase();
  const daysSinceContact = getDaysSince(lastContactAt);
  const intentScore = clampInteger(
    analysis.closeWonProbability + analysis.positiveSignals.length * 7 - analysis.missingData.length * 4,
    0,
    100,
  );
  const momentumScore = clampInteger(
    (daysSinceContact <= 7 ? 72 : daysSinceContact <= 21 ? 48 : 28) + analysis.nextSteps.length * 5,
    0,
    100,
  );
  const competitionScore = clampInteger(
    (risksText.includes("concurr") || risksText.includes("prix") || risksText.includes("budget") ? 62 : 32) +
      analysis.risks.length * 6,
    0,
    100,
  );

  const intentLevel: DealAnalysisHealthDimension["level"] =
    intentScore >= 66 ? "high" : intentScore >= 36 ? "medium" : "low";
  const momentumLevel: DealAnalysisHealthDimension["level"] =
    momentumScore >= 66 ? "high" : momentumScore >= 36 ? "medium" : "low";
  const competitionLevel: DealAnalysisHealthDimension["level"] =
    competitionScore >= 66 ? "high" : competitionScore >= 36 ? "medium" : "low";

  const dimensions: DealAnalysisHealthDimension[] = [
    {
      id: "intent",
      label: "Intent",
      level: intentLevel,
      score: intentScore,
      tone: intentLevel === "high" ? "green" : intentLevel === "medium" ? "amber" : "red",
      rationale: analysis.positiveSignals[0] ?? "Base sur l'engagement et la probabilite IA.",
    },
    {
      id: "momentum",
      label: "Momentum",
      level: momentumLevel,
      score: momentumScore,
      tone: momentumLevel === "high" ? "green" : momentumLevel === "medium" ? "amber" : "red",
      rationale:
        daysSinceContact <= 7
          ? "Activite recente dans le CRM."
          : daysSinceContact <= 21
            ? "Progression moderee."
            : "Peu de signaux recents.",
    },
    {
      id: "competition",
      label: "Pression concurrentielle",
      level: competitionLevel,
      score: competitionScore,
      tone: competitionLevel === "high" ? "red" : competitionLevel === "medium" ? "amber" : "green",
      rationale:
        analysis.risks.find((risk) => /concurr|prix|budget/i.test(risk)) ??
        "Aucun signal concurrentiel explicite dans l'analyse.",
    },
  ];

  return dimensions.map((dimension) => ({
    ...dimension,
    rationale: dimension.rationale || getLevelLabel(dimension.level),
  }));
};

const buildProbabilityTrend = (
  analysis: DealIntelligenceAnalysis,
  lastContactAt: string | null,
): DealAnalysisTrendPoint[] => {
  const finalProbability = analysis.closeWonProbability;
  const positiveLift = analysis.positiveSignals.length * 2;
  const riskDrag = analysis.risks.length * 2;
  const startProbability = clampInteger(finalProbability - 18 - positiveLift + riskDrag, 5, finalProbability);
  const offsets = [-28, -21, -14, -7, -3, 0];
  const anchorDate = lastContactAt ? new Date(lastContactAt) : new Date();

  if (Number.isNaN(anchorDate.getTime())) {
    anchorDate.setTime(Date.now());
  }

  return offsets.map((offset, index) => {
    const progress = offsets.length === 1 ? 1 : index / (offsets.length - 1);
    const jitter = index % 2 === 0 ? -1 : 1;
    const probability =
      index === offsets.length - 1
        ? finalProbability
        : clampInteger(startProbability + (finalProbability - startProbability) * progress + jitter, 0, 100);
    const date = addDays(anchorDate, offset);

    return {
      date,
      label: new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(new Date(date)),
      probability,
    };
  });
};

const buildPrimaryActions = (
  analysis: DealIntelligenceAnalysis,
  pendingActions: ActionSnapshotRow[],
): DealAnalysisAction[] => {
  const today = new Date();
  const crmActions = pendingActions.map<DealAnalysisAction>((action) => ({
    title: action.title,
    rationale: action.description ?? "Action deja presente dans Jarvis.",
    dueAt: normalizeTimestamp(action.due_at) ?? addDays(today, 1),
    priority: "medium",
    source: action.ai_generated ? "ai" : "crm",
  }));
  const aiActions = analysis.nextSteps.map<DealAnalysisAction>((step) => ({
    title: step.title,
    rationale: step.rationale,
    dueAt: addDays(today, step.dueInDays),
    priority: step.priority,
    source: "ai",
  }));
  const seen = new Set<string>();

  return [...crmActions, ...aiActions].filter((action) => {
    const key = action.title.trim().toLowerCase();

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  }).slice(0, 4);
};

const activityChannelLabels: Record<DealChannelEngagement["channel"], string> = {
  call: "Appels",
  communication: "Messages",
  email: "Emails",
  meeting: "Reunions",
  note: "Notes",
  sms: "SMS",
  task: "Taches",
};

const toActivityChannel = (type: HubSpotDealHistoryItem["type"]): DealRecentActivity["channel"] =>
  type === "call" ||
  type === "email" ||
  type === "meeting" ||
  type === "note" ||
  type === "sms" ||
  type === "communication" ||
  type === "task"
    ? type
    : "deal";

const buildRecentActivities = (
  timeline: HubSpotDealHistoryItem[],
  ownerName: string | null,
): DealRecentActivity[] =>
  [...timeline]
    .sort((left, right) => {
      const leftValue = left.timestamp ? new Date(left.timestamp).getTime() : 0;
      const rightValue = right.timestamp ? new Date(right.timestamp).getTime() : 0;

      return rightValue - leftValue;
    })
    .filter((item) => item.type !== "deal" || timeline.length <= 1)
    .slice(0, 80)
    .map((item) => ({
      id: item.id,
      type: item.type,
      occurredAt: normalizeTimestamp(item.timestamp),
      title: item.title,
      body: stripMarkup(item.body),
      actorName: ownerName ?? (item.metadata.ownerId ? `Owner ${item.metadata.ownerId}` : null),
      channel: toActivityChannel(item.type),
    }));

const buildChannelEngagement = (timeline: HubSpotDealHistoryItem[]): DealChannelEngagement[] => {
  const channels: DealChannelEngagement["channel"][] = [
    "email",
    "call",
    "meeting",
    "note",
    "task",
    "sms",
    "communication",
  ];

  return channels.map((channel) => {
    const items = timeline.filter((item) => item.type === channel);

    return {
      channel,
      label: activityChannelLabels[channel],
      count: items.length,
      responseRate: null,
      caption: items.length > 0 ? `${items.length} evenement${items.length > 1 ? "s" : ""} HubSpot` : "Aucun signal HubSpot",
    };
  });
};

const summarizeRecentActivities = (items: DealRecentActivity[]): string =>
  items
    .map((item) =>
      [
        item.occurredAt ?? "date inconnue",
        `[${item.channel}]`,
        item.title,
        item.actorName ? `owner: ${item.actorName}` : null,
        item.body ? compactText(item.body, 220) : null,
      ]
        .filter(Boolean)
        .join(" | "),
    )
    .join("\n");

const summarizePendingActions = (actions: ActionSnapshotRow[]): string =>
  actions.length > 0
    ? actions
        .map((action) =>
          [
            action.title,
            action.description,
            action.due_at ? `due: ${normalizeTimestamp(action.due_at) ?? action.due_at}` : null,
            `status: ${action.status}`,
            action.ai_generated ? "source: ia" : "source: crm/local",
          ]
            .filter(Boolean)
            .join(" | "),
        )
        .join("\n")
    : "Aucune action locale ouverte.";

const summarizeChannelEngagement = (items: DealChannelEngagement[]): string =>
  items.map((item) => `${item.label}: ${item.count}`).join(" | ");

const loadCachedAnalysis = async <TAnalysis>(
  analysisType: DealAiAnalysisType,
  orgId: string,
  hubspotDealId: string,
  provider: string,
  model: string,
  inputHash?: string | null,
): Promise<DealAiAnalysisCacheRow<TAnalysis> | null> => {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("deal_ai_analyses")
    .select("id, analysis, analysis_type, provider, model, input_hash, generated_at, expires_at")
    .eq("org_id", orgId)
    .eq("hubspot_deal_id", hubspotDealId)
    .eq("analysis_type", analysisType)
    .eq("provider", provider)
    .eq("model", model)
    .gt("expires_at", new Date().toISOString());

  if (inputHash) {
    query = query.eq("input_hash", inputHash);
  }

  const { data, error } = await query.order("generated_at", { ascending: false }).limit(1).maybeSingle();

  if (error) {
    if (isMissingDealAiAnalysesTableError(error)) {
      return null;
    }

    if (isMissingAnalysisTypeColumnError(error) && inputHash) {
      const { data: legacyData, error: legacyError } = await supabase
        .from("deal_ai_analyses")
        .select("id, analysis, provider, model, input_hash, generated_at, expires_at")
        .eq("org_id", orgId)
        .eq("hubspot_deal_id", hubspotDealId)
        .eq("provider", provider)
        .eq("model", model)
        .eq("input_hash", inputHash)
        .gt("expires_at", new Date().toISOString())
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (legacyError) {
        if (isMissingDealAiAnalysesTableError(legacyError)) {
          return null;
        }

        throw new Error(`Impossible de charger le cache d'analyse IA: ${legacyError.message}`);
      }

      return legacyData as DealAiAnalysisCacheRow<TAnalysis> | null;
    }

    throw new Error(`Impossible de charger le cache d'analyse IA: ${error.message}`);
  }

  return data as DealAiAnalysisCacheRow<TAnalysis> | null;
};

const loadReusableCachedAnalysis = async <TAnalysis>(
  analysisType: DealAiAnalysisType,
  orgId: string,
  hubspotDealId: string,
  provider: string,
  model: string,
  inputHash: string,
): Promise<DealAiAnalysisCacheRow<TAnalysis> | null> => {
  const exactCachedAnalysis = await loadCachedAnalysis<TAnalysis>(
    analysisType,
    orgId,
    hubspotDealId,
    provider,
    model,
    inputHash,
  );

  if (exactCachedAnalysis) {
    return exactCachedAnalysis;
  }

  return loadCachedAnalysis<TAnalysis>(
    analysisType,
    orgId,
    hubspotDealId,
    provider,
    model,
  );
};

const persistAnalysis = async <TAnalysis>({
  analysisType,
  orgId,
  hubspotDealId,
  provider,
  model,
  inputHash,
  analysis,
  closeWonProbability,
  expiresAt,
}: {
  analysisType: DealAiAnalysisType;
  orgId: string;
  hubspotDealId: string;
  provider: string;
  model: string;
  inputHash: string;
  analysis: TAnalysis;
  closeWonProbability: number;
  expiresAt: string;
}): Promise<DealAiAnalysisCacheRow<TAnalysis> | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("deal_ai_analyses")
    .upsert(
      {
        org_id: orgId,
        hubspot_deal_id: hubspotDealId,
        provider,
        model,
        analysis_type: analysisType,
        input_hash: inputHash,
        analysis,
        close_won_probability: closeWonProbability,
        generated_at: new Date().toISOString(),
        expires_at: expiresAt,
      },
      {
        onConflict: "org_id,hubspot_deal_id,provider,model,input_hash",
      },
    )
    .select("id, analysis, analysis_type, provider, model, input_hash, generated_at, expires_at")
    .single();

  if (error) {
    if (isMissingDealAiAnalysesTableError(error)) {
      return null;
    }

    if (isMissingAnalysisTypeColumnError(error)) {
      const { data: legacyData, error: legacyError } = await supabase
        .from("deal_ai_analyses")
        .upsert(
          {
            org_id: orgId,
            hubspot_deal_id: hubspotDealId,
            provider,
            model,
            input_hash: inputHash,
            analysis,
            close_won_probability: closeWonProbability,
            generated_at: new Date().toISOString(),
            expires_at: expiresAt,
          },
          {
            onConflict: "org_id,hubspot_deal_id,provider,model,input_hash",
          },
        )
        .select("id, analysis, provider, model, input_hash, generated_at, expires_at")
        .single();

      if (legacyError) {
        if (isMissingDealAiAnalysesTableError(legacyError)) {
          return null;
        }

        throw new Error(`Impossible de sauvegarder l'analyse IA du deal: ${legacyError.message}`);
      }

      return legacyData as DealAiAnalysisCacheRow<TAnalysis>;
    }

    throw new Error(`Impossible de sauvegarder l'analyse IA du deal: ${error.message}`);
  }

  return data as DealAiAnalysisCacheRow<TAnalysis>;
};

const updateProspectWithAnalysis = async (prospect: ProspectRow | null, analysis: DealIntelligenceAnalysis): Promise<void> => {
  if (!prospect) {
    return;
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("prospects")
    .update({
      ai_summary: analysis.whyNow,
      next_action: analysis.suggestedMove,
      ai_priority_score: analysis.closeWonProbability,
    })
    .eq("id", prospect.id);

  if (error) {
    throw new Error(`Analyse IA sauvegardee, mais prospect non mis a jour: ${error.message}`);
  }
};

const buildDealAnalysisSnapshot = async (
  target: ResolvedDealTarget,
  context: DealIntelligenceContext,
  analysis: DealIntelligenceAnalysis,
): Promise<DealAnalysisSnapshot> => {
  const rawData = asRecord(target.prospect?.raw_data);
  const rawDeal = readNestedRecord(rawData, "deal");
  const rawDealProperties = readNestedRecord(rawDeal, "properties");
  const rawContact = readNestedRecord(rawData, "contact");
  const rawContactProperties = readNestedRecord(rawContact, "properties");
  const rawCompany = readNestedRecord(rawData, "company");
  const rawCompanyProperties = readNestedRecord(rawCompany, "properties");
  const hubspotDeal = await loadHubSpotDealSnapshot(target.orgId, target.hubspotDealId);
  const hubspotContactId = target.prospect?.hubspot_contact_id ?? target.hubspotContactId;
  const hubspotContact = await loadHubSpotContactSnapshot(
    target.orgId,
    hubspotDeal?.primary_contact_id ?? hubspotContactId,
  );
  const hubspotCompany = await loadHubSpotCompanySnapshot(target.orgId, hubspotDeal?.primary_company_id ?? null);
  const ownerNameFromUser = await loadOwnerUserName(target.prospect?.owner_user_id ?? null);
  const amount = firstDefined(
    parseNumber(hubspotDeal?.amount),
    target.prospect?.deal_amount ?? null,
    context.dealAmount ?? null,
    parseNumber(readNestedString(rawData, ["deal", "properties", "amount"])),
  ) ?? 0;
  const closeProbability =
    firstDefined(
      parseProbability(hubspotDeal?.close_probability),
      target.prospect?.close_probability ?? null,
      context.currentCloseProbability ?? null,
      parseProbability(readNestedString(rawData, ["deal", "properties", "hs_deal_stage_probability"])),
    ) ?? analysis.closeWonProbability;
  const stage = firstNonEmptyString(
    hubspotDeal?.deal_stage_label ?? null,
    readString(rawData, "dealStageLabel"),
    hubspotDeal?.deal_stage,
    target.prospect?.deal_stage,
    context.dealStage,
    readString(rawDealProperties, "dealstage"),
    "Stage HubSpot",
  ) ?? "Stage HubSpot";
  const stageEnteredAt = firstNonEmptyString(
    normalizeTimestamp(hubspotDeal?.hubspot_updated_at),
    normalizeTimestamp(target.prospect?.last_contact_at),
    normalizeTimestamp(target.prospect?.synced_at),
  );
  const contactName = firstNonEmptyString(context.contactName, hubspotContact?.name, target.prospect?.name, "Contact HubSpot") ??
    "Contact HubSpot";
  const companyName =
    firstNonEmptyString(
      context.companyName,
      hubspotCompany?.name,
      hubspotContact?.company_name,
      target.prospect?.company,
      readString(rawCompanyProperties, "name"),
      readString(rawContactProperties, "company"),
      "Entreprise HubSpot",
    ) ?? "Entreprise HubSpot";
  const contactEmail = firstNonEmptyString(context.contactEmail, hubspotContact?.email, target.prospect?.email, readString(rawContactProperties, "email"));
  const contactPhone = firstNonEmptyString(context.contactPhone, hubspotContact?.phone, target.prospect?.phone, readString(rawContactProperties, "phone"));
  const closeDate = firstNonEmptyString(
    normalizeTimestamp(context.closeDate),
    normalizeTimestamp(hubspotDeal?.closed_at),
    normalizeTimestamp(readString(rawData, "closedAt")),
    normalizeTimestamp(readString(rawDealProperties, "closedate")),
  );
  const ownerHubSpotId = firstNonEmptyString(
    hubspotDeal?.hubspot_owner_id,
    readString(rawData, "hubspotOwnerId"),
    readString(rawData, "dealOwnerHubSpotId"),
    readString(rawData, "contactOwnerHubSpotId"),
    readString(rawDealProperties, "hubspot_owner_id"),
  );
  const weightedAmount = Math.round(amount * (analysis.closeWonProbability / 100));

  return {
    prospectId: target.prospect?.id ?? `${target.hubspotContactId ?? "hubspot"}:${target.hubspotDealId}`,
    orgId: target.orgId,
    hubspotDealId: target.hubspotDealId,
    hubspotContactId,
    dealName: firstNonEmptyString(hubspotDeal?.deal_name, readString(rawData, "dealName"), readString(rawDealProperties, "dealname")),
    companyName,
    contactName,
    contactTitle: firstNonEmptyString(context.contactTitle, hubspotContact?.title, target.prospect?.title, readString(rawContactProperties, "jobtitle")),
    contactEmail,
    contactPhone,
    ownerName: firstNonEmptyString(context.ownerName, ownerNameFromUser, ownerHubSpotId ? `Owner ${ownerHubSpotId}` : null),
    ownerHubSpotId,
    amount,
    weightedAmount,
    stage,
    closeProbability,
    forecastLabel: resolveForecastLabel(analysis.closeWonProbability, analysis.dealHealth),
    closeDate,
    stageEnteredAt,
    stageAgeDays: getDaysSince(stageEnteredAt),
    lastContactAt: firstNonEmptyString(normalizeTimestamp(target.prospect?.last_contact_at), normalizeTimestamp(context.lastContactAt)),
    syncedAt: firstNonEmptyString(normalizeTimestamp(hubspotDeal?.synced_at), normalizeTimestamp(target.prospect?.synced_at)),
  };
};

const buildDealMetrics = (
  snapshot: DealAnalysisSnapshot,
  analysis: DealIntelligenceAnalysis,
  healthDimensions: DealAnalysisHealthDimension[],
): DealAnalysisMetric[] => {
  const engagementScore = clampInteger(
    snapshot.closeProbability * 0.35 +
      analysis.positiveSignals.length * 12 +
      analysis.evidence.length * 8 +
      healthDimensions.reduce((sum, dimension) => sum + dimension.score, 0) / 6,
    0,
    100,
  );

  return [
    {
      id: "dealValue",
      label: "Deal value",
      value: snapshot.amount,
      unit: "currency",
      caption: snapshot.stage,
    },
    {
      id: "weightedValue",
      label: "Weighted value",
      value: snapshot.weightedAmount,
      unit: "currency",
      caption: `${analysis.closeWonProbability} % de probabilite`,
    },
    {
      id: "stageAge",
      label: "Stage age",
      value: snapshot.stageAgeDays,
      unit: "days",
      caption: snapshot.stageEnteredAt ? `Depuis ${snapshot.stageEnteredAt}` : "Date CRM indisponible",
    },
    {
      id: "engagementScore",
      label: "Engagement score",
      value: engagementScore,
      unit: "score",
      caption: engagementScore >= 70 ? "Eleve" : engagementScore >= 40 ? "Moyen" : "Faible",
    },
  ];
};

const buildCrmFacts = (
  snapshot: DealAnalysisSnapshot,
  analysis: DealIntelligenceAnalysis,
): string[] => {
  const facts = [
    snapshot.dealName ? `Deal HubSpot: ${snapshot.dealName}` : null,
    snapshot.ownerName ? `Proprietaire: ${snapshot.ownerName}` : null,
    snapshot.closeDate ? `Date de cloture prevue: ${snapshot.closeDate}` : null,
    snapshot.lastContactAt ? `Dernier contact: ${snapshot.lastContactAt}` : null,
    ...analysis.evidence,
  ];
  const seen = new Set<string>();

  return facts
    .filter((fact): fact is string => Boolean(fact))
    .filter((fact) => {
      const key = fact.trim().toLowerCase();

      if (!key || seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .slice(0, 6);
};

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
    const cachedActivityPlan = await loadReusableCachedAnalysis<DealActivityPlanAnalysis>(
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
        activityPlan: sanitizeDealActivityPlanAnalysis(cachedActivityPlan.analysis, today),
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
  const savedActivityPlan = await persistAnalysis<DealActivityPlanAnalysis>({
    analysisType: "deal_activity_plan",
    orgId: target.orgId,
    hubspotDealId: target.hubspotDealId,
    provider: provider.providerName,
    model: provider.modelName,
    inputHash,
    analysis: activityPlan,
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
    activityPlan: savedActivityPlan?.analysis ?? activityPlan,
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
    persistAnalysis<DealActivityPlanAnalysis>({
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
      analysis: fullAnalysis.activityPlan,
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
      activityPlan: sanitizeDealActivityPlanAnalysis(savedActivityPlan?.analysis ?? fullAnalysis.activityPlan, today),
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
    loadCachedAnalysis<DealActivityPlanAnalysis>(
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
  const accessToken = await getHubSpotAccessToken(target.orgId);
  const dealHistory = await loadDealHistoryForAnalysis(target.orgId, accessToken, target.hubspotDealId);
  const recentActivities = buildRecentActivities(dealHistory.timeline, snapshot.ownerName);
  const channelEngagement = buildChannelEngagement(dealHistory.timeline);
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
    activityPlan: sanitizeDealActivityPlanAnalysis(cachedActivityPlan.analysis, new Date()),
  };

  return {
    page,
    qualification,
    activityPlan,
  };
};
