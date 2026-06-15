import type { FastifyInstance } from "fastify";
import type { ApiResponse, CreateOrganizationMcpKeyResult, McpSetupInfo, OrganizationMcpKey } from "@jarvis/shared";
import { env } from "../config/env.js";
import { assertManagerOrAdmin, assertOrgAccess } from "../services/app-auth.service.js";
import {
  createOrganizationMcpKey,
  listOrganizationMcpKeys,
  revokeOrganizationMcpKey,
} from "../services/mcp-key.service.js";

type McpKeysQuery = {
  orgId?: string;
};

type CreateMcpKeyBody = {
  orgId?: string;
  label?: string | null;
};

type McpKeyParams = {
  keyId: string;
};

type RevokeMcpKeyBody = {
  orgId?: string;
};

const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidOrgId = (value: string | undefined): value is string =>
  typeof value === "string" && UUID_V4_LIKE_PATTERN.test(value.trim());

const buildMcpHttpUrl = (): string => {
  const baseUrl = (env.apiPublicUrl || `http://localhost:${env.port}`).replace(/\/+$/, "");

  return `${baseUrl}/mcp`;
};

export const registerMcpKeyRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Querystring: McpKeysQuery; Reply: ApiResponse<McpSetupInfo> }>(
    "/api/mcp/setup",
    async (request, reply) => {
      const orgId = request.query.orgId?.trim();

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        assertOrgAccess(request, orgId);
        assertManagerOrAdmin(request);

        return reply.send({
          success: true,
          data: {
            mcpHttpUrl: buildMcpHttpUrl(),
            orgId,
          },
        });
      } catch (error) {
        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Impossible de charger la configuration MCP.",
        });
      }
    },
  );

  app.get<{ Querystring: McpKeysQuery; Reply: ApiResponse<OrganizationMcpKey[]> }>(
    "/api/mcp/keys",
    async (request, reply) => {
      const orgId = request.query.orgId?.trim();

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le parametre orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        assertOrgAccess(request, orgId);
        assertManagerOrAdmin(request);

        return reply.send({
          success: true,
          data: await listOrganizationMcpKeys(orgId),
        });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de lister les cles MCP.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Impossible de lister les cles MCP.",
        });
      }
    },
  );

  app.post<{ Body: CreateMcpKeyBody; Reply: ApiResponse<CreateOrganizationMcpKeyResult> }>(
    "/api/mcp/keys",
    async (request, reply) => {
      const orgId = request.body.orgId?.trim();

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        const auth = assertOrgAccess(request, orgId);
        assertManagerOrAdmin(request);

        const created = await createOrganizationMcpKey(orgId, auth.appUserId, request.body.label ?? null);

        return reply.send({
          success: true,
          data: created,
        });
      } catch (error) {
        request.log.error({ error, orgId }, "Impossible de creer une cle MCP.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Impossible de creer une cle MCP.",
        });
      }
    },
  );

  app.post<{ Params: McpKeyParams; Body: RevokeMcpKeyBody; Reply: ApiResponse<{ revoked: boolean }> }>(
    "/api/mcp/keys/:keyId/revoke",
    async (request, reply) => {
      const orgId = request.body.orgId?.trim();

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        assertOrgAccess(request, orgId);
        assertManagerOrAdmin(request);
        await revokeOrganizationMcpKey(orgId, request.params.keyId);

        return reply.send({
          success: true,
          data: { revoked: true },
        });
      } catch (error) {
        request.log.error({ error, orgId, keyId: request.params.keyId }, "Impossible de revoquer la cle MCP.");

        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Impossible de revoquer la cle MCP.",
        });
      }
    },
  );
};