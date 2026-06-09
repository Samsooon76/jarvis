import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiResponse, PulseNotificationList, PulsePreferences } from "@jarvis/shared";
import { loadAuthenticatedAppUserProfile, type AppUserProfile } from "../services/app-auth.service.js";
import {
  getPulsePreferences,
  listPulseNotifications,
  markAllPulseNotificationsRead,
  markPulseNotificationRead,
  parsePulsePreferencesInput,
  updatePulsePreferences,
  type PulseRecipientProfile,
} from "../services/pulse.service.js";

type ListPulseNotificationsQuery = {
  unreadOnly?: string;
  limit?: string;
  offset?: string;
};

type PulseNotificationParams = {
  notificationId: string;
};

const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const parsePositiveInteger = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

// Jarvis Pulse est reserve aux admins/managers: un profil sales recoit un 403.
const resolvePulseRecipient = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<PulseRecipientProfile | null> => {
  let profile: AppUserProfile;

  try {
    profile = await loadAuthenticatedAppUserProfile(request);
  } catch (error) {
    void reply.code(401).send({
      success: false,
      error: error instanceof Error ? error.message : "Authentification requise.",
    });
    return null;
  }

  if (profile.role !== "admin" && profile.role !== "manager") {
    void reply.code(403).send({
      success: false,
      error: "Jarvis Pulse est reserve aux administrateurs et managers.",
    });
    return null;
  }

  if (!profile.id || !profile.orgId) {
    void reply.code(403).send({
      success: false,
      error: "Profil Jarvis incomplet: organisation requise pour Jarvis Pulse.",
    });
    return null;
  }

  return {
    userId: profile.id,
    orgId: profile.orgId,
  };
};

export const registerPulseRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Querystring: ListPulseNotificationsQuery; Reply: ApiResponse<PulseNotificationList> }>(
    "/api/pulse/notifications",
    async (request, reply) => {
      const recipient = await resolvePulseRecipient(request, reply);

      if (!recipient) {
        return reply;
      }

      try {
        const result = await listPulseNotifications(recipient, {
          unreadOnly: request.query.unreadOnly === "true",
          limit: parsePositiveInteger(request.query.limit),
          offset: parsePositiveInteger(request.query.offset),
        });

        return reply.send({ success: true, data: result });
      } catch (error) {
        request.log.error({ error }, "Impossible de charger les notifications Jarvis Pulse.");

        return reply.code(500).send({
          success: false,
          error: "Impossible de charger les notifications Jarvis Pulse.",
        });
      }
    },
  );

  app.post<{ Params: PulseNotificationParams; Reply: ApiResponse<{ id: string }> }>(
    "/api/pulse/notifications/:notificationId/read",
    async (request, reply) => {
      const recipient = await resolvePulseRecipient(request, reply);

      if (!recipient) {
        return reply;
      }

      const notificationId = request.params.notificationId;

      if (!UUID_V4_LIKE_PATTERN.test(notificationId)) {
        return reply.code(400).send({
          success: false,
          error: "L'identifiant de notification Jarvis Pulse est invalide.",
        });
      }

      try {
        await markPulseNotificationRead(recipient, notificationId);

        return reply.send({ success: true, data: { id: notificationId } });
      } catch (error) {
        request.log.error({ error, notificationId }, "Impossible de marquer la notification Jarvis Pulse.");

        return reply.code(500).send({
          success: false,
          error: "Impossible de marquer la notification Jarvis Pulse comme lue.",
        });
      }
    },
  );

  app.post<{ Reply: ApiResponse<{ done: boolean }> }>(
    "/api/pulse/notifications/read-all",
    async (request, reply) => {
      const recipient = await resolvePulseRecipient(request, reply);

      if (!recipient) {
        return reply;
      }

      try {
        await markAllPulseNotificationsRead(recipient);

        return reply.send({ success: true, data: { done: true } });
      } catch (error) {
        request.log.error({ error }, "Impossible de marquer les notifications Jarvis Pulse.");

        return reply.code(500).send({
          success: false,
          error: "Impossible de marquer les notifications Jarvis Pulse comme lues.",
        });
      }
    },
  );

  app.get<{ Reply: ApiResponse<PulsePreferences> }>("/api/pulse/preferences", async (request, reply) => {
    const recipient = await resolvePulseRecipient(request, reply);

    if (!recipient) {
      return reply;
    }

    try {
      const preferences = await getPulsePreferences(recipient);

      return reply.send({ success: true, data: preferences });
    } catch (error) {
      request.log.error({ error }, "Impossible de charger les preferences Jarvis Pulse.");

      return reply.code(500).send({
        success: false,
        error: "Impossible de charger les preferences Jarvis Pulse.",
      });
    }
  });

  app.put<{ Body: unknown; Reply: ApiResponse<PulsePreferences> }>(
    "/api/pulse/preferences",
    async (request, reply) => {
      const recipient = await resolvePulseRecipient(request, reply);

      if (!recipient) {
        return reply;
      }

      const preferences = parsePulsePreferencesInput(request.body);

      if (!preferences) {
        return reply.code(400).send({
          success: false,
          error: "Les preferences Jarvis Pulse sont invalides.",
        });
      }

      try {
        const saved = await updatePulsePreferences(recipient, preferences);

        return reply.send({ success: true, data: saved });
      } catch (error) {
        request.log.error({ error }, "Impossible d'enregistrer les preferences Jarvis Pulse.");

        return reply.code(500).send({
          success: false,
          error: "Impossible d'enregistrer les preferences Jarvis Pulse.",
        });
      }
    },
  );
};
