import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { env } from "./config/env.js";
import { getSupabaseAdmin } from "./db/client.js";
import { getErrorMessage, getErrorStatusCode } from "./lib/errors.js";
import { registerSentryErrorHandler, setRequestSentryUser } from "./lib/sentry.js";
import { registerRoutes } from "./routes/index.js";
import { loadAuthContext } from "./services/app-auth.service.js";
import { isJarvisMcpToken, resolveOrganizationMcpKey, touchOrganizationMcpKey } from "./services/mcp-key.service.js";

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const extractRequestedOrgId = (request: FastifyRequest): string | null => {
  const queryOrgId = asRecord(request.query).orgId;
  const bodyOrgId = asRecord(request.body).orgId;
  const paramsOrgId = asRecord(request.params).orgId;
  const value = queryOrgId ?? bodyOrgId ?? paramsOrgId;

  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const registerRawJsonParser = (app: FastifyInstance): void => {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");

    (request as FastifyRequest & { rawBody: string }).rawBody = rawBody;

    try {
      done(null, rawBody ? JSON.parse(rawBody) as unknown : {});
    } catch (error) {
      done(error as Error, undefined);
    }
  });
};

const registerCorsHook = (app: FastifyInstance): void => {
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    const isAllowedOrigin =
      origin &&
      env.allowedCorsOrigins.some((allowedOrigin) =>
        allowedOrigin.endsWith("*") ? origin.startsWith(allowedOrigin.slice(0, -1)) : origin === allowedOrigin,
      );
    const allowedOrigin =
      origin && (env.nodeEnv !== "production" || isAllowedOrigin) ? origin : env.allowedCorsOrigins[0] ?? "";

    if (allowedOrigin) {
      reply.header("Access-Control-Allow-Origin", allowedOrigin);
    }

    reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    reply.header("Vary", "Origin");

    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });
};

const routePath = (url: string): string => url.split("?")[0] ?? url;

const isPublicDebugRoute = (path: string): boolean =>
  path === "/api/debug/deal-prompt-parser" ||
  path === "/api/debug/parse-deal-prompt" ||
  path.startsWith("/api/debug/deal-light-prompt/");

const isPublicRoute = (url: string): boolean => {
  const path = routePath(url);

  if (path === "/health" || path.startsWith("/api/auth/hubspot/") || path.startsWith("/api/webhooks/")) {
    return true;
  }

  // Outils temporaires de test prompt: accessibles sans bearer token.
  if (isPublicDebugRoute(path)) {
    return true;
  }

  return false;
};

const registerAuthHook = (app: FastifyInstance): void => {
  app.addHook("preHandler", async (request, reply) => {
    setRequestSentryUser(null);

    if (!env.requireApiAuth || isPublicRoute(request.url)) {
      return;
    }

    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : null;

    if (!token) {
      request.log.warn({ path: request.url }, "Requete refusee sans bearer token.");
      return reply.code(401).send({
        success: false,
        error: "Authentification requise.",
      });
    }

    if (isJarvisMcpToken(token)) {
      const resolvedKey = await resolveOrganizationMcpKey(token);

      if (!resolvedKey) {
        request.log.warn({ path: request.url }, "Cle MCP Jarvis invalide ou revoquee.");
        return reply.code(401).send({
          success: false,
          error: "Cle MCP Jarvis invalide ou revoquee.",
        });
      }

      void touchOrganizationMcpKey(resolvedKey.keyId).catch((error: unknown) => {
        request.log.warn({ error, keyId: resolvedKey.keyId }, "Mise a jour last_used_at cle MCP ignoree.");
      });

      request.auth = {
        authUserId: `mcp-key:${resolvedKey.keyId}`,
        appUserId: resolvedKey.createdByUserId,
        orgId: resolvedKey.orgId,
        role: "admin",
        hubspotOwnerId: null,
        email: "mcp@jarvis.local",
      };

      setRequestSentryUser({
        id: request.auth.authUserId,
        orgId: resolvedKey.orgId,
        role: "admin",
      });

      return;
    }

    if (env.mcpServiceToken && token === env.mcpServiceToken) {
      const requestedOrgId = extractRequestedOrgId(request) ?? (env.mcpServiceOrgId.trim() || null);

      if (!requestedOrgId) {
        request.log.warn({ path: request.url }, "Token MCP service refuse sans orgId.");
        return reply.code(400).send({
          success: false,
          error:
            "orgId est obligatoire avec le token MCP service. Passe orgId dans la requete ou configure JARVIS_MCP_SERVICE_ORG_ID.",
        });
      }

      request.auth = {
        authUserId: "jarvis-mcp-service",
        appUserId: env.mcpServiceUserId.trim() || null,
        orgId: requestedOrgId,
        role: "admin",
        hubspotOwnerId: null,
        email: "mcp@jarvis.local",
      };

      setRequestSentryUser({
        id: "jarvis-mcp-service",
        orgId: requestedOrgId,
        role: "admin",
      });

      return;
    }

    if (
      env.apiAuthToken &&
      token === env.apiAuthToken &&
      (env.nodeEnv === "development" || env.nodeEnv === "test")
    ) {
      return;
    }

    const { data, error } = await getSupabaseAdmin().auth.getUser(token);

    if (error || !data.user) {
      request.log.warn({ path: request.url }, "Requete refusee avec token invalide.");
      return reply.code(401).send({
        success: false,
        error: "Token applicatif invalide.",
      });
    }

    request.auth = await loadAuthContext(data.user);
    const requestedOrgId = extractRequestedOrgId(request);

    if (requestedOrgId && (!request.auth.orgId || request.auth.orgId !== requestedOrgId)) {
      request.log.warn(
        {
          authUserId: request.auth.authUserId,
          appUserId: request.auth.appUserId,
          authOrgId: request.auth.orgId,
          requestedOrgId,
          path: request.url,
        },
        "Requete cross-org refusee par le garde global.",
      );
      return reply.code(403).send({
        success: false,
        error: "Cette session n'a pas acces a cette organisation.",
      });
    }

    setRequestSentryUser({
      id: data.user.id,
      orgId: request.auth.orgId,
      role: request.auth.role,
    });
  });
};

export const buildServer = async (): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: true,
  });

  registerRawJsonParser(app);
  registerCorsHook(app);
  registerAuthHook(app);

  await registerRoutes(app);
  app.setErrorHandler((error, _request, reply) => {
    reply.code(getErrorStatusCode(error)).send({
      success: false,
      error: getErrorMessage(error, "Erreur inconnue."),
    });
  });
  registerSentryErrorHandler(app);

  return app;
};
