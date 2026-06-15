const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

export type JarvisMcpConfig = {
  apiUrl: string;
  authToken: string;
  defaultOrgId: string | null;
  defaultUserId: string | null;
  requestTimeoutMs: number;
};

export const loadJarvisMcpConfig = (): JarvisMcpConfig => {
  const apiUrl = trimTrailingSlash(process.env.JARVIS_API_URL?.trim() || "http://localhost:4000");
  const authToken = process.env.JARVIS_AUTH_TOKEN?.trim() || process.env.API_AUTH_TOKEN?.trim() || "";

  if (!authToken) {
    throw new Error("JARVIS_AUTH_TOKEN (ou API_AUTH_TOKEN) est obligatoire pour le serveur MCP Jarvis.");
  }

  return {
    apiUrl,
    authToken,
    defaultOrgId: process.env.JARVIS_ORG_ID?.trim() || null,
    defaultUserId: process.env.JARVIS_USER_ID?.trim() || null,
    requestTimeoutMs: Number(process.env.JARVIS_REQUEST_TIMEOUT_MS ?? 120_000),
  };
};