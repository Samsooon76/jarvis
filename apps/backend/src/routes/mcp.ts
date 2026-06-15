import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { env } from "../config/env.js";
import { resolveMcpRuntimeContext } from "../mcp/context.js";
import { registerJarvisMcpTools } from "../mcp/register-tools.js";
import { requireAuth } from "../services/app-auth.service.js";

export const registerMcpRoutes = async (app: FastifyInstance): Promise<void> => {
  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp",
    handler: async (request, reply) => {
      if (!env.mcpHttpEnabled) {
        return reply.code(404).send({
          success: false,
          error: "MCP HTTP desactive sur ce serveur.",
        });
      }

      try {
        const auth = requireAuth(request);
        const context = await resolveMcpRuntimeContext(auth);
        const mcpServer = new McpServer({
          name: "jarvis",
          version: "0.1.0",
        });

        registerJarvisMcpTools(mcpServer, context);

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

        await mcpServer.connect(transport);
        reply.hijack();

        try {
          await transport.handleRequest(request.raw, reply.raw, request.body);
        } finally {
          await mcpServer.close();
        }
      } catch (error) {
        request.log.error({ error }, "Erreur MCP HTTP Jarvis.");

        if (!reply.sent) {
          return reply.code(500).send({
            success: false,
            error: error instanceof Error ? error.message : "Erreur inconnue MCP HTTP.",
          });
        }
      }
    },
  });
};