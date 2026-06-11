import { env } from "../../config/env.js";
import { getSupabaseAdmin } from "../../db/client.js";
import { analyzeDealActivityPlanForProspect } from "../deal-intelligence.service.js";
import { resolveLlmProviderPreference } from "../llm/provider-preference.service.js";
import { enqueueHubSpotRealtimeJob } from "../hubspot-realtime-queue.service.js";
import { toIsoFromNow } from "./shared.js";
import type { HubSpotRealtimeAnalysisRunRow } from "./types.js";

export const scheduleDealReanalysis = async (
  orgId: string,
  hubspotDealId: string,
  triggerEventId: string | null,
  reason: string,
): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const delayMs = Math.max(10, env.hubspotWebhookDebounceSeconds) * 1000;
  const scheduledFor = toIsoFromNow(delayMs);
  const { data: existingRunData, error: existingRunError } = await supabase
    .from("hubspot_realtime_analysis_runs")
    .select("id, org_id, hubspot_deal_id, status, scheduled_for, trigger_event_ids")
    .eq("org_id", orgId)
    .eq("hubspot_deal_id", hubspotDealId)
    .eq("status", "queued")
    .order("scheduled_for", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingRunError) {
    throw new Error(`Impossible de charger le run d'analyse realtime: ${existingRunError.message}`);
  }

  const existingRun = existingRunData as HubSpotRealtimeAnalysisRunRow | null;
  const triggerEventIds = Array.from(
    new Set([...(existingRun?.trigger_event_ids ?? []), triggerEventId].filter((id): id is string => Boolean(id))),
  );

  if (existingRun) {
    const { error } = await supabase
      .from("hubspot_realtime_analysis_runs")
      .update({
        scheduled_for: scheduledFor,
        trigger_event_ids: triggerEventIds,
        reason,
      })
      .eq("id", existingRun.id);

    if (error) {
      throw new Error(`Impossible de debouncer l'analyse realtime: ${error.message}`);
    }

    await enqueueHubSpotRealtimeJob(
      {
        type: "reanalyse-deal",
        runId: existingRun.id,
      },
      {
        delay: delayMs,
      },
    );
    return;
  }

  const { data: insertedRunData, error: insertError } = await supabase
    .from("hubspot_realtime_analysis_runs")
    .insert({
      org_id: orgId,
      hubspot_deal_id: hubspotDealId,
      status: "queued",
      reason,
      scheduled_for: scheduledFor,
      trigger_event_ids: triggerEventIds,
    })
    .select("id")
    .single();

  if (insertError) {
    throw new Error(`Impossible de planifier l'analyse realtime: ${insertError.message}`);
  }

  const insertedRun = insertedRunData as { id: string };

  await enqueueHubSpotRealtimeJob(
    {
      type: "reanalyse-deal",
      runId: insertedRun.id,
    },
    {
      delay: delayMs,
    },
  );
};

// Invalide le cache d'analyses IA du deal avant la reanalyse webhook, pour que
// refresh:false regenere une analyse a partir des nouvelles donnees HubSpot.
const invalidateDealAiAnalyses = async (orgId: string, hubspotDealId: string): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("deal_ai_analyses")
    .delete()
    .eq("org_id", orgId)
    .eq("hubspot_deal_id", hubspotDealId);

  if (error && error.code !== "42P01" && error.code !== "PGRST205") {
    throw new Error(`Impossible d'invalider le cache d'analyses IA du deal: ${error.message}`);
  }
};

export const runHubSpotDealReanalysis = async (runId: string): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("hubspot_realtime_analysis_runs")
    .select("id, org_id, hubspot_deal_id, status, scheduled_for, trigger_event_ids")
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le run d'analyse realtime: ${error.message}`);
  }

  const run = data as HubSpotRealtimeAnalysisRunRow | null;

  if (!run || run.status !== "queued") {
    return;
  }

  const scheduledAtMs = new Date(run.scheduled_for).getTime();

  if (Number.isFinite(scheduledAtMs) && scheduledAtMs > Date.now()) {
    await enqueueHubSpotRealtimeJob(
      {
        type: "reanalyse-deal",
        runId,
      },
      {
        delay: scheduledAtMs - Date.now(),
      },
    );
    return;
  }

  const { data: startedRows, error: startError } = await supabase
    .from("hubspot_realtime_analysis_runs")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", run.id)
    .eq("status", "queued")
    .select("id");

  if (startError) {
    throw new Error(`Impossible de demarrer l'analyse realtime: ${startError.message}`);
  }

  if ((startedRows?.length ?? 0) === 0) {
    return;
  }

  try {
    await invalidateDealAiAnalyses(run.org_id, run.hubspot_deal_id);

    const { data: prospectData, error: prospectError } = await supabase
      .from("prospects")
      .select("id")
      .eq("org_id", run.org_id)
      .eq("hubspot_deal_id", run.hubspot_deal_id)
      .limit(1)
      .maybeSingle();

    if (prospectError) {
      throw new Error(`Impossible de charger le prospect du deal realtime: ${prospectError.message}`);
    }

    const prospectId = (prospectData as { id: string } | null)?.id ?? `hubspot:${run.hubspot_deal_id}`;

    const llmPreference = await resolveLlmProviderPreference(run.org_id);

    await analyzeDealActivityPlanForProspect(prospectId, {
      orgId: run.org_id,
      hubspotDealId: run.hubspot_deal_id,
      llmProvider: llmPreference.provider,
      llmModel: llmPreference.model,
      refresh: false,
    });

    const { error: completeError } = await supabase
      .from("hubspot_realtime_analysis_runs")
      .update({
        status: "completed",
        finished_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", run.id);

    if (completeError) {
      throw new Error(`Impossible de finaliser l'analyse realtime: ${completeError.message}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue pendant l'analyse realtime.";
    await supabase
      .from("hubspot_realtime_analysis_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: message,
      })
      .eq("id", run.id);
    throw error;
  }
};
