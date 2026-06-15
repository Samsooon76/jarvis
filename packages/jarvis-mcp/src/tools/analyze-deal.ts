import { z } from "zod";
import type { JarvisToolDefinition } from "./types.js";

const inputSchema = z.object({
  prospectId: z.string().uuid().describe("UUID du prospect/deal a analyser."),
  orgId: z.string().uuid().optional().describe("UUID organisation Jarvis. Utilise JARVIS_ORG_ID par defaut."),
  refresh: z.boolean().optional().describe("Force une nouvelle analyse IA (ignore le cache)."),
});

export const analyzeDealTool: JarvisToolDefinition = {
  name: "analyze_deal",
  description:
    "Lance l'analyse deal intelligence Jarvis (sante du deal, risques, next best action) sur un prospect.",
  inputSchema,
  handler: async (rawInput, { client }) => {
    const input = inputSchema.parse(rawInput);
    const orgId = client.resolveOrgId(input.orgId);

    const analysis = await client.analyzeDealIntelligence({
      prospectId: input.prospectId,
      orgId,
      refresh: input.refresh ?? false,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(analysis, null, 2),
        },
      ],
    };
  },
};