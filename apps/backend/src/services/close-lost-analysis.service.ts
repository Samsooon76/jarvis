import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "../db/client.js";
import { formatHubSpotTimelineForPrompt } from "./hubspot-history-formatting.service.js";
import { hubSpotService, type HubSpotDealHistoryItem } from "./hubspot.service.js";
import { getHubSpotAccessToken } from "./hubspot-auth.service.js";
import { createLlmProvider } from "./llm/provider.factory.js";
import type {
  CloseLostDealAnalysis,
  CloseLostEvidenceSource,
  CloseLostPortfolioAnalysis,
  LlmProvider,
} from "./llm/llm.provider.js";

export type CloseLostScope = "sales_ae" | "owner";
export type CloseLostRunStatus = "queued" | "running" | "completed" | "failed";
export type CloseLostAnalysisStatus = "fresh" | "stale" | "missing";

export type CloseLostRunLog = {
  at: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
};

export type CloseLostAnalysisRun = {
  id: string;
  orgId: string;
  scope: CloseLostScope;
  hubspotOwnerId: string | null;
  salesAeOwnerIds: string[];
  provider: string;
  model: string;
  dateFrom: string;
  dateTo: string;
  status: CloseLostRunStatus;
  progress: number;
  currentStep: string;
  logs: CloseLostRunLog[];
  dealCount: number;
  analyzedCount: number;
  reusedCount: number;
  failedCount: number;
  result: CloseLostPortfolioAnalysis | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CloseLostDealListItem = {
  hubspotDealId: string;
  dealName: string | null;
  companyName: string;
  contactName: string | null;
  ownerName: string | null;
  ownerHubSpotId: string | null;
  amount: number;
  stage: string;
  closedAt: string | null;
  syncedAt: string;
  analysisStatus: CloseLostAnalysisStatus;
  analyzedAt: string | null;
  primaryLossReason: string | null;
  lossReasonCategory: CloseLostDealAnalysis["lossReasonCategory"] | null;
  competitorName: string | null;
  reactivationScore: number | null;
  confidence: CloseLostDealAnalysis["confidence"] | null;
};

export type CloseLostMetric = {
  id: "lostDeals" | "lostValue" | "averageLoss" | "analyzedDeals" | "reactivationScore";
  label: string;
  value: number;
  unit: "count" | "currency" | "score";
  caption: string;
};

export type CloseLostBreakdownRow = {
  id: string;
  label: string;
  dealCount: number;
  lostValue: number;
  share: number;
};

export type CloseLostOverviewResult = {
  orgId: string;
  scope: CloseLostScope;
  hubspotOwnerId: string | null;
  salesAeOwnerIds: string[];
  dateFrom: string;
  dateTo: string;
  provider: string;
  model: string;
  generatedAt: string;
  lastRun: CloseLostAnalysisRun | null;
  portfolio: CloseLostPortfolioAnalysis | null;
  metrics: CloseLostMetric[];
  deals: CloseLostDealListItem[];
  lossReasons: CloseLostBreakdownRow[];
  competitors: CloseLostBreakdownRow[];
  stageBreakdown: CloseLostBreakdownRow[];
  recommendations: CloseLostPortfolioAnalysis["recommendations"];
  needsAnalysisCount: number;
};

export type CloseLostDealDetailResult = {
  orgId: string;
  provider: string;
  model: string;
  deal: CloseLostDealListItem & {
    companyDomain: string | null;
    companyIndustry: string | null;
    contactEmail: string | null;
    closeProbability: number;
    createdAt: string | null;
    updatedAt: string | null;
  };
  analysis: CloseLostDealAnalysis | null;
  analysisStatus: CloseLostAnalysisStatus;
  generatedAt: string | null;
  sourceSyncedAt: string | null;
};

export type CloseLostRunOptions = {
  orgId: string;
  scope: CloseLostScope;
  hubspotOwnerId?: string | null;
  salesAeOwnerIds?: string[];
  dateFrom: string;
  dateTo: string;
  llmProvider?: string | null;
  llmModel?: string | null;
  refresh?: boolean;
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
  hubspot_created_at: string | null;
  closed_at: string | null;
  hubspot_updated_at: string | null;
  properties: unknown;
  synced_at: string;
};

type HubSpotContactRow = {
  hubspot_contact_id: string;
  email: string | null;
  name: string;
  phone: string | null;
  title: string | null;
  company_name: string | null;
  properties: unknown;
};

type HubSpotCompanyRow = {
  hubspot_company_id: string;
  name: string | null;
  domain: string | null;
  industry: string | null;
  country: string | null;
  properties: unknown;
};

type OwnerUserRow = {
  hubspot_owner_id: string | null;
  name: string;
};

type CloseLostAnalysisRow = {
  id: string;
  org_id: string;
  hubspot_deal_id: string;
  provider: string;
  model: string;
  input_hash: string;
  analysis: CloseLostDealAnalysis;
  source_synced_at: string | null;
  generated_at: string;
};

type CloseLostAnalysisRunRow = {
  id: string;
  org_id: string;
  scope: CloseLostScope;
  hubspot_owner_id: string | null;
  sales_ae_owner_ids?: string[] | null;
  provider: string;
  model: string;
  date_from: string;
  date_to: string;
  status: CloseLostRunStatus;
  progress: number;
  current_step: string;
  logs: unknown;
  deal_count: number;
  analyzed_count: number;
  reused_count: number;
  failed_count: number;
  result: CloseLostPortfolioAnalysis | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

type CloseLostDealContext = {
  row: HubSpotDealRow;
  contact: HubSpotContactRow | null;
  company: HubSpotCompanyRow | null;
  ownerName: string | null;
};

const MAX_DEALS_PER_RUN = 80;
const RUN_LOG_LIMIT = 100;
const CLOSE_LOST_ANALYSIS_CONCURRENCY = 10;

const LOSS_REASON_CATEGORY_LABELS: Record<CloseLostDealAnalysis["lossReasonCategory"], string> = {
  authority: "Autorite de decision",
  budget: "Budget",
  competition: "Concurrence",
  no_decision: "Client inconclusif",
  other: "Autre",
  pricing: "Pricing",
  product_gap: "Fonctionnalites manquantes",
  timing: "Timing",
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readString = (record: Record<string, unknown> | null, key: string): string | null => {
  const value = record?.[key];

  return typeof value === "string" && value.trim() ? value : null;
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

const parseDate = (value: string): Date | null => {
  const timestamp = new Date(value).getTime();

  return Number.isNaN(timestamp) ? null : new Date(timestamp);
};

const getDateOnly = (value: string): string => value.slice(0, 10);

const addDays = (date: Date, days: number): Date => {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);

  return copy;
};

const hashInput = (value: string): string => createHash("sha256").update(value).digest("hex");

const normalizeStageText = (value: string | null | undefined): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const isLostDeal = (row: HubSpotDealRow): boolean => {
  if (row.deal_lifecycle_status === "lost") {
    return true;
  }

  const stage = normalizeStageText(`${row.deal_stage_label ?? ""} ${row.deal_stage ?? ""}`);

  return stage.includes("lost") || stage.includes("perdu");
};

const buildHistoryText = (timeline: HubSpotDealHistoryItem[]): string => formatHubSpotTimelineForPrompt(timeline);

const SOURCE_ACTIVITY_TYPES = new Set<HubSpotDealHistoryItem["type"]>([
  "note",
  "call",
  "meeting",
  "email",
  "sms",
  "communication",
]);

const compactSourceText = (value: string | null, maxLength: number): string => {
  const compacted = (value ?? "").replace(/\s+/g, " ").trim();

  if (compacted.length <= maxLength) {
    return compacted;
  }

  return `${compacted.slice(0, maxLength - 1).trim()}...`;
};

const buildEvidenceSources = (timeline: HubSpotDealHistoryItem[]): CloseLostEvidenceSource[] =>
  timeline
    .filter((item) => SOURCE_ACTIVITY_TYPES.has(item.type))
    .map((item) => ({
      activityId: item.id,
      type: item.type,
      channel: item.metadata.channel ?? null,
      occurredAt: item.timestamp,
      title: compactSourceText(item.title, 120) || `${item.type} ${item.id}`,
      quote: compactSourceText(item.body, 260),
    }))
    .filter((source) => source.quote.length > 0)
    .slice(-80);

const normalizeLogs = (value: unknown): CloseLostRunLog[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is CloseLostRunLog => {
          if (!isRecord(item)) {
            return false;
          }

          return (
            typeof item.at === "string" &&
            typeof item.message === "string" &&
            (item.level === "info" || item.level === "success" || item.level === "warning" || item.level === "error")
          );
        })
        .slice(-RUN_LOG_LIMIT)
    : [];

const mapRunRow = (row: CloseLostAnalysisRunRow): CloseLostAnalysisRun => ({
  id: row.id,
  orgId: row.org_id,
  scope: row.scope,
  hubspotOwnerId: row.hubspot_owner_id,
  salesAeOwnerIds: row.sales_ae_owner_ids ?? [],
  provider: row.provider,
  model: row.model,
  dateFrom: getDateOnly(row.date_from),
  dateTo: getDateOnly(row.date_to),
  status: row.status,
  progress: row.progress,
  currentStep: row.current_step,
  logs: normalizeLogs(row.logs),
  dealCount: row.deal_count,
  analyzedCount: row.analyzed_count,
  reusedCount: row.reused_count,
  failedCount: row.failed_count,
  result: row.result,
  error: row.error,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const getProvider = (providerId?: string | null, modelId?: string | null): LlmProvider =>
  createLlmProvider({
    provider: providerId,
    model: modelId,
  });

const getDefaultDateRange = (dateFrom?: string | null, dateTo?: string | null): { dateFrom: string; dateTo: string } => {
  const now = new Date();
  const normalizedDateTo = dateTo && parseDate(dateTo) ? dateTo.slice(0, 10) : now.toISOString().slice(0, 10);
  const normalizedDateFrom =
    dateFrom && parseDate(dateFrom) ? dateFrom.slice(0, 10) : `${now.getUTCFullYear()}-01-01`;

  return {
    dateFrom: normalizedDateFrom,
    dateTo: normalizedDateTo,
  };
};

const buildScopeLabel = (scope: CloseLostScope, ownerName: string | null): string =>
  scope === "owner" ? `Owner ${ownerName ?? "selectionne"}` : "Tous les Sales AE";

const loadCloseLostDealContexts = async (
  options: Pick<CloseLostRunOptions, "orgId" | "scope" | "hubspotOwnerId" | "salesAeOwnerIds" | "dateFrom" | "dateTo"> & {
    hubspotDealId?: string | null;
  },
): Promise<CloseLostDealContext[]> => {
  const supabase = getSupabaseAdmin();
  const dateToExclusive = addDays(new Date(`${options.dateTo}T00:00:00.000Z`), 1).toISOString();
  let query = supabase
    .from("hubspot_deals")
    .select(
      "hubspot_deal_id, hubspot_owner_id, primary_contact_id, primary_company_id, deal_name, amount, pipeline_label, deal_stage, deal_stage_label, deal_lifecycle_status, is_closed_deal, close_probability, hubspot_created_at, closed_at, hubspot_updated_at, properties, synced_at",
    )
    .eq("org_id", options.orgId)
    .order("closed_at", { ascending: false })
    .limit(500);

  if (options.hubspotDealId) {
    query = query.eq("hubspot_deal_id", options.hubspotDealId);
  } else {
    query = query
      .not("closed_at", "is", null)
      .gte("closed_at", `${options.dateFrom}T00:00:00.000Z`)
      .lt("closed_at", dateToExclusive);
  }

  if (!options.hubspotDealId && options.scope === "owner") {
    if (!options.hubspotOwnerId) {
      return [];
    }

    query = query.eq("hubspot_owner_id", options.hubspotOwnerId);
  } else if (!options.hubspotDealId && options.salesAeOwnerIds && options.salesAeOwnerIds.length > 0) {
    query = query.in("hubspot_owner_id", options.salesAeOwnerIds);
  }

  const { data: dealRows, error: dealsError } = await query;

  if (dealsError) {
    throw new Error(`Impossible de charger les deals close lost: ${dealsError.message}`);
  }

  const deals = ((dealRows ?? []) as HubSpotDealRow[]).filter(isLostDeal).slice(0, MAX_DEALS_PER_RUN);
  const contactIds = Array.from(
    new Set(deals.map((deal) => deal.primary_contact_id).filter((value): value is string => Boolean(value))),
  );
  const companyIds = Array.from(
    new Set(deals.map((deal) => deal.primary_company_id).filter((value): value is string => Boolean(value))),
  );
  const ownerIds = Array.from(
    new Set(deals.map((deal) => deal.hubspot_owner_id).filter((value): value is string => Boolean(value))),
  );

  const [contactsResult, companiesResult, ownersResult] = await Promise.all([
    contactIds.length > 0
      ? supabase
          .from("hubspot_contacts")
          .select("hubspot_contact_id, email, name, phone, title, company_name, properties")
          .eq("org_id", options.orgId)
          .in("hubspot_contact_id", contactIds)
      : Promise.resolve({ data: [], error: null }),
    companyIds.length > 0
      ? supabase
          .from("hubspot_companies")
          .select("hubspot_company_id, name, domain, industry, country, properties")
          .eq("org_id", options.orgId)
          .in("hubspot_company_id", companyIds)
      : Promise.resolve({ data: [], error: null }),
    ownerIds.length > 0
      ? supabase
          .from("users")
          .select("hubspot_owner_id, name")
          .eq("org_id", options.orgId)
          .in("hubspot_owner_id", ownerIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (contactsResult.error) {
    throw new Error(`Impossible de charger les contacts close lost: ${contactsResult.error.message}`);
  }

  if (companiesResult.error) {
    throw new Error(`Impossible de charger les entreprises close lost: ${companiesResult.error.message}`);
  }

  if (ownersResult.error) {
    throw new Error(`Impossible de charger les owners close lost: ${ownersResult.error.message}`);
  }

  const contactById = new Map(
    ((contactsResult.data ?? []) as HubSpotContactRow[]).map((contact) => [contact.hubspot_contact_id, contact]),
  );
  const companyById = new Map(
    ((companiesResult.data ?? []) as HubSpotCompanyRow[]).map((company) => [company.hubspot_company_id, company]),
  );
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

const loadLatestAnalyses = async (
  orgId: string,
  hubspotDealIds: string[],
  provider: string,
  model: string,
): Promise<Map<string, CloseLostAnalysisRow>> => {
  if (hubspotDealIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("close_lost_deal_analyses")
    .select("id, org_id, hubspot_deal_id, provider, model, input_hash, analysis, source_synced_at, generated_at")
    .eq("org_id", orgId)
    .eq("provider", provider)
    .eq("model", model)
    .in("hubspot_deal_id", hubspotDealIds)
    .order("generated_at", { ascending: false });

  if (error) {
    throw new Error(`Impossible de charger le cache close lost: ${error.message}`);
  }

  const latestByDealId = new Map<string, CloseLostAnalysisRow>();

  for (const row of (data ?? []) as CloseLostAnalysisRow[]) {
    if (!latestByDealId.has(row.hubspot_deal_id)) {
      latestByDealId.set(row.hubspot_deal_id, row);
    }
  }

  return latestByDealId;
};

const getAnalysisStatus = (deal: HubSpotDealRow, analysis: CloseLostAnalysisRow | null): CloseLostAnalysisStatus => {
  if (!analysis) {
    return "missing";
  }

  return analysis.source_synced_at && analysis.source_synced_at === deal.synced_at ? "fresh" : "stale";
};

const buildDealListItem = (
  context: CloseLostDealContext,
  analysisRow: CloseLostAnalysisRow | null,
): CloseLostDealListItem => {
  const analysis = analysisRow?.analysis ?? null;
  const properties = asRecord(context.row.properties);
  const dealName = context.row.deal_name ?? readString(properties, "dealname");
  const companyName =
    context.company?.name ??
    context.contact?.company_name ??
    readString(properties, "company") ??
    dealName ??
    "Entreprise inconnue";

  return {
    hubspotDealId: context.row.hubspot_deal_id,
    dealName,
    companyName,
    contactName: context.contact?.name ?? null,
    ownerName: context.ownerName ?? (context.row.hubspot_owner_id ? `Owner ${context.row.hubspot_owner_id}` : null),
    ownerHubSpotId: context.row.hubspot_owner_id,
    amount: parseNumber(context.row.amount) ?? 0,
    stage: context.row.deal_stage_label ?? context.row.deal_stage ?? "Closed lost",
    closedAt: context.row.closed_at,
    syncedAt: context.row.synced_at,
    analysisStatus: getAnalysisStatus(context.row, analysisRow),
    analyzedAt: analysisRow?.generated_at ?? null,
    primaryLossReason: analysis?.primaryLossReason ?? null,
    lossReasonCategory: analysis?.lossReasonCategory ?? null,
    competitorName: analysis?.competitorName ?? null,
    reactivationScore: analysis?.reactivationScore ?? null,
    confidence: analysis?.confidence ?? null,
  };
};

const buildBreakdown = (
  deals: CloseLostDealListItem[],
  getKey: (deal: CloseLostDealListItem) => string | null,
  fallbackLabel: string,
): CloseLostBreakdownRow[] => {
  const totalValue = deals.reduce((sum, deal) => sum + deal.amount, 0);
  const rowsById = new Map<string, CloseLostBreakdownRow>();

  for (const deal of deals) {
    const label = getKey(deal)?.trim() || fallbackLabel;
    const id = label.toLowerCase();
    const current = rowsById.get(id) ?? {
      id,
      label,
      dealCount: 0,
      lostValue: 0,
      share: 0,
    };

    current.dealCount += 1;
    current.lostValue += deal.amount;
    rowsById.set(id, current);
  }

  return Array.from(rowsById.values())
    .map((row) => ({
      ...row,
      share: totalValue > 0 ? Math.round((row.lostValue / totalValue) * 100) : 0,
    }))
    .sort((left, right) => right.lostValue - left.lostValue)
    .slice(0, 8);
};

const getLossReasonBreakdownLabel = (deal: CloseLostDealListItem): string | null => {
  if (deal.lossReasonCategory) {
    return LOSS_REASON_CATEGORY_LABELS[deal.lossReasonCategory];
  }

  return deal.primaryLossReason;
};

const buildMetrics = (deals: CloseLostDealListItem[]): CloseLostMetric[] => {
  const lostValue = deals.reduce((sum, deal) => sum + deal.amount, 0);
  const analyzedDeals = deals.filter((deal) => deal.analysisStatus === "fresh").length;
  const scoredDeals = deals.filter((deal) => typeof deal.reactivationScore === "number");
  const averageReactivationScore =
    scoredDeals.length > 0
      ? Math.round(scoredDeals.reduce((sum, deal) => sum + (deal.reactivationScore ?? 0), 0) / scoredDeals.length)
      : 0;

  return [
    {
      id: "lostDeals",
      label: "Deals close lost",
      value: deals.length,
      unit: "count",
      caption: "Dans le scope choisi",
    },
    {
      id: "lostValue",
      label: "Valeur perdue",
      value: lostValue,
      unit: "currency",
      caption: "Somme HubSpot",
    },
    {
      id: "averageLoss",
      label: "Perte moyenne",
      value: deals.length > 0 ? Math.round(lostValue / deals.length) : 0,
      unit: "currency",
      caption: "Par deal perdu",
    },
    {
      id: "analyzedDeals",
      label: "Analyses IA",
      value: analyzedDeals,
      unit: "count",
      caption: `${deals.length - analyzedDeals} a analyser`,
    },
    {
      id: "reactivationScore",
      label: "Reactivation",
      value: averageReactivationScore,
      unit: "score",
      caption: "Score moyen",
    },
  ];
};

const loadLastCompletedRun = async (
  options: Pick<CloseLostRunOptions, "orgId" | "scope" | "hubspotOwnerId" | "dateFrom" | "dateTo">,
  provider: string,
  model: string,
): Promise<CloseLostAnalysisRun | null> => {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("close_lost_analysis_runs")
    .select("*")
    .eq("org_id", options.orgId)
    .eq("scope", options.scope)
    .eq("provider", provider)
    .eq("model", model)
    .eq("date_from", options.dateFrom)
    .eq("date_to", options.dateTo)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1);

  if (options.scope === "owner") {
    query = query.eq("hubspot_owner_id", options.hubspotOwnerId ?? "");
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le dernier run close lost: ${error.message}`);
  }

  return data ? mapRunRow(data as CloseLostAnalysisRunRow) : null;
};

export const getCloseLostOverview = async (
  options: Omit<CloseLostRunOptions, "dateFrom" | "dateTo"> & {
    dateFrom?: string | null;
    dateTo?: string | null;
  },
): Promise<CloseLostOverviewResult> => {
  const { dateFrom, dateTo } = getDefaultDateRange(options.dateFrom, options.dateTo);
  const provider = getProvider(options.llmProvider, options.llmModel);
  const contexts = await loadCloseLostDealContexts({
    orgId: options.orgId,
    scope: options.scope,
    hubspotOwnerId: options.hubspotOwnerId,
    salesAeOwnerIds: options.salesAeOwnerIds,
    dateFrom,
    dateTo,
  });
  const latestAnalyses = await loadLatestAnalyses(
    options.orgId,
    contexts.map((context) => context.row.hubspot_deal_id),
    provider.providerName,
    provider.modelName,
  );
  const deals = contexts.map((context) => buildDealListItem(context, latestAnalyses.get(context.row.hubspot_deal_id) ?? null));
  const lastRun = await loadLastCompletedRun(
    {
      orgId: options.orgId,
      scope: options.scope,
      hubspotOwnerId: options.hubspotOwnerId,
      dateFrom,
      dateTo,
    },
    provider.providerName,
    provider.modelName,
  );
  const portfolio = lastRun?.result ?? null;
  const lossReasons = buildBreakdown(deals, getLossReasonBreakdownLabel, "Non analyse");

  return {
    orgId: options.orgId,
    scope: options.scope,
    hubspotOwnerId: options.hubspotOwnerId ?? null,
    salesAeOwnerIds: options.salesAeOwnerIds ?? [],
    dateFrom,
    dateTo,
    provider: provider.providerName,
    model: provider.modelName,
    generatedAt: new Date().toISOString(),
    lastRun,
    portfolio,
    metrics: buildMetrics(deals),
    deals,
    lossReasons,
    competitors: buildBreakdown(deals, (deal) => deal.competitorName, "Aucun concurrent identifie"),
    stageBreakdown: buildBreakdown(deals, (deal) => deal.stage, "Stage inconnu"),
    recommendations: portfolio?.recommendations ?? [],
    needsAnalysisCount: deals.filter((deal) => deal.analysisStatus !== "fresh").length,
  };
};

const buildAnalysisInputHash = (context: CloseLostDealContext, historyText: string): string =>
  hashInput(
    JSON.stringify({
      hubspotDealId: context.row.hubspot_deal_id,
      dealName: context.row.deal_name,
      amount: context.row.amount,
      stage: context.row.deal_stage,
      stageLabel: context.row.deal_stage_label,
      closedAt: context.row.closed_at,
      hubspotUpdatedAt: context.row.hubspot_updated_at,
      syncedAt: context.row.synced_at,
      primaryContactId: context.row.primary_contact_id,
      primaryCompanyId: context.row.primary_company_id,
      historyText,
    }),
  );

const loadExactCachedAnalysis = async (
  orgId: string,
  hubspotDealId: string,
  provider: string,
  model: string,
  inputHash: string,
): Promise<CloseLostAnalysisRow | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("close_lost_deal_analyses")
    .select("id, org_id, hubspot_deal_id, provider, model, input_hash, analysis, source_synced_at, generated_at")
    .eq("org_id", orgId)
    .eq("hubspot_deal_id", hubspotDealId)
    .eq("provider", provider)
    .eq("model", model)
    .eq("input_hash", inputHash)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le cache close lost du deal: ${error.message}`);
  }

  return data as CloseLostAnalysisRow | null;
};

const persistDealAnalysis = async (
  orgId: string,
  context: CloseLostDealContext,
  provider: LlmProvider,
  inputHash: string,
  analysis: CloseLostDealAnalysis,
): Promise<CloseLostAnalysisRow> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("close_lost_deal_analyses")
    .upsert(
      {
        org_id: orgId,
        hubspot_deal_id: context.row.hubspot_deal_id,
        provider: provider.providerName,
        model: provider.modelName,
        input_hash: inputHash,
        analysis,
        source_synced_at: context.row.synced_at,
        generated_at: new Date().toISOString(),
      },
      {
        onConflict: "org_id,hubspot_deal_id,provider,model,input_hash",
      },
    )
    .select("id, org_id, hubspot_deal_id, provider, model, input_hash, analysis, source_synced_at, generated_at")
    .single();

  if (error) {
    throw new Error(`Impossible de sauvegarder l'analyse close lost du deal: ${error.message}`);
  }

  return data as CloseLostAnalysisRow;
};

const analyzeContext = async (
  orgId: string,
  context: CloseLostDealContext,
  provider: LlmProvider,
  refresh: boolean,
): Promise<{ row: CloseLostAnalysisRow; cached: boolean }> => {
  const accessToken = await getHubSpotAccessToken(orgId);
  const history = await hubSpotService.fetchDealHistory(accessToken, context.row.hubspot_deal_id);
  const historyText = buildHistoryText(history.timeline);
  const sourceActivities = buildEvidenceSources(history.timeline);
  const inputHash = buildAnalysisInputHash(context, historyText);

  if (!refresh) {
    const cached = await loadExactCachedAnalysis(
      orgId,
      context.row.hubspot_deal_id,
      provider.providerName,
      provider.modelName,
      inputHash,
    );

    if (cached) {
      return {
        row: cached,
        cached: true,
      };
    }
  }

  const analysis = await provider.analyzeCloseLostDeal({
    history: historyText || "Aucun historique HubSpot exploitable.",
    sourceActivities,
    companyName: history.companyName ?? context.company?.name ?? context.contact?.company_name ?? null,
    dealName: history.dealName ?? context.row.deal_name,
    companyContext: history.companyContext,
    dealContext: history.dealContext,
    dealStage: context.row.deal_stage_label ?? context.row.deal_stage,
    dealAmount: parseNumber(context.row.amount),
    closedAt: context.row.closed_at,
    ownerName: context.ownerName,
    contactNames: history.contactNames,
    today: new Date().toISOString(),
  });

  return {
    row: await persistDealAnalysis(orgId, context, provider, inputHash, analysis),
    cached: false,
  };
};

export const getCloseLostDealDetail = async (
  orgId: string,
  hubspotDealId: string,
  llmProvider?: string | null,
  llmModel?: string | null,
): Promise<CloseLostDealDetailResult> => {
  const provider = getProvider(llmProvider, llmModel);
  const contexts = await loadCloseLostDealContexts({
    orgId,
    scope: "sales_ae",
    salesAeOwnerIds: [],
    dateFrom: "1970-01-01",
    dateTo: "2999-12-31",
    hubspotDealId,
  });
  const context = contexts.find((candidate) => candidate.row.hubspot_deal_id === hubspotDealId) ?? null;

  if (!context) {
    throw new Error("Deal close lost introuvable dans Supabase.");
  }

  const latestAnalyses = await loadLatestAnalyses(orgId, [hubspotDealId], provider.providerName, provider.modelName);
  const analysisRow = latestAnalyses.get(hubspotDealId) ?? null;
  const baseDeal = buildDealListItem(context, analysisRow);

  return {
    orgId,
    provider: provider.providerName,
    model: provider.modelName,
    deal: {
      ...baseDeal,
      companyDomain: context.company?.domain ?? null,
      companyIndustry: context.company?.industry ?? null,
      contactEmail: context.contact?.email ?? null,
      closeProbability: parseNumber(context.row.close_probability) ?? 0,
      createdAt: context.row.hubspot_created_at,
      updatedAt: context.row.hubspot_updated_at,
    },
    analysis: analysisRow?.analysis ?? null,
    analysisStatus: getAnalysisStatus(context.row, analysisRow),
    generatedAt: analysisRow?.generated_at ?? null,
    sourceSyncedAt: analysisRow?.source_synced_at ?? null,
  };
};

export const analyzeCloseLostDeal = async (
  orgId: string,
  hubspotDealId: string,
  llmProvider?: string | null,
  llmModel?: string | null,
  refresh = false,
): Promise<CloseLostDealDetailResult> => {
  const provider = getProvider(llmProvider, llmModel);
  const contexts = await loadCloseLostDealContexts({
    orgId,
    scope: "sales_ae",
    salesAeOwnerIds: [],
    dateFrom: "1970-01-01",
    dateTo: "2999-12-31",
    hubspotDealId,
  });
  const context = contexts.find((candidate) => candidate.row.hubspot_deal_id === hubspotDealId) ?? null;

  if (!context) {
    throw new Error("Deal close lost introuvable dans Supabase.");
  }

  await analyzeContext(orgId, context, provider, refresh);

  return getCloseLostDealDetail(orgId, hubspotDealId, provider.providerName, provider.modelName);
};

const appendRunLog = (
  logs: CloseLostRunLog[],
  level: CloseLostRunLog["level"],
  message: string,
): CloseLostRunLog[] =>
  [
    ...logs,
    {
      at: new Date().toISOString(),
      level,
      message,
    },
  ].slice(-RUN_LOG_LIMIT);

const updateRun = async (
  runId: string,
  updates: Partial<{
    status: CloseLostRunStatus;
    progress: number;
    current_step: string;
    logs: CloseLostRunLog[];
    deal_count: number;
    analyzed_count: number;
    reused_count: number;
    failed_count: number;
    result: CloseLostPortfolioAnalysis | null;
    error: string | null;
    finished_at: string | null;
  }>,
): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("close_lost_analysis_runs").update(updates).eq("id", runId);

  if (error) {
    throw new Error(`Impossible de mettre a jour le run close lost: ${error.message}`);
  }
};

const loadRun = async (runId: string): Promise<CloseLostAnalysisRun> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("close_lost_analysis_runs").select("*").eq("id", runId).maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le run close lost: ${error.message}`);
  }

  if (!data) {
    throw new Error("Run close lost introuvable.");
  }

  return mapRunRow(data as CloseLostAnalysisRunRow);
};

export const getCloseLostAnalysisRun = async (runId: string): Promise<CloseLostAnalysisRun> => loadRun(runId);

export const createCloseLostAnalysisRun = async (options: CloseLostRunOptions): Promise<CloseLostAnalysisRun> => {
  const provider = getProvider(options.llmProvider, options.llmModel);
  const { dateFrom, dateTo } = getDefaultDateRange(options.dateFrom, options.dateTo);
  const supabase = getSupabaseAdmin();
  const initialLogs = appendRunLog([], "info", "Run close lost cree.");
  const { data, error } = await supabase
    .from("close_lost_analysis_runs")
    .insert({
      org_id: options.orgId,
      scope: options.scope,
      hubspot_owner_id: options.scope === "owner" ? options.hubspotOwnerId ?? null : null,
      sales_ae_owner_ids: options.scope === "sales_ae" ? options.salesAeOwnerIds ?? [] : [],
      provider: provider.providerName,
      model: provider.modelName,
      date_from: dateFrom,
      date_to: dateTo,
      status: "queued",
      progress: 0,
      current_step: "Queued",
      logs: initialLogs,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Impossible de creer le run close lost: ${error.message}`);
  }

  return mapRunRow(data as CloseLostAnalysisRunRow);
};

const buildPortfolioDealsSummary = (
  deals: Array<{ context: CloseLostDealContext; analysis: CloseLostDealAnalysis }>,
): string =>
  deals
    .map(({ context, analysis }) =>
      [
        `Deal: ${context.row.deal_name ?? context.row.hubspot_deal_id}`,
        `Entreprise: ${context.company?.name ?? context.contact?.company_name ?? "inconnue"}`,
        `Montant: ${parseNumber(context.row.amount) ?? 0}`,
        `Stage: ${context.row.deal_stage_label ?? context.row.deal_stage ?? "inconnu"}`,
        `Raison: ${analysis.primaryLossReason}`,
        `Categorie: ${analysis.lossReasonCategory}`,
        `Concurrent: ${analysis.competitorName ?? "non identifie"}`,
        `Reactivation: ${analysis.reactivationScore}`,
        `Resume: ${analysis.summary}`,
      ].join(" | "),
    )
    .join("\n");

export const executeCloseLostAnalysisRun = async (runId: string): Promise<void> => {
  const run = await loadRun(runId);
  const provider = getProvider(run.provider, run.model);
  let logs = appendRunLog(run.logs, "info", "Chargement des deals perdus depuis Supabase.");
  let analyzedCount = 0;
  let reusedCount = 0;
  let failedCount = 0;

  await updateRun(run.id, {
    status: "running",
    progress: 5,
    current_step: "Chargement des deals perdus",
    logs,
  });

  try {
    const contexts = await loadCloseLostDealContexts({
      orgId: run.orgId,
      scope: run.scope,
      hubspotOwnerId: run.hubspotOwnerId,
      salesAeOwnerIds: run.salesAeOwnerIds,
      dateFrom: run.dateFrom,
      dateTo: run.dateTo,
    });
    const latestAnalyses = await loadLatestAnalyses(
      run.orgId,
      contexts.map((context) => context.row.hubspot_deal_id),
      provider.providerName,
      provider.modelName,
    );
    const analyzedDeals: Array<{ context: CloseLostDealContext; analysis: CloseLostDealAnalysis }> = [];

    logs = appendRunLog(logs, "info", `${contexts.length} deal(s) close lost a traiter.`);
    await updateRun(run.id, {
      progress: 10,
      current_step: "Analyse des deals",
      logs,
      deal_count: contexts.length,
    });

    let nextContextIndex = 0;
    let processedCount = 0;

    const processNextContext = async (): Promise<void> => {
      while (nextContextIndex < contexts.length) {
        const index = nextContextIndex;
        nextContextIndex += 1;
        const context = contexts[index];

        if (!context) {
          continue;
        }

        const latestAnalysis = latestAnalyses.get(context.row.hubspot_deal_id) ?? null;

        if (latestAnalysis && getAnalysisStatus(context.row, latestAnalysis) === "fresh") {
          reusedCount += 1;
          analyzedDeals.push({
            context,
            analysis: latestAnalysis.analysis,
          });
        } else {
          try {
            const result = await analyzeContext(run.orgId, context, provider, false);
            analyzedCount += result.cached ? 0 : 1;
            reusedCount += result.cached ? 1 : 0;
            analyzedDeals.push({
              context,
              analysis: result.row.analysis,
            });
          } catch (error) {
            failedCount += 1;
            logs = appendRunLog(
              logs,
              "warning",
              `Analyse echouee pour ${context.row.deal_name ?? context.row.hubspot_deal_id}: ${
                error instanceof Error ? error.message : "erreur inconnue"
              }`,
            );
          }
        }

        processedCount += 1;
        const progress = 10 + Math.round((processedCount / Math.max(contexts.length, 1)) * 70);
        await updateRun(run.id, {
          progress,
          current_step: `Analyse des deals ${processedCount}/${contexts.length}`,
          logs,
          analyzed_count: analyzedCount,
          reused_count: reusedCount,
          failed_count: failedCount,
        });
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(CLOSE_LOST_ANALYSIS_CONCURRENCY, Math.max(contexts.length, 1)) },
        () => processNextContext(),
      ),
    );

    logs = appendRunLog(logs, "info", "Generation de la synthese globale close lost.");
    await updateRun(run.id, {
      progress: 86,
      current_step: "Synthese globale",
      logs,
    });

    const totalLostValue = contexts.reduce((sum, context) => sum + (parseNumber(context.row.amount) ?? 0), 0);
    const ownerName = contexts.find((context) => context.ownerName)?.ownerName ?? null;
    const portfolio =
      analyzedDeals.length > 0
        ? await provider.analyzeCloseLostPortfolio({
            dealsSummary: buildPortfolioDealsSummary(analyzedDeals),
            dateFrom: run.dateFrom,
            dateTo: run.dateTo,
            scopeLabel: buildScopeLabel(run.scope, ownerName),
            lostDealCount: contexts.length,
            totalLostValue,
            analyzedDealCount: analyzedDeals.length,
          })
        : null;

    logs = appendRunLog(logs, "success", "Run close lost termine.");
    await updateRun(run.id, {
      status: "completed",
      progress: 100,
      current_step: "Termine",
      logs,
      deal_count: contexts.length,
      analyzed_count: analyzedCount,
      reused_count: reusedCount,
      failed_count: failedCount,
      result: portfolio,
      error: null,
      finished_at: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue pendant le run close lost.";
    logs = appendRunLog(logs, "error", message);
    await updateRun(run.id, {
      status: "failed",
      current_step: "Erreur",
      logs,
      analyzed_count: analyzedCount,
      reused_count: reusedCount,
      failed_count: failedCount,
      error: message,
      finished_at: new Date().toISOString(),
    });

    throw error;
  }
};
