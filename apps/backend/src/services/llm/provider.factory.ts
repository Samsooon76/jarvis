import { env } from "../../config/env.js";
import type { LlmProvider } from "./llm.provider.js";
import { OpenAiProvider } from "./providers/openai.provider.js";

export type LlmProviderId = "deepseek" | "openai" | "vertex-gemini";
export const DEFAULT_LLM_PROVIDER: LlmProviderId = "openai";
export const DEFAULT_LLM_MODEL = "gpt-5-nano";

export type CreateLlmProviderOptions = {
  provider?: string | null;
  model?: string | null;
};

export const createLlmProvider = (options: CreateLlmProviderOptions = {}): LlmProvider => {
  const requestedProvider = options.provider?.trim() || env.llmProvider;
  const requestedModel = options.model?.trim() || env.openaiModel;
  const model = requestedProvider === DEFAULT_LLM_PROVIDER && requestedModel === DEFAULT_LLM_MODEL
    ? requestedModel
    : DEFAULT_LLM_MODEL;

  return new OpenAiProvider(undefined, model);
};
