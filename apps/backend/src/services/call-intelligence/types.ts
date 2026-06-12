import type { Json } from "../../db/database.types.js";

export type CallSentiment = "positive" | "neutral" | "negative";
export type CallRiskLevel = "low" | "medium" | "high";
export type CallAnalysisConfidence = "low" | "medium" | "high";

export type CallAiActionItem = {
  title: string;
  owner: "sales" | "customer" | "manager" | "unknown";
  dueInDays: number | null;
  priority: "low" | "medium" | "high";
};

export type CallAiAnalysis = {
  summary: string;
  sentiment: CallSentiment;
  objections: string[];
  nextSteps: CallAiActionItem[];
  risks: string[];
  opportunities: string[];
  coachingTips: string[];
  customerSignals: string[];
  closeProbabilityDelta: number;
  riskLevel: CallRiskLevel;
  confidence: CallAnalysisConfidence;
};

export type CallSource = {
  callId: string;
  orgId: string;
  userId: string | null;
  prospectId: string | null;
  startedAt: string | null;
  durationSeconds: number | null;
  direction: string;
  status: string | null;
  transcript: string | null;
  fallbackNotes: string | null;
  sourceText: string;
  sourceKind: "transcript" | "notes" | "summary";
  // Ids des entrees calls fusionnees (l'appel lui-meme + ses doublons Onoff/Modjo).
  memberCallIds: string[];
};

export type CallAnalysisRow = {
  id: string;
  org_id: string;
  call_id: string;
  user_id: string | null;
  prospect_id: string | null;
  provider: string;
  model: string;
  input_hash: string;
  source_kind: "transcript" | "notes" | "summary";
  analysis: Json;
  generated_at: string;
  created_at: string;
};

export type CallAnalysisRunRow = {
  id: string;
  org_id: string;
  requested_by_user_id: string | null;
  status: "queued" | "running" | "completed" | "failed";
  scope: Json;
  processed_count: number;
  analyzed_count: number;
  skipped_count: number;
  failed_count: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
};
