import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { analyzeDealTool } from "./analyze-deal.js";
import { askJarvisTool } from "./ask-jarvis.js";
import { getForecastTool } from "./get-forecast.js";
import { getManagerDigestTool } from "./get-manager-digest.js";
import { getProspectTool } from "./get-prospect.js";
import { getQueueTool } from "./get-queue.js";
import type { JarvisToolContext, JarvisToolDefinition } from "./types.js";
import { toToolErrorText } from "../errors.js";

const jarvisTools: JarvisToolDefinition[] = [
  askJarvisTool,
  getProspectTool,
  getQueueTool,
  analyzeDealTool,
  getForecastTool,
  getManagerDigestTool,
];

const registerTool = (
  server: McpServer,
  tool: JarvisToolDefinition,
  context: JarvisToolContext,
): void => {
  server.tool(
    tool.name,
    tool.description,
    tool.inputSchema.shape,
    async (input) => {
      try {
        return await tool.handler(input, context);
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: toToolErrorText(error),
            },
          ],
          isError: true,
        };
      }
    },
  );
};

export const registerJarvisTools = (server: McpServer, context: JarvisToolContext): void => {
  for (const tool of jarvisTools) {
    registerTool(server, tool, context);
  }
};

export const listJarvisToolNames = (): string[] => jarvisTools.map((tool) => tool.name);