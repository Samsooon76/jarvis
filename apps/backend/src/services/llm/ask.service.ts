import type { AskJarvisRequest, AskJarvisResult } from "@jarvis/shared";
import { resolveLlmProviderPreference } from "./provider-preference.service.js";
import { buildAskJarvisContext } from "./ask-context.service.js";
import {
  buildAskJarvisSystemPrompt,
  buildAskJarvisUserPrompt,
  parseAskJarvisResponse,
} from "./ask.js";
import { completeJarvisText } from "./text-completion.js";

export const askJarvis = async (request: AskJarvisRequest): Promise<AskJarvisResult> => {
  const question = request.question?.trim();

  if (!question) {
    throw new Error("La question est obligatoire.");
  }

  const orgId = request.orgId?.trim();

  if (!orgId) {
    throw new Error("orgId est obligatoire.");
  }

  const preference = await resolveLlmProviderPreference(orgId, request.llmProvider ?? null, request.llmModel ?? null);
  const context = await buildAskJarvisContext({
    ...request,
    question,
    orgId,
  });

  const completion = await completeJarvisText(
    {
      provider: request.llmProvider ?? preference.provider,
      model: request.llmModel ?? preference.model,
      maxTokens: 2_500,
    },
    buildAskJarvisSystemPrompt(),
    buildAskJarvisUserPrompt({
      question,
      contextBlock: context.contextBlock,
    }),
  );

  const parsed = parseAskJarvisResponse(completion.text, completion.provider);

  return {
    answer: parsed.answer,
    confidence: parsed.confidence,
    sources: [...new Set([...context.sources, ...parsed.sources])],
    contextSummary: context.summary,
    provider: completion.provider,
    model: completion.model,
    generatedAt: new Date().toISOString(),
  };
};