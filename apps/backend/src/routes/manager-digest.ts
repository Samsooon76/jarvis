import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiResponse, ManagerDigest, ManagerDigestHistoryEntry, ManagerDigestPeriod } from "@jarvis/shared";
import {
  loadAuthenticatedAppUserProfile,
  requireAuth,
  type AppUserProfile,
} from "../services/app-auth.service.js";
import {
  getOrCreateManagerDigest,
  listManagerDigestHistory,
  type ManagerDigestRecipient,
} from "../services/manager-digest.service.js";

type GetDigestQuery = {
  period?: string;
};

type GetDigestHistoryQuery = {
  limit?: string;
};

const parseDigestPeriod = (value: string | undefined): ManagerDigestPeriod | null => {
  if (value === undefined || value === "daily") {
    return "daily";
  }

  return value === "weekly" ? "weekly" : null;
};

const parsePositiveInteger = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const resolveDigestRecipientFromServiceAuth = (request: FastifyRequest): ManagerDigestRecipient | null => {
  const auth = requireAuth(request);

  if (auth.authUserId !== "jarvis-mcp-service" || !auth.orgId) {
    return null;
  }

  if (auth.role !== "admin" && auth.role !== "manager") {
    return null;
  }

  return {
    userId: auth.appUserId ?? "jarvis-mcp-service",
    orgId: auth.orgId,
    role: auth.role,
  };
};

// Le digest est reserve aux admins/managers, comme Jarvis Pulse.
const resolveDigestRecipient = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<ManagerDigestRecipient | null> => {
  const serviceRecipient = resolveDigestRecipientFromServiceAuth(request);

  if (serviceRecipient) {
    return serviceRecipient;
  }

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
      error: "Le digest manager est reserve aux administrateurs et managers.",
    });
    return null;
  }

  if (!profile.id || !profile.orgId) {
    void reply.code(403).send({
      success: false,
      error: "Profil Jarvis incomplet: organisation requise pour le digest manager.",
    });
    return null;
  }

  return {
    userId: profile.id,
    orgId: profile.orgId,
    role: profile.role,
  };
};

export const registerManagerDigestRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Querystring: GetDigestQuery; Reply: ApiResponse<ManagerDigest> }>(
    "/api/digest",
    async (request, reply) => {
      const recipient = await resolveDigestRecipient(request, reply);

      if (!recipient) {
        return reply;
      }

      const period = parseDigestPeriod(request.query.period);

      if (!period) {
        return reply.code(400).send({
          success: false,
          error: "La periode du digest est invalide (daily ou weekly).",
        });
      }

      try {
        const digest = await getOrCreateManagerDigest(recipient, period);

        return reply.send({ success: true, data: digest });
      } catch (error) {
        request.log.error({ error, period }, "Impossible de generer le digest manager.");

        return reply.code(500).send({
          success: false,
          error: "Impossible de generer le digest manager.",
        });
      }
    },
  );

  app.get<{ Querystring: GetDigestHistoryQuery; Reply: ApiResponse<ManagerDigestHistoryEntry[]> }>(
    "/api/digest/history",
    async (request, reply) => {
      const recipient = await resolveDigestRecipient(request, reply);

      if (!recipient) {
        return reply;
      }

      try {
        const history = await listManagerDigestHistory(recipient, parsePositiveInteger(request.query.limit));

        return reply.send({ success: true, data: history });
      } catch (error) {
        request.log.error({ error }, "Impossible de charger l'historique des digests manager.");

        return reply.code(500).send({
          success: false,
          error: "Impossible de charger l'historique des digests manager.",
        });
      }
    },
  );
};
