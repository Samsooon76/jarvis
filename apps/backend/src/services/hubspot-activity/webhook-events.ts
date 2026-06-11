import { getSupabaseAdmin } from "../../db/client.js";
import type { HubSpotWebhookEventRow } from "./types.js";

export const loadWebhookEvent = async (eventId: string): Promise<HubSpotWebhookEventRow | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("hubspot_webhook_events")
    .select(
      "id, org_id, portal_id, subscription_type, object_type_id, object_id, property_name, property_value, occurred_at, payload, processing_status",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger l'evenement webhook HubSpot: ${error.message}`);
  }

  return data as HubSpotWebhookEventRow | null;
};

export const updateWebhookEventStatus = async (
  eventId: string,
  status: "processing" | "completed" | "failed" | "ignored",
  errorMessage: string | null = null,
): Promise<boolean> => {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("hubspot_webhook_events")
    .update({
      processing_status: status,
      error_message: errorMessage,
      processed_at: status === "completed" || status === "failed" || status === "ignored" ? new Date().toISOString() : null,
    })
    .eq("id", eventId);

  if (status === "processing") {
    query = query.eq("processing_status", "queued");
  }

  const { data, error } = await query.select("id");

  if (error) {
    throw new Error(`Impossible de mettre a jour l'evenement webhook HubSpot: ${error.message}`);
  }

  return (data?.length ?? 0) > 0;
};
