import Fastify, { type FastifyRequest } from "fastify";
import { env } from "./config/env.js";
import { registerCloseLostAnalysisRoutes } from "./routes/close-lost-analysis.js";
import { registerForecastRoutes } from "./routes/forecast.js";
import { registerHubSpotRoutes } from "./routes/hubspot.js";
import { registerHubSpotWebhookRoutes } from "./routes/webhooks.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerLlmRoutes } from "./routes/llm.js";
import { registerProspectRoutes } from "./routes/prospects.js";
import { registerQueueRoutes } from "./routes/queue.js";
import { registerSalesTargetRoutes } from "./routes/sales-targets.js";

const buildServer = async () => {
  const app = Fastify({
    logger: true,
  });

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

  app.addHook("onRequest", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", request.headers.origin ?? "*");
    reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });

  await registerHealthRoute(app);
  await registerCloseLostAnalysisRoutes(app);
  await registerForecastRoutes(app);
  await registerHubSpotRoutes(app);
  await registerHubSpotWebhookRoutes(app);
  await registerLlmRoutes(app);
  await registerProspectRoutes(app);
  await registerQueueRoutes(app);
  await registerSalesTargetRoutes(app);

  return app;
};

const start = async () => {
  const app = await buildServer();

  try {
    await app.listen({
      host: "0.0.0.0",
      port: env.port,
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
