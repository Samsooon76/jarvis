import { getSupabaseAdmin } from "../../db/client.js";

export const logProspectAccess = async (input: {
  orgId: string;
  userId: string | null;
  prospectId: string | null;
  source: string;
}): Promise<void> => {
  if (!input.prospectId) {
    return;
  }

  const { error } = await getSupabaseAdmin().from("prospect_access_logs").insert({
    org_id: input.orgId,
    user_id: input.userId,
    prospect_id: input.prospectId,
    source: input.source,
  });

  if (error) {
    throw new Error(`Impossible de journaliser l'acces prospect: ${error.message}`);
  }
};
