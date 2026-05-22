import { getSupabaseAdmin } from "../../db/client.js";
import { DEFAULT_LLM_MODEL, DEFAULT_LLM_PROVIDER, type LlmProviderId } from "./provider.factory.js";

export type LlmProviderPreference = {
  provider: LlmProviderId;
  model: string;
};

const LLM_PROVIDER_IDS = new Set<string>([DEFAULT_LLM_PROVIDER]);

export const isLlmProviderId = (value: string | null | undefined): value is LlmProviderId =>
  Boolean(value && LLM_PROVIDER_IDS.has(value));

export const resolveLlmProviderPreference = async (
  orgId: string,
  requestedProvider?: string | null,
  _requestedModel?: string | null,
): Promise<LlmProviderPreference> => {
  if (isLlmProviderId(requestedProvider)) {
    return {
      provider: DEFAULT_LLM_PROVIDER,
      model: DEFAULT_LLM_MODEL,
    };
  }

  const fallback = {
    provider: DEFAULT_LLM_PROVIDER,
    model: DEFAULT_LLM_MODEL,
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
    provider: DEFAULT_LLM_PROVIDER,
    model: DEFAULT_LLM_MODEL,
  };
};

export const saveLlmProviderPreference = async (
  orgId: string,
  _provider: LlmProviderId,
  _model?: string | null,
): Promise<LlmProviderPreference> => {
  const preference = {
    provider: DEFAULT_LLM_PROVIDER,
    model: DEFAULT_LLM_MODEL,
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
