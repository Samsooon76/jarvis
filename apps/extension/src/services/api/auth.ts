import type { AppUserRole, OrgUser } from "@jarvis/shared";
import { getJson, postJson, putJson, type ApiRequestOptions } from "./client";

export type AiProviderId = "openai";

export type AiProviderOption = {
  id: AiProviderId;
  label: string;
  model: string;
  description: string;
  requiredEnv: string;
  docsUrl?: string;
};

export const aiProviderOptions: AiProviderOption[] = [
  {
    id: "openai",
    label: "OpenAI",
    model: "gpt-5-nano",
    description: "Modele OpenAI tres rapide pour synthese, extraction et classification.",
    requiredEnv: "OPENAI_API_KEY",
    docsUrl: "https://developers.openai.com/api/docs/models/gpt-5-nano",
  },
];

export type LlmProviderPreference = {
  provider: AiProviderId;
  model: string;
};

export const saveLlmProviderPreference = async (
  orgId: string,
  aiProvider: AiProviderOption,
): Promise<LlmProviderPreference> =>
  postJson<LlmProviderPreference>("/api/llm/provider-preference", {
    orgId,
    provider: aiProvider.id,
    model: aiProvider.model,
  });

export type AppUserProfile = {
  id: string | null;
  authUserId: string;
  orgId: string | null;
  orgName: string | null;
  email: string;
  name: string;
  role: AppUserRole | null;
  hubspotOwnerId: string | null;
  onboardingRequired: boolean;
  canManageHubSpot: boolean;
};

export const fetchCurrentUserProfile = async (options: ApiRequestOptions = {}): Promise<AppUserProfile> =>
  getJson<AppUserProfile>("/api/auth/me", options);

export const completeAdminOnboarding = async (input: {
  organizationName: string;
  fullName: string;
}): Promise<AppUserProfile> =>
  postJson<AppUserProfile>("/api/auth/onboarding/admin", input);

export const completeMemberOnboarding = async (): Promise<AppUserProfile> =>
  postJson<AppUserProfile>("/api/auth/onboarding/member", {});

export const fetchOrgUsers = async (options: ApiRequestOptions = {}): Promise<OrgUser[]> =>
  getJson<OrgUser[]>("/api/auth/users", options);

export const updateOrgUserRole = async (
  userId: string,
  role: AppUserRole,
): Promise<{ id: string; role: AppUserRole }> =>
  putJson<{ id: string; role: AppUserRole }>(`/api/auth/users/${userId}/role`, { role });
