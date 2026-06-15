import { z } from "zod";
import type { JarvisToolDefinition } from "./types.js";

const inputSchema = z.object({
  orgId: z.string().uuid().optional().describe("UUID organisation Jarvis. Utilise JARVIS_ORG_ID par defaut."),
  period: z.enum(["daily", "weekly"]).optional().describe("Periode du digest manager (defaut: daily)."),
});

export const getManagerDigestTool: JarvisToolDefinition = {
  name: "get_manager_digest",
  description:
    "Genere ou charge le digest manager Jarvis (highlights, deals a risque, coaching). Reserve aux roles manager/admin.",
  inputSchema,
  handler: async (rawInput, { client }) => {
    const input = inputSchema.parse(rawInput);
    const digest = await client.getManagerDigest(input.period ?? "daily", input.orgId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(digest, null, 2),
        },
      ],
    };
  },
};