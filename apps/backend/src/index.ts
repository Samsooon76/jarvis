import { env } from "./config/env.js";
import { initSentry } from "./lib/sentry.js";

initSentry();

const start = async () => {
  const { buildServer } = await import("./server.js");
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
