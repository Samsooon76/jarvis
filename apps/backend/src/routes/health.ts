import type { FastifyInstance } from "fastify";

export const registerHealthRoute = async (app: FastifyInstance): Promise<void> => {
  app.get("/", async () => ({
    success: true,
    data: {
      service: "jarvis-api",
      status: "ok",
      endpoints: {
        health: "/health",
        queue: "/api/queue/22222222-2222-4222-8222-222222222222",
        hubspotStatus: "/api/hubspot/status?orgId=11111111-1111-4111-8111-111111111111",
        hubspotConnect: "/api/auth/hubspot/start?orgId=11111111-1111-4111-8111-111111111111",
      },
    },
  }));

  app.get("/health", async () => ({
    success: true,
    data: {
      service: "jarvis-api",
      status: "ok",
    },
  }));
};
