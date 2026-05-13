import type { QueueProspect } from "@jarvis/shared";
import { buckets } from "./config";
import { QueueFilters } from "./queue/QueueFilters";
import { ProspectDetail } from "./queue/ProspectDetail";
import { ProspectTable } from "./queue/ProspectTable";
import { MetricIcon } from "./MetricIcon";
import type {
  CloseDatePreset,
  DashboardFilters,
  DealStatusFilter,
  QueueBucket,
  StageFilter,
} from "./types";
import { formatAmount } from "../../utils/dashboard/formatters";

type OverviewViewProps = {
  activeBucket: QueueBucket;
  activeProspect: QueueProspect | null;
  averageProbability: number;
  bucketCounts: Record<QueueBucket, number>;
  filteredProspects: QueueProspect[];
  filters: DashboardFilters;
  hubspotDealCount?: number | null;
  isLoadingLiveDeals: boolean;
  orgId: string;
  onActiveBucketChange: (bucket: QueueBucket) => void;
  onActiveProspectChange: (prospectId: string) => void;
  onCloseDateFromChange: (closeDateFrom: string) => void;
  onCloseDatePresetChange: (closeDatePreset: CloseDatePreset) => void;
  onCloseDateToChange: (closeDateTo: string) => void;
  onOpenDealAnalysis: (prospectId?: string) => void;
  onSearchTermChange: (searchTerm: string) => void;
  onStageFilterChange: (stageFilter: StageFilter) => void;
  onStatusFilterChange: (statusFilter: DealStatusFilter) => void;
  prospects: QueueProspect[];
  totalPipeline: number;
};

export const OverviewView = ({
  activeBucket,
  activeProspect,
  averageProbability,
  bucketCounts,
  filteredProspects,
  filters,
  hubspotDealCount,
  isLoadingLiveDeals,
  orgId,
  onActiveBucketChange,
  onActiveProspectChange,
  onCloseDateFromChange,
  onCloseDatePresetChange,
  onCloseDateToChange,
  onOpenDealAnalysis,
  onSearchTermChange,
  onStageFilterChange,
  onStatusFilterChange,
  prospects,
  totalPipeline,
}: OverviewViewProps) => (
  <>
    <section className="ae-metrics" aria-label="Pipeline summary">
      <div className="ae-metric-card">
        <MetricIcon name="clock" />
        <span>Act now</span>
        <strong>{bucketCounts.actNow}</strong>
        <small>Actions prioritaires</small>
      </div>
      <div className="ae-metric-card">
        <MetricIcon name="trend" />
        <span>Pipeline</span>
        <strong>{formatAmount(totalPipeline)}</strong>
        <small>Total du pipe</small>
      </div>
      <div className="ae-metric-card">
        <MetricIcon name="money" />
        <span>Deals</span>
        <strong>{isLoadingLiveDeals ? "..." : (hubspotDealCount ?? prospects.length)}</strong>
        <small>Synchronises</small>
      </div>
      <div className="ae-metric-card">
        <MetricIcon name="check" />
        <span>Avg close</span>
        <strong>{averageProbability}%</strong>
        <small>Taux de reussite</small>
      </div>
    </section>

    <nav className="ae-tabs" aria-label="Queue buckets">
      {buckets.map((bucket) => (
        <button
          aria-pressed={activeBucket === bucket.id}
          className={activeBucket === bucket.id ? "active" : ""}
          key={bucket.id}
          onClick={() => onActiveBucketChange(bucket.id)}
          title={bucket.description}
          type="button"
        >
          <span>{bucket.label}</span>
          <strong>{bucketCounts[bucket.id]}</strong>
        </button>
      ))}
    </nav>

    <section className="ae-content">
      <div className="ae-queue-panel">
        <QueueFilters
          filteredCount={filteredProspects.length}
          filters={filters}
          onCloseDateFromChange={onCloseDateFromChange}
          onCloseDatePresetChange={onCloseDatePresetChange}
          onCloseDateToChange={onCloseDateToChange}
          onSearchTermChange={onSearchTermChange}
          onStageFilterChange={onStageFilterChange}
          onStatusFilterChange={onStatusFilterChange}
        />

        <ProspectTable
          activeProspectId={activeProspect?.id ?? null}
          filteredProspects={filteredProspects}
          isLoadingLiveDeals={isLoadingLiveDeals}
          onActiveProspectChange={onActiveProspectChange}
          onOpenDealAnalysis={onOpenDealAnalysis}
        />
      </div>

      <ProspectDetail activeProspect={activeProspect} orgId={orgId} onOpenDealAnalysis={() => onOpenDealAnalysis()} />
    </section>
  </>
);
