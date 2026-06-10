import { env } from "../../config/env.js";
import type { LlmProvider } from "./llm.provider.js";
import { DeepSeekProvider } from "./providers/deepseek.provider.js";
import { OpenAiProvider } from "./providers/openai.provider.js";
import { VertexGeminiProvider } from "./providers/vertex-gemini.provider.js";

export type LlmProviderId = "deepseek" | "openai" | "vertex-gemini";
export const DEFAULT_LLM_PROVIDER: LlmProviderId = "openai";
export const DEFAULT_LLM_MODEL = "gpt-5-nano";

export type CreateLlmProviderOptions = {
  provider?: string | null;
  model?: string | null;
};

export const createLlmProvider = (options: CreateLlmProviderOptions = {}): LlmProvider => {
  const requestedProvider = (options.provider?.trim() || env.llmProvider || DEFAULT_LLM_PROVIDER) as LlmProviderId;

  if (requestedProvider === "deepseek") {
    return new DeepSeekProvider(undefined, options.model?.trim() || env.deepseekModel);
  }

  if (requestedProvider === "vertex-gemini") {
    return new VertexGeminiProvider(undefined, options.model?.trim() || env.vertexAiModel);
  }

  return new OpenAiProvider(undefined, options.model?.trim() || env.openaiModel || DEFAULT_LLM_MODEL);
};
