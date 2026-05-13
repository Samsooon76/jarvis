import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import { env } from "../config/env.js";
import { getSupabaseAdmin } from "../db/client.js";
import {
  hubSpotService,
  type DealLifecycleStatus,
  type HubSpotCrmSyncSnapshot,
} from "../services/hubspot.service.js";
import { loadLocalHubSpotDealHistory } from "../services/hubspot-activity-history.service.js";
import { getHubSpotAccessToken, upsertHubSpotIntegration } from "../services/hubspot-auth.service.js";
import { runAutomaticFollowUpTasksForOrg } from "../services/follow-up-task.service.js";

type HubSpotStartQuery = {
  orgId?: string;
  returnTo?: string;
};

type HubSpotCallbackQuery = {
  code?: string;
  state?: string;
};

type HubSpotStatusQuery = {
  orgId?: string;
};

type HubSpotConfigStatus = {
  apiPublicUrl: string | null;
  appUrl: string;
  hubspotRedirectUri: string;
  hasHubSpotClientId: boolean;
  hasHubSpotClientSecret: boolean;
  hasHubSpotAppId: boolean;
};

type HubSpotSyncBody = {
  orgId?: string;
  contactNames?: string[];
  hubspotOwnerIds?: string[];
  async?: boolean;
};

type HubSpotSyncJobParams = {
  jobId: string;
};

type HubSpotDisconnectBody = {
  orgId?: string;
  purgeData?: boolean;
};

type HubSpotOwnersQuery = {
  orgId?: string;
};

type HubSpotLastUpdatesQuery = {
  orgId?: string;
  limit?: string;
};

type HubSpotOwnerProspectsQuery = {
  orgId?: string;
  hubspotOwnerId?: string;
  live?: string;
};

type HubSpotDealHistoryQuery = {
  orgId?: string;
};

type SyncResult = {
  orgId: string;
  syncedCount: number;
  crm: {
    contactCount: number;
    companyCount: number;
    dealCount: number;
  };
  autoFollowUp: {
    analyzedCount: number;
    createdCount: number;
    skippedCount: number;
    failedCount: number;
  };
};

type SyncProgressLog = {
  at: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
};

type SyncProgressStatus = "queued" | "running" | "completed" | "failed";

type SyncJobSnapshot = {
  jobId: string;
  orgId: string;
  status: SyncProgressStatus;
  progress: number;
  currentStep: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  logs: SyncProgressLog[];
  result: SyncResult | null;
  error: string | null;
};

type SyncProgressEvent = {
  progress: number;
  step: string;
  level?: SyncProgressLog["level"];
  message?: string;
};

type HubSpotStatusCacheEntry = {
  expiresAt: number;
  payload: HubSpotConnectionStatus;
};

type DisconnectResult = {
  orgId: string;
  disconnected: true;
  purgedProspectCount: number;
};

type HubSpotConnectionStatus = {
  orgId: string;
  connected: boolean;
  hubspotPortalId: string | null;
  prospectCount: number;
  syncedDealCount: number;
  hubspotDealCount: number | null;
  lastSyncedAt: string | null;
};

type OrganizationRow = {
  id: string;
};

type HubSpotOwnerOption = {
  ownerId: string;
  hubspotUserId: string | null;
  name: string;
  email: string;
  teamName: string | null;
  prospectCount: number;
  syncedDealCount: number;
  lastSyncedAt: string | null;
};

type HubSpotOwnerTeam = {
  id: string;
  name: string;
  primary?: boolean;
};

type HubSpotOwnerProspect = {
  id: string;
  dealName: string | null;
  contactName: string;
  email: string | null;
  company: string | null;
  title: string | null;
  dealStage: string | null;
  dealStageLabel: string | null;
  dealAmount: number | null;
  closeProbability: number;
  closedAt: string | null;
  dealLifecycleStatus: DealLifecycleStatus | null;
  isClosedDeal: boolean | null;
  lastContactAt: string | null;
  hubspotDealId: string | null;
  syncedAt: string;
};

type HubSpotOwnerProspectsPayload = {
  orgId: string;
  hubspotOwnerId: string;
  hubspotDealCount: number | null;
  prospects: HubSpotOwnerProspect[];
};

type HubSpotLastUpdateItem = {
  id: string;
  orgId: string;
  hubspotDealId: string;
  dealName: string | null;
  companyName: string | null;
  amount: number | null;
  dealStage: string | null;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  reason: string | null;
  eventCount: number;
  receivedAt: string;
  scheduledFor: string;
  processedAt: string | null;
};

type HubSpotLastUpdatesPayload = {
  orgId: string;
  updates: HubSpotLastUpdateItem[];
};

type HubSpotDealHistoryPayload = {
  orgId: string;
  dealId: string;
  dealName: string | null;
  companyName: string | null;
  dealContext: string | null;
  companyContext: string | null;
  contactNames: string[];
  timeline: Array<{
    id: string;
    type: "deal" | "note" | "call" | "meeting" | "email" | "sms";
    timestamp: string | null;
    title: string;
    body: string | null;
    metadata: Record<string, string | null>;
  }>;
};

type HubSpotProspectRow = {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  title: string | null;
  deal_stage: string | null;
  deal_amount: number | null;
  close_probability: number;
  last_contact_at: string | null;
  hubspot_deal_id: string | null;
  synced_at: string;
  raw_data: unknown;
};

type HubSpotOwnerUserRow = {
  id: string;
};

type ProspectRawData = {
  source?: string | null;
  dealName?: string | null;
  dealStageLabel?: string | null;
  closedAt?: string | null;
  dealLifecycleStatus?: DealLifecycleStatus | null;
  isClosedDeal?: boolean | null;
  hubspotOwnerId?: string | null;
  contactOwnerHubSpotId?: string | null;
  dealOwnerHubSpotId?: string | null;
  deal?: {
    properties?: {
      hubspot_owner_id?: string | null;
      closedate?: string | null;
    };
  };
  contact?: {
    properties?: {
      hubspot_owner_id?: string | null;
    };
  };
};

type HubSpotContactUpsertRow = {
  org_id: string;
  hubspot_contact_id: string;
  hubspot_owner_id: string | null;
  email: string | null;
  name: string;
  phone: string | null;
  title: string | null;
  company_name: string | null;
  properties: Record<string, string | null>;
  synced_at: string;
};

type HubSpotCompanyUpsertRow = {
  org_id: string;
  hubspot_company_id: string;
  name: string | null;
  domain: string | null;
  industry: string | null;
  city: string | null;
  country: string | null;
  properties: Record<string, string | null>;
  synced_at: string;
};

type HubSpotDealUpsertRow = {
  org_id: string;
  hubspot_deal_id: string;
  hubspot_owner_id: string | null;
  primary_contact_id: string | null;
  primary_company_id: string | null;
  associated_contact_ids: string[];
  associated_company_ids: string[];
  deal_name: string | null;
  amount: number | null;
  pipeline: string | null;
  pipeline_label: string | null;
  deal_stage: string | null;
  deal_stage_label: string | null;
  deal_lifecycle_status: DealLifecycleStatus | null;
  is_closed_deal: boolean | null;
  close_probability: number;
  hubspot_created_at: string | null;
  closed_at: string | null;
  hubspot_updated_at: string | null;
  properties: Record<string, string | null>;
  synced_at: string;
};

type HubSpotDealStageUpsertRow = {
  org_id: string;
  pipeline_id: string;
  pipeline_label: string | null;
  stage_id: string;
  stage_label: string;
  display_order: number | null;
  is_closed: boolean | null;
  probability: number | null;
  synced_at: string;
};

type HubSpotRealtimeAnalysisRunListRow = {
  id: string;
  org_id: string;
  hubspot_deal_id: string;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  reason: string | null;
  scheduled_for: string;
  started_at: string | null;
  finished_at: string | null;
  trigger_event_ids: string[];
  created_at: string;
  updated_at: string;
};

type HubSpotDealSummaryRow = {
  hubspot_deal_id: string;
  hubspot_owner_id: string | null;
  primary_company_id: string | null;
  deal_name: string | null;
  amount: number | null;
  deal_stage: string | null;
  deal_stage_label?: string | null;
};

type HubSpotCompanySummaryRow = {
  hubspot_company_id: string;
  name: string | null;
};

type SalesAeOwnerCacheEntry = {
  expiresAt: number;
  ownerIds: Set<string>;
};

const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidOrgId = (value: string | undefined): value is string =>
  typeof value === "string" && UUID_V4_LIKE_PATTERN.test(value.trim());

const parseLastUpdatesLimit = (value: string | undefined): number => {
  const parsedValue = Number(value ?? 12);

  if (!Number.isFinite(parsedValue)) {
    return 12;
  }

  return Math.max(1, Math.min(50, Math.trunc(parsedValue)));
};

const normalizeUpstreamErrorMessage = (message: string): string => {
  if (
    message.includes("<!DOCTYPE html>") ||
    message.includes("Error code 522") ||
    message.includes("Connection timed out")
  ) {
    return "Supabase est temporairement indisponible (Cloudflare 522). Reessaie dans quelques minutes.";
  }

  return message;
};

const formatOperationError = (prefix: string, message: string): string =>
  `${prefix}: ${normalizeUpstreamErrorMessage(message)}`;

const getPublicErrorMessage = (error: unknown, fallbackMessage: string): string =>
  error instanceof Error ? normalizeUpstreamErrorMessage(error.message) : fallbackMessage;

const buildOAuthPopupHtml = (targetUrl: string): string => `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>Jarvis OAuth</title>
  </head>
  <body style="font-family: ui-sans-serif, system-ui; padding: 24px;">
    <p>Connexion HubSpot finalisee. Retour vers Jarvis...</p>
    <p>Si cette fenetre reste ouverte, <a id="fallback-link" href="${targetUrl}">revenir a Jarvis</a>.</p>
    <script>
      const targetUrl = ${JSON.stringify(targetUrl)};
      const targetOrigin = new URL(targetUrl).origin;
      const fallbackLink = document.getElementById("fallback-link");
      fallbackLink.href = targetUrl;

      if (window.opener && !window.opener.closed) {
        try {
          window.opener.postMessage({ type: "jarvis:hubspot-connected", targetUrl }, targetOrigin);
          window.opener.location.href = targetUrl;
        } catch (error) {
          console.error(error);
        }
      }

      window.setTimeout(() => {
        window.close();
      }, 250);

      window.setTimeout(() => {
        window.location.href = targetUrl;
      }, 1200);
    </script>
  </body>
</html>`;

const getProspectOwnerHubSpotId = (rawData: unknown): string | null => {
  const parsedRawData =
    typeof rawData === "string"
      ? (() => {
          try {
            return JSON.parse(rawData) as unknown;
          } catch {
            return null;
          }
        })()
      : rawData;

  if (!parsedRawData || typeof parsedRawData !== "object") {
    return null;
  }

  const typedRawData = parsedRawData as ProspectRawData;

  return (
    typedRawData.hubspotOwnerId ??
    typedRawData.dealOwnerHubSpotId ??
    typedRawData.contactOwnerHubSpotId ??
    typedRawData.deal?.properties?.hubspot_owner_id ??
    typedRawData.contact?.properties?.hubspot_owner_id ??
    null
  );
};

const getProspectClosedDealFlag = (rawData: unknown): boolean | null => {
  if (!rawData || typeof rawData !== "object") {
    return null;
  }

  const typedRawData = rawData as ProspectRawData;

  return typeof typedRawData.isClosedDeal === "boolean" ? typedRawData.isClosedDeal : null;
};

const getProspectDealStageLabel = (rawData: unknown): string | null => {
  if (!rawData || typeof rawData !== "object") {
    return null;
  }

  const typedRawData = rawData as ProspectRawData;

  return typeof typedRawData.dealStageLabel === "string" ? typedRawData.dealStageLabel : null;
};

const getProspectClosedAt = (rawData: unknown): string | null => {
  if (!rawData || typeof rawData !== "object") {
    return null;
  }

  const typedRawData = rawData as ProspectRawData;
  const closedAt = typedRawData.closedAt ?? typedRawData.deal?.properties?.closedate ?? null;

  return typeof closedAt === "string" && closedAt.trim() ? closedAt : null;
};

const getProspectDealLifecycleStatus = (rawData: unknown): DealLifecycleStatus | null => {
  if (!rawData || typeof rawData !== "object") {
    return null;
  }

  const typedRawData = rawData as ProspectRawData;

  if (
    typedRawData.dealLifecycleStatus === "pending" ||
    typedRawData.dealLifecycleStatus === "won" ||
    typedRawData.dealLifecycleStatus === "lost"
  ) {
    return typedRawData.dealLifecycleStatus;
  }

  return null;
};

const resolveClosedFlagFromLifecycleStatus = (dealLifecycleStatus: DealLifecycleStatus | null): boolean | null => {
  if (!dealLifecycleStatus) {
    return null;
  }

  return dealLifecycleStatus !== "pending";
};

const PROSPECT_UPSERT_BATCH_SIZE = 100;
const HUBSPOT_STATUS_CACHE_TTL_MS = 30_000;
const SALES_AE_TEAM_NAME = "sales ae";
const DEFAULT_TARGET_HUBSPOT_CONTACT_NAMES = [
  "Hugo SAMSON",
  "Samantha Brebant",
  "Samy SAHEL",
  "Sofiane Larbi",
];
const hubspotStatusCache = new Map<string, HubSpotStatusCacheEntry>();
const hubspotSyncJobs = new Map<string, SyncJobSnapshot>();
const salesAeOwnerCache = new Map<string, SalesAeOwnerCacheEntry>();
const HUBSPOT_SYNC_JOB_TTL_MS = 30 * 60 * 1000;
const HUBSPOT_SYNC_JOB_LOG_LIMIT = 80;
const SALES_AE_OWNER_CACHE_TTL_MS = 5 * 60 * 1000;

const getDisplayTeamName = (teams: HubSpotOwnerTeam[] | undefined): string | null =>
  teams?.find((team) => team.primary)?.name ?? teams?.[0]?.name ?? null;

const isSalesAeOwner = (teams: HubSpotOwnerTeam[] | undefined): boolean =>
  getDisplayTeamName(teams)?.trim().toLowerCase().includes(SALES_AE_TEAM_NAME) ?? false;

const loadSalesAeOwnerIds = async (orgId: string): Promise<Set<string>> => {
  const cachedOwners = salesAeOwnerCache.get(orgId);

  if (cachedOwners && cachedOwners.expiresAt > Date.now()) {
    return cachedOwners.ownerIds;
  }

  const accessToken = await getHubSpotAccessToken(orgId);
  const hubspotOwners = await hubSpotService.fetchOwners(accessToken);
  const ownerIds = new Set(
    hubspotOwners
      .filter((owner) => !owner.archived)
      .filter((owner) => isSalesAeOwner(owner.teams))
      .map((owner) => owner.id),
  );

  salesAeOwnerCache.set(orgId, {
    expiresAt: Date.now() + SALES_AE_OWNER_CACHE_TTL_MS,
    ownerIds,
  });

  return ownerIds;
};

const invalidateHubSpotStatusCache = (orgId: string): void => {
  hubspotStatusCache.delete(orgId);
};

const getNowMs = (): number => performance.now();
const formatDurationMs = (startedAtMs: number): number => Math.round((getNowMs() - startedAtMs) * 100) / 100;

const createSyncJobId = (): string => `hubspot-sync-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const cleanupHubSpotSyncJobs = (): void => {
  const now = Date.now();

  for (const [jobId, job] of hubspotSyncJobs) {
    const updatedAtMs = new Date(job.updatedAt).getTime();

    if (Number.isFinite(updatedAtMs) && now - updatedAtMs > HUBSPOT_SYNC_JOB_TTL_MS) {
      hubspotSyncJobs.delete(jobId);
    }
  }
};

const createHubSpotSyncJob = (orgId: string): SyncJobSnapshot => {
  cleanupHubSpotSyncJobs();

  const now = new Date().toISOString();
  const job: SyncJobSnapshot = {
    jobId: createSyncJobId(),
    orgId,
    status: "queued",
    progress: 0,
    currentStep: "Sync en attente",
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    logs: [
      {
        at: now,
        level: "info",
        message: "Job de sync HubSpot cree.",
      },
    ],
    result: null,
    error: null,
  };

  hubspotSyncJobs.set(job.jobId, job);

  return job;
};

const updateHubSpotSyncJob = (jobId: string, event: SyncProgressEvent): void => {
  const job = hubspotSyncJobs.get(jobId);

  if (!job) {
    return;
  }

  const now = new Date().toISOString();
  job.status = job.status === "queued" ? "running" : job.status;
  job.progress = Math.max(job.progress, Math.min(99, Math.round(event.progress)));
  job.currentStep = event.step;
  job.updatedAt = now;

  if (event.message) {
    job.logs = [
      ...job.logs,
      {
        at: now,
        level: event.level ?? "info",
        message: event.message,
      },
    ].slice(-HUBSPOT_SYNC_JOB_LOG_LIMIT);
  }
};

const completeHubSpotSyncJob = (jobId: string, result: SyncResult): void => {
  const job = hubspotSyncJobs.get(jobId);

  if (!job) {
    return;
  }

  const now = new Date().toISOString();
  job.status = "completed";
  job.progress = 100;
  job.currentStep = "Sync terminee";
  job.updatedAt = now;
  job.finishedAt = now;
  job.result = result;
  job.logs = [
    ...job.logs,
    {
      at: now,
      level: "success",
      message: `Sync terminee: ${result.syncedCount} prospect(s), ${result.crm.dealCount} deal(s), ${result.crm.contactCount} contact(s).`,
    } satisfies SyncProgressLog,
  ].slice(-HUBSPOT_SYNC_JOB_LOG_LIMIT);
};

const failHubSpotSyncJob = (jobId: string, error: unknown): void => {
  const job = hubspotSyncJobs.get(jobId);

  if (!job) {
    return;
  }

  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : "Erreur inconnue pendant la sync HubSpot.";
  job.status = "failed";
  job.currentStep = "Sync en erreur";
  job.updatedAt = now;
  job.finishedAt = now;
  job.error = message;
  job.logs = [
    ...job.logs,
    {
      at: now,
      level: "error",
      message,
    } satisfies SyncProgressLog,
  ].slice(-HUBSPOT_SYNC_JOB_LOG_LIMIT);
};

const createBatches = <T>(items: T[], batchSize: number): T[][] => {
  const batches: T[][] = [];

  for (let startIndex = 0; startIndex < items.length; startIndex += batchSize) {
    batches.push(items.slice(startIndex, startIndex + batchSize));
  }

  return batches;
};

const readHubSpotProperty = (properties: Record<string, string | null>, key: string): string | null =>
  properties[key] ?? null;

const parseHubSpotNumericProperty = (properties: Record<string, string | null>, key: string): number | null => {
  const value = readHubSpotProperty(properties, key);

  if (!value) {
    return null;
  }

  const parsedValue = Number(value);

  return Number.isFinite(parsedValue) ? parsedValue : null;
};

const parseHubSpotProbability = (properties: Record<string, string | null>): number => {
  const probability = parseHubSpotNumericProperty(properties, "hs_deal_stage_probability");

  if (probability === null) {
    return 0;
  }

  const normalizedProbability = probability >= 0 && probability <= 1 ? probability * 100 : probability;

  return Math.max(0, Math.min(100, Math.round(normalizedProbability)));
};

const normalizeClassifierText = (value: string | null | undefined): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const compactClassifierText = (value: string | null | undefined): string =>
  normalizeClassifierText(value).replace(/[^a-z0-9]+/g, "");

const resolveHubSpotDealLifecycleStatus = (
  dealStageId: string | null,
  stage:
    | {
        stageLabel?: string | null;
        stage_label?: string | null;
        isClosed?: boolean | null;
        is_closed?: boolean | null;
        probability?: number | null;
      }
    | undefined,
): DealLifecycleStatus | null => {
  const stageLabel = stage?.stageLabel ?? stage?.stage_label ?? null;
  const isClosed = stage?.isClosed ?? stage?.is_closed ?? null;
  const normalizedStage = normalizeClassifierText(`${dealStageId ?? ""} ${stageLabel ?? ""}`);
  const compactStage = compactClassifierText(normalizedStage);

  if (
    compactStage.includes("closedlost") ||
    compactStage.includes("closelost") ||
    compactStage === "lost" ||
    normalizedStage.includes(" lost") ||
    normalizedStage.includes("perdu") ||
    normalizedStage.includes("perdue")
  ) {
    return "lost";
  }

  if (
    compactStage.includes("closedwon") ||
    compactStage === "won" ||
    normalizedStage.includes(" won") ||
    normalizedStage.includes("gagne") ||
    normalizedStage.includes("gagnee")
  ) {
    return "won";
  }

  if (typeof stage?.probability === "number") {
    if (stage.probability <= 0) {
      return "lost";
    }

    if (stage.probability >= 1) {
      return "won";
    }
  }

  if (isClosed === false) {
    return "pending";
  }

  if (isClosed === true) {
    return "won";
  }

  return null;
};

const normalizeHubSpotTimestamp = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();

  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
};

const buildHubSpotContactName = (properties: Record<string, string | null>): string => {
  const name = [readHubSpotProperty(properties, "firstname"), readHubSpotProperty(properties, "lastname")]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(" ");

  return name || readHubSpotProperty(properties, "email") || readHubSpotProperty(properties, "phone") || "Contact HubSpot";
};

const upsertHubSpotCrmSnapshot = async (
  orgId: string,
  snapshot: HubSpotCrmSyncSnapshot,
  syncedAt: string,
): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const contactRows: HubSpotContactUpsertRow[] = snapshot.contacts.map((contact) => ({
    org_id: orgId,
    hubspot_contact_id: contact.id,
    hubspot_owner_id: readHubSpotProperty(contact.properties, "hubspot_owner_id"),
    email: readHubSpotProperty(contact.properties, "email"),
    name: buildHubSpotContactName(contact.properties),
    phone: readHubSpotProperty(contact.properties, "phone"),
    title: readHubSpotProperty(contact.properties, "jobtitle"),
    company_name: readHubSpotProperty(contact.properties, "company"),
    properties: contact.properties,
    synced_at: syncedAt,
  }));
  const companyRows: HubSpotCompanyUpsertRow[] = snapshot.companies.map((company) => ({
    org_id: orgId,
    hubspot_company_id: company.id,
    name: readHubSpotProperty(company.properties, "name"),
    domain: readHubSpotProperty(company.properties, "domain"),
    industry: readHubSpotProperty(company.properties, "industry"),
    city: readHubSpotProperty(company.properties, "city"),
    country: readHubSpotProperty(company.properties, "country"),
    properties: company.properties,
    synced_at: syncedAt,
  }));
  const stageLabelById = new Map(snapshot.dealStages.map((stage) => [stage.stageId, stage]));
  const stageRows: HubSpotDealStageUpsertRow[] = snapshot.dealStages.map((stage) => ({
    org_id: orgId,
    pipeline_id: stage.pipelineId,
    pipeline_label: stage.pipelineLabel,
    stage_id: stage.stageId,
    stage_label: stage.stageLabel,
    display_order: stage.displayOrder,
    is_closed: stage.isClosed,
    probability: stage.probability,
    synced_at: syncedAt,
  }));
  const dealRows: HubSpotDealUpsertRow[] = snapshot.deals.map((deal) => {
    const dealStageId = readHubSpotProperty(deal.properties, "dealstage");
    const stage = stageLabelById.get(dealStageId ?? "");
    const lifecycleStatus = resolveHubSpotDealLifecycleStatus(dealStageId, stage);

    return {
      org_id: orgId,
      hubspot_deal_id: deal.id,
      hubspot_owner_id: readHubSpotProperty(deal.properties, "hubspot_owner_id"),
      primary_contact_id: deal.associatedContactIds[0] ?? null,
      primary_company_id: deal.associatedCompanyIds[0] ?? null,
      associated_contact_ids: deal.associatedContactIds,
      associated_company_ids: deal.associatedCompanyIds,
      deal_name: readHubSpotProperty(deal.properties, "dealname"),
      amount: parseHubSpotNumericProperty(deal.properties, "amount"),
      pipeline: readHubSpotProperty(deal.properties, "pipeline"),
      pipeline_label: stage?.pipelineLabel ?? null,
      deal_stage: dealStageId,
      deal_stage_label: stage?.stageLabel ?? null,
      deal_lifecycle_status: lifecycleStatus,
      is_closed_deal: lifecycleStatus ? lifecycleStatus !== "pending" : (stage?.isClosed ?? null),
      close_probability: parseHubSpotProbability(deal.properties),
      hubspot_created_at: normalizeHubSpotTimestamp(readHubSpotProperty(deal.properties, "createdate")),
      closed_at: normalizeHubSpotTimestamp(readHubSpotProperty(deal.properties, "closedate")),
      hubspot_updated_at: normalizeHubSpotTimestamp(readHubSpotProperty(deal.properties, "hs_lastmodifieddate")),
      properties: deal.properties,
      synced_at: syncedAt,
    };
  });

  for (const batch of createBatches(contactRows, PROSPECT_UPSERT_BATCH_SIZE)) {
    const { error } = await supabase.from("hubspot_contacts").upsert(batch, {
      onConflict: "org_id,hubspot_contact_id",
    });

    if (error) {
      throw new Error(formatOperationError("Impossible de synchroniser les contacts HubSpot", error.message));
    }
  }

  for (const batch of createBatches(companyRows, PROSPECT_UPSERT_BATCH_SIZE)) {
    const { error } = await supabase.from("hubspot_companies").upsert(batch, {
      onConflict: "org_id,hubspot_company_id",
    });

    if (error) {
      throw new Error(formatOperationError("Impossible de synchroniser les entreprises HubSpot", error.message));
    }
  }

  for (const batch of createBatches(dealRows, PROSPECT_UPSERT_BATCH_SIZE)) {
    const { error } = await supabase.from("hubspot_deals").upsert(batch, {
      onConflict: "org_id,hubspot_deal_id",
    });

    if (error) {
      throw new Error(formatOperationError("Impossible de synchroniser les deals HubSpot", error.message));
    }
  }

  for (const batch of createBatches(stageRows, PROSPECT_UPSERT_BATCH_SIZE)) {
    const { error } = await supabase.from("hubspot_deal_stages").upsert(batch, {
      onConflict: "org_id,pipeline_id,stage_id",
    });

    if (error) {
      throw new Error(formatOperationError("Impossible de synchroniser les stages HubSpot", error.message));
    }
  }
};

const mapOwnerProspects = (
  prospects: HubSpotProspectRow[],
  hubspotOwnerId: string,
): HubSpotOwnerProspect[] =>
  prospects
    .filter((prospect) => getProspectOwnerHubSpotId(prospect.raw_data) === hubspotOwnerId)
    .map((prospect) => ({
      id: prospect.id,
      dealName:
        (typeof prospect.raw_data === "object" &&
        prospect.raw_data !== null &&
        "dealName" in prospect.raw_data &&
        typeof (prospect.raw_data as ProspectRawData).dealName === "string"
          ? (prospect.raw_data as ProspectRawData).dealName
          : null) ?? null,
      contactName: prospect.name,
      email: prospect.email,
      company: prospect.company,
      title: prospect.title,
      dealStage: prospect.deal_stage,
      dealStageLabel: getProspectDealStageLabel(prospect.raw_data),
      dealAmount: prospect.deal_amount,
      closeProbability: prospect.close_probability,
      closedAt: getProspectClosedAt(prospect.raw_data),
      dealLifecycleStatus: getProspectDealLifecycleStatus(prospect.raw_data),
      isClosedDeal:
        getProspectClosedDealFlag(prospect.raw_data) ??
        resolveClosedFlagFromLifecycleStatus(getProspectDealLifecycleStatus(prospect.raw_data)),
      lastContactAt: prospect.last_contact_at,
      hubspotDealId: prospect.hubspot_deal_id,
      syncedAt: prospect.synced_at,
    }));

const mapProspectRowToOwnerProspect = (prospect: HubSpotProspectRow): HubSpotOwnerProspect => ({
  id: prospect.id,
  dealName:
    (typeof prospect.raw_data === "object" &&
    prospect.raw_data !== null &&
    "dealName" in prospect.raw_data &&
    typeof (prospect.raw_data as ProspectRawData).dealName === "string"
      ? (prospect.raw_data as ProspectRawData).dealName
      : null) ?? null,
  contactName: prospect.name,
  email: prospect.email,
  company: prospect.company,
  title: prospect.title,
  dealStage: prospect.deal_stage,
  dealStageLabel: getProspectDealStageLabel(prospect.raw_data),
  dealAmount: prospect.deal_amount,
  closeProbability: prospect.close_probability,
  closedAt: getProspectClosedAt(prospect.raw_data),
  dealLifecycleStatus: getProspectDealLifecycleStatus(prospect.raw_data),
  isClosedDeal:
    getProspectClosedDealFlag(prospect.raw_data) ??
    resolveClosedFlagFromLifecycleStatus(getProspectDealLifecycleStatus(prospect.raw_data)),
  lastContactAt: prospect.last_contact_at,
  hubspotDealId: prospect.hubspot_deal_id,
  syncedAt: prospect.synced_at,
});

const mapLiveOwnerProspect = (
  prospect: {
    hubspotContactId: string;
    hubspotDealId: string | null;
    name: string;
    email: string | null;
    company: string | null;
    title: string | null;
    dealStage: string | null;
    dealStageLabel: string | null;
    dealAmount: number | null;
    closeProbability: number;
    closedAt: string | null;
    dealLifecycleStatus: DealLifecycleStatus | null;
    isClosedDeal: boolean | null;
    lastContactAt: string | null;
    rawData: {
      dealName: string | null;
    };
  },
  syncedAt: string,
): HubSpotOwnerProspect => ({
  id: `${prospect.hubspotContactId}:${prospect.hubspotDealId ?? "contact"}`,
  dealName: prospect.rawData.dealName,
  contactName: prospect.name,
  email: prospect.email,
  company: prospect.company,
  title: prospect.title,
  dealStage: prospect.dealStage,
  dealStageLabel: prospect.dealStageLabel,
  dealAmount: prospect.dealAmount,
  closeProbability: prospect.closeProbability,
  closedAt: prospect.closedAt,
  dealLifecycleStatus: prospect.dealLifecycleStatus,
  isClosedDeal: prospect.isClosedDeal,
  lastContactAt: prospect.lastContactAt,
  hubspotDealId: prospect.hubspotDealId,
  syncedAt,
});

const getProspectSyncKey = (prospect: { hubspotContactId: string; hubspotDealId: string | null }): string =>
  `${prospect.hubspotContactId}:${prospect.hubspotDealId ?? "contact"}`;

const syncHubSpotProspects = async (
  orgId: string,
  contactNames: string[] = DEFAULT_TARGET_HUBSPOT_CONTACT_NAMES,
  includeFullSync = true,
  hubspotOwnerIds: string[] = [],
  reportProgress?: (event: SyncProgressEvent) => void,
): Promise<SyncResult> => {
  const supabase = getSupabaseAdmin();
  invalidateHubSpotStatusCache(orgId);

  try {
    reportProgress?.({
      progress: 5,
      step: "Connexion HubSpot",
      message: "Chargement et refresh eventuel du token HubSpot.",
    });
    const accessToken = await getHubSpotAccessToken(orgId);
    const syncedAt = new Date().toISOString();
    reportProgress?.({
      progress: 12,
      step: "Lecture HubSpot",
      message:
        hubspotOwnerIds.length > 0
          ? `Chargement des donnees de ${hubspotOwnerIds.length} owner(s).`
          : "Chargement complet des contacts, deals et pipelines.",
    });
    const ownerCrmSnapshot =
      hubspotOwnerIds.length > 0 ? await hubSpotService.fetchCrmSnapshotByOwners(accessToken, hubspotOwnerIds) : null;
    const fullCrmSnapshot =
      includeFullSync ? await hubSpotService.fetchCrmSnapshot(accessToken) : null;
    const crmSnapshot = ownerCrmSnapshot ?? fullCrmSnapshot;
    const ownerProspects = ownerCrmSnapshot?.prospects ?? [];

    const [allProspects, targetedProspects] = await Promise.all([
      Promise.resolve(fullCrmSnapshot?.prospects ?? []),
      contactNames.length > 0 ? hubSpotService.fetchProspectsByContactNames(accessToken, contactNames) : [],
    ]);
    const prospects = Array.from(
      new Map(
        [...allProspects, ...targetedProspects, ...ownerProspects].map((prospect) => [
          getProspectSyncKey(prospect),
          prospect,
        ]),
      ).values(),
    );
    reportProgress?.({
      progress: 42,
      step: "Donnees HubSpot recuperees",
      message: `${prospects.length} prospect(s) prepare(s) depuis HubSpot.`,
    });

    if (prospects.length === 0) {
      if (crmSnapshot) {
        reportProgress?.({
          progress: 55,
          step: "Ecriture CRM",
          message: "Aucun prospect a mettre a jour, persistance du snapshot CRM.",
        });
        await upsertHubSpotCrmSnapshot(orgId, crmSnapshot, syncedAt);
      }

      return {
        orgId,
        syncedCount: 0,
        crm: {
          contactCount: crmSnapshot?.contacts.length ?? 0,
          companyCount: crmSnapshot?.companies.length ?? 0,
          dealCount: crmSnapshot?.deals.length ?? 0,
        },
        autoFollowUp: {
          analyzedCount: 0,
          createdCount: 0,
          skippedCount: 0,
          failedCount: 0,
        },
      };
    }

    const ownerIds = Array.from(
      new Set(prospects.map((prospect) => prospect.ownerHubSpotId).filter((value): value is string => Boolean(value))),
    );
    reportProgress?.({
      progress: 55,
      step: "Resolution des owners",
      message: `${ownerIds.length} owner(s) HubSpot detecte(s).`,
    });

    const ownerUserIdByHubSpotId = new Map<string, string>();

    if (ownerIds.length > 0) {
      const { data: users, error: usersError } = await supabase
        .from("users")
        .select("id, hubspot_owner_id")
        .eq("org_id", orgId)
        .in("hubspot_owner_id", ownerIds);

      if (usersError) {
        throw new Error(`Impossible de charger les owners HubSpot: ${usersError.message}`);
      }

      for (const user of users ?? []) {
        if (user.hubspot_owner_id) {
          ownerUserIdByHubSpotId.set(user.hubspot_owner_id, user.id);
        }
      }
    }

    reportProgress?.({
      progress: 62,
      step: "Preparation Supabase",
      message: "Mapping des prospects HubSpot vers Jarvis.",
    });
    const rows = prospects.map((prospect) => ({
      org_id: orgId,
      owner_user_id: prospect.ownerHubSpotId
        ? ownerUserIdByHubSpotId.get(prospect.ownerHubSpotId) ?? null
        : null,
      hubspot_contact_id: prospect.hubspotContactId,
      hubspot_deal_id: prospect.hubspotDealId,
      name: prospect.name,
      company: prospect.company,
      title: prospect.title,
      phone: prospect.phone,
      email: prospect.email,
      deal_stage: prospect.dealStage,
      deal_amount: prospect.dealAmount,
      close_probability: prospect.closeProbability,
      last_contact_at: prospect.lastContactAt,
      next_action: null,
      next_action_at: null,
      ai_summary: null,
      ai_priority_score: hubSpotService.computePriorityScore(prospect),
      raw_data: prospect.rawData,
      synced_at: syncedAt,
    }));

    if (crmSnapshot) {
      reportProgress?.({
        progress: 68,
        step: "Ecriture CRM",
        message: `${crmSnapshot.deals.length} deal(s), ${crmSnapshot.contacts.length} contact(s), ${crmSnapshot.companies.length} entreprise(s).`,
      });
      await upsertHubSpotCrmSnapshot(orgId, crmSnapshot, syncedAt);
    }

    const rowBatches = createBatches(rows, PROSPECT_UPSERT_BATCH_SIZE);

    for (const [batchIndex, batch] of rowBatches.entries()) {
      reportProgress?.({
        progress: 70 + Math.round((batchIndex / Math.max(rowBatches.length, 1)) * 15),
        step: "Ecriture prospects",
        message: `Batch ${batchIndex + 1}/${rowBatches.length}: ${batch.length} prospect(s).`,
      });
      const { error } = await supabase.from("prospects").upsert(batch, {
        onConflict: "org_id,hubspot_prospect_key",
      });

      if (error) {
        throw new Error(formatOperationError("Impossible de synchroniser les prospects HubSpot", error.message));
      }
    }

    const autoFollowUp =
      hubspotOwnerIds.length === 0
        ? await runAutomaticFollowUpTasksForOrg(orgId, {
            warn: (payload, message) => {
              console.warn(message, payload);
              reportProgress?.({
                progress: 90,
                step: "Relances automatiques",
                level: "warning",
                message,
              });
            },
          })
        : {
            analyzedCount: 0,
            createdCount: 0,
            skippedCount: rows.length,
            failedCount: 0,
          };
    reportProgress?.({
      progress: 95,
      step: "Finalisation",
      message: `Relances: ${autoFollowUp.createdCount} creee(s), ${autoFollowUp.failedCount} echec(s).`,
    });

    return {
      orgId,
      syncedCount: rows.length,
      crm: {
        contactCount: crmSnapshot?.contacts.length ?? 0,
        companyCount: crmSnapshot?.companies.length ?? 0,
        dealCount: crmSnapshot?.deals.length ?? 0,
      },
      autoFollowUp,
    };
  } finally {
    invalidateHubSpotStatusCache(orgId);
  }
};

const disconnectHubSpotIntegration = async (
  orgId: string,
  purgeData = true,
): Promise<DisconnectResult> => {
  const supabase = getSupabaseAdmin();

  const { error: integrationError } = await supabase.rpc("set_hubspot_integration", {
    target_org_id: orgId,
    target_access_token: null,
    target_refresh_token: null,
    target_token_expires_at: null,
  });

  if (integrationError) {
    throw new Error(
      formatOperationError("Impossible de reinitialiser l'integration HubSpot", integrationError.message),
    );
  }

  const { error: organizationError } = await supabase
    .from("organizations")
    .update({
      hubspot_portal_id: null,
    })
    .eq("id", orgId);

  if (organizationError) {
    throw new Error(
      formatOperationError("Impossible de reinitialiser l'organisation HubSpot", organizationError.message),
    );
  }

  let purgedProspectCount = 0;

  if (purgeData) {
    const { data: prospectsToDelete, error: prospectsCountError } = await supabase
      .from("prospects")
      .select("id")
      .eq("org_id", orgId)
      .contains("raw_data", { source: "hubspot" });

    if (prospectsCountError) {
      throw new Error(
        formatOperationError("Impossible de lister les prospects HubSpot a purger", prospectsCountError.message),
      );
    }

    purgedProspectCount = prospectsToDelete?.length ?? 0;

    const { error: deleteProspectsError } = await supabase
      .from("prospects")
      .delete()
      .eq("org_id", orgId)
      .contains("raw_data", { source: "hubspot" });

    if (deleteProspectsError) {
      throw new Error(formatOperationError("Impossible de purger les prospects HubSpot", deleteProspectsError.message));
    }
  }

  return {
    orgId,
    disconnected: true,
    purgedProspectCount,
  };
};

export const registerHubSpotRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Reply: ApiResponse<HubSpotConfigStatus> }>("/api/hubspot/config-status", async (_request, reply) =>
    reply.send({
      success: true,
      data: {
        apiPublicUrl: env.apiPublicUrl || null,
        appUrl: env.appUrl,
        hubspotRedirectUri: env.hubspotRedirectUri,
        hasHubSpotClientId: Boolean(env.hubspotClientId),
        hasHubSpotClientSecret: Boolean(env.hubspotClientSecret),
        hasHubSpotAppId: Boolean(env.hubspotAppId),
      },
    }),
  );

  app.get<{ Querystring: HubSpotStatusQuery; Reply: ApiResponse<HubSpotConnectionStatus> }>(
    "/api/hubspot/status",
    async (request, reply) => {
      const orgId = request.query.orgId;
      const cachedStatus = orgId ? hubspotStatusCache.get(orgId) : null;

      if (cachedStatus && cachedStatus.expiresAt > Date.now()) {
        return reply.send({
          success: true,
          data: cachedStatus.payload,
        });
      }

      if (!orgId) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId est obligatoire pour charger le statut HubSpot.",
        });
      }

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        const supabase = getSupabaseAdmin();
        const { data: organization, error: organizationError } = await supabase
          .from("organizations")
          .select("id, hubspot_portal_id")
          .eq("id", orgId)
          .maybeSingle();

        if (organizationError) {
          throw new Error(formatOperationError("Impossible de charger l'organisation", organizationError.message));
        }

        const organizationRow = organization as { id: string; hubspot_portal_id: string | null } | null;

        if (!organizationRow) {
          return reply.code(404).send({
            success: false,
            error: "Organisation inconnue.",
          });
        }

        const portalId = organizationRow.hubspot_portal_id ?? null;
        const [
          accessToken,
          { count: prospectCount, error: prospectsCountError },
          { data: dealRows, error: dealsError },
        ] = await Promise.all([
          getHubSpotAccessToken(orgId).catch((error: unknown) => {
            if (error instanceof Error && error.message === "Aucun token HubSpot trouve pour cette organisation.") {
              return null;
            }

            throw error;
          }),
          supabase
            .from("prospects")
            .select("*", { count: "exact", head: true })
            .eq("org_id", orgId)
            .contains("raw_data", { source: "hubspot" }),
          supabase
            .from("prospects")
            .select("hubspot_deal_id, synced_at")
            .eq("org_id", orgId)
            .contains("raw_data", { source: "hubspot" })
            .not("hubspot_deal_id", "is", null),
        ]);

        if (prospectsCountError) {
          throw new Error(formatOperationError("Impossible de compter les prospects", prospectsCountError.message));
        }

        if (dealsError) {
          throw new Error(formatOperationError("Impossible de charger les deals synchronises", dealsError.message));
        }

        const distinctDealIds = new Set(
          (dealRows ?? [])
            .map((row) => row.hubspot_deal_id)
            .filter((value): value is string => typeof value === "string" && value.length > 0),
        );

        let hubspotDealCount: number | null = null;

        if (accessToken) {
          try {
            hubspotDealCount = await hubSpotService.fetchDealCount(accessToken);
          } catch (hubspotCountError) {
            request.log.warn(
              { error: hubspotCountError, orgId },
              "Impossible de charger le nombre de deals live depuis HubSpot.",
            );
          }
        }

        const lastSyncedAt =
          (dealRows ?? []).reduce<string | null>((latestValue, row) => {
            if (!row.synced_at) {
              return latestValue;
            }

            if (!latestValue) {
              return row.synced_at;
            }

            return new Date(row.synced_at).getTime() > new Date(latestValue).getTime()
              ? row.synced_at
              : latestValue;
          }, null) ?? null;

        const payload: HubSpotConnectionStatus = {
          orgId,
          connected: Boolean(accessToken),
          hubspotPortalId: portalId,
          prospectCount: prospectCount ?? 0,
          syncedDealCount: distinctDealIds.size,
          hubspotDealCount,
          lastSyncedAt,
        };

        hubspotStatusCache.set(orgId, {
          expiresAt: Date.now() + HUBSPOT_STATUS_CACHE_TTL_MS,
          payload,
        });

        return reply.send({
          success: true,
          data: payload,
        });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de charger le statut HubSpot.");

        return reply.code(500).send({
          success: false,
          error:
            getPublicErrorMessage(error, "Erreur inconnue pendant le chargement du statut HubSpot."),
        });
      }
    },
  );

  app.get<{ Querystring: HubSpotOwnersQuery; Reply: ApiResponse<HubSpotOwnerOption[]> }>(
    "/api/hubspot/owners",
    async (request, reply) => {
      const orgId = request.query.orgId;

      if (!orgId) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId est obligatoire pour charger les owners HubSpot.",
        });
      }

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        const supabase = getSupabaseAdmin();
        let accessToken: string;

        try {
          accessToken = await getHubSpotAccessToken(orgId);
        } catch (error) {
          if (error instanceof Error && error.message === "Aucun token HubSpot trouve pour cette organisation.") {
            return reply.send({
              success: true,
              data: [],
            });
          }

          throw error;
        }

        const hubspotOwners = await hubSpotService.fetchOwners(accessToken);

        const { data: prospects, error: prospectsError } = await supabase
          .from("prospects")
          .select("hubspot_deal_id, synced_at, raw_data")
          .eq("org_id", orgId)
          .contains("raw_data", { source: "hubspot" })
          .range(0, 4999);

        if (prospectsError) {
          throw new Error(formatOperationError("Impossible de charger les prospects HubSpot", prospectsError.message));
        }

        const metricsByOwnerId = new Map<
          string,
          { prospectCount: number; syncedDealIds: Set<string>; lastSyncedAt: string | null }
        >();

        for (const prospect of prospects ?? []) {
          const ownerId = getProspectOwnerHubSpotId(prospect.raw_data);

          if (!ownerId) {
            continue;
          }

          const currentMetrics = metricsByOwnerId.get(ownerId) ?? {
            prospectCount: 0,
            syncedDealIds: new Set<string>(),
            lastSyncedAt: null,
          };

          currentMetrics.prospectCount += 1;

          if (prospect.hubspot_deal_id) {
            currentMetrics.syncedDealIds.add(prospect.hubspot_deal_id);
          }

          if (
            prospect.synced_at &&
            (!currentMetrics.lastSyncedAt ||
              new Date(prospect.synced_at).getTime() > new Date(currentMetrics.lastSyncedAt).getTime())
          ) {
            currentMetrics.lastSyncedAt = prospect.synced_at;
          }

          metricsByOwnerId.set(ownerId, currentMetrics);
        }

        const ownersFromHubSpot: HubSpotOwnerOption[] = hubspotOwners
          .filter((owner) => !owner.archived)
          .filter((owner) => isSalesAeOwner(owner.teams))
          .map((owner) => {
            const metrics = metricsByOwnerId.get(owner.id);
            const ownerName = [owner.firstName, owner.lastName].filter(Boolean).join(" ").trim();

            return {
              ownerId: owner.id,
              hubspotUserId:
                typeof owner.userId === "number"
                  ? String(owner.userId)
                  : typeof owner.userIdIncludingInactive === "number"
                    ? String(owner.userIdIncludingInactive)
                    : null,
              name: ownerName || owner.email || `Owner ${owner.id}`,
              email: owner.email ?? "",
              teamName: getDisplayTeamName(owner.teams),
              prospectCount: metrics?.prospectCount ?? 0,
              syncedDealCount: metrics?.syncedDealIds.size ?? 0,
              lastSyncedAt: metrics?.lastSyncedAt ?? null,
            };
          });
        const owners = ownersFromHubSpot.sort((left, right) => left.name.localeCompare(right.name, "fr"));

        request.log.info(
          {
            orgId,
            hubspotOwnerCount: hubspotOwners.length,
            salesAeOwnerCount: ownersFromHubSpot.length,
            syncedProspectCount: prospects?.length ?? 0,
            ownerMetricCount: metricsByOwnerId.size,
            responseOwnerCount: owners.length,
          },
          "Owners HubSpot charges.",
        );

        return reply.send({
          success: true,
          data: owners,
        });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de charger les owners HubSpot.");

        return reply.code(500).send({
          success: false,
          error:
            getPublicErrorMessage(error, "Erreur inconnue pendant le chargement des owners HubSpot."),
        });
      }
    },
  );

  app.post<{ Body: HubSpotDisconnectBody; Reply: ApiResponse<DisconnectResult> }>(
    "/api/hubspot/disconnect",
    async (request, reply) => {
      const orgId = request.body.orgId;
      const purgeData = request.body.purgeData ?? true;

      if (!orgId) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId est obligatoire pour deconnecter HubSpot.",
        });
      }

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        const result = await disconnectHubSpotIntegration(orgId, purgeData);

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        request.log.error({ error, orgId, purgeData }, "Echec de la deconnexion HubSpot.");

        return reply.code(500).send({
          success: false,
          error: getPublicErrorMessage(error, "Erreur inconnue pendant la deconnexion HubSpot."),
        });
      }
    },
  );

  app.get<{ Querystring: HubSpotLastUpdatesQuery; Reply: ApiResponse<HubSpotLastUpdatesPayload> }>(
    "/api/hubspot/last-updates",
    async (request, reply) => {
      const orgId = request.query.orgId;

      if (!orgId) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId est obligatoire pour charger les dernieres updates HubSpot.",
        });
      }

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        const supabase = getSupabaseAdmin();
        const limit = parseLastUpdatesLimit(request.query.limit);
        const salesAeOwnerIds = await loadSalesAeOwnerIds(orgId);

        if (salesAeOwnerIds.size === 0) {
          return reply.send({
            success: true,
            data: {
              orgId,
              updates: [],
            },
          });
        }

        const { data: runData, error: runError } = await supabase
          .from("hubspot_realtime_analysis_runs")
          .select(
            "id, org_id, hubspot_deal_id, status, reason, scheduled_for, started_at, finished_at, trigger_event_ids, created_at, updated_at",
          )
          .eq("org_id", orgId)
          .order("updated_at", { ascending: false })
          .range(0, Math.max(limit * 12, limit) - 1);

        if (runError) {
          throw new Error(formatOperationError("Impossible de charger les updates realtime HubSpot", runError.message));
        }

        const candidateRuns: HubSpotRealtimeAnalysisRunListRow[] = [];
        const seenDealIds = new Set<string>();

        for (const run of (runData ?? []) as HubSpotRealtimeAnalysisRunListRow[]) {
          if (seenDealIds.has(run.hubspot_deal_id)) {
            continue;
          }

          seenDealIds.add(run.hubspot_deal_id);
          candidateRuns.push(run);
        }

        const dealIds = candidateRuns.map((run) => run.hubspot_deal_id);
        const { data: dealData, error: dealError } =
          dealIds.length > 0
            ? await supabase
                .from("hubspot_deals")
                .select("hubspot_deal_id, hubspot_owner_id, primary_company_id, deal_name, amount, deal_stage, deal_stage_label")
                .eq("org_id", orgId)
                .in("hubspot_deal_id", dealIds)
            : { data: [], error: null };

        if (dealError) {
          throw new Error(formatOperationError("Impossible de charger les deals HubSpot", dealError.message));
        }

        const deals = (dealData ?? []) as HubSpotDealSummaryRow[];
        const dealById = new Map(deals.map((deal) => [deal.hubspot_deal_id, deal]));
        const uniqueRuns = candidateRuns
          .filter((run) => {
            const deal = dealById.get(run.hubspot_deal_id);

            return Boolean(deal?.hubspot_owner_id && salesAeOwnerIds.has(deal.hubspot_owner_id));
          })
          .slice(0, limit);
        const companyIds = Array.from(
          new Set(
            uniqueRuns
              .map((run) => dealById.get(run.hubspot_deal_id)?.primary_company_id ?? null)
              .filter((id): id is string => Boolean(id)),
          ),
        );
        const { data: companyData, error: companyError } =
          companyIds.length > 0
            ? await supabase
                .from("hubspot_companies")
                .select("hubspot_company_id, name")
                .eq("org_id", orgId)
                .in("hubspot_company_id", companyIds)
            : { data: [], error: null };

        if (companyError) {
          throw new Error(formatOperationError("Impossible de charger les entreprises HubSpot", companyError.message));
        }

        const companyById = new Map(
          ((companyData ?? []) as HubSpotCompanySummaryRow[]).map((company) => [company.hubspot_company_id, company]),
        );
        const updates: HubSpotLastUpdateItem[] = uniqueRuns.map((run) => {
          const deal = dealById.get(run.hubspot_deal_id) ?? null;
          const company = deal?.primary_company_id ? companyById.get(deal.primary_company_id) ?? null : null;

          return {
            id: run.id,
            orgId: run.org_id,
            hubspotDealId: run.hubspot_deal_id,
            dealName: deal?.deal_name ?? null,
            companyName: company?.name ?? null,
            amount: deal?.amount ?? null,
            dealStage: deal?.deal_stage_label ?? deal?.deal_stage ?? null,
            status: run.status,
            reason: run.reason,
            eventCount: run.trigger_event_ids.length,
            receivedAt: run.updated_at,
            scheduledFor: run.scheduled_for,
            processedAt: run.finished_at ?? run.started_at,
          };
        });

        return reply.send({
          success: true,
          data: {
            orgId,
            updates,
          },
        });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de charger les dernieres updates HubSpot.");

        return reply.code(500).send({
          success: false,
          error:
            getPublicErrorMessage(error, "Erreur inconnue pendant le chargement des dernieres updates HubSpot."),
        });
      }
    },
  );

  app.get<{ Querystring: HubSpotOwnerProspectsQuery; Reply: ApiResponse<HubSpotOwnerProspectsPayload> }>(
    "/api/hubspot/owner-prospects",
    async (request, reply) => {
      const requestStartedAtMs = getNowMs();
      const orgId = request.query.orgId;
      const hubspotOwnerId = request.query.hubspotOwnerId;

      if (!orgId || !hubspotOwnerId) {
        return reply.code(400).send({
          success: false,
          error: "Les parametres orgId et hubspotOwnerId sont obligatoires pour charger les deals d'un owner HubSpot.",
        });
      }

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        const supabase = getSupabaseAdmin();
        const includeLiveReconciliation = request.query.live !== "false";
        const accessTokenStartedAtMs = includeLiveReconciliation ? getNowMs() : null;
        const ownerUserLookupStartedAtMs = getNowMs();
        const [accessToken, ownerUserLookup] = await Promise.all([
          includeLiveReconciliation ? getHubSpotAccessToken(orgId) : Promise.resolve(null),
          supabase
            .from("users")
            .select("id")
            .eq("org_id", orgId)
            .eq("hubspot_owner_id", hubspotOwnerId)
            .maybeSingle(),
        ]);
        const accessTokenDurationMs = accessTokenStartedAtMs === null ? null : formatDurationMs(accessTokenStartedAtMs);
        const ownerUserLookupDurationMs = formatDurationMs(ownerUserLookupStartedAtMs);

        if (ownerUserLookup.error) {
          throw new Error(
            formatOperationError("Impossible de charger le user Jarvis de cet owner HubSpot", ownerUserLookup.error.message),
          );
        }

        const ownerUser = ownerUserLookup.data as HubSpotOwnerUserRow | null;
        const ownerUserId = ownerUser?.id ?? null;

        const loadProspects = async (): Promise<HubSpotProspectRow[]> => {
          const prospectsQueryStartedAtMs = getNowMs();
          let prospectsQuery = supabase
            .from("prospects")
            .select(
              "id, name, email, company, title, deal_stage, deal_amount, close_probability, last_contact_at, hubspot_deal_id, synced_at, raw_data",
            )
            .eq("org_id", orgId)
            .contains("raw_data", { source: "hubspot" })
            .order("deal_amount", { ascending: false, nullsFirst: false });

          if (ownerUserId) {
            prospectsQuery = prospectsQuery.eq("owner_user_id", ownerUserId);
          } else {
            prospectsQuery = prospectsQuery.contains("raw_data", { hubspotOwnerId });
          }

          const { data: prospects, error: prospectsError } = await prospectsQuery.range(0, 4999);

          if (prospectsError) {
            throw new Error(
              formatOperationError("Impossible de charger les prospects de l'owner HubSpot", prospectsError.message),
            );
          }

          request.log.info(
            {
              orgId,
              hubspotOwnerId,
              ownerUserId,
              usedOwnerUserFilter: Boolean(ownerUserId),
              prospectsQueryDurationMs: formatDurationMs(prospectsQueryStartedAtMs),
              rowCount: (prospects ?? []).length,
            },
            "Prospects owner charges depuis Supabase.",
          );

          return (prospects ?? []) as HubSpotProspectRow[];
        };

        let prospects = await loadProspects();

        let hubspotDealCount: number | null = null;
        let hubspotDealCountDurationMs: number | null = null;

        if (includeLiveReconciliation && accessToken) {
          try {
            const dealCountStartedAtMs = getNowMs();
            hubspotDealCount = await hubSpotService.fetchDealCountByOwner(accessToken, hubspotOwnerId);
            hubspotDealCountDurationMs = formatDurationMs(dealCountStartedAtMs);
          } catch (hubspotCountError) {
            request.log.warn(
              { error: hubspotCountError, orgId, hubspotOwnerId },
              "Impossible de charger le nombre de deals live pour cet owner HubSpot.",
            );
          }
        }

        const localMappingStartedAtMs = getNowMs();
        let ownerProspects = ownerUserId
          ? prospects.map((prospect) => mapProspectRowToOwnerProspect(prospect))
          : mapOwnerProspects(prospects, hubspotOwnerId);
        const localMappingDurationMs = formatDurationMs(localMappingStartedAtMs);
        const localDistinctDealCount = new Set(
          ownerProspects
            .map((prospect) => prospect.hubspotDealId)
            .filter((hubspotDealId): hubspotDealId is string => Boolean(hubspotDealId)),
        ).size;
        const localLifecycleCoverageIncomplete = ownerProspects.some(
          (prospect) => prospect.hubspotDealId && !prospect.dealLifecycleStatus,
        );
        let liveProspectsDurationMs: number | null = null;
        let liveProspectsCount = 0;

        const shouldReconcileWithLiveDeals =
          includeLiveReconciliation &&
          Boolean(accessToken) &&
          (localLifecycleCoverageIncomplete ||
            (typeof hubspotDealCount === "number" &&
              hubspotDealCount !== 0 &&
              (ownerProspects.length === 0 || localDistinctDealCount < hubspotDealCount)));

        if (shouldReconcileWithLiveDeals && accessToken) {
          try {
            const liveProspectsStartedAtMs = getNowMs();
            const liveOwnerProspects = await hubSpotService.fetchProspectsByOwner(accessToken, hubspotOwnerId);
            liveProspectsDurationMs = formatDurationMs(liveProspectsStartedAtMs);
            liveProspectsCount = liveOwnerProspects.length;
            const syncedAt = new Date().toISOString();
            const liveProspectByDealId = new Map(
              liveOwnerProspects
                .filter((prospect) => prospect.hubspotDealId)
                .map((prospect) => [prospect.hubspotDealId as string, prospect]),
            );

            ownerProspects = ownerProspects.map((prospect) => {
              const liveProspect = prospect.hubspotDealId ? liveProspectByDealId.get(prospect.hubspotDealId) : null;

              if (!liveProspect) {
                return prospect;
              }

              return {
                ...prospect,
                dealName: liveProspect.rawData.dealName ?? prospect.dealName,
                contactName: liveProspect.name,
                email: liveProspect.email,
                company: liveProspect.company,
                title: liveProspect.title,
                dealStage: liveProspect.dealStage,
                dealStageLabel: liveProspect.dealStageLabel,
                dealAmount: liveProspect.dealAmount,
                closeProbability: liveProspect.closeProbability,
                closedAt: liveProspect.closedAt,
                dealLifecycleStatus: liveProspect.dealLifecycleStatus,
                isClosedDeal: liveProspect.isClosedDeal,
                lastContactAt: liveProspect.lastContactAt,
              };
            });

            const knownDealIds = new Set(
              ownerProspects
                .map((prospect) => prospect.hubspotDealId)
                .filter((hubspotDealId): hubspotDealId is string => Boolean(hubspotDealId)),
            );
            const missingLiveProspects = liveOwnerProspects.filter(
              (prospect) => prospect.hubspotDealId && !knownDealIds.has(prospect.hubspotDealId),
            );

            if (ownerProspects.length === 0) {
              ownerProspects = liveOwnerProspects.map((prospect) => mapLiveOwnerProspect(prospect, syncedAt));
            } else if (missingLiveProspects.length > 0) {
              ownerProspects = [
                ...ownerProspects,
                ...missingLiveProspects.map((prospect) => mapLiveOwnerProspect(prospect, syncedAt)),
              ];
            }
          } catch (liveOwnerProspectsError) {
            request.log.warn(
              { error: liveOwnerProspectsError, orgId, hubspotOwnerId },
              "Impossible d'enrichir les deals live pour cet owner HubSpot. Fallback sur la sync locale.",
            );
          }
        }

        const totalDurationMs = formatDurationMs(requestStartedAtMs);
        reply.header(
          "Server-Timing",
          [
            `total;dur=${totalDurationMs}`,
            accessTokenDurationMs === null ? null : `token;dur=${accessTokenDurationMs}`,
            hubspotDealCountDurationMs === null ? null : `hubspot-count;dur=${hubspotDealCountDurationMs}`,
            `local-map;dur=${localMappingDurationMs}`,
            liveProspectsDurationMs === null ? null : `hubspot-live;dur=${liveProspectsDurationMs}`,
          ]
            .filter((entry): entry is string => Boolean(entry))
            .join(", "),
        );
        reply.header("X-Response-Time-Ms", String(totalDurationMs));
        request.log.info(
          {
            orgId,
            hubspotOwnerId,
            durationMs: totalDurationMs,
            accessTokenDurationMs,
            ownerUserLookupDurationMs,
            ownerUserId,
            hubspotDealCountDurationMs,
            localMappingDurationMs,
            liveProspectsDurationMs,
            localProspectCount: prospects.length,
            localDistinctDealCount,
            liveProspectsCount,
            responseProspectCount: ownerProspects.length,
          },
          "Owner prospects charges.",
        );

        return reply.send({
          success: true,
          data: {
            orgId,
            hubspotOwnerId,
            hubspotDealCount,
            prospects: ownerProspects,
          },
        });
      } catch (error) {
        request.log.error({ error, orgId, hubspotOwnerId }, "Impossible de charger les prospects de l'owner HubSpot.");

        return reply.code(500).send({
          success: false,
          error:
            getPublicErrorMessage(error, "Erreur inconnue pendant le chargement des prospects de l'owner HubSpot."),
        });
      }
    },
  );

  app.get<{ Params: { dealId: string }; Querystring: HubSpotDealHistoryQuery; Reply: ApiResponse<HubSpotDealHistoryPayload> }>(
    "/api/deals/:dealId/history",
    async (request, reply) => {
      const orgId = request.query.orgId;
      const dealId = request.params.dealId?.trim();

      if (!orgId || !dealId) {
        return reply.code(400).send({
          success: false,
          error: "Les parametres orgId et dealId sont obligatoires pour charger l'historique du deal.",
        });
      }

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        let history = await loadLocalHubSpotDealHistory(orgId, dealId);

        if (!history) {
          const accessToken = await getHubSpotAccessToken(orgId);
          history = await hubSpotService.fetchDealHistory(accessToken, dealId);
        }

        if (!history) {
          throw new Error("Historique HubSpot introuvable.");
        }

        return reply.send({
          success: true,
          data: {
            orgId,
            dealId,
            dealName: history.dealName,
            companyName: history.companyName,
            dealContext: history.dealContext,
            companyContext: history.companyContext,
            contactNames: history.contactNames,
            timeline: history.timeline,
          },
        });
      } catch (error) {
        request.log.error(
          {
            err: error instanceof Error ? error : undefined,
            errorMessage: error instanceof Error ? error.message : String(error),
            orgId,
            dealId,
          },
          "Impossible de charger l'historique du deal HubSpot.",
        );

        return reply.code(500).send({
          success: false,
          error: getPublicErrorMessage(error, "Erreur inconnue pendant le chargement de l'historique du deal."),
        });
      }
    },
  );

  app.get<{ Params: HubSpotSyncJobParams; Reply: ApiResponse<SyncJobSnapshot> }>(
    "/api/sync/hubspot/jobs/:jobId",
    async (request, reply) => {
      cleanupHubSpotSyncJobs();

      const job = hubspotSyncJobs.get(request.params.jobId);

      if (!job) {
        return reply.code(404).send({
          success: false,
          error: "Job de sync HubSpot introuvable.",
        });
      }

      return reply.send({
        success: true,
        data: job,
      });
    },
  );

  app.post<{ Body: HubSpotSyncBody; Reply: ApiResponse<SyncResult | SyncJobSnapshot> }>(
    "/api/sync/hubspot",
    async (request, reply) => {
      const orgId = request.body.orgId;

      if (!orgId) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId est obligatoire pour lancer une sync HubSpot.",
        });
      }

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        const contactNames = Array.isArray(request.body.contactNames)
          ? request.body.contactNames.filter((contactName): contactName is string => typeof contactName === "string")
          : [];
        const hubspotOwnerIds = Array.isArray(request.body.hubspotOwnerIds)
          ? Array.from(
              new Set(
                request.body.hubspotOwnerIds
                  .filter((hubspotOwnerId): hubspotOwnerId is string => typeof hubspotOwnerId === "string")
                  .map((hubspotOwnerId) => hubspotOwnerId.trim())
                  .filter(Boolean),
              ),
            )
          : [];
        const includeFullSync = hubspotOwnerIds.length === 0 && !Array.isArray(request.body.contactNames);
        const targetContactNames =
          hubspotOwnerIds.length === 0 && !Array.isArray(request.body.contactNames)
            ? DEFAULT_TARGET_HUBSPOT_CONTACT_NAMES
            : contactNames;

        if (request.body.async) {
          const job = createHubSpotSyncJob(orgId);

          void syncHubSpotProspects(orgId, targetContactNames, includeFullSync, hubspotOwnerIds, (event) => {
            updateHubSpotSyncJob(job.jobId, event);
          })
            .then((syncResult) => {
              completeHubSpotSyncJob(job.jobId, syncResult);
            })
            .catch((syncError: unknown) => {
              failHubSpotSyncJob(job.jobId, syncError);
              request.log.error({ error: syncError, orgId, jobId: job.jobId }, "Echec du job de sync HubSpot.");
            });

          return reply.code(202).send({
            success: true,
            data: job,
          });
        }

        const syncResult = await syncHubSpotProspects(orgId, targetContactNames, includeFullSync, hubspotOwnerIds);

        return reply.send({
          success: true,
          data: syncResult,
        });
      } catch (error) {
        request.log.error({ error, orgId }, "Echec de la sync HubSpot.");

        return reply.code(500).send({
          success: false,
          error: getPublicErrorMessage(error, "Erreur inconnue pendant la sync HubSpot."),
        });
      }
    },
  );

  app.get<{ Querystring: HubSpotStartQuery }>(
    "/api/auth/hubspot/start",
    async (request, reply) => {
      const orgId = request.query.orgId;

      if (!orgId) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId est obligatoire pour connecter HubSpot.",
        });
      }

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        const authorizationUrl = hubSpotService.buildAuthorizationUrl({
          orgId,
          returnTo: request.query.returnTo ?? `${env.appUrl}/settings?hubspot=connected`,
        });

        request.log.info(
          {
            orgId,
            apiPublicUrl: env.apiPublicUrl || null,
            hubspotRedirectUri: env.hubspotRedirectUri,
          },
          "Demarrage OAuth HubSpot.",
        );

        return reply.redirect(authorizationUrl);
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de construire l'URL OAuth HubSpot.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Erreur de configuration HubSpot.",
        });
      }
    },
  );

  app.get<{ Querystring: HubSpotCallbackQuery }>(
    "/api/auth/hubspot/callback",
    async (request, reply) => {
      const { code, state } = request.query;
      let fallbackTarget = env.appUrl;
      const appendErrorQuery = (targetUrl: string, errorMessage: string): string => {
        const separator = targetUrl.includes("?") ? "&" : "?";

        return `${targetUrl}${separator}hubspot=error&reason=${encodeURIComponent(errorMessage)}`;
      };

      if (!code || !state) {
        return reply.code(400).send({
          success: false,
          error: "HubSpot n'a pas fourni les parametres code/state attendus.",
        });
      }

      try {
        const decodedState = hubSpotService.decodeState(state);
        const orgId = decodedState.orgId;
        const returnTo = decodedState.returnTo ?? env.appUrl;
        fallbackTarget = appendErrorQuery(returnTo, "HubSpot callback invalide.");

        if (!orgId) {
          return reply.code(400).send({
            success: false,
            error: "Etat OAuth invalide: orgId manquant.",
          });
        }

        if (!isValidOrgId(orgId)) {
          return reply.code(400).send({
            success: false,
            error: "Etat OAuth invalide: orgId Jarvis incorrect.",
          });
        }

        const supabase = getSupabaseAdmin();
        const { data: organization, error: organizationError } = await supabase
          .from("organizations")
          .select("id")
          .eq("id", orgId)
          .maybeSingle();

        if (organizationError) {
          throw new Error(formatOperationError("Impossible de charger l'organisation", organizationError.message));
        }

        if (!(organization as OrganizationRow | null)) {
          return reply.code(404).send({
            success: false,
            error: "Organisation inconnue pour cette connexion HubSpot.",
          });
        }

        const tokenResponse = await hubSpotService.exchangeCodeForToken(code);

        await upsertHubSpotIntegration(orgId, {
          accessToken: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token,
          expiresIn: tokenResponse.expires_in,
        });
        invalidateHubSpotStatusCache(orgId);

        if (tokenResponse.hub_id) {
          const { error: updateOrgError } = await supabase
            .from("organizations")
            .update({
              hubspot_portal_id: String(tokenResponse.hub_id),
            })
            .eq("id", orgId);

          if (updateOrgError) {
            throw new Error(
              formatOperationError("Impossible d'enregistrer le portal HubSpot", updateOrgError.message),
            );
          }

          invalidateHubSpotStatusCache(orgId);
        }

        void syncHubSpotProspects(orgId)
          .then((syncResult) => {
            request.log.info(
              { orgId, syncedCount: syncResult.syncedCount },
              "Connexion HubSpot terminee, sync initiale terminee en arriere-plan.",
            );
          })
          .catch((syncError: unknown) => {
            request.log.error(
              { error: syncError, orgId },
              "Connexion HubSpot terminee, mais la sync initiale en arriere-plan a echoue.",
            );
          });

        return reply
          .type("text/html; charset=utf-8")
          .send(
            buildOAuthPopupHtml(
              `${returnTo}${returnTo.includes("?") ? "&" : "?"}hubspot=connected&sync=started`,
            ),
          );
      } catch (error) {
        request.log.error({ error }, "Echec du callback OAuth HubSpot.");
        const errorMessage =
          getPublicErrorMessage(error, "Erreur inconnue pendant le callback OAuth HubSpot.");

        return reply
          .type("text/html; charset=utf-8")
          .send(
            buildOAuthPopupHtml(
              appendErrorQuery(fallbackTarget.replace(/[?&]reason=[^&]*/g, ""), errorMessage),
            ),
          );
      }
    },
  );
};
