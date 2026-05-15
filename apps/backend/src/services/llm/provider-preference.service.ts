import { env } from "../../config/env.js";
import { getSupabaseAdmin } from "../../db/client.js";
import type { LlmProviderId } from "./provider.factory.js";

export type LlmProviderPreference = {
  provider: LlmProviderId;
  model: string;
};

const LLM_PROVIDER_IDS = new Set<string>(["deepseek", "openai", "vertex-gemini"]);
const DEFAULT_PROVIDER: LlmProviderId = "openai";
const DEFAULT_OPENAI_MODEL = "gpt-5-nano";

export const isLlmProviderId = (value: string | null | undefined): value is LlmProviderId =>
  Boolean(value && LLM_PROVIDER_IDS.has(value));

const defaultModelForProvider = (provider: LlmProviderId): string => {
  if (provider === "openai") {
    return env.openaiModel || DEFAULT_OPENAI_MODEL;
  }

  if (provider === "vertex-gemini") {
    return env.vertexAiModel;
  }

  return env.deepseekModel;
};

export const resolveLlmProviderPreference = async (
  orgId: string,
  requestedProvider?: string | null,
  requestedModel?: string | null,
): Promise<LlmProviderPreference> => {
  if (isLlmProviderId(requestedProvider)) {
    return {
      provider: requestedProvider,
      model: requestedModel?.trim() || defaultModelForProvider(requestedProvider),
    };
  }

  const fallback = {
    provider: DEFAULT_PROVIDER,
    model: defaultModelForProvider(DEFAULT_PROVIDER),
  };

  const { data, error } = await getSupabaseAdmin()
    .from("organizations")
    .select("preferred_llm_provider, preferred_llm_model")
    .eq("id", orgId)
    .maybeSingle();

  if (error) {
    const message = error.message.toLowerCase();

    if (message.includes("preferred_llm_provider") || message.includes("preferred_llm_model")) {
      return fallback;
    }

    throw new Error(`Impossible de charger la preference IA de l'organisation: ${error.message}`);
  }

  const row = data as { preferred_llm_provider: string | null; preferred_llm_model: string | null } | null;

  if (!isLlmProviderId(row?.preferred_llm_provider)) {
    return fallback;
  }

  return {
    provider: row.preferred_llm_provider,
    model: row.preferred_llm_model?.trim() || defaultModelForProvider(row.preferred_llm_provider),
  };
};

export const saveLlmProviderPreference = async (
  orgId: string,
  provider: LlmProviderId,
  model?: string | null,
): Promise<LlmProviderPreference> => {
  const preference = {
    provider,
    model: model?.trim() || defaultModelForProvider(provider),
  };
  const { error } = await getSupabaseAdmin()
    .from("organizations")
    .update({
      preferred_llm_provider: preference.provider,
      preferred_llm_model: preference.model,
    })
    .eq("id", orgId);

  if (error) {
    throw new Error(`Impossible d'enregistrer la preference IA de l'organisation: ${error.message}`);
  }

  return preference;
};
