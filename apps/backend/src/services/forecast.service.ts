import { getSupabaseAdmin } from "../db/client.js";
import { buildDealAnalysisBundleForProspect, type DealIntelligenceResult } from "./deal-intelligence.service.js";
import { createLlmProvider } from "./llm/provider.factory.js";
import type { DealIntelligenceAnalysis } from "./llm/llm.provider.js";
import { getObjectiveAmountForForecast } from "./sales-targets.service.js";

export type ForecastScope = "all" | "owner";
export type ForecastAnalysisStatus = "fresh" | "stale" | "missing" | "closed_won";
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
  analyzedDealCount: number;
  staleDealCount: number;
  missingAnalysisCount: number;
  pipelineAmount: number;
  forecastAmount: number;
  objectiveAmount: number | null;
  gapToObjective: number | null;
  confidenceScore: number;
  scenarios: ForecastScenario[];
  risks: ForecastRisk[];
  levers: ForecastLever[];
  reliability: ForecastReliabilityDimension[];
  deals: ForecastDeal[];
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

const getDealStageText = (row: HubSpotDealRow): string => normalizeText(`${row.deal_stage_label ?? ""} ${row.deal_stage ?? ""}`);

const isWonDeal = (row: HubSpotDealRow): boolean => {
  if (row.deal_lifecycle_status === "won") {
    return true;
  }

  const stage = getDealStageText(row);

  return stage.includes("won") || stage.includes("gagn");
};

const isLostDeal = (row: HubSpotDealRow): boolean => {
  if (row.deal_lifecycle_status === "lost") {
    return true;
  }

  const stage = getDealStageText(row);

  return stage.includes("lost") || stage.includes("perdu");
};

const isForecastableDeal = (row: HubSpotDealRow): boolean => {
  if (isLostDeal(row)) {
    return false;
  }

  if (isWonDeal(row)) {
    return true;
  }

  if (row.deal_lifecycle_status === "pending") {
    return true;
  }

  if (row.is_closed_deal === true) {
    return false;
  }

  const stage = getDealStageText(row);

  return !stage.includes("closed");
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

const loadOpenDealContexts = async (options: Required<Pick<ForecastOverviewOptions, "orgId">> & {
  scope: ForecastScope;
  hubspotOwnerId: string | null;
  dateFrom: string;
  dateTo: string;
}): Promise<ForecastDealContext[]> => {
  const supabase = getSupabaseAdmin();
  const dateToExclusive = addDays(new Date(`${options.dateTo}T00:00:00.000Z`), 1).toISOString();
  let query = supabase
    .from("hubspot_deals")
    .select(
      "hubspot_deal_id, hubspot_owner_id, primary_contact_id, primary_company_id, deal_name, amount, pipeline_label, deal_stage, deal_stage_label, deal_lifecycle_status, is_closed_deal, close_probability, closed_at, hubspot_updated_at, properties, synced_at",
    )
    .eq("org_id", options.orgId)
    .gte("closed_at", `${options.dateFrom}T00:00:00.000Z`)
    .lt("closed_at", dateToExclusive)
    .order("amount", { ascending: false })
    .limit(MAX_OPEN_DEALS);

  if (options.scope === "owner") {
    if (!options.hubspotOwnerId) {
      return [];
    }

    query = query.eq("hubspot_owner_id", options.hubspotOwnerId);
  }

  const { data: dealRows, error: dealsError } = await query;

  if (dealsError) {
    throw new Error(`Impossible de charger les deals forecast Supabase: ${dealsError.message}`);
  }

  const deals = ((dealRows ?? []) as HubSpotDealRow[]).filter(isForecastableDeal);
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
  const isWon = isWonDeal(context.row);
  const analysis = analysisRow?.analysis ?? null;
  const status = isWon ? "closed_won" : getAnalysisStatus(context.row, analysisRow);
  const aiProbability = isWon ? 100 : status === "fresh" && analysis ? clamp(Math.round(analysis.closeWonProbability), 0, 100) : null;
  const probability = aiProbability ?? 0;
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

const buildScenarios = (deals: ForecastDeal[]): ForecastScenario[] => {
  const analyzedDeals = deals.filter((deal) => deal.aiProbability !== null);
  const commitAmount = analyzedDeals
    .filter((deal) => (deal.aiProbability ?? 0) >= 70 || deal.dealHealth === "strong")
    .reduce((sum, deal) => sum + deal.forecastAmount, 0);
  const likelyAmount = analyzedDeals.reduce((sum, deal) => sum + deal.forecastAmount, 0);
  const upsideAmount = analyzedDeals.reduce((sum, deal) => {
    const probability = (deal.aiProbability ?? 0) / 100;
    return sum + Math.round(deal.amount * clamp(probability + 0.22, 0, 0.98));
  }, 0);
  const averageProbability =
    analyzedDeals.length > 0
      ? Math.round(analyzedDeals.reduce((sum, deal) => sum + (deal.aiProbability ?? 0), 0) / analyzedDeals.length)
      : 0;

  return [
    {
      id: "commit",
      label: "Commit",
      amount: commitAmount,
      probability: analyzedDeals.length > 0 ? clamp(Math.round(averageProbability * 0.82), 0, 100) : 0,
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
      probability: analyzedDeals.length > 0 ? clamp(Math.round(averageProbability * 0.42), 0, 100) : 0,
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

const getProvider = (providerId?: string | null, modelId?: string | null) =>
  createLlmProvider({
    provider: providerId,
    model: modelId,
  });

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
  const reliability = buildReliability(deals);
  const freshDeals = deals.filter((deal) => deal.analysisStatus === "fresh");
  const wonDeals = deals.filter((deal) => deal.analysisStatus === "closed_won");
  const staleDeals = deals.filter((deal) => deal.analysisStatus === "stale");
  const missingDeals = deals.filter((deal) => deal.analysisStatus === "missing");
  const lastAnalyzedAt = freshDeals
    .map((deal) => deal.analyzedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
  const forecastAmount = [...freshDeals, ...wonDeals].reduce((sum, deal) => sum + deal.forecastAmount, 0);
  const objectiveAmount = await getObjectiveAmountForForecast({
    orgId: options.orgId,
    scope,
    hubspotOwnerId: options.hubspotOwnerId ?? null,
    dateFrom,
    dateTo,
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
    openDealCount: deals.length,
    wonDealCount: wonDeals.length,
    analyzedDealCount: freshDeals.length + wonDeals.length,
    staleDealCount: staleDeals.length,
    missingAnalysisCount: missingDeals.length,
    pipelineAmount: deals.reduce((sum, deal) => sum + deal.amount, 0),
    forecastAmount,
    objectiveAmount,
    gapToObjective: objectiveAmount === null ? null : forecastAmount - objectiveAmount,
    confidenceScore: averageScore(reliability),
    scenarios: buildScenarios(deals),
    risks: buildRisks(freshDeals),
    levers: buildLevers(freshDeals),
    reliability,
    deals,
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
  const openDeals = overview.deals.filter((deal) => deal.analysisStatus !== "closed_won");
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
    .filter((deal) => deal.analysisStatus !== "closed_won")
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
    progress: 92,
    step: "Rechargement du forecast",
    message: "Lecture des analyses stockees depuis Supabase.",
  });

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
    overview: await getForecastOverview({
      ...options,
      llmProvider: provider.providerName,
      llmModel: provider.modelName,
    }),
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

  if (deal.analysisStatus === "closed_won") {
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
