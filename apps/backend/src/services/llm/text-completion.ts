import { env } from "../../config/env.js";
import { runWithLlmConcurrencyLimit } from "./llm-rate-limiter.js";
import { createLlmProvider, type CreateLlmProviderOptions } from "./provider.factory.js";

const TEXT_COMPLETION_TIMEOUT_MS = 60_000;

type ChatCompletionResponse = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?:
        | string
        | null
        | Array<{
            text?: string;
            type?: string;
          }>;
      refusal?: string | null;
    };
  }>;
};

export type TextCompletionResult = {
  text: string;
  provider: string;
  model: string;
};

type ProviderRuntimeConfig = {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  useOpenAiReasoning: boolean;
};

const resolveProviderRuntimeConfig = (options: CreateLlmProviderOptions = {}): ProviderRuntimeConfig => {
  const provider = createLlmProvider(options);

  if (provider.providerName === "deepseek") {
    if (!env.deepseekApiKey) {
      throw new Error("Configuration DeepSeek manquante. Renseigne DEEPSEEK_API_KEY.");
    }

    return {
      provider: provider.providerName,
      model: provider.modelName,
      apiKey: env.deepseekApiKey,
      baseUrl: env.deepseekBaseUrl.replace(/\/$/, ""),
      useOpenAiReasoning: false,
    };
  }

  if (provider.providerName === "vertex-gemini") {
    if (!env.vertexAiApiKey) {
      throw new Error("Configuration Vertex AI manquante. Renseigne VERTEX_AI_API_KEY.");
    }

    return {
      provider: provider.providerName,
      model: provider.modelName,
      apiKey: env.vertexAiApiKey,
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      useOpenAiReasoning: false,
    };
  }

  if (!env.openaiApiKey) {
    throw new Error("Configuration OpenAI manquante. Renseigne OPENAI_API_KEY.");
  }

  return {
    provider: provider.providerName,
    model: provider.modelName,
    apiKey: env.openaiApiKey,
    baseUrl: env.openaiBaseUrl.replace(/\/$/, ""),
    useOpenAiReasoning: true,
  };
};

const extractMessageContent = (payload: ChatCompletionResponse): string => {
  const message = payload.choices?.[0]?.message;
  const rawContent = message?.content;

  if (typeof rawContent === "string") {
    return rawContent.trim();
  }

  if (Array.isArray(rawContent)) {
    return rawContent
      .map((item) => item.text ?? "")
      .join("")
      .trim();
  }

  const refusal = message?.refusal ? ` Refus: ${message.refusal}` : "";

  throw new Error(`Le provider IA n'a renvoye aucun contenu exploitable.${refusal}`);
};

export const completeJarvisText = async (
  options: CreateLlmProviderOptions & { maxTokens?: number },
  systemPrompt: string,
  userPrompt: string,
): Promise<TextCompletionResult> => {
  const runtime = resolveProviderRuntimeConfig(options);
  const maxTokens = options.maxTokens ?? 2_000;

  return runWithLlmConcurrencyLimit(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TEXT_COMPLETION_TIMEOUT_MS);

    try {
      const body: Record<string, unknown> = {
        model: runtime.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: false,
      };

      if (runtime.provider === "deepseek") {
        body.temperature = 0.2;
        body.max_tokens = maxTokens;
      } else if (runtime.useOpenAiReasoning) {
        body.reasoning_effort = "minimal";
        body.max_completion_tokens = maxTokens;
      } else {
        body.temperature = 0.2;
        body.max_completion_tokens = maxTokens;
      }

      const response = await fetch(`${runtime.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${runtime.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();

        throw new Error(`Provider IA error (${response.status}): ${errorText}`);
      }

      const payload = (await response.json()) as ChatCompletionResponse;

      return {
        text: extractMessageContent(payload),
        provider: runtime.provider,
        model: runtime.model,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Timeout provider IA apres 60s.");
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  });
};