import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { previewDealAnalysisV1LlmRequestForProspect } from "../services/deal-intelligence/v1.js";

config({ path: resolve(process.cwd(), "../../.env") });

const prospectId = process.argv[2];
const model = process.argv[3] ?? "gpt-4.1";

if (!prospectId) {
  console.error("Usage: npx tsx src/scripts/dump-deal-analysis-prompt.ts <prospectId> [model]");
  process.exit(1);
}

const preview = await previewDealAnalysisV1LlmRequestForProspect(prospectId, {}, model);
const slug = (preview.dealName ?? preview.companyName ?? prospectId)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");
const outputDir = resolve(process.cwd(), "../../tmp/llm-prompts");
mkdirSync(outputDir, { recursive: true });

const baseName = `${slug}-${preview.hubspotDealId}`;
const userPromptPath = resolve(outputDir, `${baseName}.user-prompt.txt`);
const openAiBodyPath = resolve(outputDir, `${baseName}.openai-request.json`);
const metaPath = resolve(outputDir, `${baseName}.meta.json`);

writeFileSync(userPromptPath, preview.userPrompt, "utf8");
writeFileSync(openAiBodyPath, `${JSON.stringify(preview.openAiChatCompletionsBody, null, 2)}\n`, "utf8");
writeFileSync(
  metaPath,
  `${JSON.stringify(
    {
      prospectId: preview.prospectId,
      orgId: preview.orgId,
      hubspotDealId: preview.hubspotDealId,
      dealName: preview.dealName,
      companyName: preview.companyName,
      lifecycleStatus: preview.lifecycleStatus,
      inputHash: preview.inputHash,
      systemMessage: preview.systemMessage,
      userPromptChars: preview.userPrompt.length,
      userPromptPath,
      openAiBodyPath,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      dealName: preview.dealName,
      companyName: preview.companyName,
      hubspotDealId: preview.hubspotDealId,
      lifecycleStatus: preview.lifecycleStatus,
      userPromptChars: preview.userPrompt.length,
      userPromptPath,
      openAiBodyPath,
      metaPath,
    },
    null,
    2,
  ),
);