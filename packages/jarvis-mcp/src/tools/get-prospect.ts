import { z } from "zod";
import type { JarvisToolDefinition } from "./types.js";

const inputSchema = z.object({
  prospectId: z.string().uuid().describe("UUID du prospect Jarvis."),
});

export const getProspectTool: JarvisToolDefinition = {
  name: "get_prospect",
  description: "Charge la fiche prospect Jarvis (deal, contact, score, prochaine action).",
  inputSchema,
  handler: async (rawInput, { client }) => {
    const input = inputSchema.parse(rawInput);
    const prospect = await client.getProspect(input.prospectId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(prospect, null, 2),
        },
      ],
    };
  },
};