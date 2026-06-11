import { getSupabaseAdmin } from "../../db/client.js";
import { captureServerError } from "../../lib/sentry.js";
import { analyzeCloseLostDeal } from "../close-lost-analysis.service.js";
import { CLOSING_PROBABILITY_PROPERTY, recordDealProbabilityPoint } from "../deal-probability.service.js";
import { resolveForecastSnapshotsForDeal } from "../forecast-snapshot.service.js";
import { analyzeWinDeal } from "../win-analysis.service.js";
import {
  normalizeStageProbability,
  normalizeWebhookDate,
  parseManualProbability,
  parseWebhookAmount,
  parseWebhookProbability,
  resolveDealLifecycleStatusFromStage,
} from "./shared.js";
import type { DealLifecycleStatus, HubSpotDealStageLookupRow } from "./types.js";

const loadDealStageLookupRow = async (
  orgId: string,
  stageId: string | null,
): Promise<HubSpotDealStageLookupRow | null> => {
  if (!stageId) {
    return null;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("hubspot_deal_stages")
    .select("stage_id, stage_label, pipeline_id, pipeline_label, is_closed, probability")
    .eq("org_id", orgId)
    .eq("stage_id", stageId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le stage HubSpot: ${error.message}`);
  }

  return data as HubSpotDealStageLookupRow | null;
};

export const runClosedDealAutomation = async (
  orgId: string,
  hubspotDealId: string,
  lifecycleStatus: DealLifecycleStatus,
  eventId: string | null,
): Promise<void> => {
  if (lifecycleStatus === "pending") {
    return;
  }

  try {
    await resolveForecastSnapshotsForDeal(orgId, hubspotDealId);
  } catch (snapshotError) {
    void captureServerError(snapshotError, { scope: "forecast-snapshots", eventId, orgId, hubspotDealId });
  }

  try {
    if (lifecycleStatus === "won") {
      await analyzeWinDeal(orgId, hubspotDealId, false);
    } else {
      await analyzeCloseLostDeal(orgId, hubspotDealId, null, null, false);
    }
  } catch (analysisError) {
    void captureServerError(analysisError, {
      scope: lifecycleStatus === "won" ? "close-won-auto-analysis" : "close-lost-auto-analysis",
      eventId,
      orgId,
      hubspotDealId,
    });
  }
};

// Applique directement la nouvelle valeur portee par le webhook HubSpot
// (property_name / property_value) sur la base Jarvis, sans rappeler l'API.
export const applyDealPropertyChangeFromWebhook = async (
  orgId: string,
  hubspotDealId: string,
  propertyName: string | null,
  propertyValue: string | null,
  occurredAt: string | null,
): Promise<{ lifecycleStatus: DealLifecycleStatus | null }> => {
  if (
    propertyName !== "amount" &&
    propertyName !== "closedate" &&
    propertyName !== "dealstage" &&
    propertyName !== "hs_deal_stage_probability" &&
    propertyName !== "probabilite_de__closing"
  ) {
    return { lifecycleStatus: null };
  }

  const supabase = getSupabaseAdmin();
  const syncedAt = new Date().toISOString();

  if (propertyName === "hs_deal_stage_probability" || propertyName === "probabilite_de__closing") {
    const closeProbability =
      propertyName === "probabilite_de__closing"
        ? parseManualProbability(propertyValue)
        : parseWebhookProbability(propertyValue);

    if (closeProbability === null) {
      return { lifecycleStatus: null };
    }

    const { error: dealError } = await supabase
      .from("hubspot_deals")
      .update({ close_probability: closeProbability, synced_at: syncedAt })
      .eq("org_id", orgId)
      .eq("hubspot_deal_id", hubspotDealId);

    if (dealError) {
      throw new Error(`Impossible de mettre a jour la probabilite du deal HubSpot: ${dealError.message}`);
    }

    const { error: prospectError } = await supabase
      .from("prospects")
      .update({ close_probability: closeProbability, synced_at: syncedAt })
      .eq("org_id", orgId)
      .eq("hubspot_deal_id", hubspotDealId);

    if (prospectError) {
      throw new Error(`Impossible de mettre a jour la probabilite du prospect HubSpot: ${prospectError.message}`);
    }

    // On historise uniquement la propriete custom suivie dans les dashboards.
    if (propertyName === CLOSING_PROBABILITY_PROPERTY) {
      const { data: ownerData } = await supabase
        .from("hubspot_deals")
        .select("hubspot_owner_id")
        .eq("org_id", orgId)
        .eq("hubspot_deal_id", hubspotDealId)
        .maybeSingle();

      await recordDealProbabilityPoint({
        orgId,
        hubspotDealId,
        hubspotOwnerId: (ownerData as { hubspot_owner_id: string | null } | null)?.hubspot_owner_id ?? null,
        probability: closeProbability,
        recordedAt: normalizeWebhookDate(occurredAt) ?? syncedAt,
        source: "webhook",
      });
    }

    return { lifecycleStatus: null };
  }

  if (propertyName === "amount") {
    const amount = parseWebhookAmount(propertyValue);
    const { error: dealError } = await supabase
      .from("hubspot_deals")
      .update({ amount, synced_at: syncedAt })
      .eq("org_id", orgId)
      .eq("hubspot_deal_id", hubspotDealId);

    if (dealError) {
      throw new Error(`Impossible de mettre a jour le montant du deal HubSpot: ${dealError.message}`);
    }

    const { error: prospectError } = await supabase
      .from("prospects")
      .update({ deal_amount: amount, synced_at: syncedAt })
      .eq("org_id", orgId)
      .eq("hubspot_deal_id", hubspotDealId);

    if (prospectError) {
      throw new Error(`Impossible de mettre a jour le montant du prospect HubSpot: ${prospectError.message}`);
    }

    return { lifecycleStatus: null };
  }

  if (propertyName === "dealstage") {
    const stage = await loadDealStageLookupRow(orgId, propertyValue);
    const lifecycleStatus = resolveDealLifecycleStatusFromStage(propertyValue, stage);
    const closedAt = normalizeWebhookDate(occurredAt) ?? new Date().toISOString();
    const updates: {
      deal_stage: string | null;
      deal_stage_label: string | null;
      pipeline: string | null;
      pipeline_label: string | null;
      deal_lifecycle_status: DealLifecycleStatus;
      is_closed_deal: boolean;
      close_probability: number;
      closed_at?: string;
      synced_at: string;
    } = {
      deal_stage: propertyValue,
      deal_stage_label: stage?.stage_label ?? propertyValue,
      pipeline: stage?.pipeline_id ?? null,
      pipeline_label: stage?.pipeline_label ?? null,
      deal_lifecycle_status: lifecycleStatus,
      is_closed_deal: lifecycleStatus !== "pending",
      close_probability:
        lifecycleStatus === "won" ? 100 : lifecycleStatus === "lost" ? 0 : normalizeStageProbability(stage?.probability ?? null),
      synced_at: syncedAt,
    };

    if (lifecycleStatus !== "pending") {
      updates.closed_at = closedAt;
    }

    const { error: dealError } = await supabase
      .from("hubspot_deals")
      .update(updates)
      .eq("org_id", orgId)
      .eq("hubspot_deal_id", hubspotDealId);

    if (dealError) {
      throw new Error(`Impossible de mettre a jour le stage du deal HubSpot: ${dealError.message}`);
    }

    const { error: prospectError } = await supabase
      .from("prospects")
      .update({
        deal_stage: stage?.stage_label ?? propertyValue,
        close_probability: updates.close_probability,
        synced_at: syncedAt,
      })
      .eq("org_id", orgId)
      .eq("hubspot_deal_id", hubspotDealId);

    if (prospectError) {
      throw new Error(`Impossible de mettre a jour le stage du prospect HubSpot: ${prospectError.message}`);
    }

    return { lifecycleStatus };
  }

  const closedAt = normalizeWebhookDate(propertyValue);
  const { error: closedError } = await supabase
    .from("hubspot_deals")
    .update({ closed_at: closedAt, synced_at: syncedAt })
    .eq("org_id", orgId)
    .eq("hubspot_deal_id", hubspotDealId);

  if (closedError) {
    throw new Error(`Impossible de mettre a jour la date de closing du deal HubSpot: ${closedError.message}`);
  }

  return { lifecycleStatus: null };
};
