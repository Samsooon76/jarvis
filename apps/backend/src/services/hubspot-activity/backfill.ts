import { getSupabaseAdmin } from "../../db/client.js";
import { getHubSpotAccessToken } from "../hubspot-auth.service.js";
import { hubSpotService, type HubSpotActivityType } from "../hubspot.service.js";
import { upsertHubSpotActivity } from "./activity-ingestion.js";

// --- Backfill des activites sur deals clotures -------------------------------
// Le flux temps-reel ne relie les activites qu'aux deals OUVERTS. Une fois un deal
// gagne/perdu, plus aucun lien n'est cree, et l'historique n'a jamais ete importe.
// Ce backfill va chercher dans HubSpot les activites (call/meeting/communication)
// directement associees aux deals clotures du perimetre deja synchronise, et les
// relie explicitement au deal. On le scope par date de cloture (ex: 2025) pour
// limiter le volume d'appels API.

const ACTIVITY_BACKFILL_CONCURRENCY = 4;
const SALES_ACTIVITY_BACKFILL_TYPES = ["call", "meeting", "communication", "email"] as const satisfies readonly HubSpotActivityType[];

export type SalesActivityBackfillResult = {
  dealsProcessed: number;
  activitiesUpserted: number;
};

const backfillSingleDealActivities = async (
  orgId: string,
  accessToken: string,
  dealId: string,
): Promise<number> => {
  let idsByType: { call: string[]; meeting: string[]; communication: string[]; email: string[] };

  try {
    idsByType = await hubSpotService.fetchDealSalesActivityIds(accessToken, dealId);
  } catch {
    // Un blip reseau sur un deal ne doit pas interrompre tout le backfill.
    return 0;
  }

  const byType: Record<"call" | "meeting" | "communication" | "email", string[]> = {
    call: idsByType.call,
    meeting: idsByType.meeting,
    communication: idsByType.communication,
    email: idsByType.email,
  };

  let upserted = 0;

  for (const activityType of SALES_ACTIVITY_BACKFILL_TYPES) {
    for (const activityId of byType[activityType]) {
      try {
        const activity = await hubSpotService.fetchActivity(accessToken, activityType, activityId);
        // On relie explicitement au deal cloture connu (sans filtre "deal ouvert").
        await upsertHubSpotActivity(orgId, activity, [dealId], null);
        upserted += 1;
      } catch {
        // Une activite illisible ne doit pas interrompre le backfill complet.
      }
    }
  }

  return upserted;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Token robuste aux blips reseau : quelques tentatives avant d'abandonner.
const resolveAccessTokenWithRetry = async (orgId: string, attempts = 4): Promise<string> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await getHubSpotAccessToken(orgId);
    } catch (error) {
      lastError = error;
      await sleep(500 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Impossible de recuperer le token HubSpot.");
};

export const backfillClosedDealActivities = async (
  orgId: string,
  options: { closedFrom: string | null; closedTo: string | null },
): Promise<SalesActivityBackfillResult> => {
  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("hubspot_deals")
    .select("hubspot_deal_id, closed_at")
    .eq("org_id", orgId)
    .in("deal_lifecycle_status", ["won", "lost"]);

  if (options.closedFrom) {
    query = query.gte("closed_at", new Date(options.closedFrom).toISOString());
  }

  if (options.closedTo) {
    const toBound = new Date(options.closedTo);
    toBound.setUTCHours(23, 59, 59, 999);
    query = query.lte("closed_at", toBound.toISOString());
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Impossible de charger les deals clotures pour le backfill: ${error.message}`);
  }

  const dealIds = ((data ?? []) as Array<{ hubspot_deal_id: string }>).map((row) => row.hubspot_deal_id);
  let activitiesUpserted = 0;
  let accessToken = await resolveAccessTokenWithRetry(orgId);

  for (let index = 0; index < dealIds.length; index += ACTIVITY_BACKFILL_CONCURRENCY) {
    const batch = dealIds.slice(index, index + ACTIVITY_BACKFILL_CONCURRENCY);
    // Token rafraichi a chaque batch : un backfill long depasse la duree de vie d'un token.
    // En cas de blip reseau on conserve le dernier token valide.
    try {
      accessToken = await resolveAccessTokenWithRetry(orgId);
    } catch {
      // On reutilise le token precedent.
    }
    const counts = await Promise.all(
      batch.map((dealId) => backfillSingleDealActivities(orgId, accessToken, dealId)),
    );
    activitiesUpserted += counts.reduce((sum, count) => sum + count, 0);
  }

  return { dealsProcessed: dealIds.length, activitiesUpserted };
};
