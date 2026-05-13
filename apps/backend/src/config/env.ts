import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectoryPath = dirname(currentFilePath);
const backendDirectoryPath = resolve(currentDirectoryPath, "..", "..");
const workspaceRootPath = resolve(backendDirectoryPath, "..", "..");

const loadEnvFile = (filePath: string): void => {
  if (!existsSync(filePath)) {
    return;
  }

  const fileContent = readFileSync(filePath, "utf8");

  for (const line of fileContent.split("\n")) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim();

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
};

loadEnvFile(resolve(workspaceRootPath, ".env"));
loadEnvFile(resolve(backendDirectoryPath, ".env"));
loadEnvFile(resolve(process.cwd(), ".env"));
loadEnvFile(resolve(process.cwd(), "apps/backend/.env"));

const apiPublicUrl = process.env.API_PUBLIC_URL ?? process.env.BACKEND_PUBLIC_URL ?? "";
const defaultHubSpotRedirectUri = apiPublicUrl
  ? `${apiPublicUrl.replace(/\/+$/, "")}/api/auth/hubspot/callback`
  : "http://localhost:4000/api/auth/hubspot/callback";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  supabaseUrl: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  appUrl: process.env.APP_URL ?? "http://localhost:5173",
  apiPublicUrl,
  redisUrl: process.env.REDIS_URL ?? "",
  hubspotWebhookDebounceSeconds: Number(process.env.HUBSPOT_WEBHOOK_DEBOUNCE_SECONDS ?? 90),
  crmActivityRetentionDays: Number(process.env.CRM_ACTIVITY_RETENTION_DAYS ?? 180),
  hubspotAppId: process.env.HUBSPOT_APP_ID ?? "",
  hubspotClientId: process.env.HUBSPOT_CLIENT_ID ?? "",
  hubspotClientSecret: process.env.HUBSPOT_CLIENT_SECRET ?? "",
  hubspotRedirectUri: process.env.HUBSPOT_REDIRECT_URI ?? defaultHubSpotRedirectUri,
  vertexAiApiKey: process.env.VERTEX_AI_API_KEY ?? "",
  vertexAiModel: process.env.VERTEX_AI_MODEL ?? "gemini-3.1-flash-lite-preview",
  llmProvider: process.env.LLM_PROVIDER ?? "deepseek",
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5-nano",
  dealAiCacheTtlHours: Number(process.env.DEAL_AI_CACHE_TTL_HOURS ?? 6),
  hubspotScopes:
    process.env.HUBSPOT_SCOPES ??
    [
      "sales-email-read",
      "crm.objects.companies.read",
      "crm.objects.contacts.read",
      "crm.objects.contacts.write",
      "crm.objects.deals.read",
      "crm.objects.deals.write",
      "crm.objects.owners.read",
      "crm.schemas.companies.read",
      "crm.schemas.contacts.read",
      "oauth",
    ].join(" "),
};
