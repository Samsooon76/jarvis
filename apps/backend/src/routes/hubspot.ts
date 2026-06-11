import type { FastifyInstance } from "fastify";
import { registerHubSpotCoreRoutes } from "./hubspot/index.js";

export { invalidateHubSpotTasksCache } from "./hubspot/index.js";

export const registerHubSpotRoutes = async (app: FastifyInstance): Promise<void> => {
  await registerHubSpotCoreRoutes(app);
};
