import { z } from "zod";
import type { JarvisToolDefinition } from "./types.js";

const inputSchema = z.object({
  question: z.string().min(1).describe("Question libre a poser a Jarvis."),
  orgId: z.string().uuid().optional().describe("UUID organisation Jarvis. Utilise JARVIS_ORG_ID par defaut."),
  prospectId: z.string().uuid().optional().describe("UUID prospect pour contextualiser la reponse sur un deal."),
  hubspotDealId: z.string().optional().describe("ID deal HubSpot si le prospect n'est pas synchronise localement."),
  userId: z.string().uuid().optional().describe("UUID commercial pour inclure la morning queue."),
  includeQueue: z.boolean().optional().describe("Inclure un resume de la morning queue dans le contexte."),
});

export const askJarvisTool: JarvisToolDefinition = {
  name: "ask_jarvis",
  description:
    "Pose une question libre a Jarvis. Jarvis charge le contexte CRM (deal, historique, queue) et repond via son LLM metier.",
  inputSchema,
  handler: async (rawInput, { client }) => {
    const input = inputSchema.parse(rawInput);
    const orgId = client.resolveOrgId(input.orgId);

    const result = await client.askJarvis({
      question: input.question,
      orgId,
      prospectId: input.prospectId ?? null,
      hubspotDealId: input.hubspotDealId ?? null,
      userId: input.userId ?? client.defaultUserId,
      includeQueue: input.includeQueue ?? false,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
};