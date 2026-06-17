import type {
  PlaybookEvidenceKind,
  JsonObject,
  JsonValue,
  PlaybookOverview,
  PlaybookSuggestionKind,
  PlaybookSuggestionStatus,
  PlaybookPlayCategory,
  PlaybookPlaySource,
  PlaybookPlayStatus,
  PlaybookStatus,
} from "@jarvis/shared";

export type PlaybookOverviewRow = PlaybookOverview;

export type PlaybookRow = {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  overview: PlaybookOverviewRow | null;
  status: PlaybookStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PlaybookPlayRow = {
  id: string;
  org_id: string;
  playbook_id: string;
  category: PlaybookPlayCategory;
  title: string;
  trigger_description: string;
  recommended_response: string;
  status: PlaybookPlayStatus;
  source: PlaybookPlaySource;
  position: number;
  version: number;
  created_at: string;
  updated_at: string;
};

export type PlaybookPlayEvidenceRow = {
  id: string;
  org_id: string;
  play_id: string;
  kind: PlaybookEvidenceKind;
  ref_id: string;
  note: string | null;
  created_at: string;
};

export type PlaybookSuggestionRow = {
  id: string;
  org_id: string;
  playbook_id: string;
  kind: PlaybookSuggestionKind;
  payload: JsonObject;
  rationale: string;
  evidence: JsonValue[];
  status: PlaybookSuggestionStatus;
  source: string;
  source_key: string | null;
  confidence: number | null;
  cooldown_until: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
};

export type PlaybookActivityEvidenceRow = {
  id: string;
  hubspot_deal_id: string | null;
  event_type: string;
  channel: string;
  occurred_at: string;
  payload: JsonObject;
};

export type CreatePlaybookInput = {
  orgId: string;
  name: string;
  description?: string | null;
  createdBy?: string | null;
};

export type UpdatePlaybookInput = {
  name?: string;
  description?: string | null;
  status?: PlaybookStatus;
};

export type UpdatePlayInput = {
  category?: PlaybookPlayCategory;
  title?: string;
  triggerDescription?: string;
  recommendedResponse?: string;
  status?: PlaybookPlayStatus;
  evidence?: Array<{ kind: PlaybookEvidenceKind; refId: string; note?: string | null }>;
};
