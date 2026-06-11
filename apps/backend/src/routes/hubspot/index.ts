import type { FastifyInstance } from "fastify";
import { registerHubSpotStatusRoutes } from "./status.routes.js";
import { registerHubSpotOwnersRoutes } from "./owners.routes.js";
import { registerHubSpotDisconnectRoutes } from "./disconnect.routes.js";
import { registerHubSpotTasksRoutes } from "./tasks.routes.js";
import { registerHubSpotDealsRoutes } from "./deals.routes.js";
import { registerHubSpotSyncRoutes } from "./sync.routes.js";
import { registerHubSpotOAuthRoutes } from "./oauth.routes.js";

export { invalidateHubSpotTasksCache } from "./tasks.routes.js";

export const registerHubSpotCoreRoutes = async (app: FastifyInstance): Promise<void> => {
  await registerHubSpotStatusRoutes(app);
  await registerHubSpotOwnersRoutes(app);
  await registerHubSpotDisconnectRoutes(app);
  await registerHubSpotTasksRoutes(app);
  await registerHubSpotDealsRoutes(app);
  await registerHubSpotSyncRoutes(app);
  await registerHubSpotOAuthRoutes(app);
};
