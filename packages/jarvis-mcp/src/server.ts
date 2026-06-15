import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JarvisApiClient } from "./client/jarvis-api.js";
import type { JarvisMcpConfig } from "./config.js";
import { registerJarvisTools } from "./tools/registry.js";

export const createJarvisMcpServer = (config: JarvisMcpConfig): McpServer => {
  const server = new McpServer({
    name: "jarvis",
    version: "0.1.0",
  });

  const client = new JarvisApiClient(config);

  registerJarvisTools(server, { client });

  return server;
};

export const startJarvisMcpServer = async (config: JarvisMcpConfig): Promise<void> => {
  const server = createJarvisMcpServer(config);
  const transport = new StdioServerTransport();

  await server.connect(transport);
};