import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import { env } from "../config/env.js";
import { getSupabaseAdmin } from "../db/client.js";
import { processHubSpotRealtimeJob } from "../services/hubspot-activity.service.js";
import { startHubSpotRealtimeWorker } from "../services/hubspot-realtime-queue.service.js";
import { acceptHubSpotWebhookBatch, type AcceptedHubSpotWebhookBatch } from "../services/hubspot-webhook.service.js";
import {
  acceptNormalizedSalesActivityEvent,
  parseNormalizedSalesActivityEvent,
  type AcceptedSalesActivityEvent,
} from "../services/task-planning.service.js";

type RawBodyRequest = FastifyRequest & {
  rawBody?: string;
};

type HubSpotWebhookStatusQuery = {
  orgId?: string;
};

type HubSpotWebhookStatus = {
  orgId: string;
  lastEvent: {
    id: string;
    subscriptionType: string;
    objectTypeId: string | null;
    objectId: string | null;
    processingStatus: string;
    occurredAt: string | null;
    createdAt: string;
  } | null;
  lastError: {
    id: string;
    errorMessage: string | null;
    createdAt: string;
  } | null;
  queuedEventCount: number;
  queuedAnalysisCount: number;
  analysisQueueLagSeconds: number | null;
  projectionLagSeconds: number | null;
  lastNormalizedEvent: {
    id: string;
    eventType: string;
    source: string;
    occurredAt: string;
    createdAt: string;
  } | null;
  failedProjectionCount: number;
  deadLetterCount: number;
  redisMode: "redis" | "memory";
  lastAnalysisRun: {
    id: string;
    hubspotDealId: string;
    status: string;
    scheduledFor: string;
    startedAt: string | null;
    finishedAt: string | null;
    errorMessage: string | null;
  } | null;
};

type HubSpotWebhookEventStatusRow = {
  id: string;
  subscription_type: string;
  object_type_id: string | null;
  object_id: string | null;
  processing_status: string;
  occurred_at: string | null;
  created_at: string;
  error_message?: string | null;
};

type HubSpotRealtimeAnalysisRunStatusRow = {
  id: string;
  hubspot_deal_id: string;
  status: string;
  scheduled_for: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
};

type ActivityEventStatusRow = {
  id: string;
  event_type: string;
  source: string;
  occurred_at: string;
  created_at: string;
};

const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidOrgId = (value: string | undefined): value is string =>
  typeof value === "string" && UUID_V4_LIKE_PATTERN.test(value.trim());

const getHeaderValue = (value: string | string[] | undefined): string | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;

const isWebhookInputError = (message: string): boolean =>
  message.includes("obligatoire") ||
  message.includes("valide") ||
  message.includes("supporte") ||
  message.includes("body doit etre");

const buildPublicRequestUri = (request: FastifyRequest): string => {
  if (env.apiPublicUrl) {
    return `${env.apiPublicUrl.replace(/\/+$/, "")}${request.url}`;
  }

  const forwardedProto = getHeaderValue(request.headers["x-forwarded-proto"]) ?? "https";
  const forwardedHost =
    getHeaderValue(request.headers["x-forwarded-host"]) ?? getHeaderValue(request.headers.host) ?? request.hostname;

  return `${forwardedProto}://${forwardedHost}${request.url}`;
};

const mapLastEvent = (row: HubSpotWebhookEventStatusRow | null): HubSpotWebhookStatus["lastEvent"] =>
  row
    ? {
        id: row.id,
        subscriptionType: row.subscription_type,
        objectTypeId: row.object_type_id,
        objectId: row.object_id,
        processingStatus: row.processing_status,
        occurredAt: row.occurred_at,
        createdAt: row.created_at,
      }
    : null;

const mapLastError = (row: HubSpotWebhookEventStatusRow | null): HubSpotWebhookStatus["lastError"] =>
  row
    ? {
        id: row.id,
        errorMessage: row.error_message ?? null,
        createdAt: row.created_at,
      }
    : null;

const mapAnalysisRun = (
  row: HubSpotRealtimeAnalysisRunStatusRow | null,
): HubSpotWebhookStatus["lastAnalysisRun"] =>
  row
    ? {
        id: row.id,
        hubspotDealId: row.hubspot_deal_id,
        status: row.status,
        scheduledFor: row.scheduled_for,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        errorMessage: row.error_message,
    }
    : null;

const mapLastNormalizedEvent = (row: ActivityEventStatusRow | null): HubSpotWebhookStatus["lastNormalizedEvent"] =>
  row
    ? {
        id: row.id,
        eventType: row.event_type,
        source: row.source,
        occurredAt: row.occurred_at,
        createdAt: row.created_at,
      }
    : null;

const getLagSeconds = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();

  return Number.isNaN(timestamp) ? null : Math.max(0, Math.round((Date.now() - timestamp) / 1000));
};

export const registerHubSpotWebhookRoutes = async (app: FastifyInstance): Promise<void> => {
  startHubSpotRealtimeWorker(processHubSpotRealtimeJob, app.log);

  app.post<{ Body: unknown; Reply: ApiResponse<AcceptedSalesActivityEvent> }>(
    "/api/webhooks/events",
    async (request, reply) => {
      try {
        const input = parseNormalizedSalesActivityEvent(request.body);
        const result = await acceptNormalizedSalesActivityEvent(input);

        request.log.info(
          {
            eventId: result.event.id,
            eventType: result.event.eventType,
            orgId: result.event.orgId,
            prospectId: result.event.prospectId,
            userId: result.event.userId,
            created: result.planning.created,
            updated: result.planning.updated,
            canceled: result.planning.canceled,
          },
          "Evenement commercial normalise accepte.",
        );

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erreur inconnue pendant le webhook evenement.";
        const statusCode = isWebhookInputError(message) ? 400 : 500;

        request.log.error({ error }, "Webhook evenement commercial refuse.");

        return reply.code(statusCode).send({
          success: false,
          error: message,
        });
      }
    },
  );

  app.post<{ Reply: ApiResponse<AcceptedHubSpotWebhookBatch> }>(
    "/api/webhooks/hubspot",
    async (request, reply) => {
      try {
        const rawBody = (request as RawBodyRequest).rawBody;

        if (typeof rawBody !== "string") {
          return reply.code(400).send({
            success: false,
            error: "Raw body indisponible pour valider la signature HubSpot.",
          });
        }

        const result = await acceptHubSpotWebhookBatch({
          headers: request.headers,
          method: request.method,
          requestUri: buildPublicRequestUri(request),
          rawBody,
          parsedBody: request.body,
        });

        request.log.info(
          {
            accepted: result.accepted,
            duplicate: result.duplicate,
            ignored: result.ignored,
            requestUri: buildPublicRequestUri(request),
          },
          "Webhook HubSpot accepte.",
        );

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erreur inconnue pendant le webhook HubSpot.";
        const statusCode = message.includes("Signature HubSpot invalide") ? 401 : 500;

        request.log.error({ error }, "Webhook HubSpot refuse.");

        return reply.code(statusCode).send({
          success: false,
          error: message,
        });
      }
    },
  );

  app.get<{
    Querystring: HubSpotWebhookStatusQuery;
    Reply: ApiResponse<HubSpotWebhookStatus>;
  }>("/api/hubspot/webhooks/status", async (request, reply) => {
    const orgId = request.query.orgId;

    if (!isValidOrgId(orgId)) {
      return reply.code(400).send({
        success: false,
        error: "Le parametre orgId doit etre un UUID Jarvis valide.",
      });
    }

    try {
      const supabase = getSupabaseAdmin();
      const [
        lastEventResult,
        lastErrorResult,
        queuedEventsResult,
        failedEventsResult,
        queuedAnalysisResult,
        nextAnalysisResult,
        lastAnalysisResult,
        lastNormalizedEventResult,
      ] = await Promise.all([
        supabase
          .from("hubspot_webhook_events")
          .select("id, subscription_type, object_type_id, object_id, processing_status, occurred_at, created_at")
          .eq("org_id", orgId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("hubspot_webhook_events")
          .select("id, error_message, created_at, subscription_type, object_type_id, object_id, processing_status, occurred_at")
          .eq("org_id", orgId)
          .eq("processing_status", "failed")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("hubspot_webhook_events")
          .select("*", { count: "exact", head: true })
          .eq("org_id", orgId)
          .in("processing_status", ["queued", "processing"]),
        supabase
          .from("hubspot_webhook_events")
          .select("*", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("processing_status", "failed"),
        supabase
          .from("hubspot_realtime_analysis_runs")
          .select("*", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("status", "queued"),
        supabase
          .from("hubspot_realtime_analysis_runs")
          .select("scheduled_for")
          .eq("org_id", orgId)
          .eq("status", "queued")
          .order("scheduled_for", { ascending: true })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("hubspot_realtime_analysis_runs")
          .select("id, hubspot_deal_id, status, scheduled_for, started_at, finished_at, error_message")
          .eq("org_id", orgId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("activity_events")
          .select("id, event_type, source, occurred_at, created_at")
          .eq("org_id", orgId)
          .in("source", ["hubspot_webhook", "hubspot_activity"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const firstError =
        lastEventResult.error ??
        lastErrorResult.error ??
        queuedEventsResult.error ??
        failedEventsResult.error ??
        queuedAnalysisResult.error ??
        nextAnalysisResult.error ??
        lastAnalysisResult.error ??
        lastNormalizedEventResult.error;

      if (firstError) {
        throw new Error(firstError.message);
      }

      const nextScheduledFor = (nextAnalysisResult.data as { scheduled_for: string } | null)?.scheduled_for ?? null;
      const analysisQueueLagSeconds = nextScheduledFor
        ? Math.max(0, Math.round((Date.now() - new Date(nextScheduledFor).getTime()) / 1000))
        : null;

      return reply.send({
        success: true,
        data: {
          orgId,
          lastEvent: mapLastEvent(lastEventResult.data as HubSpotWebhookEventStatusRow | null),
          lastError: mapLastError(lastErrorResult.data as HubSpotWebhookEventStatusRow | null),
          queuedEventCount: queuedEventsResult.count ?? 0,
          queuedAnalysisCount: queuedAnalysisResult.count ?? 0,
          analysisQueueLagSeconds,
          projectionLagSeconds: getLagSeconds(
            (lastEventResult.data as HubSpotWebhookEventStatusRow | null)?.occurred_at ??
              (lastEventResult.data as HubSpotWebhookEventStatusRow | null)?.created_at,
          ),
          lastNormalizedEvent: mapLastNormalizedEvent(lastNormalizedEventResult.data as ActivityEventStatusRow | null),
          failedProjectionCount: failedEventsResult.count ?? 0,
          deadLetterCount: failedEventsResult.count ?? 0,
          redisMode: env.redisUrl ? "redis" : "memory",
          lastAnalysisRun: mapAnalysisRun(lastAnalysisResult.data as HubSpotRealtimeAnalysisRunStatusRow | null),
        },
      });
    } catch (error) {
      request.log.error({ error, orgId }, "Impossible de charger le statut des webhooks HubSpot.");

      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Erreur inconnue pendant le statut webhook HubSpot.",
      });
    }
  });
};
