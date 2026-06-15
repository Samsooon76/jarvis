import type { CreateOrganizationMcpKeyResult, OrganizationMcpKey } from "@jarvis/shared";
import { createHash, randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "../db/client.js";

const MCP_KEY_PREFIX = "jrv_";
const MCP_KEY_BYTE_LENGTH = 32;
const MAX_ACTIVE_MCP_KEYS_PER_ORG = 10;

export type ResolvedOrganizationMcpKey = {
  keyId: string;
  orgId: string;
  createdByUserId: string | null;
};

const hashMcpToken = (token: string): string => createHash("sha256").update(token).digest("hex");

const generateMcpToken = (): string => `${MCP_KEY_PREFIX}${randomBytes(MCP_KEY_BYTE_LENGTH).toString("hex")}`;

const mapMcpKeyRow = (row: Record<string, unknown>): OrganizationMcpKey => ({
  id: String(row.id),
  label: String(row.label),
  tokenPrefix: String(row.token_prefix),
  createdByUserId: typeof row.created_by_user_id === "string" ? row.created_by_user_id : null,
  lastUsedAt: typeof row.last_used_at === "string" ? row.last_used_at : null,
  revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
  createdAt: String(row.created_at),
  status: typeof row.revoked_at === "string" ? "revoked" : "active",
});

export const isJarvisMcpToken = (token: string): boolean => token.startsWith(MCP_KEY_PREFIX);

export const resolveOrganizationMcpKey = async (token: string): Promise<ResolvedOrganizationMcpKey | null> => {
  const trimmedToken = token.trim();

  if (!isJarvisMcpToken(trimmedToken)) {
    return null;
  }

  const { data, error } = await getSupabaseAdmin().rpc("resolve_organization_mcp_key", {
    target_token_hash: hashMcpToken(trimmedToken),
  });

  if (error) {
    throw new Error(`Impossible de resoudre la cle MCP: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : null;

  if (!row || typeof row !== "object") {
    return null;
  }

  const typedRow = row as Record<string, unknown>;

  return {
    keyId: String(typedRow.key_id),
    orgId: String(typedRow.org_id),
    createdByUserId: typeof typedRow.created_by_user_id === "string" ? typedRow.created_by_user_id : null,
  };
};

export const touchOrganizationMcpKey = async (keyId: string): Promise<void> => {
  const { error } = await getSupabaseAdmin().rpc("touch_organization_mcp_key", {
    target_key_id: keyId,
  });

  if (error) {
    throw new Error(`Impossible de mettre a jour la cle MCP: ${error.message}`);
  }
};

export const listOrganizationMcpKeys = async (orgId: string): Promise<OrganizationMcpKey[]> => {
  const { data, error } = await getSupabaseAdmin().rpc("list_organization_mcp_keys", {
    target_org_id: orgId,
  });

  if (error) {
    throw new Error(`Impossible de charger les cles MCP: ${error.message}`);
  }

  return (data ?? []).map((row: Record<string, unknown>) => mapMcpKeyRow(row));
};

export const createOrganizationMcpKey = async (
  orgId: string,
  createdByUserId: string | null,
  label?: string | null,
): Promise<CreateOrganizationMcpKeyResult> => {
  const activeKeys = (await listOrganizationMcpKeys(orgId)).filter((key) => key.status === "active");

  if (activeKeys.length >= MAX_ACTIVE_MCP_KEYS_PER_ORG) {
    throw new Error(`Limite atteinte: ${MAX_ACTIVE_MCP_KEYS_PER_ORG} cles MCP actives maximum par organisation.`);
  }

  const token = generateMcpToken();
  const tokenHash = hashMcpToken(token);
  const tokenPrefix = `${token.slice(0, 12)}...`;

  const { data, error } = await getSupabaseAdmin().rpc("insert_organization_mcp_key", {
    target_org_id: orgId,
    target_created_by_user_id: createdByUserId,
    target_label: label?.trim() || "Cle MCP",
    target_token_hash: tokenHash,
    target_token_prefix: tokenPrefix,
  });

  if (error) {
    throw new Error(`Impossible de creer la cle MCP: ${error.message}`);
  }

  const keyId = typeof data === "string" ? data : null;

  if (!keyId) {
    throw new Error("Cle MCP creee mais identifiant introuvable.");
  }

  return {
    token,
    key: {
      id: keyId,
      label: label?.trim() || "Cle MCP",
      tokenPrefix,
      createdByUserId,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
      status: "active",
    },
  };
};

export const revokeOrganizationMcpKey = async (orgId: string, keyId: string): Promise<void> => {
  const { data, error } = await getSupabaseAdmin().rpc("revoke_organization_mcp_key", {
    target_org_id: orgId,
    target_key_id: keyId,
  });

  if (error) {
    throw new Error(`Impossible de revoquer la cle MCP: ${error.message}`);
  }

  if (data !== true) {
    throw new Error("Cle MCP introuvable ou deja revoquee.");
  }
};