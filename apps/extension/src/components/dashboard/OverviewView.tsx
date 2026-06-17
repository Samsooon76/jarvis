import { useMemo } from "react";
import type { QueueProspect } from "@jarvis/shared";
import { Flame, History, LayoutDashboard, RefreshCw, Sparkles, Target, type LucideIcon } from "lucide-react";
import { buckets } from "./config";
import { QueueFilters } from "./queue/QueueFilters";
import { ProspectDetail } from "./queue/ProspectDetail";
import { ProspectTable } from "./queue/ProspectTable";
import type { HubSpotLastUpdateItem, HubSpotOwnerOption } from "../../services/api";
import type {
  CloseDatePreset,
  DashboardFilters,
  DealStatusFilter,
  PlannedProspectTask,
  QueueBucket,
  StageFilter,
} from "./types";
import { formatAmount, formatDateTime } from "../../utils/dashboard/formatters";
import { getBucket, getDaysSince, matchesCloseDateFilter } from "../../utils/dashboard/prospects";
import "../styles/overview.css";

const getQueueScoreLabel = (score: number): string => {
  if (score >= 75) {
    return "Tres bon";
  }

  if (score >= 50) {
    return "Correct";
  }

  return "A surveiller";
};

const SectionLabel = ({ children, icon: Icon }: { children: string; icon: LucideIcon }) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

const ThemeBlock = ({
  empty,
  icon,
  items,
  title,
}: {
  empty: string;
  icon: LucideIcon;
  items: Array<{ label: string; count: number }>;
  title: string;
}) => (
  <div className="jv-theme-block">
    <SectionLabel icon={icon}>{title}</SectionLabel>
    {items.length > 0 ? (
      <ul className="jv-theme-list">
        {items.slice(0, 5).map((item) => (
          <li key={item.label}>
            <span>{item.label}</span>
            <em>{item.count}</em>
          </li>
        ))}
      </ul>
    ) : (
      <p className="jv-theme-empty">{empty}</p>
    )}
  </div>
);

type LastUpdateListProps = {
  updates: HubSpotLastUpdateItem[];
};

const LastUpdateList = ({ updates }: LastUpdateListProps) => (
  <section className="jv-list-shell" aria-label="Derniers deals mis a jour">
    <header className="jv-list-head">
      <SectionLabel icon={History}>Last update</SectionLabel>
      <span className="jv-list-count">
        {updates.length} deal{updates.length > 1 ? "s" : ""}
      </span>
    </header>
    <div className="jv-list-body">
      {updates.map((update) => (
        <div className="jv-list-item jv-update-item" key={update.id}>
          <span className="jv-list-main">
            <strong>{update.dealName ?? `Deal ${update.hubspotDealId}`}</strong>
            <small>{update.companyName ?? update.hubspotDealId}</small>
            <span className="jv-item-meta">
              <span>{update.reason ?? "Webhook HubSpot"}</span>
              <span>{update.dealStage ?? "Stage inconnu"}</span>
            </span>
          </span>
          <span className="jv-list-side">
            <time>{formatDateTime(update.receivedAt)}</time>
            <em>{update.amount === null ? "—" : formatAmount(update.amount)}</em>
          </span>
        </div>
      ))}
      {updates.length === 0 ? (
        <p className="jv-list-empty">Aucun event webhook HubSpot recu pour l'instant.</p>
      ) : null}
    </div>
  </section>
);

type OverviewViewProps = {
  activeBucket: QueueBucket;
  activeProspect: QueueProspect | null;
  baseFilteredProspects: QueueProspect[];
  bucketCounts: Record<QueueBucket, number>;
  filteredProspects: QueueProspect[];
  filters: DashboardFilters;
  hubspotDealCount?: number | null;
  isConnected?: boolean;
  isLoadingLiveDeals: boolean;
  lastUpdates: HubSpotLastUpdateItem[];
  onActiveBucketChange: (bucket: QueueBucket) => void;
  onActiveProspectChange: (prospectId: string) => void;
  onCloseDateFromChange: (closeDateFrom: string) => void;
  onCloseDatePresetChange: (closeDatePreset: CloseDatePreset) => void;
  onCloseDateToChange: (closeDateTo: string) => void;
  onOpenDealAnalysis: (prospectId?: string) => void;
  onOwnerChange?: (ownerId: string) => void;
  onSearchTermChange: (searchTerm: string) => void;
  onStageFilterChange: (stageFilter: StageFilter) => void;
  onStatusFilterChange: (statusFilter: DealStatusFilter) => void;
  onSyncHubSpot?: () => void;
  orgId: string;
  owners?: HubSpotOwnerOption[];
  ownerName?: string;
  plannedTasksByProspectId: Map<string, PlannedProspectTask>;
  prospects: QueueProspect[];
  selectedOwnerId?: string;
  syncLoading?: boolean;
};

export const OverviewView = ({
  activeBucket,
  activeProspect,
  baseFilteredProspects,
  bucketCounts,
  filteredProspects,
  filters,
  hubspotDealCount,
  isConnected = false,
  isLoadingLiveDeals,
  lastUpdates,
  onActiveBucketChange,
  onActiveProspectChange,
  onCloseDateFromChange,
  onCloseDatePresetChange,
  onCloseDateToChange,
  onOpenDealAnalysis,
  onOwnerChange,
  onSearchTermChange,
  onStageFilterChange,
  onStatusFilterChange,
  onSyncHubSpot,
  orgId,
  owners = [],
  ownerName,
  plannedTasksByProspectId,
  prospects,
  selectedOwnerId,
  syncLoading = false,
}: OverviewViewProps) => {
  const selectedOwner = owners.find((owner) => owner.ownerId === selectedOwnerId) ?? null;
  const ownerKicker = selectedOwner
    ? `${selectedOwner.name} · pipeline`
    : ownerName
      ? `${ownerName} · pipeline`
      : "pipeline";
  const pipelineSummary = useMemo(() => {
    const pipelineTotal = baseFilteredProspects.reduce((sum, prospect) => sum + prospect.dealAmount, 0);
    const avgClose =
      baseFilteredProspects.length > 0
        ? Math.round(
            baseFilteredProspects.reduce((sum, prospect) => sum + prospect.closeProbability, 0) /
              baseFilteredProspects.length,
          )
        : 0;

    return {
      avgClose,
      pipelineTotal,
    };
  }, [baseFilteredProspects]);

  const queueInsights = useMemo(() => {
    const overdueCount = baseFilteredProspects.filter((prospect) =>
      matchesCloseDateFilter(prospect, "overdue", "", ""),
    ).length;
    const staleContactCount = baseFilteredProspects.filter((prospect) => getDaysSince(prospect.lastContactAt) >= 14).length;
    const actNowCount = baseFilteredProspects.filter((prospect) => getBucket(prospect) === "actNow").length;

    const signals = [
      { label: "Close date depassee", count: overdueCount },
      { label: "Aucun contact 14j+", count: staleContactCount },
      { label: "Action immediate", count: actNowCount },
    ].filter((signal) => signal.count > 0);

    const suggested = baseFilteredProspects
      .filter((prospect) => getBucket(prospect) === "actNow")
      .slice(0, 5)
      .map((prospect) => ({
        label: `${prospect.nextAction} · ${prospect.company}`,
        count: 1,
      }));

    const queueScore =
      baseFilteredProspects.length > 0
        ? Math.round(
            baseFilteredProspects.reduce((sum, prospect) => sum + prospect.closeProbability, 0) /
              baseFilteredProspects.length,
          )
        : 0;

    return {
      queueScore,
      scoreLabel: getQueueScoreLabel(queueScore),
      signals,
      suggested,
    };
  }, [baseFilteredProspects]);

  const stats = [
    {
      caption: "Actions prioritaires",
      label: "Act now",
      value: String(bucketCounts.actNow),
    },
    {
      caption: "Total du pipe",
      label: "Pipeline",
      value: formatAmount(pipelineSummary.pipelineTotal),
    },
    {
      caption: "Synchronises",
      label: "Deals",
      value: isLoadingLiveDeals ? "..." : String(hubspotDealCount ?? prospects.length),
    },
    {
      caption: "Taux de reussite",
      label: "Avg close",
      value: `${pipelineSummary.avgClose}%`,
    },
  ] as const;

  const activePlannedTask = activeProspect ? (plannedTasksByProspectId.get(activeProspect.id) ?? null) : null;
  const showQueueWorkspace = activeBucket !== "lastUpdate";

  return (
    <div className="jv-overview-page" aria-label="Vue d'ensemble pipeline">
      <header className="jv-page-header">
        <LayoutDashboard aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
        <h1>
          Vue d'ensemble
          <span className="jv-page-kicker">{ownerKicker}</span>
        </h1>
      </header>

      <section className="jv-controls" aria-label="Filtres pipeline">
        <div className="jv-toolbar">
          <div className="jv-toolbar-filters">
            <div className="jv-filter-pills jv-bucket-pills" role="group" aria-label="Buckets queue">
              {buckets.map((bucket) => (
                <button
                  className={activeBucket === bucket.id ? "active" : ""}
                  key={bucket.id}
                  onClick={() => onActiveBucketChange(bucket.id)}
                  title={bucket.description}
                  type="button"
                >
                  {bucket.label}
                  <em>{bucket.id === "lastUpdate" ? lastUpdates.length : bucketCounts[bucket.id]}</em>
                </button>
              ))}
            </div>
          </div>
          <div className="jv-toolbar-actions">
            {owners.length > 0 ? (
              <select
                aria-label="Filtrer par commercial"
                className="jv-select"
                disabled={!onOwnerChange}
                onChange={(event) => onOwnerChange?.(event.target.value)}
                value={selectedOwnerId ?? ""}
              >
                {owners.map((owner) => (
                  <option key={owner.ownerId} value={owner.ownerId}>
                    {owner.name}
                  </option>
                ))}
              </select>
            ) : null}
            {onSyncHubSpot ? (
              <button className="jv-btn-primary" disabled={!isConnected || syncLoading} onClick={onSyncHubSpot} type="button">
                <RefreshCw aria-hidden="true" className={syncLoading ? "jv-spin" : undefined} size={15} strokeWidth={1.5} />
                Sync HubSpot
              </button>
            ) : null}
          </div>
        </div>

        {showQueueWorkspace ? (
          <QueueFilters
            filters={filters}
            onCloseDateFromChange={onCloseDateFromChange}
            onCloseDatePresetChange={onCloseDatePresetChange}
            onCloseDateToChange={onCloseDateToChange}
            onSearchTermChange={onSearchTermChange}
            onStageFilterChange={onStageFilterChange}
            onStatusFilterChange={onStatusFilterChange}
          />
        ) : null}
      </section>

      <section className="jv-stat-strip cols-4" aria-label="Resume pipeline">
        {stats.map((stat, index) => (
          <div className="jv-stat" key={stat.label} style={{ animationDelay: `${index * 60}ms` }}>
            <span className="jv-stat-label">{stat.label}</span>
            <span className="jv-stat-value">{stat.value}</span>
            {stat.caption ? <small className="jv-stat-caption">{stat.caption}</small> : null}
          </div>
        ))}
      </section>

      {showQueueWorkspace ? (
        <>
          <section className="jv-score-banner" aria-label="Score priorite pipeline">
            <div
              className="jv-score-ring"
              style={{ background: `conic-gradient(#d4714a ${queueInsights.queueScore * 3.6}deg, #ece9e3 0)` }}
            >
              <span>{queueInsights.queueScore}</span>
            </div>
            <div className="jv-score-copy">
              <strong>{queueInsights.scoreLabel}</strong>
              <p>
                {bucketCounts.actNow > 0
                  ? `Queue bien priorisee — ${bucketCounts.actNow} prospect${bucketCounts.actNow > 1 ? "s" : ""} demandent une action aujourd'hui.`
                  : "Aucune action urgente detectee sur la queue filtree."}
              </p>
            </div>
            <span className="jv-score-badge">
              <Sparkles size={11} strokeWidth={1.5} />
              IA
            </span>
          </section>

          <section className="jv-themes-row" aria-label="Signaux et actions">
            <ThemeBlock empty="Aucun signal." icon={Flame} items={queueInsights.signals} title="Signaux du jour" />
            <ThemeBlock empty="Aucune action." icon={Target} items={queueInsights.suggested} title="Actions suggerees" />
          </section>
        </>
      ) : null}

      <div className={showQueueWorkspace ? "jv-workspace" : "jv-workspace jv-workspace-single"}>
        {showQueueWorkspace ? (
          <>
            <ProspectTable
              activeProspectId={activeProspect?.id ?? null}
              filteredProspects={filteredProspects}
              isLoadingLiveDeals={isLoadingLiveDeals}
              onActiveProspectChange={onActiveProspectChange}
            />
            <ProspectDetail
              activeProspect={activeProspect}
              onOpenDealAnalysis={() => onOpenDealAnalysis()}
              orgId={orgId}
              plannedTask={activePlannedTask}
            />
          </>
        ) : (
          <LastUpdateList updates={lastUpdates} />
        )}
      </div>
    </div>
  );
};