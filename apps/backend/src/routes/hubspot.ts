import type { FastifyInstance } from "fastify";
import { registerHubSpotCoreRoutes } from "./hubspot-core.routes.js";

export { invalidateHubSpotTasksCache } from "./hubspot-core.routes.js";

export const registerHubSpotRoutes = async (app: FastifyInstance): Promise<void> => {
  await registerHubSpotCoreRoutes(app);
};
