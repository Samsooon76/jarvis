import type { QueueProspect } from "@jarvis/shared";
import type {
  AiProviderId,
  AiProviderOption,
  HubSpotDisconnectResult,
  HubSpotLastUpdateItem,
  HubSpotOwnerOption,
  HubSpotSyncJobStatus,
  HubSpotSyncResult,
} from "../../services/api";

export type QueueViewProps = {
  generatedAt?: string;
  hubspotDealCount?: number | null;
  hubspotPortalId?: string | null;
  orgId: string;
  isConnected?: boolean;
  isRefreshing?: boolean;
  lastUpdates?: HubSpotLastUpdateItem[];
  onConnectHubSpot?: () => void;
  onDisconnectHubSpot?: () => Promise<HubSpotDisconnectResult>;
  onOwnerChange?: (ownerId: string) => void;
  onSyncHubSpot?: (onProgress?: (status: HubSpotSyncJobStatus) => void) => Promise<HubSpotSyncResult>;
  owners?: HubSpotOwnerOption[];
  ownerName?: string;
  selectedOwnerId?: string;
  prospects: QueueProspect[];
};

export type PlannedProspectTask = {
  id: string;
  title: string;
  dueAt: string | null;
  priority: "low" | "medium" | "high" | null;
  extraCount: number;
};

export type QueueBucket = "actNow" | "thisWeek" | "watch" | "all" | "lastUpdate";
export type DealStatus = "open" | "won" | "lost" | "other";
export type DealStatusFilter = "open" | "all" | "won" | "lost";
export type CloseDatePreset = "all" | "thisMonth" | "nextMonth" | "thisQuarter" | "overdue" | "noDate";
export type StageFilter =
  | "all"
  | "discovery"
  | "initialProposition"
  | "testing"
  | "contractSent"
  | "negociation"
  | "contractValidation"
  | "dealSignedPaymentPending"
  | "paymentReceived"
  | "closedLost"
  | "late";
export type WorkspaceView =
  | "overview"
  | "leads"
  | "forecast"
  | "stats"
  | "tasks"
  | "settings"
  | "dealAnalysis"
  | "closeLostAnalysis";

export type AiSettings = {
  selectedProviderId: AiProviderId;
  selectedProvider: AiProviderOption;
};

export type BucketDefinition = {
  id: QueueBucket;
  label: string;
  description: string;
};

export type SelectOption<T extends string> = {
  id: T;
  label: string;
};

export type WorkspaceViewDefinition = SelectOption<WorkspaceView>;

export type DashboardFilters = {
  searchTerm: string;
  statusFilter: DealStatusFilter;
  closeDatePreset: CloseDatePreset;
  closeDateFrom: string;
  closeDateTo: string;
  stageFilter: StageFilter;
};

export type ForecastMonth = {
  id: string;
  monthIndex: number;
  label: string;
  shortLabel: string;
  currentYear: number;
  previousYear: number;
  currentCount: number;
  previousCount: number;
  currentAmount: number;
  previousAmount: number;
  deltaAmount: number;
  deltaCount: number;
};

export type ChartPoint = {
  x: number;
  y: number;
};

export type ForecastChartBar = {
  amount: number;
  count: number;
  height: number;
  width: number;
  x: number;
  y: number;
};

export type ForecastChartPoint = ForecastMonth &
  ChartPoint & {
    currentBar: ForecastChartBar;
    previousBar: ForecastChartBar;
  };

export type ForecastChartViewModel = {
  baseline: number;
  currentYear: number;
  hasData: boolean;
  height: number;
  innerWidth: number;
  months: ForecastMonth[];
  padding: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  points: ForecastChartPoint[];
  previousYear: number;
  width: number;
};

export type StageDashboardRow = {
  id: string;
  label: string;
  count: number;
  amount: number;
  prospects: QueueProspect[];
};

export type StageBandPoint = StageDashboardRow &
  ChartPoint & {
    bottomY: number;
    color: string;
    share: number;
    topY: number;
  };

export type StageChartViewModel = {
  bandCenterY: number;
  bandPath: string;
  columnWidth: number;
  dealCount: number;
  height: number;
  padding: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  points: StageBandPoint[];
  width: number;
};

export type MetricIconName = "pulse" | "money" | "clock" | "check" | "x" | "trend";

export type MetricCard = {
  id: string;
  label: string;
  value: string | number;
  icon: MetricIconName;
  tone: "green" | "red";
};
