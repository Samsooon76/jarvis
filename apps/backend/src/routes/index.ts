import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { registerAuthRoutes } from "./auth.js";
import { registerCloseLostAnalysisRoutes } from "./close-lost-analysis.js";
import { registerDebugRoutes } from "./debug.js";
import { registerForecastAccuracyRoutes } from "./forecast-accuracy.js";
import { registerForecastRoutes } from "./forecast.js";
import { registerHubSpotRoutes } from "./hubspot.js";
import { registerHubSpotWebhookRoutes } from "./webhooks.js";
import { registerHealthRoute } from "./health.js";
import { registerLeadRoutes } from "./leads.js";
import { registerLlmRoutes } from "./llm.js";
import { registerManagerDigestRoutes } from "./manager-digest.js";
import { registerProbabilityRoutes } from "./probability.js";
import { registerProspectRoutes } from "./prospects.js";
import { registerPulseRoutes } from "./pulse.js";
import { registerRepCoachingRoutes } from "./rep-coaching.js";
import { registerQueueRoutes } from "./queue.js";
import { registerSalesActivityStatsRoutes } from "./sales-activity-stats.js";
import { registerSalesTargetRoutes } from "./sales-targets.js";
import { registerTaskRoutes } from "./tasks.js";
import { registerWinAnalysisRoutes } from "./win-analysis.js";

export const registerRoutes = async (app: FastifyInstance): Promise<void> => {
  await registerHealthRoute(app);
  await registerAuthRoutes(app);
  await registerCloseLostAnalysisRoutes(app);
  if (env.enableDebugRoutes || env.nodeEnv !== "production") {
    await registerDebugRoutes(app);
  }
  await registerForecastAccuracyRoutes(app);
  await registerForecastRoutes(app);
  await registerHubSpotRoutes(app);
  await registerHubSpotWebhookRoutes(app);
  await registerLeadRoutes(app);
  await registerLlmRoutes(app);
  await registerManagerDigestRoutes(app);
  await registerProbabilityRoutes(app);
  await registerProspectRoutes(app);
  await registerPulseRoutes(app);
  await registerRepCoachingRoutes(app);
  await registerQueueRoutes(app);
  await registerSalesActivityStatsRoutes(app);
  await registerSalesTargetRoutes(app);
  await registerTaskRoutes(app);
  await registerWinAnalysisRoutes(app);
};
