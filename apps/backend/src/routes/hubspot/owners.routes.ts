import type { FastifyInstance } from "fastify";
import type { ApiResponse, ProspectPriority } from "@jarvis/shared";
import { getSupabaseAdmin } from "../../db/client.js";
import { hubSpotService, type DealLifecycleStatus } from "../../services/hubspot.service.js";
import { getHubSpotAccessToken } from "../../services/hubspot-auth.service.js";
import { scoreProspect } from "../../services/scoring.service.js";
import { formatDurationMs, getNowMs } from "../../lib/format.js";
import { formatOperationError, getPublicErrorMessage, isValidOrgId } from "./helpers.js";

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

type HubSpotOwnerSummary = {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  archived?: boolean;
  teams?: HubSpotOwnerTeam[];
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
  nextAction: string;
  reason: string;
  priority: ProspectPriority;
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

type HubSpotLastUpdatesPayload = {
  orgId: string;
  updates: HubSpotLastUpdateItem[];
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
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type DealActivityPlanAnalysisRow = {
  hubspot_deal_id: string;
  provider: string;
  model: string;
  analysis: unknown;
  generated_at: string;
};

type HubSpotDealSummaryRow = {
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

type HubSpotCompanySummaryRow = {
  hubspot_company_id: string;
  name: string | null;
};

type SalesAeOwnerCacheEntry = {
  expiresAt: number;
  ownerIds: Set<string>;
};

const parseLastUpdatesLimit = (value: string | undefined): number => {
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

const parseLastUpdateNextAction = (
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

const SALES_AE_TEAM_NAME = "sales ae";
const SALES_AE_LAST_UPDATE_OWNER_NAMES = new Set(["hugo samson", "samy sahel", "samantha brebant", "sofiane larbi"]);
const salesAeOwnerCache = new Map<string, SalesAeOwnerCacheEntry>();
const SALES_AE_OWNER_CACHE_TTL_MS = 5 * 60 * 1000;

const getDisplayTeamName = (teams: HubSpotOwnerTeam[] | undefined): string | null =>
  teams?.find((team) => team.primary)?.name ?? teams?.[0]?.name ?? null;

const isSalesAeOwner = (teams: HubSpotOwnerTeam[] | undefined): boolean =>
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

const isOpenDeal = (deal: Pick<HubSpotDealSummaryRow, "deal_lifecycle_status" | "is_closed_deal">): boolean =>
  deal.deal_lifecycle_status === "pending" || (deal.deal_lifecycle_status === null && deal.is_closed_deal !== true);

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
      .filter(isTargetSalesAeLastUpdateOwner)
      .map((owner) => owner.id),
  );

  salesAeOwnerCache.set(orgId, {
    expiresAt: Date.now() + SALES_AE_OWNER_CACHE_TTL_MS,
    ownerIds,
  });

  return ownerIds;
};

const mapOwnerProspects = (
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

const mapProspectRowToOwnerProspect = (prospect: HubSpotProspectRow): HubSpotOwnerProspect => {
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

export const registerHubSpotOwnersRoutes = async (app: FastifyInstance): Promise<void> => {
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
            "id, org_id, hubspot_deal_id, status, reason, scheduled_for, started_at, finished_at, trigger_event_ids, error_message, created_at, updated_at",
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
                .select(
                  "hubspot_deal_id, hubspot_owner_id, primary_company_id, deal_name, amount, deal_stage, deal_stage_label, deal_lifecycle_status, is_closed_deal",
                )
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

            return Boolean(deal?.hubspot_owner_id && salesAeOwnerIds.has(deal.hubspot_owner_id) && isOpenDeal(deal));
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
        const { data: activityPlanData, error: activityPlanError } =
          dealIds.length > 0
            ? await supabase
                .from("deal_ai_analyses")
                .select("hubspot_deal_id, provider, model, analysis, generated_at")
                .eq("org_id", orgId)
                .eq("analysis_type", "deal_activity_plan")
                .in("hubspot_deal_id", dealIds)
                .order("generated_at", { ascending: false })
            : { data: [], error: null };

        if (activityPlanError) {
          throw new Error(formatOperationError("Impossible de charger les next actions IA", activityPlanError.message));
        }

        const activityPlanByDealId = new Map<string, DealActivityPlanAnalysisRow>();

        for (const analysis of (activityPlanData ?? []) as DealActivityPlanAnalysisRow[]) {
          if (!activityPlanByDealId.has(analysis.hubspot_deal_id)) {
            activityPlanByDealId.set(analysis.hubspot_deal_id, analysis);
          }
        }

        const updates: HubSpotLastUpdateItem[] = uniqueRuns.map((run) => {
          const deal = dealById.get(run.hubspot_deal_id) ?? null;
          const company = deal?.primary_company_id ? companyById.get(deal.primary_company_id) ?? null : null;
          const activityPlan = activityPlanByDealId.get(run.hubspot_deal_id) ?? null;

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
            nextAction: parseLastUpdateNextAction(activityPlan?.analysis ?? null),
            analysisProvider: activityPlan?.provider ?? null,
            analysisModel: activityPlan?.model ?? null,
            errorMessage: run.error_message,
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
};
