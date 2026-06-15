#!/usr/bin/env node

import { loadJarvisMcpConfig } from "./config.js";
import { startJarvisMcpServer } from "./server.js";

const main = async (): Promise<void> => {
  const config = loadJarvisMcpConfig();

  await startJarvisMcpServer(config);
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Erreur inconnue au demarrage du MCP Jarvis.";
  console.error(message);
  process.exit(1);
});