import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@jarvis/shared";
import { getSupabaseAdmin } from "../../db/client.js";
import { formatOperationError, getPublicErrorMessage, isValidOrgId } from "./helpers.js";

type HubSpotDisconnectBody = {
  orgId?: string;
  purgeData?: boolean;
};

type DisconnectResult = {
  orgId: string;
  disconnected: true;
  purgedProspectCount: number;
};

const disconnectHubSpotIntegration = async (
  orgId: string,
  purgeData = true,
): Promise<DisconnectResult> => {
  const supabase = getSupabaseAdmin();

  const { error: integrationError } = await supabase.rpc("set_hubspot_integration", {
    target_org_id: orgId,
    target_access_token: null,
    target_refresh_token: null,
    target_token_expires_at: null,
  });

  if (integrationError) {
    throw new Error(
      formatOperationError("Impossible de reinitialiser l'integration HubSpot", integrationError.message),
    );
  }

  const { error: organizationError } = await supabase
    .from("organizations")
    .update({
      hubspot_portal_id: null,
    })
    .eq("id", orgId);

  if (organizationError) {
    throw new Error(
      formatOperationError("Impossible de reinitialiser l'organisation HubSpot", organizationError.message),
    );
  }

  let purgedProspectCount = 0;

  if (purgeData) {
    const { data: prospectsToDelete, error: prospectsCountError } = await supabase
      .from("prospects")
      .select("id")
      .eq("org_id", orgId)
      .contains("raw_data", { source: "hubspot" });

    if (prospectsCountError) {
      throw new Error(
        formatOperationError("Impossible de lister les prospects HubSpot a purger", prospectsCountError.message),
      );
    }

    purgedProspectCount = prospectsToDelete?.length ?? 0;

    const { error: deleteProspectsError } = await supabase
      .from("prospects")
      .delete()
      .eq("org_id", orgId)
      .contains("raw_data", { source: "hubspot" });

    if (deleteProspectsError) {
      throw new Error(formatOperationError("Impossible de purger les prospects HubSpot", deleteProspectsError.message));
    }
  }

  return {
    orgId,
    disconnected: true,
    purgedProspectCount,
  };
};

export const registerHubSpotDisconnectRoutes = async (app: FastifyInstance): Promise<void> => {
  app.post<{ Body: HubSpotDisconnectBody; Reply: ApiResponse<DisconnectResult> }>(
    "/api/hubspot/disconnect",
    async (request, reply) => {
      const orgId = request.body.orgId;
      const purgeData = request.body.purgeData ?? true;

      if (!orgId) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId est obligatoire pour deconnecter HubSpot.",
        });
      }

      if (!isValidOrgId(orgId)) {
        return reply.code(400).send({
          success: false,
          error: "Le champ orgId doit etre un UUID Jarvis valide.",
        });
      }

      try {
        const result = await disconnectHubSpotIntegration(orgId, purgeData);

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        request.log.error({ error, orgId, purgeData }, "Echec de la deconnexion HubSpot.");

        return reply.code(500).send({
          success: false,
          error: getPublicErrorMessage(error, "Erreur inconnue pendant la deconnexion HubSpot."),
        });
      }
    },
  );
};
