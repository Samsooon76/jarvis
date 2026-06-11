import type { WinBenchmarkMetrics } from "@jarvis/shared";
import type { CloseWonDealAnalysis, CloseWonPortfolioAnalysis } from "../llm/llm.provider.js";

export type HubSpotDealRow = {
  hubspot_deal_id: string;
  hubspot_owner_id: string | null;
  primary_contact_id: string | null;
  primary_company_id: string | null;
  deal_name: string | null;
  amount: number | string | null;
  pipeline_label: string | null;
  deal_stage: string | null;
  deal_stage_label: string | null;
  deal_lifecycle_status: "pending" | "won" | "lost" | null;
  is_closed_deal: boolean | null;
  hubspot_created_at: string | null;
  closed_at: string | null;
  hubspot_updated_at: string | null;
  synced_at: string;
};

export type DealContext = {
  row: HubSpotDealRow;
  companyName: string | null;
  ownerName: string | null;
};

export type CloseWonAnalysisRow = {
  hubspot_deal_id: string;
  input_hash: string;
  analysis: CloseWonDealAnalysis;
  generated_at: string;
  expires_at: string;
};

export type WinRunRow = {
  id: string;
  org_id: string;
  provider: string;
  model: string;
  date_from: string;
  date_to: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  current_step: string;
  logs: unknown;
  deal_count: number;
  analyzed_count: number;
  reused_count: number;
  failed_count: number;
  result: CloseWonPortfolioAnalysis | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

export type BenchmarkRow = {
  segment: string;
  date_from: string;
  date_to: string;
  sample_size: number;
  benchmark: WinBenchmarkMetrics;
  computed_at: string;
};

export type ActivityCountRow = {
  hubspot_deal_id: string | null;
  channel: "call" | "email" | "sms" | "deal";
};
