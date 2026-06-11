import { getSupabaseAdmin } from "../../db/client.js";
import type { Json } from "../../db/database.types.js";
import {
  hubSpotService,
  type DealLifecycleStatus,
  type HubSpotCrmSyncSnapshot,
} from "../../services/hubspot.service.js";
import { getHubSpotAccessToken } from "../../services/hubspot-auth.service.js";
import { createJob, getJob, updateJob } from "../../services/job-store.js";
import { upsertHubSpotSyncStatus, type HubSpotSyncStatusSnapshot } from "../../services/hubspot-sync-status.service.js";
import { runAutomaticFollowUpTasksForOrg } from "../../services/follow-up-task.service.js";
import { captureServerError } from "../../lib/sentry.js";
import {
  buildPulseDealCreatedSourceEventId,
  generatePulseNotificationsForNewDeal,
} from "../../services/pulse.service.js";

export type SyncResult = {
  orgId: string;
  syncedCount: number;
  crm: {
    contactCount: number;
    companyCount: number;
    dealCount: number;
    leadCount: number;
  };
  autoFollowUp: {
    analyzedCount: number;
    createdCount: number;
    skippedCount: number;
    failedCount: number;
  };
};

export type SyncProgressLog = {
  at: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
};

export type SyncProgressStatus = "queued" | "running" | "completed" | "failed";

export type SyncJobSnapshot = {
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

export type SyncProgressEvent = {
  progress: number;
  step: string;
  level?: SyncProgressLog["level"];
  message?: string;
};

type HubSpotStatusCacheEntry = {
  expiresAt: number;
  payload: HubSpotConnectionStatus;
};

export type HubSpotConnectionStatus = {
  orgId: string;
  connected: boolean;
  hubspotPortalId: string | null;
  prospectCount: number;
  syncedDealCount: number;
  hubspotDealCount: number | null;
  lastSyncedAt: string | null;
  syncStatus?: HubSpotSyncStatusSnapshot | null;
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

type HubSpotLeadUpsertRow = {
  org_id: string;
  hubspot_lead_id: string;
  hubspot_owner_id: string | null;
  associated_contact_ids: string[];
  associated_company_ids: string[];
  name: string;
  pipeline_id: string | null;
  pipeline_label: string | null;
  phase_id: string | null;
  phase_label: string | null;
  hubspot_created_at: string | null;
  hubspot_updated_at: string | null;
  properties: Record<string, string | null>;
  synced_at: string;
};

const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isValidOrgId = (value: string | undefined): value is string =>
  typeof value === "string" && UUID_V4_LIKE_PATTERN.test(value.trim());

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

export const formatOperationError = (prefix: string, message: string): string =>
  `${prefix}: ${normalizeUpstreamErrorMessage(message)}`;

export const getPublicErrorMessage = (error: unknown, fallbackMessage: string): string =>
  error instanceof Error ? normalizeUpstreamErrorMessage(error.message) : fallbackMessage;

export const PROSPECT_UPSERT_BATCH_SIZE = 100;
export const HUBSPOT_STATUS_CACHE_TTL_MS = 30_000;
export const DEFAULT_TARGET_HUBSPOT_CONTACT_NAMES = [
  "Hugo SAMSON",
  "Samantha Brebant",
  "Samy SAHEL",
  "Sofiane Larbi",
];
export const hubspotStatusCache = new Map<string, HubSpotStatusCacheEntry>();
const HUBSPOT_SYNC_JOB_LOG_LIMIT = 80;
const HUBSPOT_SYNC_JOB_TYPE = "hubspot_sync";

export const invalidateHubSpotStatusCache = (orgId: string): void => {
  hubspotStatusCache.delete(orgId);
};

const createSyncJobId = (): string => `hubspot-sync-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const toSyncJobSnapshot = (job: Awaited<ReturnType<typeof getJob>>): SyncJobSnapshot | null => {
  if (!job || job.type !== HUBSPOT_SYNC_JOB_TYPE || !job.orgId) {
    return null;
  }

  return {
    jobId: job.id,
    orgId: job.orgId,
    status: job.status === "skipped" ? "failed" : job.status,
    progress: job.progress,
    currentStep: job.currentStep,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    logs: job.logs.filter((log) => log.level !== "warning") as SyncProgressLog[],
    result: job.result as SyncResult | null,
    error: job.error,
  };
};

export const loadHubSpotSyncJob = async (jobId: string): Promise<SyncJobSnapshot | null> => {
  const job = await getJob(jobId);
  return toSyncJobSnapshot(job);
};

export const createHubSpotSyncJob = async (orgId: string): Promise<SyncJobSnapshot> => {
  const now = new Date().toISOString();
  const job = await createJob({
    id: createSyncJobId(),
    orgId,
    type: HUBSPOT_SYNC_JOB_TYPE,
    currentStep: "Sync en attente",
    logs: [
      {
        at: now,
        level: "info",
        message: "Job de sync HubSpot cree.",
      },
    ],
  });

  void upsertHubSpotSyncStatus({
    orgId,
    status: "queued",
    jobId: job.id,
    progress: 0,
    currentStep: job.currentStep,
  });

  const snapshot = toSyncJobSnapshot(job);

  if (!snapshot) {
    throw new Error("Job de sync HubSpot invalide apres creation.");
  }

  return snapshot;
};

export const updateHubSpotSyncJob = async (jobId: string, event: SyncProgressEvent): Promise<void> => {
  const job = await loadHubSpotSyncJob(jobId);

  if (!job) {
    return;
  }

  const now = new Date().toISOString();
  job.status = job.status === "queued" ? "running" : job.status;
  job.progress = Math.max(job.progress, Math.min(99, Math.round(event.progress)));
  job.currentStep = event.step;

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
  await updateJob(jobId, {
    status: job.status,
    progress: job.progress,
    currentStep: job.currentStep,
    logs: job.logs,
  });
  void upsertHubSpotSyncStatus({
    orgId: job.orgId,
    status: "running",
    jobId,
    progress: job.progress,
    currentStep: job.currentStep,
  });
};

export const completeHubSpotSyncJob = async (jobId: string, result: SyncResult): Promise<void> => {
  const job = await loadHubSpotSyncJob(jobId);

  if (!job) {
    return;
  }

  const now = new Date().toISOString();
  job.status = "completed";
  job.progress = 100;
  job.currentStep = "Sync terminee";
  job.finishedAt = now;
  job.result = result;
  job.logs = [
    ...job.logs,
    {
      at: now,
      level: "success",
      message: `Sync terminee: ${result.syncedCount} prospect(s), ${result.crm.dealCount} deal(s), ${result.crm.contactCount} contact(s), ${result.crm.leadCount} lead(s).`,
    } satisfies SyncProgressLog,
  ].slice(-HUBSPOT_SYNC_JOB_LOG_LIMIT);
  await updateJob(jobId, {
    status: "completed",
    progress: 100,
    currentStep: job.currentStep,
    logs: job.logs,
    result: result as unknown as Json,
    error: null,
    finishedAt: now,
  });
  void upsertHubSpotSyncStatus({
    orgId: job.orgId,
    status: "completed",
    jobId,
    progress: 100,
    currentStep: job.currentStep,
  });
};

export const failHubSpotSyncJob = async (jobId: string, error: unknown): Promise<void> => {
  const job = await loadHubSpotSyncJob(jobId);

  if (!job) {
    return;
  }

  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : "Erreur inconnue pendant la sync HubSpot.";
  job.status = "failed";
  job.currentStep = "Sync en erreur";
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
  await updateJob(jobId, {
    status: "failed",
    progress: job.progress,
    currentStep: job.currentStep,
    logs: job.logs,
    error: message,
    finishedAt: now,
  });
  void upsertHubSpotSyncStatus({
    orgId: job.orgId,
    status: "failed",
    jobId,
    progress: job.progress,
    currentStep: job.currentStep,
    error: message,
  });
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
  const leadRows: HubSpotLeadUpsertRow[] = snapshot.leads.map((lead) => ({
    org_id: orgId,
    hubspot_lead_id: lead.id,
    hubspot_owner_id: lead.hubspotOwnerId,
    associated_contact_ids: lead.associatedContactIds,
    associated_company_ids: lead.associatedCompanyIds,
    name: lead.name,
    pipeline_id: lead.pipelineId,
    pipeline_label: lead.pipelineLabel,
    phase_id: lead.phaseId,
    phase_label: lead.phaseLabel,
    hubspot_created_at: normalizeHubSpotTimestamp(lead.createdAt),
    hubspot_updated_at: normalizeHubSpotTimestamp(lead.updatedAt),
    properties: lead.properties,
    synced_at: syncedAt,
  }));
  const dealRows: HubSpotDealUpsertRow[] = snapshot.deals.map((deal) => {
    const dealStageId = readHubSpotProperty(deal.properties, "dealstage");
    const stage = stageLabelById.get(dealStageId ?? "");
    const lifecycleStatus = resolveHubSpotDealLifecycleStatus(dealStageId, stage ?? undefined);

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

  for (const batch of createBatches(leadRows, PROSPECT_UPSERT_BATCH_SIZE)) {
    const { error } = await supabase.from("hubspot_leads").upsert(batch, {
      onConflict: "org_id,hubspot_lead_id",
    });

    if (error) {
      throw new Error(formatOperationError("Impossible de synchroniser les leads HubSpot", error.message));
    }
  }
};

const getProspectSyncKey = (prospect: { hubspotContactId: string; hubspotDealId: string | null }): string =>
  `${prospect.hubspotContactId}:${prospect.hubspotDealId ?? "contact"}`;

const loadExistingHubSpotDealIds = async (orgId: string, dealIds: string[]): Promise<Set<string> | null> => {
  if (dealIds.length === 0) {
    return new Set();
  }

  const { count, error: countError } = await getSupabaseAdmin()
    .from("hubspot_deals")
    .select("hubspot_deal_id", { count: "exact", head: true })
    .eq("org_id", orgId);

  if (countError) {
    throw new Error(`Impossible de verifier les deals HubSpot existants: ${countError.message}`);
  }

  // Premier snapshot CRM: ne pas spammer Pulse avec tout le pipe historique.
  if ((count ?? 0) === 0) {
    return null;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("hubspot_deals")
    .select("hubspot_deal_id")
    .eq("org_id", orgId)
    .in("hubspot_deal_id", dealIds);

  if (error) {
    throw new Error(`Impossible de charger les deals HubSpot existants: ${error.message}`);
  }

  return new Set(((data ?? []) as Array<{ hubspot_deal_id: string }>).map((row) => row.hubspot_deal_id));
};

const notifyPulseForNewSyncedDeals = async (
  orgId: string,
  snapshot: HubSpotCrmSyncSnapshot,
  existingDealIds: Set<string> | null,
  occurredAt: string,
): Promise<void> => {
  if (!existingDealIds) {
    return;
  }

  for (const deal of snapshot.deals) {
    if (existingDealIds.has(deal.id)) {
      continue;
    }

    const dealStageId = readHubSpotProperty(deal.properties, "dealstage");
    const stage = snapshot.dealStages.find((candidate) => candidate.stageId === dealStageId) ?? null;
    const lifecycleStatus = resolveHubSpotDealLifecycleStatus(dealStageId, stage ?? undefined);

    if (lifecycleStatus !== "pending") {
      continue;
    }

    try {
      await generatePulseNotificationsForNewDeal({
        orgId,
        sourceEventId: buildPulseDealCreatedSourceEventId(orgId, deal.id),
        hubspotDealId: deal.id,
        dealName: readHubSpotProperty(deal.properties, "dealname"),
        amount: parseHubSpotNumericProperty(deal.properties, "amount"),
        stageLabel: stage?.stageLabel ?? dealStageId,
        occurredAt,
      });
    } catch (error) {
      void captureServerError(error, { scope: "jarvis-pulse-sync", orgId, hubspotDealId: deal.id });
    }
  }
};

export const syncHubSpotProspects = async (
  orgId: string,
  contactNames: string[] = DEFAULT_TARGET_HUBSPOT_CONTACT_NAMES,
  includeFullSync = true,
  hubspotOwnerIds: string[] = [],
  reportProgress?: (event: SyncProgressEvent) => void,
): Promise<SyncResult> => {
  const supabase = getSupabaseAdmin();
  invalidateHubSpotStatusCache(orgId);

  try {
    await upsertHubSpotSyncStatus({
      orgId,
      status: "running",
      progress: 1,
      currentStep: "Demarrage sync HubSpot",
    }).catch(() => undefined);
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
    const existingDealIdsBeforeSync = crmSnapshot
      ? await loadExistingHubSpotDealIds(
          orgId,
          crmSnapshot.deals.map((deal) => deal.id),
        )
      : null;
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
        await notifyPulseForNewSyncedDeals(orgId, crmSnapshot, existingDealIdsBeforeSync, syncedAt);
      }

      const emptyResult = {
        orgId,
        syncedCount: 0,
        crm: {
          contactCount: crmSnapshot?.contacts.length ?? 0,
          companyCount: crmSnapshot?.companies.length ?? 0,
          dealCount: crmSnapshot?.deals.length ?? 0,
          leadCount: crmSnapshot?.leads.length ?? 0,
        },
        autoFollowUp: {
          analyzedCount: 0,
          createdCount: 0,
          skippedCount: 0,
          failedCount: 0,
        },
      };
      await upsertHubSpotSyncStatus({
        orgId,
        status: "completed",
        progress: 100,
        currentStep: "Sync terminee sans prospect",
      }).catch(() => undefined);

      return emptyResult;
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
        message: `${crmSnapshot.deals.length} deal(s), ${crmSnapshot.contacts.length} contact(s), ${crmSnapshot.companies.length} entreprise(s), ${crmSnapshot.leads.length} lead(s).`,
      });
      await upsertHubSpotCrmSnapshot(orgId, crmSnapshot, syncedAt);
      await notifyPulseForNewSyncedDeals(orgId, crmSnapshot, existingDealIdsBeforeSync, syncedAt);
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

    const autoFollowUp = {
      analyzedCount: 0,
      createdCount: 0,
      skippedCount: rows.length,
      failedCount: 0,
    };
    reportProgress?.({
      progress: 95,
      step: "Finalisation",
      message: "Sync HubSpot finalisee. Les relances automatiques sont traitees hors du flow de sync.",
    });

    const result = {
      orgId,
      syncedCount: rows.length,
      crm: {
        contactCount: crmSnapshot?.contacts.length ?? 0,
        companyCount: crmSnapshot?.companies.length ?? 0,
        dealCount: crmSnapshot?.deals.length ?? 0,
        leadCount: crmSnapshot?.leads.length ?? 0,
      },
      autoFollowUp,
    };
    await upsertHubSpotSyncStatus({
      orgId,
      status: "completed",
      progress: 100,
      currentStep: "Sync terminee",
    }).catch(() => undefined);

    // Relances automatiques hors du chemin critique de la sync (route sync et callback OAuth).
    setImmediate(() => {
      void runAutomaticFollowUpTasksForOrg(orgId).catch((followUpError: unknown) => {
        void captureServerError(followUpError, { scope: "auto-follow-up", orgId });
      });
    });

    return result;
  } catch (error) {
    await upsertHubSpotSyncStatus({
      orgId,
      status: "failed",
      progress: 100,
      currentStep: "Sync en erreur",
      error: error instanceof Error ? error.message : "Erreur inconnue pendant la sync HubSpot.",
    }).catch(() => undefined);
    throw error;
  } finally {
    invalidateHubSpotStatusCache(orgId);
  }
};
