import type { FastifyInstance } from "fastify";
import { registerHubSpotLegacyRoutesOnce } from "./hubspot-route-once.js";

export const registerHubSpotSyncRoutes = async (app: FastifyInstance): Promise<void> => {
  await registerHubSpotLegacyRoutesOnce(app);
};
