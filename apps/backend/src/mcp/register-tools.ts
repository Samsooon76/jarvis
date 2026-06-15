import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ManagerDigestPeriod } from "@jarvis/shared";
import { getSupabaseAdmin } from "../db/client.js";
import { analyzeDealIntelligenceForProspect } from "../services/deal-intelligence.service.js";
import { getForecastOverview } from "../services/forecast.service.js";
import { askJarvis } from "../services/llm/ask.service.js";
import { getOrCreateManagerDigest } from "../services/manager-digest.service.js";
import { getUserQueue } from "../services/prospects/queue.service.js";
import type { JarvisMcpRuntimeContext } from "./context.js";

const toJsonContent = (payload: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: JSON.stringify(payload, null, 2),
    },
  ],
});

const toErrorContent = (message: string) => ({
  content: [
    {
      type: "text" as const,
      text: message,
    },
  ],
  isError: true as const,
});

const loadProspectDetail = async (prospectId: string) => {
  const { data, error } = await getSupabaseAdmin()
    .from("prospects")
    .select(
      "id, org_id, owner_user_id, name, company, title, email, phone, deal_stage, deal_amount, close_probability, last_contact_at, next_action, ai_summary, ai_priority_score, hubspot_contact_id, hubspot_deal_id",
    )
    .eq("id", prospectId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le prospect: ${error.message}`);
  }

  if (!data) {
    throw new Error("Prospect introuvable.");
  }

  return {
    id: String(data.id),
    orgId: String(data.org_id),
    ownerUserId: typeof data.owner_user_id === "string" ? data.owner_user_id : null,
    name: String(data.name),
    company: typeof data.company === "string" ? data.company : null,
    title: typeof data.title === "string" ? data.title : null,
    email: typeof data.email === "string" ? data.email : null,
    phone: typeof data.phone === "string" ? data.phone : null,
    dealStage: typeof data.deal_stage === "string" ? data.deal_stage : null,
    dealAmount: typeof data.deal_amount === "number" ? data.deal_amount : null,
    closeProbability: Number(data.close_probability ?? 0),
    lastContactAt: typeof data.last_contact_at === "string" ? data.last_contact_at : null,
    nextAction: typeof data.next_action === "string" ? data.next_action : null,
    aiSummary: typeof data.ai_summary === "string" ? data.ai_summary : null,
    aiPriorityScore: Number(data.ai_priority_score ?? 0),
    hubspotContactId: String(data.hubspot_contact_id),
    hubspotDealId: typeof data.hubspot_deal_id === "string" ? data.hubspot_deal_id : null,
  };
};

export const registerJarvisMcpTools = (server: McpServer, context: JarvisMcpRuntimeContext): void => {
  server.tool(
    "ask_jarvis",
    "Pose une question libre a Jarvis avec contexte CRM (forecast, deal, queue).",
    {
      question: z.string().min(1),
      prospectId: z.string().uuid().optional(),
      hubspotDealId: z.string().optional(),
      userId: z.string().uuid().optional(),
      includeQueue: z.boolean().optional(),
    },
    async (input) => {
      try {
        return toJsonContent(
          await askJarvis({
            question: input.question,
            orgId: context.orgId,
            prospectId: input.prospectId ?? null,
            hubspotDealId: input.hubspotDealId ?? null,
            userId: input.userId ?? context.userId,
            includeQueue: input.includeQueue ?? false,
          }),
        );
      } catch (error) {
        return toErrorContent(error instanceof Error ? error.message : "Erreur ask_jarvis.");
      }
    },
  );

  server.tool(
    "get_forecast",
    "Charge la vue forecast Jarvis (pipeline, risques, deals ouverts, synthese IA).",
    {
      scope: z.enum(["all", "owner"]).optional(),
      hubspotOwnerId: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    },
    async (input) => {
      try {
        if (input.scope === "owner" && !input.hubspotOwnerId?.trim()) {
          throw new Error("hubspotOwnerId est obligatoire quand scope=owner.");
        }

        return toJsonContent(
          await getForecastOverview({
            orgId: context.orgId,
            scope: input.scope ?? "all",
            hubspotOwnerId: input.hubspotOwnerId ?? null,
            dateFrom: input.dateFrom ?? null,
            dateTo: input.dateTo ?? null,
          }),
        );
      } catch (error) {
        return toErrorContent(error instanceof Error ? error.message : "Erreur get_forecast.");
      }
    },
  );

  server.tool(
    "get_manager_digest",
    "Genere ou charge le digest manager Jarvis (highlights, deals a risque, coaching).",
    {
      period: z.enum(["daily", "weekly"]).optional(),
    },
    async (input) => {
      try {
        if (!context.userId) {
          throw new Error("Aucun manager/admin Jarvis disponible pour generer le digest.");
        }

        const period = (input.period ?? "daily") as ManagerDigestPeriod;

        return toJsonContent(
          await getOrCreateManagerDigest(
            {
              userId: context.userId,
              orgId: context.orgId,
              role: context.role,
            },
            period,
          ),
        );
      } catch (error) {
        return toErrorContent(error instanceof Error ? error.message : "Erreur get_manager_digest.");
      }
    },
  );

  server.tool(
    "get_queue",
    "Charge la morning queue priorisee d'un commercial Jarvis.",
    {
      userId: z.string().uuid().optional(),
    },
    async (input) => {
      try {
        const userId = input.userId ?? context.userId;

        if (!userId) {
          throw new Error("userId est obligatoire pour charger la queue.");
        }

        const { payload } = await getUserQueue(userId);

        return toJsonContent(payload);
      } catch (error) {
        return toErrorContent(error instanceof Error ? error.message : "Erreur get_queue.");
      }
    },
  );

  server.tool(
    "get_prospect",
    "Charge la fiche prospect Jarvis (deal, contact, score, prochaine action).",
    {
      prospectId: z.string().uuid(),
    },
    async (input) => {
      try {
        const prospect = await loadProspectDetail(input.prospectId);

        if (prospect.orgId !== context.orgId) {
          throw new Error("Ce prospect n'appartient pas a l'organisation de cette session MCP.");
        }

        return toJsonContent(prospect);
      } catch (error) {
        return toErrorContent(error instanceof Error ? error.message : "Erreur get_prospect.");
      }
    },
  );

  server.tool(
    "analyze_deal",
    "Lance l'analyse deal intelligence Jarvis sur un prospect.",
    {
      prospectId: z.string().uuid(),
      refresh: z.boolean().optional(),
    },
    async (input) => {
      try {
        return toJsonContent(
          await analyzeDealIntelligenceForProspect(input.prospectId, {
            orgId: context.orgId,
            refresh: input.refresh ?? false,
          }),
        );
      } catch (error) {
        return toErrorContent(error instanceof Error ? error.message : "Erreur analyze_deal.");
      }
    },
  );
};