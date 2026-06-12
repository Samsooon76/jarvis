import { captureServerError } from "../../lib/sentry.js";
import type { HubSpotActivityType } from "../hubspot.service.js";
import type { HubSpotRealtimeJob } from "../hubspot-realtime-queue.service.js";
import {
  buildPulseDealCreatedSourceEventId,
  generatePulseNotificationsForDealWebhookEvent,
  generatePulseNotificationsForNewDeal,
} from "../pulse.service.js";
import { filterEligibleRealtimeDealIds, hydrateActivity } from "./activity-ingestion.js";
import { applyDealPropertyChangeFromWebhook, runClosedDealAutomation } from "./deal-property-sync.js";
import { acceptNormalizedDealWebhookEvent } from "./normalized-events.js";
import { purgePrivacyDeletedContact } from "./privacy-purge.js";
import { runHubSpotDealReanalysis, scheduleDealReanalysis } from "./reanalysis.js";
import {
  DEAL_OBJECT_TYPE_IDS,
  asRecord,
  isInterestingDealProperty,
  resolveActivityTarget,
  resolveAssociationActivityTarget,
  resolveAssociationDealId,
} from "./shared.js";
import { loadWebhookEvent, updateWebhookEventStatus } from "./webhook-events.js";

const processHubSpotWebhookEvent = async (eventId: string): Promise<void> => {
  const event = await loadWebhookEvent(eventId);

  if (!event) {
    return;
  }

  if (!event.org_id) {
    await updateWebhookEventStatus(event.id, "ignored", "Evenement sans organisation Jarvis.");
    return;
  }

  const lockedForProcessing = await updateWebhookEventStatus(event.id, "processing");

  if (!lockedForProcessing) {
    return;
  }

  try {
    const payload = asRecord(event.payload);
    const directActivityTarget = resolveActivityTarget(event.object_type_id, event.object_id);
    const associationActivityTarget =
      event.subscription_type === "object.associationChange" ? resolveAssociationActivityTarget(payload) : null;
    const activityTarget = directActivityTarget ?? associationActivityTarget;
    const scheduleDelayedRehydrate =
      event.subscription_type === "object.creation" || event.subscription_type.endsWith(".creation");

    if (event.subscription_type === "contact.privacyDeletion" && event.object_id) {
      await purgePrivacyDeletedContact(event.org_id, event.object_id);
      await updateWebhookEventStatus(event.id, "completed");
      return;
    }

    if (activityTarget) {
      await hydrateActivity(
        event.org_id,
        activityTarget.activityType,
        activityTarget.hubspotActivityId,
        event,
        scheduleDelayedRehydrate,
      );
      await updateWebhookEventStatus(event.id, "completed");
      return;
    }

    const associationDealId =
      event.subscription_type === "object.associationChange" ? resolveAssociationDealId(payload) : null;
    const legacyDealId = event.subscription_type.startsWith("deal.") ? event.object_id : null;
    const dealId =
      (event.object_type_id && DEAL_OBJECT_TYPE_IDS.has(event.object_type_id) ? event.object_id : null) ??
      associationDealId ??
      legacyDealId;

    if (dealId && (event.subscription_type === "object.creation" || event.subscription_type === "deal.creation")) {
      await acceptNormalizedDealWebhookEvent({
        event,
        hubspotDealId: dealId,
        lifecycleStatus: null,
      });

      try {
        await generatePulseNotificationsForNewDeal({
          orgId: event.org_id,
          sourceEventId: buildPulseDealCreatedSourceEventId(event.org_id, dealId),
          hubspotDealId: dealId,
          dealName: null,
          amount: null,
          stageLabel: null,
          occurredAt: event.occurred_at,
        });
      } catch (pulseError) {
        void captureServerError(pulseError, { scope: "jarvis-pulse", eventId: event.id });
      }

      await updateWebhookEventStatus(event.id, "completed");
      return;
    }

    if (dealId && isInterestingDealProperty(event.property_name)) {
      const isStageChange = event.property_name === "dealstage";
      const [eligibleDealId] = await filterEligibleRealtimeDealIds(event.org_id, [dealId], {
        includeClosed: isStageChange,
      });

      if (!eligibleDealId) {
        await updateWebhookEventStatus(event.id, "ignored", "Deal hors scope realtime: ferme ou hors Sales AE.");
        return;
      }

      // Jarvis Pulse: genere les notifications AVANT d'appliquer la nouvelle valeur,
      // pour que la base contienne encore l'ancienne valeur (transition avant -> apres).
      // Best-effort: un echec Pulse ne doit jamais bloquer la sync temps reel.
      try {
        await generatePulseNotificationsForDealWebhookEvent({
          eventId: event.id,
          orgId: event.org_id,
          hubspotDealId: eligibleDealId,
          propertyName: event.property_name,
          propertyValue: event.property_value,
          occurredAt: event.occurred_at,
        });
      } catch (pulseError) {
        // On capture l'erreur pour observabilite sans bloquer le pipeline.
        void captureServerError(pulseError, { scope: "jarvis-pulse", eventId: event.id });
      }

      const appliedChange = await applyDealPropertyChangeFromWebhook(
        event.org_id,
        eligibleDealId,
        event.property_name,
        event.property_value,
        event.occurred_at,
      );

      await acceptNormalizedDealWebhookEvent({
        event,
        hubspotDealId: eligibleDealId,
        lifecycleStatus: appliedChange.lifecycleStatus,
      });

      if (isStageChange && appliedChange.lifecycleStatus) {
        await runClosedDealAutomation(event.org_id, eligibleDealId, appliedChange.lifecycleStatus, event.id);
      }

      if (appliedChange.lifecycleStatus !== "won" && appliedChange.lifecycleStatus !== "lost") {
        await scheduleDealReanalysis(event.org_id, eligibleDealId, event.id, "Changement HubSpot sur le deal");
      }
      await updateWebhookEventStatus(event.id, "completed");
      return;
    }

    await updateWebhookEventStatus(event.id, "ignored", "Type d'evenement HubSpot non exploite pour le realtime.");
  } catch (error) {
    await updateWebhookEventStatus(
      event.id,
      "failed",
      error instanceof Error ? error.message : "Erreur inconnue pendant le traitement webhook HubSpot.",
    );
    throw error;
  }
};

const rehydrateHubSpotActivity = async (
  orgId: string,
  activityType: HubSpotActivityType,
  hubspotActivityId: string,
): Promise<void> => {
  await hydrateActivity(orgId, activityType, hubspotActivityId, null, false);
};

export const processHubSpotRealtimeJob = async (job: HubSpotRealtimeJob): Promise<void> => {
  if (job.type === "process-webhook-event") {
    await processHubSpotWebhookEvent(job.eventId);
    return;
  }

  if (job.type === "rehydrate-activity") {
    await rehydrateHubSpotActivity(job.orgId, job.activityType, job.hubspotActivityId);
    return;
  }

  await runHubSpotDealReanalysis(job.runId);
};
