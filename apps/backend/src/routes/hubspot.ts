import type { FastifyInstance } from "fastify";
import { registerHubSpotOauthRoutes } from "./hubspot-oauth.routes.js";
import { registerHubSpotOwnersRoutes } from "./hubspot-owners.routes.js";
import { registerHubSpotStatusRoutes } from "./hubspot-status.routes.js";
import { registerHubSpotSyncRoutes } from "./hubspot-sync.routes.js";
import { registerHubSpotTasksRoutes } from "./hubspot-tasks.routes.js";

export { invalidateHubSpotTasksCache } from "./hubspot-legacy.routes.js";

export const registerHubSpotRoutes = async (app: FastifyInstance): Promise<void> => {
  await registerHubSpotStatusRoutes(app);
  await registerHubSpotOwnersRoutes(app);
  await registerHubSpotTasksRoutes(app);
  await registerHubSpotSyncRoutes(app);
  await registerHubSpotOauthRoutes(app);
};
