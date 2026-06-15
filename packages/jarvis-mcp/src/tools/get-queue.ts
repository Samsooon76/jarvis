import { z } from "zod";
import type { JarvisToolDefinition } from "./types.js";

const inputSchema = z.object({
  userId: z.string().uuid().optional().describe("UUID commercial Jarvis. Utilise JARVIS_USER_ID par defaut."),
});

export const getQueueTool: JarvisToolDefinition = {
  name: "get_queue",
  description: "Charge la morning queue priorisee d'un commercial Jarvis.",
  inputSchema,
  handler: async (rawInput, { client }) => {
    const input = inputSchema.parse(rawInput);
    const userId = input.userId ?? client.defaultUserId;

    if (!userId) {
      throw new Error("userId est obligatoire. Passe-le dans l'appel ou configure JARVIS_USER_ID.");
    }

    const queue = await client.getQueue(userId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(queue, null, 2),
        },
      ],
    };
  },
};