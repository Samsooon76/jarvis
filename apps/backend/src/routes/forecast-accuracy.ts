import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiResponse, ForecastAccuracyOverview, ForecastCalibrationBucket } from "@jarvis/shared";
import { loadAuthenticatedAppUserProfile, type AppUserProfile } from "../services/app-auth.service.js";
import { getAccuracyOverview, getCalibrationCurve, getRepAccuracy } from "../services/forecast-accuracy.service.js";
import { startForecastSnapshotScheduler } from "../services/forecast-snapshot.service.js";

type AccuracyQuery = {
  periodDays?: string;
};

type CalibrationQuery = AccuracyQuery & {
  source?: string;
};

type RepAccuracyParams = {
  userId: string;
};

const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const parsePeriodDays = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const resolveProfile = async (request: FastifyRequest, reply: FastifyReply): Promise<AppUserProfile | null> => {
  try {
    const profile = await loadAuthenticatedAppUserProfile(request);

    if (!profile.id || !profile.orgId) {
      void reply.code(403).send({
        success: false,
        error: "Profil Jarvis incomplet: organisation requise pour le suivi de fiabilite forecast.",
      });
      return null;
    }

    return profile;
  } catch (error) {
    void reply.code(401).send({
      success: false,
      error: error instanceof Error ? error.message : "Authentification requise.",
    });
    return null;
  }
};

const isManagerOrAdmin = (profile: AppUserProfile): boolean =>
  profile.role === "admin" || profile.role === "manager";

export const registerForecastAccuracyRoutes = async (app: FastifyInstance): Promise<void> => {
  // Demarre la capture quotidienne des snapshots (BullMQ repeatable, ou timer en dev).
  startForecastSnapshotScheduler(app.log);

  app.get<{ Querystring: AccuracyQuery; Reply: ApiResponse<ForecastAccuracyOverview> }>(
    "/api/forecast-accuracy/overview",
    async (request, reply) => {
      const profile = await resolveProfile(request, reply);

      if (!profile) {
        return reply;
      }

      if (!isManagerOrAdmin(profile)) {
        return reply.code(403).send({
          success: false,
          error: "La fiabilite forecast est reservee aux administrateurs et managers.",
        });
      }

      try {
        const overview = await getAccuracyOverview(profile.orgId as string, parsePeriodDays(request.query.periodDays));

        return reply.send({ success: true, data: overview });
      } catch (error) {
        request.log.error({ error }, "Impossible de calculer la fiabilite forecast.");

        return reply.code(500).send({
          success: false,
          error: "Impossible de calculer la fiabilite forecast.",
        });
      }
    },
  );

  app.get<{ Params: RepAccuracyParams; Querystring: AccuracyQuery; Reply: ApiResponse<ForecastAccuracyOverview> }>(
    "/api/forecast-accuracy/rep/:userId",
    async (request, reply) => {
      const profile = await resolveProfile(request, reply);

      if (!profile) {
        return reply;
      }

      if (!UUID_V4_LIKE_PATTERN.test(request.params.userId)) {
        return reply.code(400).send({
          success: false,
          error: "L'identifiant du commercial est invalide.",
        });
      }

      // Vue rep: managers/admins, ou le sales lui-meme sur son propre profil.
      if (!isManagerOrAdmin(profile) && profile.id !== request.params.userId) {
        return reply.code(403).send({
          success: false,
          error: "Vous ne pouvez consulter que votre propre fiabilite forecast.",
        });
      }

      try {
        const accuracy = await getRepAccuracy(
          profile.orgId as string,
          request.params.userId,
          parsePeriodDays(request.query.periodDays),
        );

        return reply.send({ success: true, data: accuracy });
      } catch (error) {
        request.log.error({ error, targetUserId: request.params.userId }, "Impossible de calculer la fiabilite du commercial.");

        return reply.code(500).send({
          success: false,
          error: "Impossible de calculer la fiabilite forecast du commercial.",
        });
      }
    },
  );

  app.get<{ Querystring: CalibrationQuery; Reply: ApiResponse<ForecastCalibrationBucket[]> }>(
    "/api/forecast-accuracy/calibration",
    async (request, reply) => {
      const profile = await resolveProfile(request, reply);

      if (!profile) {
        return reply;
      }

      if (!isManagerOrAdmin(profile)) {
        return reply.code(403).send({
          success: false,
          error: "La fiabilite forecast est reservee aux administrateurs et managers.",
        });
      }

      const source = request.query.source ?? "crm";

      if (source !== "crm" && source !== "ai") {
        return reply.code(400).send({
          success: false,
          error: "La source de calibration est invalide (crm ou ai).",
        });
      }

      try {
        const curve = await getCalibrationCurve(profile.orgId as string, source, parsePeriodDays(request.query.periodDays));

        return reply.send({ success: true, data: curve });
      } catch (error) {
        request.log.error({ error }, "Impossible de calculer la calibration forecast.");

        return reply.code(500).send({
          success: false,
          error: "Impossible de calculer la calibration forecast.",
        });
      }
    },
  );
};
