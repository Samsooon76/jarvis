import type { QueueProspect } from "@jarvis/shared";
import { buckets } from "./config";
import { QueueFilters } from "./queue/QueueFilters";
import { ProspectDetail } from "./queue/ProspectDetail";
import { ProspectTable } from "./queue/ProspectTable";
import { MetricIcon } from "./MetricIcon";
import type { HubSpotLastUpdateItem } from "../../services/api";
import type {
  CloseDatePreset,
  DashboardFilters,
  DealStatusFilter,
  PlannedProspectTask,
  QueueBucket,
  StageFilter,
} from "./types";
import { formatAmount, formatDateTime } from "../../utils/dashboard/formatters";

const nextActionPriorityLabels: Record<NonNullable<HubSpotLastUpdateItem["nextAction"]>["priority"], string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

const formatDueInDays = (dueInDays: number): string => {
  if (dueInDays <= 0) {
    return "Aujourd'hui";
  }

  if (dueInDays === 1) {
    return "Demain";
  }

  return `Dans ${dueInDays} j`;
};

type LastUpdateTableProps = {
  updates: HubSpotLastUpdateItem[];
};

const LastUpdateTable = ({ updates }: LastUpdateTableProps) => (
  <section className="ae-last-update-panel" aria-label="Last update">
    <div className="ae-panel-heading">
      <span>Last update</span>
      <strong>{updates.length} deal(s)</strong>
    </div>
    <div className="ae-last-update-table" role="region" aria-label="Derniers deals mis a jour par webhook">
      <table>
        <thead>
          <tr>
            <th>Deal</th>
            <th>Event</th>
            <th>Next to do</th>
            <th>Received</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {updates.map((update) => (
            <tr key={update.id}>
              <td>
                <strong>{update.dealName ?? `Deal ${update.hubspotDealId}`}</strong>
                <small>{update.companyName ?? update.hubspotDealId}</small>
              </td>
              <td>
                <strong>{update.reason ?? "Webhook HubSpot"}</strong>
                <small>
                  {update.eventCount} event{update.eventCount > 1 ? "s" : ""} · {update.dealStage ?? "Stage inconnu"}
                </small>
              </td>
              <td>
                {update.nextAction ? (
                  <>
                    <strong>{update.nextAction.title}</strong>
                    <small>
                      {formatDueInDays(update.nextAction.dueInDays)} ·{" "}
                      {nextActionPriorityLabels[update.nextAction.priority]}
                    </small>
                  </>
                ) : (
                  <>
                    <strong>Next action en cours</strong>
                    <small>{update.errorMessage ?? "Analyse du dernier event HubSpot en attente"}</small>
                  </>
                )}
              </td>
              <td>
                <strong>{formatDateTime(update.receivedAt)}</strong>
                <small>{update.processedAt ? `Traite ${formatDateTime(update.processedAt)}` : "En attente"}</small>
              </td>
              <td>
                <strong>{update.amount === null ? "-" : formatAmount(update.amount)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {updates.length === 0 ? <p className="ae-empty">Aucun event webhook HubSpot recu pour l'instant.</p> : null}
    </div>
  </section>
);

type OverviewViewProps = {
  activeBucket: QueueBucket;
  activeProspect: QueueProspect | null;
  averageProbability: number;
  bucketCounts: Record<QueueBucket, number>;
  filteredProspects: QueueProspect[];
  filters: DashboardFilters;
  hubspotDealCount?: number | null;
  isLoadingLiveDeals: boolean;
  lastUpdates: HubSpotLastUpdateItem[];
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
  plannedTasksByProspectId: Map<string, PlannedProspectTask>;
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
  lastUpdates,
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
  plannedTasksByProspectId,
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
          className={`ae-bucket-tab ${bucket.id}${activeBucket === bucket.id ? " active" : ""}`}
          key={bucket.id}
          onClick={() => onActiveBucketChange(bucket.id)}
          title={bucket.description}
          type="button"
        >
          <span>{bucket.label}</span>
          <strong>{bucket.id === "lastUpdate" ? lastUpdates.length : bucketCounts[bucket.id]}</strong>
        </button>
      ))}
    </nav>

    <section className={activeBucket === "lastUpdate" ? "ae-content last-update-active" : "ae-content"}>
      <div className="ae-queue-panel">
        {activeBucket === "lastUpdate" ? (
          <LastUpdateTable updates={lastUpdates} />
        ) : (
          <>
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
              plannedTasksByProspectId={plannedTasksByProspectId}
            />
          </>
        )}
      </div>

      {activeBucket === "lastUpdate" ? null : (
        <ProspectDetail activeProspect={activeProspect} orgId={orgId} onOpenDealAnalysis={() => onOpenDealAnalysis()} />
      )}
    </section>
  </>
);
