import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import { getSupabaseAdmin } from "../../db/client.js";
import { hubSpotService } from "../../services/hubspot.service.js";
import { getHubSpotAccessToken } from "../../services/hubspot-auth.service.js";
import { formatDurationMs, getNowMs } from "../../lib/format.js";
import { formatOperationError, getPublicErrorMessage, isValidOrgId } from "./helpers.js";
import {
  getDisplayTeamName,
  getProspectOwnerHubSpotId,
  isOpenDeal,
  isSalesAeOwner,
  loadSalesAeOwnerIds,
  mapLiveOwnerProspect,
  mapOwnerProspects,
  mapProspectRowToOwnerProspect,
  parseLastUpdateNextAction,
  parseLastUpdatesLimit,
  type DealActivityPlanAnalysisRow,
  type HubSpotCompanySummaryRow,
  type HubSpotDealSummaryRow,
  type HubSpotLastUpdateItem,
  type HubSpotLastUpdatesPayload,
  type HubSpotLastUpdatesQuery,
  type HubSpotOwnerOption,
  type HubSpotOwnerProspectsPayload,
  type HubSpotOwnerProspectsQuery,
  type HubSpotOwnerUserRow,
  type HubSpotOwnersQuery,
  type HubSpotProspectRow,
  type HubSpotRealtimeAnalysisRunListRow,
} from "./owners.helpers.js";

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
