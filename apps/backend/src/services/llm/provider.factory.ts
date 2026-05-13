import { env } from "../../config/env.js";
import type { LlmProvider } from "./llm.provider.js";
import { DeepSeekProvider } from "./providers/deepseek.provider.js";
import { OpenAiProvider } from "./providers/openai.provider.js";
import { VertexGeminiProvider } from "./providers/vertex-gemini.provider.js";

export type LlmProviderId = "deepseek" | "openai" | "vertex-gemini";

export type CreateLlmProviderOptions = {
  provider?: string | null;
  model?: string | null;
};

export const createLlmProvider = (options: CreateLlmProviderOptions = {}): LlmProvider => {
  const provider = (options.provider?.trim() || env.llmProvider) as LlmProviderId;
  const model = options.model?.trim() || null;

  if (provider === "vertex-gemini") {
    return new VertexGeminiProvider(undefined, model ?? undefined);
  }

  if (provider === "deepseek") {
    return new DeepSeekProvider(undefined, model ?? undefined);
  }

  if (provider === "openai") {
    return new OpenAiProvider(undefined, model ?? undefined);
  }

  throw new Error(`Provider LLM non supporte: ${provider}`);
};
