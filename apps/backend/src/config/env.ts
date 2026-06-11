import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectoryPath = dirname(currentFilePath);
const backendDirectoryPath = resolve(currentDirectoryPath, "..", "..");
const workspaceRootPath = resolve(backendDirectoryPath, "..", "..");

// Charge un fichier .env sans jamais ecraser les variables deja presentes dans
// process.env (y compris celles chargees par un fichier precedent).
const loadEnvFile = (filePath: string): void => {
  if (!existsSync(filePath)) {
    return;
  }

  dotenv.config({ path: filePath, override: false, quiet: true });
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
  allowedCorsOrigins: (process.env.ALLOWED_CORS_ORIGINS ?? process.env.APP_URL ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  requireApiAuth:
    (process.env.REQUIRE_API_AUTH ??
      (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test" ? "false" : "true")) === "true",
  apiAuthToken: process.env.API_AUTH_TOKEN ?? "",
  apiPublicUrl,
  enableDebugRoutes: process.env.ENABLE_DEBUG_ROUTES === "true",
  oauthStateSecret:
    process.env.OAUTH_STATE_SECRET ??
    process.env.HUBSPOT_OAUTH_STATE_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "",
  sentryDsn: process.env.SENTRY_DSN ?? "",
  sentryTracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  redisUrl: process.env.REDIS_URL ?? "",
  hubspotWebhookDebounceSeconds: Number(process.env.HUBSPOT_WEBHOOK_DEBOUNCE_SECONDS ?? 90),
  crmActivityRetentionDays: Number(process.env.CRM_ACTIVITY_RETENTION_DAYS ?? 180),
  hubspotAppId: process.env.HUBSPOT_APP_ID ?? "",
  hubspotClientId: process.env.HUBSPOT_CLIENT_ID ?? "",
  hubspotClientSecret: process.env.HUBSPOT_CLIENT_SECRET ?? "",
  hubspotRedirectUri: process.env.HUBSPOT_REDIRECT_URI ?? defaultHubSpotRedirectUri,
  vertexAiApiKey: process.env.VERTEX_AI_API_KEY ?? "",
  vertexAiModel: process.env.VERTEX_AI_MODEL ?? "gemini-3.1-flash-lite-preview",
  llmProvider: process.env.LLM_PROVIDER ?? "openai",
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
      "crm.objects.leads.read",
      "crm.objects.leads.write",
      "crm.objects.owners.read",
      "crm.schemas.companies.read",
      "crm.schemas.contacts.read",
      "oauth",
    ].join(" "),
};
