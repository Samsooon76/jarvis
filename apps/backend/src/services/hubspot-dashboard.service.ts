import type { ProspectPriority } from "@jarvis/shared";
import { getSupabaseAdmin } from "../db/client.js";
import type { Json } from "../db/database.types.js";
import { getHubSpotAccessToken } from "./hubspot-auth.service.js";
import { hubSpotService } from "./hubspot.service.js";
import { scoreProspect } from "./scoring.service.js";
import { getHubSpotSyncStatus, type HubSpotSyncStatusSnapshot } from "./hubspot-sync-status.service.js";

export type HubSpotConnectionStatusData = {
  orgId: string;
  connected: boolean;
  hubspotPortalId: string | null;
  prospectCount: number;
  syncedDealCount: number;
  hubspotDealCount: number | null;
  lastSyncedAt: string | null;
  syncStatus: HubSpotSyncStatusSnapshot | null;
};

export type HubSpotOwnerOptionData = {
  ownerId: string;
  hubspotUserId: string | null;
  name: string;
  email: string;
  teamName: string | null;
  prospectCount: number;
  syncedDealCount: number;
  lastSyncedAt: string | null;
};

export type HubSpotOwnerProspectData = {
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
  dealLifecycleStatus: "pending" | "won" | "lost" | null;
  isClosedDeal: boolean | null;
  lastContactAt: string | null;
  hubspotDealId: string | null;
  syncedAt: string;
  nextAction: string;
  reason: string;
  priority: ProspectPriority;
};

export type HubSpotQueueDashboardData = {
  orgId: string;
  hubspotOwnerId: string;
  hubspotDealCount: number | null;
  prospects: HubSpotOwnerProspectData[];
  status: HubSpotConnectionStatusData;
  owner: HubSpotOwnerOptionData;
  owners: HubSpotOwnerOptionData[];
  lastUpdates: HubSpotLastUpdateData[];
};

export type HubSpotLastUpdateData = {
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
  };
  analysisProvider: string | null;
  analysisModel: string | null;
  errorMessage: string | null;
  receivedAt: string;
  scheduledFor: string;
  processedAt: string | null;
};

type ProspectRow = {
  id: string;
  owner_user_id: string | null;
  hubspot_deal_id: string | null;
  name: string;
  email: string | null;
  company: string | null;
  title: string | null;
  deal_stage: string | null;
  deal_amount: number | null;
  close_probability: number;
  last_contact_at: string | null;
  synced_at: string;
  raw_data: Json;
};

type UserRow = {
  id: string;
  hubspot_owner_id: string | null;
};

type RealtimeRunRow = {
  id: string;
  org_id: string;
  hubspot_deal_id: string;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  reason: string | null;
  scheduled_for: string | null;
  started_at: string | null;
  finished_at: string | null;
  trigger_event_ids: string[];
  error_message: string | null;
  updated_at: string;
};

type DealRow = {
  hubspot_deal_id: string;
  primary_company_id: string | null;
  deal_name: string | null;
  amount: number | null;
  deal_stage: string | null;
  deal_stage_label: string | null;
};

type CompanyRow = {
  hubspot_company_id: string;
  name: string | null;
};

const getRawString = (rawData: Json, key: string): string | null => {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    return null;
  }

  const value = rawData[key];

  return typeof value === "string" && value.trim() ? value : null;
};

const getRawBoolean = (rawData: Json, key: string): boolean | null => {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    return null;
  }

  const value = rawData[key];

  return typeof value === "boolean" ? value : null;
};

const getTeamName = (teams: Array<{ name?: string | null; primary?: boolean }> | undefined): string | null => {
  const team = teams?.find((candidate) => candidate.primary) ?? teams?.[0];

  return team?.name ?? null;
};

const isSalesAeOwner = (teams: Array<{ name?: string | null }> | undefined): boolean =>
  getTeamName(teams)?.toLowerCase().includes("sales ae") ?? false;

const mapProspect = (prospect: ProspectRow): HubSpotOwnerProspectData => {
  const dealName = getRawString(prospect.raw_data, "dealName");
  const dealStageLabel = getRawString(prospect.raw_data, "dealStageLabel");
  const closedAt = getRawString(prospect.raw_data, "closedAt");
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
    dealLifecycleStatus: getRawString(prospect.raw_data, "dealLifecycleStatus") as "pending" | "won" | "lost" | null,
    isClosedDeal: getRawBoolean(prospect.raw_data, "isClosedDeal"),
    lastContactAt: prospect.last_contact_at,
    hubspotDealId: prospect.hubspot_deal_id,
    syncedAt: prospect.synced_at,
    nextAction: scoring.next_action,
    reason: scoring.reason,
    priority: scoring.priority,
  };
};

const loadLastUpdates = async (orgId: string, limit: number): Promise<HubSpotLastUpdateData[]> => {
  const supabase = getSupabaseAdmin();
  const { data: runData, error: runError } = await supabase
    .from("hubspot_realtime_analysis_runs")
    .select(
      "id, org_id, hubspot_deal_id, status, reason, scheduled_for, started_at, finished_at, trigger_event_ids, error_message, updated_at",
    )
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (runError) {
    return [];
  }

  const runs = (runData ?? []) as RealtimeRunRow[];
  const dealIds = runs.map((run) => run.hubspot_deal_id);
  const { data: dealData } =
    dealIds.length > 0
      ? await supabase
          .from("hubspot_deals")
          .select("hubspot_deal_id, primary_company_id, deal_name, amount, deal_stage, deal_stage_label")
          .eq("org_id", orgId)
          .in("hubspot_deal_id", dealIds)
      : { data: [] };
  const deals = (dealData ?? []) as DealRow[];
  const dealById = new Map(deals.map((deal) => [deal.hubspot_deal_id, deal]));
  const companyIds = Array.from(
    new Set(deals.map((deal) => deal.primary_company_id).filter((companyId): companyId is string => Boolean(companyId))),
  );
  const { data: companyData } =
    companyIds.length > 0
      ? await supabase
          .from("hubspot_companies")
          .select("hubspot_company_id, name")
          .eq("org_id", orgId)
          .in("hubspot_company_id", companyIds)
      : { data: [] };
  const companyById = new Map(((companyData ?? []) as CompanyRow[]).map((company) => [company.hubspot_company_id, company]));

  return runs.map((run) => {
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
      nextAction: {
        title: "Verifier le prochain pas HubSpot",
        rationale: "Derniere update HubSpot recue, analyse detaillee non chargee dans ce resume.",
        dueInDays: 1,
        priority: "medium",
      },
      analysisProvider: null,
      analysisModel: null,
      errorMessage: run.error_message,
      receivedAt: run.updated_at,
      scheduledFor: run.scheduled_for ?? run.updated_at,
      processedAt: run.finished_at ?? run.started_at,
    };
  });
};

export const loadHubSpotDashboard = async (input: {
  orgId: string;
  preferredHubSpotOwnerId?: string | null;
  live?: boolean;
}): Promise<HubSpotQueueDashboardData> => {
  const supabase = getSupabaseAdmin();
  const [prospectsResult, usersResult, syncStatus] = await Promise.all([
    supabase
      .from("prospects")
      .select("id, owner_user_id, hubspot_deal_id, name, email, company, title, deal_stage, deal_amount, close_probability, last_contact_at, synced_at, raw_data")
      .eq("org_id", input.orgId)
      .contains("raw_data", { source: "hubspot" })
      .range(0, 4999),
    supabase.from("users").select("id, hubspot_owner_id").eq("org_id", input.orgId),
    getHubSpotSyncStatus(input.orgId).catch(() => null),
  ]);

  if (prospectsResult.error) {
    throw new Error(`Impossible de charger les prospects dashboard: ${prospectsResult.error.message}`);
  }

  if (usersResult.error) {
    throw new Error(`Impossible de charger les users dashboard: ${usersResult.error.message}`);
  }

  const prospects = (prospectsResult.data ?? []) as ProspectRow[];
  const users = (usersResult.data ?? []) as UserRow[];
  const ownerUserIdByHubSpotId = new Map(
    users
      .filter((user) => user.hubspot_owner_id)
      .map((user) => [user.hubspot_owner_id as string, user.id]),
  );
  const prospectMetricsByOwner = new Map<string, { prospectCount: number; dealIds: Set<string>; lastSyncedAt: string | null }>();

  for (const prospect of prospects) {
    const ownerId = getRawString(prospect.raw_data, "hubspotOwnerId");

    if (!ownerId) {
      continue;
    }

    const metrics = prospectMetricsByOwner.get(ownerId) ?? {
      prospectCount: 0,
      dealIds: new Set<string>(),
      lastSyncedAt: null,
    };
    metrics.prospectCount += 1;

    if (prospect.hubspot_deal_id) {
      metrics.dealIds.add(prospect.hubspot_deal_id);
    }

    if (!metrics.lastSyncedAt || new Date(prospect.synced_at).getTime() > new Date(metrics.lastSyncedAt).getTime()) {
      metrics.lastSyncedAt = prospect.synced_at;
    }

    prospectMetricsByOwner.set(ownerId, metrics);
  }

  let accessToken: string | null = null;
  let hubspotPortalId: string | null = null;
  let hubspotDealCount: number | null = null;
  let owners: HubSpotOwnerOptionData[] = [];

  try {
    accessToken = await getHubSpotAccessToken(input.orgId);
    const [tokenInfo, hubspotOwners] = await Promise.all([
      hubSpotService.fetchTokenInfo(accessToken).catch(() => null),
      hubSpotService.fetchOwners(accessToken),
    ]);
    hubspotPortalId = tokenInfo?.hub_id ? String(tokenInfo.hub_id) : null;
    owners = hubspotOwners
      .filter((owner) => !owner.archived)
      .filter((owner) => isSalesAeOwner(owner.teams))
      .map((owner) => {
        const metrics = prospectMetricsByOwner.get(owner.id);
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
          teamName: getTeamName(owner.teams),
          prospectCount: metrics?.prospectCount ?? 0,
          syncedDealCount: metrics?.dealIds.size ?? 0,
          lastSyncedAt: metrics?.lastSyncedAt ?? null,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, "fr"));

    if (input.live !== false) {
      hubspotDealCount = await hubSpotService.fetchDealCount(accessToken).catch(() => null);
    }
  } catch {
    accessToken = null;
  }

  if (owners.length === 0) {
    owners = Array.from(prospectMetricsByOwner.entries()).map(([ownerId, metrics]) => ({
      ownerId,
      hubspotUserId: null,
      name: `Owner ${ownerId}`,
      email: "",
      teamName: null,
      prospectCount: metrics.prospectCount,
      syncedDealCount: metrics.dealIds.size,
      lastSyncedAt: metrics.lastSyncedAt,
    }));
  }

  const owner =
    owners.find((candidate) => candidate.ownerId === input.preferredHubSpotOwnerId) ??
    owners.find((candidate) => candidate.prospectCount > 0 || candidate.syncedDealCount > 0) ??
    owners[0];

  if (!owner) {
    throw new Error("Aucun owner HubSpot exploitable.");
  }

  const ownerUserId = ownerUserIdByHubSpotId.get(owner.ownerId) ?? null;
  const ownerProspects = prospects
    .filter((prospect) =>
      ownerUserId ? prospect.owner_user_id === ownerUserId : getRawString(prospect.raw_data, "hubspotOwnerId") === owner.ownerId,
    )
    .map(mapProspect)
    .sort((left, right) => {
      const priorityOrder = { urgent: 0, important: 1, routine: 2 };

      return priorityOrder[left.priority] - priorityOrder[right.priority] || (right.dealAmount ?? 0) - (left.dealAmount ?? 0);
    });

  const lastSyncedAt = prospects.reduce<string | null>((latest, prospect) => {
    if (!latest) {
      return prospect.synced_at;
    }

    return new Date(prospect.synced_at).getTime() > new Date(latest).getTime() ? prospect.synced_at : latest;
  }, null);
  const [lastUpdates] = await Promise.all([loadLastUpdates(input.orgId, 12)]);
  const status: HubSpotConnectionStatusData = {
    orgId: input.orgId,
    connected: Boolean(accessToken),
    hubspotPortalId,
    prospectCount: prospects.length,
    syncedDealCount: new Set(prospects.map((prospect) => prospect.hubspot_deal_id).filter(Boolean)).size,
    hubspotDealCount,
    lastSyncedAt,
    syncStatus,
  };

  return {
    orgId: input.orgId,
    hubspotOwnerId: owner.ownerId,
    hubspotDealCount,
    prospects: ownerProspects,
    status,
    owner,
    owners,
    lastUpdates,
  };
};
