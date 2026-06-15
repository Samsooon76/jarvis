import type { AuthContext } from "../services/app-auth.service.js";
import { getSupabaseAdmin } from "../db/client.js";

export type JarvisMcpRuntimeContext = {
  orgId: string;
  userId: string | null;
  role: "admin" | "manager";
};

const loadOrgManagerRecipient = async (
  orgId: string,
): Promise<{ userId: string | null; role: "admin" | "manager" }> => {
  const { data: admin, error: adminError } = await getSupabaseAdmin()
    .from("users")
    .select("id")
    .eq("org_id", orgId)
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();

  if (adminError) {
    throw new Error(`Impossible de resoudre le destinataire MCP: ${adminError.message}`);
  }

  if (typeof admin?.id === "string") {
    return { userId: admin.id, role: "admin" };
  }

  const { data: manager, error: managerError } = await getSupabaseAdmin()
    .from("users")
    .select("id")
    .eq("org_id", orgId)
    .eq("role", "manager")
    .limit(1)
    .maybeSingle();

  if (managerError) {
    throw new Error(`Impossible de resoudre le destinataire MCP: ${managerError.message}`);
  }

  return {
    userId: typeof manager?.id === "string" ? manager.id : null,
    role: "manager",
  };
};

export const resolveMcpRuntimeContext = async (auth: AuthContext): Promise<JarvisMcpRuntimeContext> => {
  const orgId = auth.orgId?.trim();

  if (!orgId) {
    throw new Error("Organisation Jarvis introuvable pour cette session MCP.");
  }

  if (auth.appUserId && (auth.role === "admin" || auth.role === "manager")) {
    return {
      orgId,
      userId: auth.appUserId,
      role: auth.role,
    };
  }

  const recipient = await loadOrgManagerRecipient(orgId);

  return {
    orgId,
    userId: recipient.userId,
    role: recipient.role,
  };
};