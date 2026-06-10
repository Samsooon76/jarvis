import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "../db/client.js";
import { buildDealAnalysisBundleForProspect, type DealIntelligenceResult } from "./deal-intelligence.service.js";
import { createLlmProvider } from "./llm/provider.factory.js";
import { isTransientLlmError } from "./llm/llm-rate-limiter.js";
import type {
  DealIntelligenceAnalysis,
  ForecastSynthesisAction,
  ForecastSynthesisAnalysis,
  ForecastSynthesisCategory,
} from "./llm/llm.provider.js";
import { getObjectiveAmountForForecast } from "./sales-targets.service.js";
import { buildWinBenchmarkSummaryForPrompt } from "./win-analysis.service.js";

export type ForecastScope = "all" | "owner";
export type ForecastAnalysisStatus = "fresh" | "stale" | "missing" | "closed_won";
export type ForecastDealBucket = "signedPaymentPending" | "paymentReceived" | "openForecast";
export type ForecastDealStatus = ForecastDealBucket | "closedLost" | "excluded";
export type ForecastRiskSeverity = "low" | "medium" | "high";

export type ForecastOverviewOptions = {
  orgId: string;
  scope?: ForecastScope;
  hubspotOwnerId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  llmProvider?: string | null;
  llmModel?: string | null;
};

export type AnalyzeForecastOptions = ForecastOverviewOptions & {
  refresh?: boolean;
  limit?: number | null;
  batchSize?: number | null;
  retryFailedCount?: number | null;
  onProgress?: (event: ForecastAnalyzeProgressEvent) => void;
};

export type ForecastAnalyzeProgressEvent = {
  progress: number;
  step: string;
  level?: "info" | "success" | "warning" | "error";
  message?: string;
};

export type ForecastDeal = {
  hubspotDealId: string;
  dealName: string | null;
  companyName: string;
  contactName: string | null;
  ownerName: string | null;
  ownerHubSpotId: string | null;
  amount: number;
  stage: string;
  closeDate: string | null;
  syncedAt: string;
  forecastBucket: ForecastDealBucket;
  aiProbability: number | null;
  crmProbability: number;
  forecastAmount: number;
  impactAmount: number;
  analysisStatus: ForecastAnalysisStatus;
  analyzedAt: string | null;
  confidence: DealIntelligenceAnalysis["confidence"] | null;
  dealHealth: DealIntelligenceAnalysis["dealHealth"] | null;
  summary: string | null;
  suggestedMove: string | null;
  risks: string[];
  positiveSignals: string[];
};

export type ForecastScenario = {
  id: "commit" | "likely" | "upside";
  label: string;
  amount: number;
  probability: number;
};

export type ForecastRisk = {
  title: string;
  severity: ForecastRiskSeverity;
  dealCount: number;
  amount: number;
};

export type ForecastLever = {
  title: string;
  dealCount: number;
  amount: number;
};

export type ForecastReliabilityDimension = {
  id: "dataCompleteness" | "recentAnalysis" | "aiConfidence" | "stageCoverage";
  label: string;
  score: number;
};

export type ForecastMonthlyProjection = {
  month: string;
  label: string;
  dealCount: number;
  signedDealCount: number;
  signedPaymentPendingDealCount: number;
  paymentReceivedDealCount: number;
  openDealCount: number;
  wonDealCount: number;
  analyzedDealCount: number;
  missingAnalysisCount: number;
  signedAmount: number;
  signedPaymentPendingAmount: number;
  paymentReceivedAmount: number;
  openPipelineAmount: number;
  openForecastAmount: number;
  landingAmount: number;
  pipelineAmount: number;
  commitAmount: number;
  forecastAmount: number;
  objectiveAmount: number | null;
  gapToObjective: number | null;
  confidenceScore: number;
};

export type ForecastSynthesisStatus = "fresh" | "stale";

export type ForecastSynthesisDeal = {
  hubspotDealId: string;
  dealName: string | null;
  companyName: string;
  ownerName: string | null;
  amount: number;
  forecastAmount: number;
  aiProbability: number | null;
  crmProbability: number;
  stage: string;
  closeDate: string | null;
  dealHealth: DealIntelligenceAnalysis["dealHealth"] | null;
  category: ForecastSynthesisCategory;
  reason: string;
  recommendedAction: string | null;
};

export type ForecastSynthesisCategorySummary = {
  category: ForecastSynthesisCategory;
  label: string;
  dealCount: number;
  amount: number;
  weightedAmount: number;
};

export type ForecastSynthesis = {
  generatedAt: string;
  provider: string;
  model: string;
  status: ForecastSynthesisStatus;
  headline: string;
  confidence: "low" | "medium" | "high";
  analyzedDealCount: number;
  objectiveAmount: number | null;
  gapToObjective: number | null;
  /** Deja signe + montant des deals classes "commit" par l'IA : ce que l'IA pense closer sur la periode. */
  projectedCloseAmount: number;
  categories: ForecastSynthesisCategorySummary[];
  deals: ForecastSynthesisDeal[];
  actionPlan: ForecastSynthesisAction[];
};

export type ForecastOverviewResult = {
  orgId: string;
  scope: ForecastScope;
  hubspotOwnerId: string | null;
  dateFrom: string;
  dateTo: string;
  provider: string;
  model: string;
  generatedAt: string;
  lastAnalyzedAt: string | null;
  openDealCount: number;
  wonDealCount: number;
  signedDealCount: number;
  signedPaymentPendingDealCount: number;
  paymentReceivedDealCount: number;
  analyzedDealCount: number;
  staleDealCount: number;
  missingAnalysisCount: number;
  signedAmount: number;
  signedPaymentPendingAmount: number;
  paymentReceivedAmount: number;
  openPipelineAmount: number;
  openForecastAmount: number;
  landingAmount: number;
  pipelineAmount: number;
  forecastAmount: number;
  objectiveAmount: number | null;
  gapToObjective: number | null;
  confidenceScore: number;
  scenarios: ForecastScenario[];
  risks: ForecastRisk[];
  levers: ForecastLever[];
  reliability: ForecastReliabilityDimension[];
  monthlyProjection: ForecastMonthlyProjection[];
  deals: ForecastDeal[];
  synthesis: ForecastSynthesis | null;
};

export type ForecastGenerateSynthesisResult = {
  orgId: string;
  provider: string;
  model: string;
  synthesis: ForecastSynthesis | null;
  overview: ForecastOverviewResult;
};

export type ForecastAnalyzeResult = {
  orgId: string;
  provider: string;
  model: string;
  requestedCount: number;
  batchSize: number;
  analyzedCount: number;
  reusedCount: number;
  failedCount: number;
  errors: Array<{
    hubspotDealId: string;
    message: string;
  }>;
  overview: ForecastOverviewResult;
};

export type ForecastAnalyzeDealResult = {
  orgId: string;
  provider: string;
  model: string;
  hubspotDealId: string;
  cached: boolean;
  analysis: DealIntelligenceResult;
  overview: ForecastOverviewResult;
};

type HubSpotDealRow = {
  hubspot_deal_id: string;
  hubspot_owner_id: string | null;
  primary_contact_id: string | null;
  primary_company_id: string | null;
  deal_name: string | null;
  amount: number | string | null;
  pipeline_label: string | null;
  deal_stage: string | null;
  deal_stage_label: string | null;
  deal_lifecycle_status: "pending" | "won" | "lost" | null;
  is_closed_deal: boolean | null;
  close_probability: number | string | null;
  closed_at: string | null;
  hubspot_updated_at: string | null;
  properties: unknown;
  synced_at: string;
};

type HubSpotContactRow = {
  hubspot_contact_id: string;
  name: string;
  company_name: string | null;
};

type HubSpotCompanyRow = {
  hubspot_company_id: string;
  name: string | null;
};

type OwnerUserRow = {
  hubspot_owner_id: string | null;
  name: string;
};

type DealAiAnalysisRow = {
  hubspot_deal_id: string;
  analysis: DealIntelligenceAnalysis;
  close_won_probability: number;
  generated_at: string;
  expires_at: string;
};

type DealAiAnalysisMetadataRow = {
  hubspot_deal_id: string;
  generated_at: string;
  expires_at: string;
};

type ForecastDealContext = {
  row: HubSpotDealRow;
  contact: HubSpotContactRow | null;
  company: HubSpotCompanyRow | null;
  ownerName: string | null;
};

type ForecastDealStatusInput = {
  deal_stage: string | null;
  deal_stage_label: string | null;
  deal_lifecycle_status: "pending" | "won" | "lost" | null;
  is_closed_deal: boolean | null;
};

type ForecastDealSummary = {
  signedDeals: ForecastDeal[];
  signedPaymentPendingDeals: ForecastDeal[];
  paymentReceivedDeals: ForecastDeal[];
  openDeals: ForecastDeal[];
  signedAmount: number;
  signedPaymentPendingAmount: number;
  paymentReceivedAmount: number;
  openPipelineAmount: number;
  openForecastAmount: number;
  landingAmount: number;
  pipelineAmount: number;
};

const MAX_OPEN_DEALS = 250;
const MAX_ANALYZE_DEALS = 40;
const DEFAULT_ANALYZE_BATCH_SIZE = 5;
const MAX_ANALYZE_BATCH_SIZE = 10;
const DEFAULT_RETRY_FAILED_COUNT = 2;
const MAX_RETRY_FAILED_COUNT = 3;

const chunkArray = <T>(items: T[], chunkSize: number): T[][] => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
};

const wait = async (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

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

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const normalizeDateInput = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();

  return Number.isNaN(timestamp) ? null : value.slice(0, 10);
};

const getDefaultDateRange = (dateFrom?: string | null, dateTo?: string | null): { dateFrom: string; dateTo: string } => {
  const now = new Date();
  const firstDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));

  return {
    dateFrom: normalizeDateInput(dateFrom) ?? firstDay.toISOString().slice(0, 10),
    dateTo: normalizeDateInput(dateTo) ?? lastDay.toISOString().slice(0, 10),
  };
};

const getMonthStart = (date: Date): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

const getMonthEnd = (date: Date): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));

const getMonthKey = (date: Date): string => getMonthStart(date).toISOString().slice(0, 10);

const getMonthLabel = (month: string): string =>
  new Intl.DateTimeFormat("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${month}T00:00:00.000Z`));

const getMonthsBetween = (dateFrom: string, dateTo: string): string[] => {
  const start = getMonthStart(new Date(`${dateFrom}T00:00:00.000Z`));
  const end = getMonthStart(new Date(`${dateTo}T00:00:00.000Z`));
  const months: string[] = [];
  const cursor = new Date(start);

  while (cursor.getTime() <= end.getTime()) {
    months.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return months;
};

const addDays = (date: Date, days: number): Date => {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);

  return copy;
};

const normalizeText = (value: string | null | undefined): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const normalizeStageText = (value: string | null | undefined): string =>
  normalizeText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const compactStageText = (value: string | null | undefined): string => normalizeStageText(value).replace(/\s+/g, "");

const getDealStageText = (row: ForecastDealStatusInput): string => normalizeStageText(`${row.deal_stage_label ?? ""} ${row.deal_stage ?? ""}`);

const getDealStageCompactText = (row: ForecastDealStatusInput): string => compactStageText(`${row.deal_stage_label ?? ""} ${row.deal_stage ?? ""}`);

const isStage = (row: ForecastDealStatusInput, readableStage: string): boolean => getDealStageCompactText(row).includes(compactStageText(readableStage));

const isSignedPaymentPendingStage = (row: ForecastDealStatusInput): boolean => {
  const stage = getDealStageCompactText(row);

  return (
    stage.includes(compactStageText("deal signed payment pending")) ||
    stage.includes(compactStageText("deal signe payment pending")) ||
    stage.includes(compactStageText("deal signes payment pending"))
  );
};

const isPaymentReceivedStage = (row: ForecastDealStatusInput): boolean => isStage(row, "payment received");

const isExplicitOpenForecastStage = (row: ForecastDealStatusInput): boolean => {
  const stage = getDealStageCompactText(row);

  return [
    "discovery",
    "initialproposition",
    "testing",
    "contractsent",
    "negociation",
    "negotiation",
    "contractvalidation",
  ].some((knownStage) => stage.includes(knownStage));
};

const isSignedDealStatus = (status: ForecastDealStatus): status is "signedPaymentPending" | "paymentReceived" =>
  status === "signedPaymentPending" || status === "paymentReceived";

const isLostDeal = (row: ForecastDealStatusInput): boolean => {
  const stage = getDealStageText(row);

  return row.deal_lifecycle_status === "lost" || stage.includes("closed lost") || stage.includes("lost") || stage.includes("perdu");
};

export const getForecastDealStatus = (row: ForecastDealStatusInput): ForecastDealStatus => {
  if (isSignedPaymentPendingStage(row)) {
    return "signedPaymentPending";
  }

  if (isPaymentReceivedStage(row)) {
    return "paymentReceived";
  }

  if (isLostDeal(row)) {
    return "closedLost";
  }

  if (isExplicitOpenForecastStage(row)) {
    return "openForecast";
  }

  const stage = getDealStageText(row);

  if (row.deal_lifecycle_status === "won" || row.is_closed_deal === true || stage.includes("closed")) {
    return "excluded";
  }

  return "openForecast";
};

const isForecastableDeal = (row: HubSpotDealRow): boolean => {
  const status = getForecastDealStatus(row);

  return status !== "closedLost" && status !== "excluded";
};

const getAnalysisStatus = (deal: HubSpotDealRow, analysis: DealAiAnalysisRow | null): ForecastAnalysisStatus => {
  if (!analysis) {
    return "missing";
  }

  const expiresAt = new Date(analysis.expires_at).getTime();

  if (!Number.isNaN(expiresAt) && expiresAt < Date.now()) {
    return "stale";
  }

  const dealUpdatedAt = deal.hubspot_updated_at ? new Date(deal.hubspot_updated_at).getTime() : null;
  const analyzedAt = new Date(analysis.generated_at).getTime();

  if (dealUpdatedAt && !Number.isNaN(dealUpdatedAt) && !Number.isNaN(analyzedAt) && dealUpdatedAt > analyzedAt) {
    return "stale";
  }

  return "fresh";
};

const FORECAST_DEAL_SELECT =
  "hubspot_deal_id, hubspot_owner_id, primary_contact_id, primary_company_id, deal_name, amount, pipeline_label, deal_stage, deal_stage_label, deal_lifecycle_status, is_closed_deal, close_probability, closed_at, hubspot_updated_at, properties, synced_at";

const loadOpenDealContexts = async (options: Required<Pick<ForecastOverviewOptions, "orgId">> & {
  scope: ForecastScope;
  hubspotOwnerId: string | null;
  dateFrom: string;
  dateTo: string;
}): Promise<ForecastDealContext[]> => {
  if (options.scope === "owner" && !options.hubspotOwnerId) {
    return [];
  }

  const supabase = getSupabaseAdmin();
  const dateToExclusive = addDays(new Date(`${options.dateTo}T00:00:00.000Z`), 1).toISOString();

  const scopedQuery = () => {
    let query = supabase.from("hubspot_deals").select(FORECAST_DEAL_SELECT).eq("org_id", options.orgId);

    if (options.scope === "owner" && options.hubspotOwnerId) {
      query = query.eq("hubspot_owner_id", options.hubspotOwnerId);
    }

    return query;
  };

  // 1) Fenetre temporelle : deals ouverts (close date prevue) + paiements recus dans la periode.
  const windowedQuery = scopedQuery()
    .gte("closed_at", `${options.dateFrom}T00:00:00.000Z`)
    .lt("closed_at", dateToExclusive)
    .order("amount", { ascending: false })
    .limit(MAX_OPEN_DEALS);

  // 2) Backlog signe : "Deal Signed/Payment Pending" toujours visible, quelle que soit la date de signature.
  const backlogQuery = scopedQuery()
    .or("deal_stage_label.ilike.%payment pending%,deal_stage_label.ilike.%signed%")
    .order("amount", { ascending: false })
    .limit(MAX_OPEN_DEALS);

  const [windowedResult, backlogResult] = await Promise.all([windowedQuery, backlogQuery]);

  if (windowedResult.error) {
    throw new Error(`Impossible de charger les deals forecast Supabase: ${windowedResult.error.message}`);
  }

  if (backlogResult.error) {
    throw new Error(`Impossible de charger le backlog signe du forecast: ${backlogResult.error.message}`);
  }

  const dealRowsById = new Map<string, HubSpotDealRow>();

  for (const row of (windowedResult.data ?? []) as HubSpotDealRow[]) {
    dealRowsById.set(row.hubspot_deal_id, row);
  }

  // On n'ajoute du backlog que les deals reellement en "signed / payment pending" (les paiements recus
  // hors periode restent exclus, conformement au rattachement par mois civil).
  for (const row of (backlogResult.data ?? []) as HubSpotDealRow[]) {
    if (isSignedPaymentPendingStage(row) && !dealRowsById.has(row.hubspot_deal_id)) {
      dealRowsById.set(row.hubspot_deal_id, row);
    }
  }

  const deals = Array.from(dealRowsById.values()).filter(isForecastableDeal);
  const contactIds = Array.from(new Set(deals.map((deal) => deal.primary_contact_id).filter((value): value is string => Boolean(value))));
  const companyIds = Array.from(new Set(deals.map((deal) => deal.primary_company_id).filter((value): value is string => Boolean(value))));
  const ownerIds = Array.from(new Set(deals.map((deal) => deal.hubspot_owner_id).filter((value): value is string => Boolean(value))));

  const [contactsResult, companiesResult, ownersResult] = await Promise.all([
    contactIds.length > 0
      ? supabase.from("hubspot_contacts").select("hubspot_contact_id, name, company_name").eq("org_id", options.orgId).in("hubspot_contact_id", contactIds)
      : Promise.resolve({ data: [], error: null }),
    companyIds.length > 0
      ? supabase.from("hubspot_companies").select("hubspot_company_id, name").eq("org_id", options.orgId).in("hubspot_company_id", companyIds)
      : Promise.resolve({ data: [], error: null }),
    ownerIds.length > 0
      ? supabase.from("users").select("hubspot_owner_id, name").eq("org_id", options.orgId).in("hubspot_owner_id", ownerIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (contactsResult.error) {
    throw new Error(`Impossible de charger les contacts du forecast: ${contactsResult.error.message}`);
  }

  if (companiesResult.error) {
    throw new Error(`Impossible de charger les entreprises du forecast: ${companiesResult.error.message}`);
  }

  if (ownersResult.error) {
    throw new Error(`Impossible de charger les owners du forecast: ${ownersResult.error.message}`);
  }

  const contactById = new Map(((contactsResult.data ?? []) as HubSpotContactRow[]).map((contact) => [contact.hubspot_contact_id, contact]));
  const companyById = new Map(((companiesResult.data ?? []) as HubSpotCompanyRow[]).map((company) => [company.hubspot_company_id, company]));
  const ownerNameByHubSpotId = new Map(
    ((ownersResult.data ?? []) as OwnerUserRow[])
      .filter((owner) => owner.hubspot_owner_id)
      .map((owner) => [owner.hubspot_owner_id as string, owner.name]),
  );

  return deals.map((row) => ({
    row,
    contact: row.primary_contact_id ? contactById.get(row.primary_contact_id) ?? null : null,
    company: row.primary_company_id ? companyById.get(row.primary_company_id) ?? null : null,
    ownerName: row.hubspot_owner_id ? ownerNameByHubSpotId.get(row.hubspot_owner_id) ?? null : null,
  }));
};

const loadLatestDealIntelligence = async (
  orgId: string,
  hubspotDealIds: string[],
  provider: string,
  model: string,
): Promise<Map<string, DealAiAnalysisRow>> => {
  if (hubspotDealIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("deal_ai_analyses")
    .select("hubspot_deal_id, analysis, close_won_probability, generated_at, expires_at")
    .eq("org_id", orgId)
    .eq("provider", provider)
    .eq("model", model)
    .eq("analysis_type", "deal_intelligence")
    .in("hubspot_deal_id", hubspotDealIds)
    .order("generated_at", { ascending: false });

  if (error) {
    throw new Error(`Impossible de charger les analyses IA du forecast: ${error.message}`);
  }

  const latestByDealId = new Map<string, DealAiAnalysisRow>();

  for (const row of (data ?? []) as DealAiAnalysisRow[]) {
    if (!latestByDealId.has(row.hubspot_deal_id)) {
      latestByDealId.set(row.hubspot_deal_id, row);
    }
  }

  return latestByDealId;
};

const loadLatestDealAnalysisMetadata = async (
  orgId: string,
  hubspotDealIds: string[],
  provider: string,
  model: string,
  analysisType: "deal_qualification" | "deal_activity_plan",
): Promise<Map<string, DealAiAnalysisMetadataRow>> => {
  if (hubspotDealIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("deal_ai_analyses")
    .select("hubspot_deal_id, generated_at, expires_at")
    .eq("org_id", orgId)
    .eq("provider", provider)
    .eq("model", model)
    .eq("analysis_type", analysisType)
    .in("hubspot_deal_id", hubspotDealIds)
    .order("generated_at", { ascending: false });

  if (error) {
    throw new Error(`Impossible de charger la couverture d'analyse IA du forecast: ${error.message}`);
  }

  const latestByDealId = new Map<string, DealAiAnalysisMetadataRow>();

  for (const row of (data ?? []) as DealAiAnalysisMetadataRow[]) {
    if (!latestByDealId.has(row.hubspot_deal_id)) {
      latestByDealId.set(row.hubspot_deal_id, row);
    }
  }

  return latestByDealId;
};

const isFreshAnalysisMetadata = (row: DealAiAnalysisMetadataRow | null | undefined): boolean => {
  if (!row) {
    return false;
  }

  const expiresAt = new Date(row.expires_at).getTime();

  return Number.isNaN(expiresAt) || expiresAt >= Date.now();
};

const buildForecastDeal = (context: ForecastDealContext, analysisRow: DealAiAnalysisRow | null): ForecastDeal => {
  const amount = parseNumber(context.row.amount) ?? 0;
  const crmProbability = clamp(Math.round(parseNumber(context.row.close_probability) ?? 0), 0, 100);
  const dealStatus = getForecastDealStatus(context.row);
  const isSigned = isSignedDealStatus(dealStatus);
  const analysis = analysisRow?.analysis ?? null;
  const forecastBucket: ForecastDealBucket = isSigned ? dealStatus : "openForecast";
  const status = isSigned ? "closed_won" : getAnalysisStatus(context.row, analysisRow);
  const aiProbability = isSigned ? 100 : status === "fresh" && analysis ? clamp(Math.round(analysis.closeWonProbability), 0, 100) : null;
  const probability = aiProbability ?? crmProbability;
  const dealName = context.row.deal_name;
  const companyName = context.company?.name ?? context.contact?.company_name ?? dealName ?? "Entreprise inconnue";

  return {
    hubspotDealId: context.row.hubspot_deal_id,
    dealName,
    companyName,
    contactName: context.contact?.name ?? null,
    ownerName: context.ownerName ?? (context.row.hubspot_owner_id ? `Owner ${context.row.hubspot_owner_id}` : null),
    ownerHubSpotId: context.row.hubspot_owner_id,
    amount,
    stage: context.row.deal_stage_label ?? context.row.deal_stage ?? "Stage HubSpot non renseigne",
    closeDate: context.row.closed_at,
    syncedAt: context.row.synced_at,
    forecastBucket,
    aiProbability,
    crmProbability,
    forecastAmount: Math.round(amount * (probability / 100)),
    impactAmount: Math.round(amount * Math.max(0.1, probability / 100)),
    analysisStatus: status,
    analyzedAt: analysisRow?.generated_at ?? null,
    confidence: analysis?.confidence ?? null,
    dealHealth: analysis?.dealHealth ?? null,
    summary: analysis?.executiveSummary ?? null,
    suggestedMove: analysis?.suggestedMove ?? null,
    risks: analysis?.risks ?? [],
    positiveSignals: analysis?.positiveSignals ?? [],
  };
};

export const summarizeForecastDeals = (deals: ForecastDeal[]): ForecastDealSummary => {
  const signedPaymentPendingDeals = deals.filter((deal) => deal.forecastBucket === "signedPaymentPending");
  const paymentReceivedDeals = deals.filter((deal) => deal.forecastBucket === "paymentReceived");
  const signedDeals = [...signedPaymentPendingDeals, ...paymentReceivedDeals];
  const openDeals = deals.filter((deal) => deal.forecastBucket === "openForecast");
  const signedPaymentPendingAmount = signedPaymentPendingDeals.reduce((sum, deal) => sum + deal.amount, 0);
  const paymentReceivedAmount = paymentReceivedDeals.reduce((sum, deal) => sum + deal.amount, 0);
  const signedAmount = signedPaymentPendingAmount + paymentReceivedAmount;
  const openPipelineAmount = openDeals.reduce((sum, deal) => sum + deal.amount, 0);
  const openForecastAmount = openDeals.reduce((sum, deal) => sum + deal.forecastAmount, 0);

  return {
    signedDeals,
    signedPaymentPendingDeals,
    paymentReceivedDeals,
    openDeals,
    signedAmount,
    signedPaymentPendingAmount,
    paymentReceivedAmount,
    openPipelineAmount,
    openForecastAmount,
    landingAmount: signedAmount + openForecastAmount,
    pipelineAmount: signedAmount + openPipelineAmount,
  };
};

const buildScenarios = (deals: ForecastDeal[]): ForecastScenario[] => {
  const weightedDeals = deals.filter((deal) => deal.analysisStatus === "closed_won" || deal.aiProbability !== null || deal.crmProbability > 0);
  const commitAmount = weightedDeals
    .filter((deal) => (deal.aiProbability ?? deal.crmProbability) >= 70 || deal.dealHealth === "strong")
    .reduce((sum, deal) => sum + deal.forecastAmount, 0);
  const likelyAmount = weightedDeals.reduce((sum, deal) => sum + deal.forecastAmount, 0);
  const upsideAmount = weightedDeals.reduce((sum, deal) => {
    const probability = (deal.aiProbability ?? deal.crmProbability) / 100;
    return sum + Math.round(deal.amount * clamp(probability + 0.22, 0, 0.98));
  }, 0);
  const averageProbability =
    weightedDeals.length > 0
      ? Math.round(weightedDeals.reduce((sum, deal) => sum + (deal.aiProbability ?? deal.crmProbability), 0) / weightedDeals.length)
      : 0;

  return [
    {
      id: "commit",
      label: "Commit",
      amount: commitAmount,
      probability: weightedDeals.length > 0 ? clamp(Math.round(averageProbability * 0.82), 0, 100) : 0,
    },
    {
      id: "likely",
      label: "Likely",
      amount: likelyAmount,
      probability: averageProbability,
    },
    {
      id: "upside",
      label: "Upside",
      amount: upsideAmount,
      probability: weightedDeals.length > 0 ? clamp(Math.round(averageProbability * 0.42), 0, 100) : 0,
    },
  ];
};

const severityFromRisk = (risk: string): ForecastRiskSeverity => {
  const normalized = normalizeText(risk);

  if (normalized.includes("bloqu") || normalized.includes("budget") || normalized.includes("decision") || normalized.includes("legal")) {
    return "high";
  }

  if (normalized.includes("concurr") || normalized.includes("retard") || normalized.includes("no show") || normalized.includes("silence")) {
    return "medium";
  }

  return "low";
};

const buildRisks = (deals: ForecastDeal[]): ForecastRisk[] => {
  const byTitle = new Map<string, ForecastRisk>();

  for (const deal of deals) {
    for (const risk of deal.risks.slice(0, 3)) {
      const title = risk.trim();

      if (!title) {
        continue;
      }

      const key = normalizeText(title);
      const current = byTitle.get(key) ?? {
        title,
        severity: severityFromRisk(title),
        dealCount: 0,
        amount: 0,
      };

      current.dealCount += 1;
      current.amount += deal.amount;
      byTitle.set(key, current);
    }
  }

  return Array.from(byTitle.values())
    .sort((left, right) => right.dealCount - left.dealCount || right.amount - left.amount)
    .slice(0, 5);
};

const buildLevers = (deals: ForecastDeal[]): ForecastLever[] =>
  Array.from(
    deals
      .filter((deal) => deal.suggestedMove)
      .reduce<Map<string, ForecastLever>>((rowsByTitle, deal) => {
      const title = deal.suggestedMove?.trim();

      if (!title) {
        return rowsByTitle;
      }

      const key = normalizeText(title);
      const current = rowsByTitle.get(key) ?? {
        title,
        dealCount: 0,
        amount: 0,
      };

      current.dealCount += 1;
      current.amount += deal.amount;
      rowsByTitle.set(key, current);

      return rowsByTitle;
      }, new Map())
      .values(),
  )
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 5);

const confidenceToScore = (confidence: DealIntelligenceAnalysis["confidence"] | null): number => {
  if (confidence === "high") {
    return 90;
  }

  if (confidence === "medium") {
    return 68;
  }

  if (confidence === "low") {
    return 42;
  }

  return 0;
};

const buildReliability = (deals: ForecastDeal[]): ForecastReliabilityDimension[] => {
  const openDealCount = deals.length;
  const analyzedDeals = deals.filter((deal) => deal.analysisStatus === "fresh" || deal.analysisStatus === "closed_won");
  const recentAnalyzedDeals = analyzedDeals.filter((deal) => {
    if (deal.analysisStatus === "closed_won") {
      return true;
    }

    if (!deal.analyzedAt) {
      return false;
    }

    const analyzedAt = new Date(deal.analyzedAt).getTime();

    return !Number.isNaN(analyzedAt) && Date.now() - analyzedAt <= 7 * 86_400_000;
  });
  const confidenceScores = analyzedDeals.map((deal) => confidenceToScore(deal.confidence));
  const dealsWithCoreData = deals.filter((deal) => deal.amount > 0 && deal.closeDate && deal.stage !== "Stage HubSpot non renseigne");

  return [
    {
      id: "dataCompleteness",
      label: "Donnees completes",
      score: openDealCount > 0 ? Math.round((dealsWithCoreData.length / openDealCount) * 100) : 0,
    },
    {
      id: "recentAnalysis",
      label: "Analyse recente",
      score: openDealCount > 0 ? Math.round((recentAnalyzedDeals.length / openDealCount) * 100) : 0,
    },
    {
      id: "aiConfidence",
      label: "Confiance IA",
      score:
        confidenceScores.length > 0
          ? Math.round(confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length)
          : 0,
    },
    {
      id: "stageCoverage",
      label: "Win rate calibre",
      score: openDealCount > 0 ? Math.round((analyzedDeals.length / openDealCount) * 100) : 0,
    },
  ];
};

const averageScore = (items: ForecastReliabilityDimension[]): number =>
  items.length > 0 ? Math.round(items.reduce((sum, item) => sum + item.score, 0) / items.length) : 0;

const buildMonthlyProjection = async ({
  orgId,
  scope,
  hubspotOwnerId,
  dateFrom,
  dateTo,
  deals,
}: {
  orgId: string;
  scope: ForecastScope;
  hubspotOwnerId: string | null;
  dateFrom: string;
  dateTo: string;
  deals: ForecastDeal[];
}): Promise<ForecastMonthlyProjection[]> => {
  const monthsInRange = getMonthsBetween(dateFrom, dateTo);
  const firstMonth = monthsInRange[0] ?? getMonthKey(new Date(`${dateFrom}T00:00:00.000Z`));
  const lastMonth = monthsInRange[monthsInRange.length - 1] ?? getMonthKey(new Date(`${dateTo}T00:00:00.000Z`));
  const monthsInRangeSet = new Set(monthsInRange);
  const dealsByMonth = deals.reduce<Map<string, ForecastDeal[]>>((months, deal) => {
    const closeDate = deal.closeDate ? new Date(deal.closeDate) : null;
    let month = closeDate && !Number.isNaN(closeDate.getTime()) ? getMonthKey(closeDate) : lastMonth;

    // Backlog signe (signe, paiement en attente) : la date de signature est souvent passee.
    // On le rattache au premier mois de la periode pour qu'il reste visible comme acquis.
    if (deal.forecastBucket === "signedPaymentPending" && !monthsInRangeSet.has(month)) {
      month = firstMonth;
    }

    const currentDeals = months.get(month) ?? [];

    currentDeals.push(deal);
    months.set(month, currentDeals);

    return months;
  }, new Map());

  return Promise.all(
    monthsInRange.map(async (month) => {
      const monthStart = new Date(`${month}T00:00:00.000Z`);
      const monthEnd = getMonthEnd(monthStart).toISOString().slice(0, 10);
      const monthDeals = dealsByMonth.get(month) ?? [];
      const objectiveAmount = await getObjectiveAmountForForecast({
        orgId,
        scope,
        hubspotOwnerId,
        dateFrom: month,
        dateTo: monthEnd,
      });
      const wonDeals = monthDeals.filter((deal) => deal.analysisStatus === "closed_won");
      const summary = summarizeForecastDeals(monthDeals);
      const reliability = buildReliability(summary.openDeals);
      const analyzedDeals = summary.openDeals.filter((deal) => deal.analysisStatus === "fresh");
      const missingDeals = summary.openDeals.filter((deal) => deal.analysisStatus === "missing" || deal.analysisStatus === "stale");

      return {
        month,
        label: getMonthLabel(month),
        dealCount: monthDeals.length,
        signedDealCount: summary.signedDeals.length,
        signedPaymentPendingDealCount: summary.signedPaymentPendingDeals.length,
        paymentReceivedDealCount: summary.paymentReceivedDeals.length,
        openDealCount: summary.openDeals.length,
        wonDealCount: wonDeals.length,
        analyzedDealCount: analyzedDeals.length,
        missingAnalysisCount: missingDeals.length,
        signedAmount: summary.signedAmount,
        signedPaymentPendingAmount: summary.signedPaymentPendingAmount,
        paymentReceivedAmount: summary.paymentReceivedAmount,
        openPipelineAmount: summary.openPipelineAmount,
        openForecastAmount: summary.openForecastAmount,
        landingAmount: summary.landingAmount,
        pipelineAmount: summary.pipelineAmount,
        commitAmount: monthDeals
          .filter((deal) => deal.analysisStatus === "closed_won" || (deal.aiProbability ?? deal.crmProbability) >= 70 || deal.dealHealth === "strong")
          .reduce((sum, deal) => sum + deal.forecastAmount, 0),
        forecastAmount: summary.landingAmount,
        objectiveAmount,
        gapToObjective: objectiveAmount === null ? null : summary.landingAmount - objectiveAmount,
        confidenceScore: averageScore(reliability),
      };
    }),
  );
};

const getProvider = (providerId?: string | null, modelId?: string | null) =>
  createLlmProvider({
    provider: providerId,
    model: modelId,
  });

const FORECAST_SYNTHESIS_CACHE_TTL_HOURS = 12;
const MAX_SYNTHESIS_DEALS = 60;

const FORECAST_SYNTHESIS_CATEGORY_LABELS: Record<ForecastSynthesisCategory, string> = {
  commit: "Commit",
  bestCase: "Best case",
  atRisk: "A risque",
  slipping: "Va slipper",
};

const FORECAST_SYNTHESIS_CATEGORY_ORDER: ForecastSynthesisCategory[] = ["commit", "bestCase", "atRisk", "slipping"];

type ForecastSynthesisRow = {
  analysis: ForecastSynthesis;
  input_hash: string;
  generated_at: string;
};

const isMissingForecastSynthesisTableError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const typedError = error as { code?: string; message?: string };
  const message = typedError.message ?? "";

  return typedError.code === "42P01" || typedError.code === "PGRST205" || message.includes("forecast_synthesis");
};

const buildSynthesisScopeLabel = (scope: ForecastScope, deals: ForecastDeal[]): string => {
  if (scope !== "owner") {
    return "Equipe (tous les sales)";
  }

  const ownerName = deals.find((deal) => deal.ownerName && !/^Owner \d+$/i.test(deal.ownerName))?.ownerName;

  return ownerName ? `Owner ${ownerName}` : "Owner";
};

const isDateAfter = (closeDate: string | null, dateTo: string): boolean => {
  if (!closeDate) {
    return false;
  }

  const closeTimestamp = new Date(closeDate).getTime();
  const periodEnd = new Date(`${dateTo}T23:59:59.999Z`).getTime();

  return !Number.isNaN(closeTimestamp) && !Number.isNaN(periodEnd) && closeTimestamp > periodEnd;
};

// Fallback deterministe pour les deals que l'IA n'a pas explicitement classes.
const fallbackCategory = (deal: ForecastDeal, dateTo: string): ForecastSynthesisCategory => {
  const probability = deal.aiProbability ?? deal.crmProbability;

  if (isDateAfter(deal.closeDate, dateTo)) {
    return "slipping";
  }

  if (deal.dealHealth === "blocked" || deal.dealHealth === "at_risk") {
    return "atRisk";
  }

  if (probability >= 70 || deal.dealHealth === "strong") {
    return "commit";
  }

  if (probability >= 40) {
    return "bestCase";
  }

  return "atRisk";
};

export const buildForecastSynthesisInputHash = (
  deals: ForecastDeal[],
  objectiveAmount: number | null,
  dateFrom: string,
  dateTo: string,
): string => {
  const dealSignature = deals
    .map((deal) => `${deal.hubspotDealId}:${deal.analyzedAt ?? ""}`)
    .sort()
    .join("|");

  return createHash("sha256").update(`${dateFrom}|${dateTo}|${objectiveAmount ?? "null"}|${dealSignature}`).digest("hex");
};

export const enrichForecastSynthesis = ({
  analysis,
  analyzedOpenDeals,
  objectiveAmount,
  gapToObjective,
  signedAmount,
  dateTo,
  provider,
  model,
  generatedAt,
  status,
}: {
  analysis: ForecastSynthesisAnalysis;
  analyzedOpenDeals: ForecastDeal[];
  objectiveAmount: number | null;
  gapToObjective: number | null;
  signedAmount: number;
  dateTo: string;
  provider: string;
  model: string;
  generatedAt: string;
  status: ForecastSynthesisStatus;
}): ForecastSynthesis => {
  const verdictByDealId = new Map(analysis.dealVerdicts.map((verdict) => [verdict.hubspotDealId, verdict]));
  const deals: ForecastSynthesisDeal[] = analyzedOpenDeals.map((deal) => {
    const verdict = verdictByDealId.get(deal.hubspotDealId);
    const category = verdict?.category ?? fallbackCategory(deal, dateTo);

    return {
      hubspotDealId: deal.hubspotDealId,
      dealName: deal.dealName,
      companyName: deal.companyName,
      ownerName: deal.ownerName,
      amount: deal.amount,
      forecastAmount: deal.forecastAmount,
      aiProbability: deal.aiProbability,
      crmProbability: deal.crmProbability,
      stage: deal.stage,
      closeDate: deal.closeDate,
      dealHealth: deal.dealHealth,
      category,
      reason: verdict?.reason ?? "Classement automatique (deal non couvert par la synthese IA).",
      recommendedAction: verdict?.recommendedAction ?? deal.suggestedMove,
    };
  });

  const categories: ForecastSynthesisCategorySummary[] = FORECAST_SYNTHESIS_CATEGORY_ORDER.map((category) => {
    const categoryDeals = deals.filter((deal) => deal.category === category);

    return {
      category,
      label: FORECAST_SYNTHESIS_CATEGORY_LABELS[category],
      dealCount: categoryDeals.length,
      amount: categoryDeals.reduce((sum, deal) => sum + deal.amount, 0),
      weightedAmount: categoryDeals.reduce((sum, deal) => sum + deal.forecastAmount, 0),
    };
  });

  const commitAmount = categories.find((category) => category.category === "commit")?.amount ?? 0;

  return {
    generatedAt,
    provider,
    model,
    status,
    headline: analysis.headline,
    confidence: analysis.confidence,
    analyzedDealCount: deals.length,
    objectiveAmount,
    gapToObjective,
    projectedCloseAmount: signedAmount + commitAmount,
    categories,
    deals,
    actionPlan: analysis.actionPlan,
  };
};

const buildSynthesisDealsSummary = (deals: ForecastDeal[]): string =>
  deals
    .map((deal) =>
      [
        `id=${deal.hubspotDealId}`,
        deal.companyName,
        `montant=${deal.amount}`,
        `stage=${deal.stage}`,
        `closeDate=${deal.closeDate ? deal.closeDate.slice(0, 10) : "sans date"}`,
        `probaIA=${deal.aiProbability ?? deal.crmProbability}%`,
        `sante=${deal.dealHealth ?? "inconnue"}`,
        `risques=${deal.risks.slice(0, 3).join("; ") || "aucun"}`,
        `move=${deal.suggestedMove ?? "n/a"}`,
        `resume=${deal.summary ?? "n/a"}`,
      ].join(" | "),
    )
    .join("\n");

const loadLatestForecastSynthesis = async (params: {
  orgId: string;
  scope: ForecastScope;
  hubspotOwnerId: string;
  dateFrom: string;
  dateTo: string;
  provider: string;
  model: string;
}): Promise<ForecastSynthesisRow | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("forecast_synthesis")
    .select("analysis, input_hash, generated_at")
    .eq("org_id", params.orgId)
    .eq("scope", params.scope)
    .eq("hubspot_owner_id", params.hubspotOwnerId)
    .eq("date_from", params.dateFrom)
    .eq("date_to", params.dateTo)
    .eq("provider", params.provider)
    .eq("model", params.model)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingForecastSynthesisTableError(error)) {
      return null;
    }

    throw new Error(`Impossible de charger la synthese forecast IA: ${error.message}`);
  }

  return (data as ForecastSynthesisRow | null) ?? null;
};

const persistForecastSynthesis = async (params: {
  orgId: string;
  scope: ForecastScope;
  hubspotOwnerId: string;
  dateFrom: string;
  dateTo: string;
  provider: string;
  model: string;
  inputHash: string;
  synthesis: ForecastSynthesis;
}): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const expiresAt = new Date();
  expiresAt.setUTCHours(expiresAt.getUTCHours() + FORECAST_SYNTHESIS_CACHE_TTL_HOURS);
  const { error } = await supabase.from("forecast_synthesis").upsert(
    {
      org_id: params.orgId,
      scope: params.scope,
      hubspot_owner_id: params.hubspotOwnerId,
      date_from: params.dateFrom,
      date_to: params.dateTo,
      provider: params.provider,
      model: params.model,
      input_hash: params.inputHash,
      analysis: params.synthesis,
      generated_at: params.synthesis.generatedAt,
      expires_at: expiresAt.toISOString(),
    },
    {
      onConflict: "org_id,scope,hubspot_owner_id,date_from,date_to,provider,model",
    },
  );

  if (error && !isMissingForecastSynthesisTableError(error)) {
    throw new Error(`Impossible de sauvegarder la synthese forecast IA: ${error.message}`);
  }
};

const loadStoredForecastSynthesis = async (params: {
  orgId: string;
  scope: ForecastScope;
  hubspotOwnerId: string;
  dateFrom: string;
  dateTo: string;
  provider: string;
  model: string;
  freshOpenDeals: ForecastDeal[];
  objectiveAmount: number | null;
}): Promise<ForecastSynthesis | null> => {
  const stored = await loadLatestForecastSynthesis(params);

  if (!stored) {
    return null;
  }

  const currentHash = buildForecastSynthesisInputHash(
    params.freshOpenDeals,
    params.objectiveAmount,
    params.dateFrom,
    params.dateTo,
  );

  return {
    ...stored.analysis,
    status: stored.input_hash === currentHash ? "fresh" : "stale",
  };
};

// Genere la synthese forecast IA a partir des deals ouverts deja analyses (1 appel LLM).
// Renvoie null si aucun deal ouvert frais n'est disponible. Best-effort sur la persistance.
const runForecastSynthesis = async (
  overview: ForecastOverviewResult,
  provider: ReturnType<typeof getProvider>,
): Promise<ForecastSynthesis | null> => {
  if (overview.synthesis?.status === "fresh") {
    return overview.synthesis;
  }

  const analyzedOpenDeals = overview.deals
    .filter((deal) => deal.forecastBucket === "openForecast" && deal.analysisStatus === "fresh")
    .slice(0, MAX_SYNTHESIS_DEALS);

  if (analyzedOpenDeals.length === 0) {
    return null;
  }

  // Boucle Win Analysis: benchmark des deals gagnes injecte dans le prompt
  // (0 LLM supplementaire; null si le benchmark n'est pas significatif).
  const winBenchmarkSummary = await buildWinBenchmarkSummaryForPrompt(overview.orgId);
  const analysis = await provider.analyzeForecastSynthesis({
    winBenchmarkSummary,
    dealsSummary: buildSynthesisDealsSummary(analyzedOpenDeals),
    knownDealIds: analyzedOpenDeals.map((deal) => deal.hubspotDealId),
    dateFrom: overview.dateFrom,
    dateTo: overview.dateTo,
    scopeLabel: buildSynthesisScopeLabel(overview.scope, analyzedOpenDeals),
    openDealCount: analyzedOpenDeals.length,
    totalOpenAmount: overview.openPipelineAmount,
    signedAmount: overview.signedAmount,
    landingAmount: overview.landingAmount,
    objectiveAmount: overview.objectiveAmount,
    gapToObjective: overview.gapToObjective,
    today: new Date().toISOString(),
  });

  const synthesis = enrichForecastSynthesis({
    analysis,
    analyzedOpenDeals,
    objectiveAmount: overview.objectiveAmount,
    gapToObjective: overview.gapToObjective,
    signedAmount: overview.signedAmount,
    dateTo: overview.dateTo,
    provider: provider.providerName,
    model: provider.modelName,
    generatedAt: new Date().toISOString(),
    status: "fresh",
  });

  await persistForecastSynthesis({
    orgId: overview.orgId,
    scope: overview.scope,
    hubspotOwnerId: overview.scope === "owner" ? overview.hubspotOwnerId ?? "" : "",
    dateFrom: overview.dateFrom,
    dateTo: overview.dateTo,
    provider: provider.providerName,
    model: provider.modelName,
    inputHash: buildForecastSynthesisInputHash(
      analyzedOpenDeals,
      overview.objectiveAmount,
      overview.dateFrom,
      overview.dateTo,
    ),
    synthesis,
  });

  return synthesis;
};

export const getForecastOverview = async (options: ForecastOverviewOptions): Promise<ForecastOverviewResult> => {
  const { dateFrom, dateTo } = getDefaultDateRange(options.dateFrom, options.dateTo);
  const scope = options.scope === "owner" ? "owner" : "all";
  const provider = getProvider(options.llmProvider, options.llmModel);
  const contexts = await loadOpenDealContexts({
    orgId: options.orgId,
    scope,
    hubspotOwnerId: options.hubspotOwnerId ?? null,
    dateFrom,
    dateTo,
  });
  const latestAnalyses = await loadLatestDealIntelligence(
    options.orgId,
    contexts.map((context) => context.row.hubspot_deal_id),
    provider.providerName,
    provider.modelName,
  );
  const deals = contexts
    .map((context) => buildForecastDeal(context, latestAnalyses.get(context.row.hubspot_deal_id) ?? null))
    .sort((left, right) => right.impactAmount - left.impactAmount);
  const summary = summarizeForecastDeals(deals);
  const reliability = buildReliability(summary.openDeals);
  const freshDeals = summary.openDeals.filter((deal) => deal.analysisStatus === "fresh");
  const staleDeals = summary.openDeals.filter((deal) => deal.analysisStatus === "stale");
  const missingDeals = summary.openDeals.filter((deal) => deal.analysisStatus === "missing");
  const lastAnalyzedAt = freshDeals
    .map((deal) => deal.analyzedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
  const objectiveAmount = await getObjectiveAmountForForecast({
    orgId: options.orgId,
    scope,
    hubspotOwnerId: options.hubspotOwnerId ?? null,
    dateFrom,
    dateTo,
  });
  const monthlyProjection = await buildMonthlyProjection({
    orgId: options.orgId,
    scope,
    hubspotOwnerId: scope === "owner" ? options.hubspotOwnerId ?? null : null,
    dateFrom,
    dateTo,
    deals,
  });
  const synthesis = await loadStoredForecastSynthesis({
    orgId: options.orgId,
    scope,
    hubspotOwnerId: scope === "owner" ? options.hubspotOwnerId ?? "" : "",
    dateFrom,
    dateTo,
    provider: provider.providerName,
    model: provider.modelName,
    freshOpenDeals: freshDeals,
    objectiveAmount,
  });

  return {
    orgId: options.orgId,
    scope,
    hubspotOwnerId: scope === "owner" ? options.hubspotOwnerId ?? null : null,
    dateFrom,
    dateTo,
    provider: provider.providerName,
    model: provider.modelName,
    generatedAt: new Date().toISOString(),
    lastAnalyzedAt,
    openDealCount: summary.openDeals.length,
    wonDealCount: summary.signedDeals.length,
    signedDealCount: summary.signedDeals.length,
    signedPaymentPendingDealCount: summary.signedPaymentPendingDeals.length,
    paymentReceivedDealCount: summary.paymentReceivedDeals.length,
    analyzedDealCount: freshDeals.length,
    staleDealCount: staleDeals.length,
    missingAnalysisCount: missingDeals.length,
    signedAmount: summary.signedAmount,
    signedPaymentPendingAmount: summary.signedPaymentPendingAmount,
    paymentReceivedAmount: summary.paymentReceivedAmount,
    openPipelineAmount: summary.openPipelineAmount,
    openForecastAmount: summary.openForecastAmount,
    landingAmount: summary.landingAmount,
    pipelineAmount: summary.pipelineAmount,
    forecastAmount: summary.landingAmount,
    objectiveAmount,
    gapToObjective: objectiveAmount === null ? null : summary.landingAmount - objectiveAmount,
    confidenceScore: averageScore(reliability),
    scenarios: buildScenarios(deals),
    risks: buildRisks(freshDeals),
    levers: buildLevers(freshDeals),
    reliability,
    monthlyProjection,
    deals,
    synthesis,
  };
};

export const analyzeForecastOpenDeals = async (options: AnalyzeForecastOptions): Promise<ForecastAnalyzeResult> => {
  const provider = getProvider(options.llmProvider, options.llmModel);
  const overview = await getForecastOverview(options);
  const batchSize = clamp(
    Math.round(options.batchSize ?? DEFAULT_ANALYZE_BATCH_SIZE),
    1,
    MAX_ANALYZE_BATCH_SIZE,
  );
  const retryFailedCount = clamp(
    Math.round(options.retryFailedCount ?? DEFAULT_RETRY_FAILED_COUNT),
    0,
    MAX_RETRY_FAILED_COUNT,
  );
  const openDeals = overview.deals.filter((deal) => deal.forecastBucket === "openForecast");
  const [qualificationCoverage, activityPlanCoverage] = await Promise.all([
    loadLatestDealAnalysisMetadata(
      options.orgId,
      openDeals.map((deal) => deal.hubspotDealId),
      provider.providerName,
      provider.modelName,
      "deal_qualification",
    ),
    loadLatestDealAnalysisMetadata(
      options.orgId,
      openDeals.map((deal) => deal.hubspotDealId),
      provider.providerName,
      provider.modelName,
      "deal_activity_plan",
    ),
  ]);
  const candidates = overview.deals
    .filter((deal) => deal.forecastBucket === "openForecast")
    .filter(
      (deal) =>
        options.refresh ||
        deal.analysisStatus !== "fresh" ||
        !isFreshAnalysisMetadata(qualificationCoverage.get(deal.hubspotDealId)) ||
        !isFreshAnalysisMetadata(activityPlanCoverage.get(deal.hubspotDealId)),
    )
    .slice(0, clamp(Math.round(options.limit ?? MAX_ANALYZE_DEALS), 1, MAX_ANALYZE_DEALS));
  options.onProgress?.({
    progress: 8,
    step: "Deals ouverts charges",
    message: `${candidates.length} deal(s) a analyser par lots de ${batchSize}. Retry echec(s): ${retryFailedCount}.`,
  });
  let analyzedCount = 0;
  let reusedCount = 0;
  let failedCount = 0;
  const errors: ForecastAnalyzeResult["errors"] = [];

  const chunks = chunkArray(candidates, batchSize);

  for (const [chunkIndex, chunk] of chunks.entries()) {
    options.onProgress?.({
      progress: 10 + Math.round((chunkIndex / Math.max(chunks.length, 1)) * 75),
      step: `Analyse du lot ${chunkIndex + 1}/${chunks.length}`,
      message: `Traitement de ${chunk.length} deal(s) en parallele.`,
    });
    const analyzeDealWithRetry = async (deal: ForecastDeal) => {
      let lastError: string | null = null;

      for (let attempt = 0; attempt <= retryFailedCount; attempt += 1) {
        try {
          if (attempt > 0) {
            options.onProgress?.({
              progress: 10 + Math.round((chunkIndex / Math.max(chunks.length, 1)) * 75),
              step: `Retry ${attempt}/${retryFailedCount}`,
              level: "warning",
              message: `Nouvelle tentative pour ${deal.dealName ?? deal.hubspotDealId}.`,
            });
            await wait(750 * attempt);
          }

          const result = await buildDealAnalysisBundleForProspect(`hubspot:${deal.hubspotDealId}`, {
            orgId: options.orgId,
            hubspotDealId: deal.hubspotDealId,
            llmProvider: provider.providerName,
            llmModel: provider.modelName,
            contactName: deal.contactName,
            companyName: deal.companyName,
            ownerName: deal.ownerName,
            closeDate: deal.closeDate,
            currentCloseProbability: deal.crmProbability,
            dealAmount: deal.amount,
            dealStage: deal.stage,
            refresh: options.refresh === true,
          });

          return {
            hubspotDealId: deal.hubspotDealId,
            cached: result.page.cached && result.qualification.cached && result.activityPlan.cached,
            retried: attempt > 0,
            error: null,
          };
        } catch (error) {
          lastError = error instanceof Error ? error.message : "Erreur inconnue pendant l'analyse IA.";

          if (!isTransientLlmError(error)) {
            break;
          }
        }
      }

      return {
        hubspotDealId: deal.hubspotDealId,
        cached: false,
        retried: retryFailedCount > 0,
        error: lastError ?? "Erreur inconnue pendant l'analyse IA.",
      };
    };

    const chunkResults = await Promise.all(chunk.map(analyzeDealWithRetry));

    for (const result of chunkResults) {
      if (result.error) {
        failedCount += 1;
        errors.push({
          hubspotDealId: result.hubspotDealId,
          message: result.error,
        });
      } else if (result.cached) {
        reusedCount += 1;
      } else {
        analyzedCount += 1;
      }
    }

    options.onProgress?.({
      progress: 10 + Math.round(((chunkIndex + 1) / Math.max(chunks.length, 1)) * 75),
      step: `Lot ${chunkIndex + 1}/${chunks.length} termine`,
      level: chunkResults.some((result) => result.error) ? "warning" : "success",
      message: `${analyzedCount} traite(s), ${reusedCount} reutilise(s), ${failedCount} echec(s).`,
    });
  }

  options.onProgress?.({
    progress: 88,
    step: "Rechargement du forecast",
    message: "Lecture des analyses stockees depuis Supabase.",
  });

  const reloadedOverview = await getForecastOverview({
    ...options,
    llmProvider: provider.providerName,
    llmModel: provider.modelName,
  });

  options.onProgress?.({
    progress: 94,
    step: "Synthese forecast IA",
    message: "Classement des deals et plan d'action par l'IA.",
  });

  let finalOverview = reloadedOverview;

  try {
    const synthesis = await runForecastSynthesis(reloadedOverview, provider);
    finalOverview = { ...reloadedOverview, synthesis: synthesis ?? reloadedOverview.synthesis };
    options.onProgress?.({
      progress: 99,
      step: "Synthese forecast IA prete",
      level: "success",
      message: synthesis
        ? `Synthese generee: ${synthesis.deals.length} deal(s) classe(s).`
        : "Aucun deal ouvert frais a synthetiser.",
    });
  } catch (synthesisError) {
    options.onProgress?.({
      progress: 99,
      step: "Synthese forecast IA",
      level: "warning",
      message: `Synthese non generee: ${synthesisError instanceof Error ? synthesisError.message : "erreur inconnue"}.`,
    });
  }

  return {
    orgId: options.orgId,
    provider: provider.providerName,
    model: provider.modelName,
    requestedCount: candidates.length,
    batchSize,
    analyzedCount,
    reusedCount,
    failedCount,
    errors,
    overview: finalOverview,
  };
};

export const generateForecastSynthesis = async (
  options: ForecastOverviewOptions,
): Promise<ForecastGenerateSynthesisResult> => {
  const provider = getProvider(options.llmProvider, options.llmModel);
  const overview = await getForecastOverview({
    ...options,
    llmProvider: provider.providerName,
    llmModel: provider.modelName,
  });
  if (overview.synthesis?.status === "fresh") {
    return {
      orgId: options.orgId,
      provider: provider.providerName,
      model: provider.modelName,
      synthesis: overview.synthesis,
      overview,
    };
  }

  const synthesis = await runForecastSynthesis(overview, provider);

  return {
    orgId: options.orgId,
    provider: provider.providerName,
    model: provider.modelName,
    synthesis: synthesis ?? overview.synthesis,
    overview: { ...overview, synthesis: synthesis ?? overview.synthesis },
  };
};

export const analyzeForecastDeal = async (
  hubspotDealId: string,
  options: AnalyzeForecastOptions,
): Promise<ForecastAnalyzeDealResult> => {
  const provider = getProvider(options.llmProvider, options.llmModel);
  const overview = await getForecastOverview({
    ...options,
    llmProvider: provider.providerName,
    llmModel: provider.modelName,
  });
  const deal = overview.deals.find((candidate) => candidate.hubspotDealId === hubspotDealId);

  if (!deal) {
    throw new Error("Deal HubSpot introuvable dans le forecast courant.");
  }

  if (deal.forecastBucket !== "openForecast") {
    throw new Error("Un deal close won est deja integre a 100% et ne necessite pas d'analyse IA forecast.");
  }

  const bundle = await buildDealAnalysisBundleForProspect(`hubspot:${deal.hubspotDealId}`, {
    orgId: options.orgId,
    hubspotDealId: deal.hubspotDealId,
    llmProvider: provider.providerName,
    llmModel: provider.modelName,
    contactName: deal.contactName,
    companyName: deal.companyName,
    ownerName: deal.ownerName,
    closeDate: deal.closeDate,
    currentCloseProbability: deal.crmProbability,
    dealAmount: deal.amount,
    dealStage: deal.stage,
    refresh: options.refresh === true,
  });

  return {
    orgId: options.orgId,
    provider: provider.providerName,
    model: provider.modelName,
    hubspotDealId: deal.hubspotDealId,
    cached: bundle.page.cached && bundle.qualification.cached && bundle.activityPlan.cached,
    analysis: bundle.page,
    overview: await getForecastOverview({
      ...options,
      llmProvider: provider.providerName,
      llmModel: provider.modelName,
    }),
  };
};
