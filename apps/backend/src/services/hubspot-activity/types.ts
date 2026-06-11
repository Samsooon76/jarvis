export type HubSpotWebhookEventRow = {
  id: string;
  org_id: string | null;
  portal_id: string;
  subscription_type: string;
  object_type_id: string | null;
  object_id: string | null;
  property_name: string | null;
  property_value: string | null;
  occurred_at: string | null;
  payload: unknown;
  processing_status: string;
};

export type HubSpotActivityUpsertRow = {
  org_id: string;
  hubspot_activity_id: string;
  activity_type: "call" | "communication" | "email" | "note" | "meeting" | "sms";
  activity_channel: string | null;
  hubspot_owner_id: string | null;
  occurred_at: string | null;
  title: string | null;
  body: string | null;
  direction: string | null;
  status: string | null;
  disposition: string | null;
  source_object_type_id: string | null;
  source_object_type: string | null;
  properties: Record<string, string | null>;
  associated_contact_ids: string[];
  associated_company_ids: string[];
  associated_deal_ids: string[];
  last_hubspot_event_at: string | null;
  synced_at: string;
};

export type HubSpotRealtimeAnalysisRunRow = {
  id: string;
  org_id: string;
  hubspot_deal_id: string;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  scheduled_for: string;
  trigger_event_ids: string[];
};

export type ProspectLookupRow = {
  id: string;
  owner_user_id: string | null;
};

export type HubSpotDealLookupRow = {
  hubspot_deal_id: string;
  hubspot_owner_id?: string | null;
};

export type HubSpotDealStageLookupRow = {
  stage_id: string;
  stage_label: string;
  pipeline_id: string;
  pipeline_label: string | null;
  is_closed: boolean | null;
  probability: number | string | null;
};

export type DealLifecycleStatus = "pending" | "won" | "lost";

export type HubSpotActivityLookupRow = {
  hubspot_activity_id: string;
  activity_type: "call" | "communication" | "email" | "note" | "meeting" | "sms";
  associated_deal_ids: string[];
};

export type JsonRecord = Record<string, unknown>;
