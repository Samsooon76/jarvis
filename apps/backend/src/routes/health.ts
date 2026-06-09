import type { FastifyInstance } from "fastify";

export const registerHealthRoute = async (app: FastifyInstance): Promise<void> => {
  app.get("/", async () => ({
    success: true,
    data: {
      service: "jarvis-api",
      status: "ok",
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
