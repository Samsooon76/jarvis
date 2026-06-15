import { z } from "zod";
import type { JarvisToolDefinition } from "./types.js";

const inputSchema = z.object({
  orgId: z.string().uuid().optional().describe("UUID organisation Jarvis. Utilise JARVIS_ORG_ID par defaut."),
  scope: z.enum(["all", "owner"]).optional().describe("Perimetre: toute l'org (all, manager/admin) ou un owner HubSpot (owner)."),
  hubspotOwnerId: z.string().optional().describe("ID owner HubSpot. Obligatoire si scope=owner."),
  dateFrom: z.string().optional().describe("Date de debut ISO (YYYY-MM-DD)."),
  dateTo: z.string().optional().describe("Date de fin ISO (YYYY-MM-DD)."),
});

export const getForecastTool: JarvisToolDefinition = {
  name: "get_forecast",
  description:
    "Charge la vue forecast Jarvis (pipeline, scenarios, risques, deals ouverts analyses, synthese IA). Scope all reserve aux managers/admins.",
  inputSchema,
  handler: async (rawInput, { client }) => {
    const input = inputSchema.parse(rawInput);
    const orgId = input.orgId ?? client.defaultOrgId;

    if (!orgId) {
      throw new Error("orgId est obligatoire. Passe-le dans l'appel ou configure JARVIS_ORG_ID.");
    }

    if (input.scope === "owner" && !input.hubspotOwnerId?.trim()) {
      throw new Error("hubspotOwnerId est obligatoire quand scope=owner.");
    }

    const forecast = await client.getForecastOverview({
      orgId,
      scope: input.scope,
      hubspotOwnerId: input.hubspotOwnerId,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(forecast, null, 2),
        },
      ],
    };
  },
};