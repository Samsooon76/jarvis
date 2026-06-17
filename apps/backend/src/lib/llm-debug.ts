import { env } from "../config/env.js";

type LlmDebugPayload = Record<string, unknown>;

const previewText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}… [${value.length} chars total]`;
};

export const isLlmDebugEnabled = (): boolean => env.llmDebug;

export const logLlmDebug = (event: string, payload: LlmDebugPayload): void => {
  if (!isLlmDebugEnabled()) {
    return;
  }

  const line = JSON.stringify({
    ts: new Date().toISOString(),
    scope: "llm",
    event,
    ...payload,
  });

  console.info(`[llm-debug] ${line}`);
};

export const logLlmDebugText = (value: string): string | undefined => {
  if (!isLlmDebugEnabled()) {
    return undefined;
  }

  if (env.llmDebugFullResponse) {
    return value;
  }

  return previewText(value, env.llmDebugPreviewChars);
};