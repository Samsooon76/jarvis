import type { FastifyInstance } from "fastify";
import { registerHubSpotLegacyRoutes } from "./hubspot-legacy.routes.js";

const registeredApps = new WeakSet<FastifyInstance>();

export const registerHubSpotLegacyRoutesOnce = async (app: FastifyInstance): Promise<void> => {
  if (registeredApps.has(app)) {
    return;
  }

  registeredApps.add(app);
  await registerHubSpotLegacyRoutes(app);
};
