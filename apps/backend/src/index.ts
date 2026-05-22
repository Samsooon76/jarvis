import { env } from "./config/env.js";
import { buildServer } from "./server.js";

const start = async () => {
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
