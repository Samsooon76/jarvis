import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { env } from "./config/env.js";
import { getSupabaseAdmin } from "./db/client.js";
import { registerSentryErrorHandler, setRequestSentryUser } from "./lib/sentry.js";
import { registerRoutes } from "./routes/index.js";

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

    reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    reply.header("Vary", "Origin");

    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });
};

const isPublicRoute = (url: string): boolean =>
  url === "/health" ||
  url.startsWith("/api/auth/hubspot/") ||
  url.startsWith("/api/webhooks/");

const registerAuthHook = (app: FastifyInstance): void => {
  app.addHook("preHandler", async (request, reply) => {
    setRequestSentryUser(null);

    if (!env.requireApiAuth || isPublicRoute(request.url)) {
      return;
    }

    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : null;

    if (!token) {
      return reply.code(401).send({
        success: false,
        error: "Authentification requise.",
      });
    }

    if (env.apiAuthToken && token === env.apiAuthToken) {
      return;
    }

    const { data, error } = await getSupabaseAdmin().auth.getUser(token);

    if (error || !data.user) {
      return reply.code(401).send({
        success: false,
        error: "Token applicatif invalide.",
      });
    }

    setRequestSentryUser({
      id: data.user.id,
      orgId: typeof data.user.app_metadata.org_id === "string" ? data.user.app_metadata.org_id : null,
      role: typeof data.user.app_metadata.role === "string" ? data.user.app_metadata.role : null,
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
  registerSentryErrorHandler(app);

  return app;
};
