import type { ProspectPriority } from "@jarvis/shared";
import { hubSpotService, type DealLifecycleStatus } from "../../services/hubspot.service.js";
import { getHubSpotAccessToken } from "../../services/hubspot-auth.service.js";
import { scoreProspect } from "../../services/prospects/scoring.service.js";

export type HubSpotOwnersQuery = {
  orgId?: string;
};

export type HubSpotLastUpdatesQuery = {
  orgId?: string;
  limit?: string;
};

export type HubSpotOwnerProspectsQuery = {
  orgId?: string;
  hubspotOwnerId?: string;
  live?: string;
};

export type HubSpotOwnerOption = {
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

type HubSpotOwnerSummary = {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  archived?: boolean;
  teams?: HubSpotOwnerTeam[];
};

export type HubSpotOwnerProspect = {
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
  nextAction: string;
  reason: string;
  priority: ProspectPriority;
};

export type HubSpotOwnerProspectsPayload = {
  orgId: string;
  hubspotOwnerId: string;
  hubspotDealCount: number | null;
  prospects: HubSpotOwnerProspect[];
};

export type HubSpotLastUpdateItem = {
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
  nextAction: {
    title: string;
    rationale: string;
    dueInDays: number;
    priority: "low" | "medium" | "high";
  } | null;
  analysisProvider: string | null;
  analysisModel: string | null;
  errorMessage: string | null;
  receivedAt: string;
  scheduledFor: string;
  processedAt: string | null;
};

export type HubSpotLastUpdatesPayload = {
  orgId: string;
  updates: HubSpotLastUpdateItem[];
};

export type HubSpotProspectRow = {
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

export type HubSpotOwnerUserRow = {
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

export type HubSpotRealtimeAnalysisRunListRow = {
  id: string;
  org_id: string;
  hubspot_deal_id: string;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  reason: string | null;
  scheduled_for: string;
  started_at: string | null;
  finished_at: string | null;
  trigger_event_ids: string[];
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type DealActivityPlanAnalysisRow = {
  hubspot_deal_id: string;
  provider: string;
  model: string;
  analysis: unknown;
  generated_at: string;
};

export type HubSpotDealSummaryRow = {
  hubspot_deal_id: string;
  hubspot_owner_id: string | null;
  primary_company_id: string | null;
  deal_name: string | null;
  amount: number | null;
  deal_stage: string | null;
  deal_stage_label?: string | null;
  deal_lifecycle_status: DealLifecycleStatus | null;
  is_closed_deal: boolean | null;
};

export type HubSpotCompanySummaryRow = {
  hubspot_company_id: string;
  name: string | null;
};

type SalesAeOwnerCacheEntry = {
  expiresAt: number;
  ownerIds: Set<string>;
};

export const parseLastUpdatesLimit = (value: string | undefined): number => {
  const parsedValue = Number(value ?? 12);

  if (!Number.isFinite(parsedValue)) {
    return 12;
  }

  return Math.max(1, Math.min(50, Math.trunc(parsedValue)));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isLastUpdatePriority = (value: unknown): value is "low" | "medium" | "high" =>
  value === "low" || value === "medium" || value === "high";

export const parseLastUpdateNextAction = (
  analysis: unknown,
): HubSpotLastUpdateItem["nextAction"] => {
  if (!isRecord(analysis)) {
    return null;
  }

  const recommendation = analysis.recommendation;

  if (!isRecord(recommendation)) {
    return null;
  }

  const nextBestAction = recommendation.nextBestAction;

  if (
    !isRecord(nextBestAction) ||
    typeof nextBestAction.title !== "string" ||
    typeof nextBestAction.rationale !== "string" ||
    typeof nextBestAction.dueInDays !== "number" ||
    !Number.isFinite(nextBestAction.dueInDays)
  ) {
    return null;
  }

  return {
    title: nextBestAction.title,
    rationale: nextBestAction.rationale,
    dueInDays: Math.max(0, Math.round(nextBestAction.dueInDays)),
    priority: isLastUpdatePriority(recommendation.priority) ? recommendation.priority : "medium",
  };
};

export const getProspectOwnerHubSpotId = (rawData: unknown): string | null => {
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

const SALES_AE_TEAM_NAME = "sales ae";
const SALES_AE_LAST_UPDATE_OWNER_NAMES = new Set(["hugo samson", "samy sahel", "samantha brebant", "sofiane larbi"]);
const salesAeOwnerCache = new Map<string, SalesAeOwnerCacheEntry>();
const SALES_AE_OWNER_CACHE_TTL_MS = 5 * 60 * 1000;

export const getDisplayTeamName = (teams: HubSpotOwnerTeam[] | undefined): string | null =>
  teams?.find((team) => team.primary)?.name ?? teams?.[0]?.name ?? null;

export const isSalesAeOwner = (teams: HubSpotOwnerTeam[] | undefined): boolean =>
  getDisplayTeamName(teams)?.trim().toLowerCase().includes(SALES_AE_TEAM_NAME) ?? false;

const normalizeOwnerName = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const getHubSpotOwnerName = (owner: HubSpotOwnerSummary): string =>
  [owner.firstName, owner.lastName].filter(Boolean).join(" ").trim() || owner.email || `Owner ${owner.id}`;

const isTargetSalesAeLastUpdateOwner = (owner: HubSpotOwnerSummary): boolean =>
  isSalesAeOwner(owner.teams) && SALES_AE_LAST_UPDATE_OWNER_NAMES.has(normalizeOwnerName(getHubSpotOwnerName(owner)));

export const isOpenDeal = (deal: Pick<HubSpotDealSummaryRow, "deal_lifecycle_status" | "is_closed_deal">): boolean =>
  deal.deal_lifecycle_status === "pending" || (deal.deal_lifecycle_status === null && deal.is_closed_deal !== true);

export const loadSalesAeOwnerIds = async (orgId: string): Promise<Set<string>> => {
  const cachedOwners = salesAeOwnerCache.get(orgId);

  if (cachedOwners && cachedOwners.expiresAt > Date.now()) {
    return cachedOwners.ownerIds;
  }

  const accessToken = await getHubSpotAccessToken(orgId);
  const hubspotOwners = await hubSpotService.fetchOwners(accessToken);
  const ownerIds = new Set(
    hubspotOwners
      .filter((owner) => !owner.archived)
      .filter(isTargetSalesAeLastUpdateOwner)
      .map((owner) => owner.id),
  );

  salesAeOwnerCache.set(orgId, {
    expiresAt: Date.now() + SALES_AE_OWNER_CACHE_TTL_MS,
    ownerIds,
  });

  return ownerIds;
};

export const mapOwnerProspects = (
  prospects: HubSpotProspectRow[],
  hubspotOwnerId: string,
): HubSpotOwnerProspect[] =>
  prospects
    .filter((prospect) => getProspectOwnerHubSpotId(prospect.raw_data) === hubspotOwnerId)
    .map((prospect) => {
      const dealName =
        (typeof prospect.raw_data === "object" &&
        prospect.raw_data !== null &&
        "dealName" in prospect.raw_data &&
        typeof (prospect.raw_data as ProspectRawData).dealName === "string"
          ? (prospect.raw_data as ProspectRawData).dealName
          : null) ?? null;
      const dealStageLabel = getProspectDealStageLabel(prospect.raw_data);
      const closedAt = getProspectClosedAt(prospect.raw_data);
      const scoring = scoreProspect({
        dealAmount: prospect.deal_amount,
        closeProbability: prospect.close_probability,
        dealStage: prospect.deal_stage,
        dealStageLabel,
        lastContactAt: prospect.last_contact_at,
        closeDate: closedAt,
        dealName: dealName ?? prospect.hubspot_deal_id,
      });

      return {
      id: prospect.id,
      dealName,
      contactName: prospect.name,
      email: prospect.email,
      company: prospect.company,
      title: prospect.title,
      dealStage: prospect.deal_stage,
      dealStageLabel,
      dealAmount: prospect.deal_amount,
      closeProbability: prospect.close_probability,
      closedAt,
      dealLifecycleStatus: getProspectDealLifecycleStatus(prospect.raw_data),
      isClosedDeal:
        getProspectClosedDealFlag(prospect.raw_data) ??
        resolveClosedFlagFromLifecycleStatus(getProspectDealLifecycleStatus(prospect.raw_data)),
      lastContactAt: prospect.last_contact_at,
      hubspotDealId: prospect.hubspot_deal_id,
      syncedAt: prospect.synced_at,
      nextAction: scoring.next_action,
      reason: scoring.reason,
      priority: scoring.priority,
      };
    });

export const mapProspectRowToOwnerProspect = (prospect: HubSpotProspectRow): HubSpotOwnerProspect => {
  const dealName =
    (typeof prospect.raw_data === "object" &&
    prospect.raw_data !== null &&
    "dealName" in prospect.raw_data &&
    typeof (prospect.raw_data as ProspectRawData).dealName === "string"
      ? (prospect.raw_data as ProspectRawData).dealName
      : null) ?? null;
  const dealStageLabel = getProspectDealStageLabel(prospect.raw_data);
  const closedAt = getProspectClosedAt(prospect.raw_data);
  const scoring = scoreProspect({
    dealAmount: prospect.deal_amount,
    closeProbability: prospect.close_probability,
    dealStage: prospect.deal_stage,
    dealStageLabel,
    lastContactAt: prospect.last_contact_at,
    closeDate: closedAt,
    dealName: dealName ?? prospect.hubspot_deal_id,
  });

  return {
  id: prospect.id,
  dealName,
  contactName: prospect.name,
  email: prospect.email,
  company: prospect.company,
  title: prospect.title,
  dealStage: prospect.deal_stage,
  dealStageLabel,
  dealAmount: prospect.deal_amount,
  closeProbability: prospect.close_probability,
  closedAt,
  dealLifecycleStatus: getProspectDealLifecycleStatus(prospect.raw_data),
  isClosedDeal:
    getProspectClosedDealFlag(prospect.raw_data) ??
    resolveClosedFlagFromLifecycleStatus(getProspectDealLifecycleStatus(prospect.raw_data)),
  lastContactAt: prospect.last_contact_at,
  hubspotDealId: prospect.hubspot_deal_id,
  syncedAt: prospect.synced_at,
  nextAction: scoring.next_action,
  reason: scoring.reason,
  priority: scoring.priority,
  };
};

export const mapLiveOwnerProspect = (
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
): HubSpotOwnerProspect => {
  const scoring = scoreProspect({
    dealAmount: prospect.dealAmount,
    closeProbability: prospect.closeProbability,
    dealStage: prospect.dealStage,
    dealStageLabel: prospect.dealStageLabel,
    lastContactAt: prospect.lastContactAt,
    closeDate: prospect.closedAt,
    dealName: prospect.rawData.dealName ?? prospect.hubspotDealId,
  });

  return {
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
  nextAction: scoring.next_action,
  reason: scoring.reason,
  priority: scoring.priority,
  };
};
