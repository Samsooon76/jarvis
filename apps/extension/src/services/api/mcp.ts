import type { CreateOrganizationMcpKeyResult, McpSetupInfo, OrganizationMcpKey } from "@jarvis/shared";
import { apiPath, getJson, postJson } from "./client";

export const fetchMcpSetup = async (orgId: string): Promise<McpSetupInfo> =>
  getJson<McpSetupInfo>(apiPath("/api/mcp/setup", { orgId }));

export const fetchMcpKeys = async (orgId: string): Promise<OrganizationMcpKey[]> =>
  getJson<OrganizationMcpKey[]>(apiPath("/api/mcp/keys", { orgId }));

export const createMcpKey = async (orgId: string, label?: string | null): Promise<CreateOrganizationMcpKeyResult> =>
  postJson<CreateOrganizationMcpKeyResult>("/api/mcp/keys", {
    orgId,
    label: label ?? null,
  });

export const revokeMcpKey = async (orgId: string, keyId: string): Promise<{ revoked: boolean }> =>
  postJson<{ revoked: boolean }>(`/api/mcp/keys/${encodeURIComponent(keyId)}/revoke`, {
    orgId,
  });