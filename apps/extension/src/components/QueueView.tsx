import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { QueueProspect } from "@jarvis/shared";
import { AdminFeedback } from "./dashboard/AdminFeedback";
import { HubSpotHeader } from "./dashboard/HubSpotHeader";
import { LoadingState } from "./dashboard/LoadingState";
import { PulseNotificationCenter } from "./dashboard/PulseNotificationCenter";
import { OverviewView } from "./dashboard/OverviewView";
import { Sidebar } from "./dashboard/Sidebar";
import type { PlannedProspectTask, QueueViewProps } from "./dashboard/types";
import { useQueueDashboard } from "../hooks/dashboard/useQueueDashboard";
import {
  fetchCloseLostOverview,
  fetchForecastOverview,
  fetchHubSpotLeadAccounts,
  fetchHubSpotTasks,
  fetchManagerDigest,
  fetchTeamCoaching,
  fetchWinAnalysisOverview,
  type HubSpotTaskListItem,
} from "../services/api";
import "./QueueView.css";

const CloseLostAnalysisView = lazy(async () => {
  const module = await import("./dashboard/close-lost/CloseLostAnalysisView");

  return { default: module.CloseLostAnalysisView };
});
const CallsView = lazy(async () => {
  const module = await import("./dashboard/calls/CallsView");

  return { default: module.CallsView };
});
const DealAnalysisView = lazy(async () => {
  const module = await import("./dashboard/DealAnalysisView");

  return { default: module.DealAnalysisView };
});
const WinAnalysisView = lazy(async () => {
  const module = await import("./dashboard/WinAnalysisView");

  return { default: module.WinAnalysisView };
});
const CoachingView = lazy(async () => {
  const module = await import("./dashboard/coaching/CoachingView");

  return { default: module.CoachingView };
});
const DigestView = lazy(async () => {
  const module = await import("./dashboard/DigestView");

  return { default: module.DigestView };
});
const ForecastView = lazy(async () => {
  const module = await import("./dashboard/forecast/ForecastView");

  return { default: module.ForecastView };
});
const LeadsView = lazy(async () => {
  const module = await import("./dashboard/LeadsView");

  return { default: module.LeadsView };
});
const PlaybookView = lazy(async () => {
  const module = await import("./dashboard/playbook/PlaybookView");

  return { default: module.PlaybookView };
});
const SettingsView = lazy(async () => {
  const module = await import("./dashboard/SettingsView");

  return { default: module.SettingsView };
});
const StatsView = lazy(async () => {
  const module = await import("./dashboard/StatsView");

  return { default: module.StatsView };
});
const TasksView = lazy(async () => {
  const module = await import("./dashboard/tasks/TasksView");

  return { default: module.TasksView };
});

const WorkspaceFallback = () => (
  <section className="ae-view-panel" aria-busy="true">
    <LoadingState detail="La vue demandee arrive." label="Chargement de la vue" />
  </section>
);

const formatInputDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const getForecastMonthBounds = (): { dateFrom: string; dateTo: string } => {
  const now = new Date();
  const firstDay = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const lastDay = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));

  return {
    dateFrom: firstDay.toISOString().slice(0, 10),
    dateTo: lastDay.toISOString().slice(0, 10),
  };
};

const getCloseLostDefaultDateRange = (): { dateFrom: string; dateTo: string } => {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);

  return {
    dateFrom: formatInputDate(yearStart),
    dateTo: formatInputDate(now),
  };
};

const workspaceCopy = {
  closeLostAnalysis: {
    eyebrow: "Revenue workspace",
    title: "Close Lost Analysis",
    subtitle: "Comprendre pourquoi les deals sont perdus et prioriser les leviers d'amelioration.",
  },
  calls: {
    eyebrow: "Call intelligence",
    title: "Appels",
    subtitle: "Analyse des appels sales, signaux clients et prochaines actions.",
  },
  dealAnalysis: {
    eyebrow: "Deal workspace",
    title: "Deal analysis",
    subtitle: "Analyse approfondie d'un deal, separee de la queue operationnelle.",
  },
  winAnalysis: {
    eyebrow: "Revenue workspace",
    title: "Win Analysis",
    subtitle: "Comprendre pourquoi les deals sont gagnes et repliquer les patterns de victoire.",
  },
  coaching: {
    eyebrow: "Manager workspace",
    title: "Coaching IA",
    subtitle: "Profil de chaque commercial: forces, axes de progression et actions de coaching pour le 1:1.",
  },
  digest: {
    eyebrow: "Manager workspace",
    title: "Digest",
    subtitle: "Ce qui a bouge sur votre perimetre: mouvements cles, deals a risque et coups de main a donner.",
  },
  forecast: {
    eyebrow: "Revenue workspace",
    title: "Forecast IA",
    subtitle: "Analyser les deals ouverts HubSpot et anticiper l'atterrissage de fin de periode.",
  },
  leads: {
    eyebrow: "AE workspace",
    title: "Leads",
    subtitle: "Liste des leads ouverts pour l'AE selectionne.",
  },
  overview: {
    eyebrow: "AE workspace",
    title: "Pipeline inbox",
    subtitle: "La queue priorisee pour savoir qui relancer, pourquoi, et avec quel angle.",
  },
  playbook: {
    eyebrow: "Revenue workspace",
    title: "Playbook",
    subtitle: "Le referentiel des plays de vente de l'equipe: declencheurs, reponses recommandees et preuves.",
  },
  settings: {
    eyebrow: "Admin workspace",
    title: "Parametres",
    subtitle: "Configuration locale du copilot et des providers d'analyse.",
  },
  stats: {
    eyebrow: "Manager workspace",
    title: "Statistiques",
    subtitle: "Lecture pipeline, forecast et repartition par stage.",
  },
  tasks: {
    eyebrow: "AE workspace",
    title: "Taches",
    subtitle: "Actions prioritaires issues de la queue synchronisee.",
  },
} as const;

const taskPriorityRank: Record<NonNullable<HubSpotTaskListItem["priority"]>, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const getTaskSortTime = (task: HubSpotTaskListItem): number => {
  if (!task.dueAt) {
    return Number.MAX_SAFE_INTEGER;
  }

  const dueTimestamp = new Date(task.dueAt).getTime();

  return Number.isNaN(dueTimestamp) ? Number.MAX_SAFE_INTEGER : dueTimestamp;
};

const sortPlannedTasks = (firstTask: HubSpotTaskListItem, secondTask: HubSpotTaskListItem): number =>
  getTaskSortTime(firstTask) - getTaskSortTime(secondTask) ||
  (taskPriorityRank[firstTask.priority ?? "low"] ?? 3) - (taskPriorityRank[secondTask.priority ?? "low"] ?? 3) ||
  firstTask.title.localeCompare(secondTask.title);

const normalizeTaskMatchValue = (value: string | null | undefined): string => value?.trim().toLowerCase() ?? "";

const taskMatchesProspect = (task: HubSpotTaskListItem, prospect: QueueProspect): boolean => {
  if (prospect.hubspotDealId && task.associatedDealIds.includes(prospect.hubspotDealId)) {
    return true;
  }

  const prospectEmail = normalizeTaskMatchValue(prospect.email);

  if (prospectEmail && normalizeTaskMatchValue(task.contactEmail) === prospectEmail) {
    return true;
  }

  const prospectCompany = normalizeTaskMatchValue(prospect.company);

  if (prospectCompany && normalizeTaskMatchValue(task.companyName) === prospectCompany) {
    return true;
  }

  const prospectDealName = normalizeTaskMatchValue(prospect.dealName);

  return Boolean(prospectDealName && normalizeTaskMatchValue(task.dealName) === prospectDealName);
};

const buildPlannedTasksByProspectId = (
  prospects: QueueProspect[],
  tasks: HubSpotTaskListItem[],
): Map<string, PlannedProspectTask> => {
  const plannedTasksByProspectId = new Map<string, PlannedProspectTask>();

  for (const prospect of prospects) {
    const matchingTasks = tasks.filter((task) => taskMatchesProspect(task, prospect)).sort(sortPlannedTasks);
    const [nextTask] = matchingTasks;

    if (!nextTask) {
      continue;
    }

    plannedTasksByProspectId.set(prospect.id, {
      id: nextTask.id,
      title: nextTask.title,
      dueAt: nextTask.dueAt,
      priority: nextTask.priority,
      extraCount: Math.max(0, matchingTasks.length - 1),
    });
  }

  return plannedTasksByProspectId;
};

export const QueueView = ({
  generatedAt,
  hubspotDealCount,
  hubspotPortalId,
  isConnected = Boolean(hubspotPortalId),
  isRefreshing = false,
  lastUpdates = [],
  orgId,
  onConnectHubSpot,
  onDisconnectHubSpot,
  onOwnerChange,
  onSignOut,
  onSyncHubSpot,
  owners = [],
  ownerName,
  selectedOwnerId,
  canViewTeamForecast = false,
  prospects,
}: QueueViewProps) => {
  const [hubspotTasks, setHubspotTasks] = useState<HubSpotTaskListItem[]>([]);
  const dashboard = useQueueDashboard({
    isConnected,
    isRefreshing,
    onDisconnectHubSpot,
    onSyncHubSpot,
    orgId,
    prospects,
  });
  const pageCopy = workspaceCopy[dashboard.activeView];
  const plannedTasksByProspectId = useMemo(
    () => buildPlannedTasksByProspectId(prospects, hubspotTasks),
    [hubspotTasks, prospects],
  );

  useEffect(() => {
    void import("./dashboard/close-lost/CloseLostAnalysisView");
    void import("./dashboard/calls/CallsView");
    void import("./dashboard/forecast/ForecastView");
    void import("./dashboard/LeadsView");
    void import("./dashboard/DealAnalysisView");
    void import("./dashboard/DigestView");
    void import("./dashboard/coaching/CoachingView");
    void import("./dashboard/WinAnalysisView");
    void import("./dashboard/tasks/TasksView");
    void import("./dashboard/StatsView");
    void import("./dashboard/playbook/PlaybookView");
  }, []);

  const closeLostOwnerIds = useMemo(() => {
    const salesAeOwners = owners.filter((owner) => owner.teamName?.toLowerCase().includes("sales ae"));

    return (salesAeOwners.length > 0 ? salesAeOwners : owners).map((owner) => owner.ownerId);
  }, [owners]);

  // Forecast prefetch depends on the selected owner (scope changes per owner).
  useEffect(() => {
    if (!isConnected || !orgId) {
      return;
    }

    const forecastDates = getForecastMonthBounds();
    const forecastScope = selectedOwnerId ? "owner" : "all";

    void fetchForecastOverview({
      orgId,
      scope: forecastScope,
      hubspotOwnerId: selectedOwnerId ?? null,
      dateFrom: forecastDates.dateFrom,
      dateTo: forecastDates.dateTo,
      aiProvider: dashboard.selectedAiProvider,
    }).catch(() => undefined);
  }, [dashboard.selectedAiProvider, isConnected, orgId, selectedOwnerId]);

  // Close-lost prefetch is owner-independent: it must not refire on owner switch.
  useEffect(() => {
    if (!isConnected || !orgId || closeLostOwnerIds.length === 0) {
      return;
    }

    const closeLostDates = getCloseLostDefaultDateRange();

    void fetchCloseLostOverview({
      orgId,
      scope: "sales_ae",
      hubspotOwnerId: null,
      salesAeOwnerIds: closeLostOwnerIds,
      dateFrom: closeLostDates.dateFrom,
      dateTo: closeLostDates.dateTo,
      aiProvider: dashboard.selectedAiProvider,
    }).catch(() => undefined);
  }, [closeLostOwnerIds, dashboard.selectedAiProvider, isConnected, orgId]);

  // Warm the manager tabs (digest, coaching, win analysis) and leads caches in
  // the background so switching to those views renders instantly. Delayed so
  // the initial queue render and forecast prefetch keep network priority.
  useEffect(() => {
    if (!isConnected || !orgId) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (canViewTeamForecast) {
        void fetchManagerDigest("daily").catch(() => undefined);
        void fetchTeamCoaching().catch(() => undefined);
        void fetchWinAnalysisOverview(orgId).catch(() => undefined);
      }

      if (selectedOwnerId) {
        void fetchHubSpotLeadAccounts(orgId, selectedOwnerId, 500).catch(() => undefined);
      }
    }, 2_000);

    return () => window.clearTimeout(timer);
  }, [canViewTeamForecast, isConnected, orgId, selectedOwnerId]);

  useEffect(() => {
    if (!isConnected || !orgId || !selectedOwnerId) {
      setHubspotTasks([]);
      return;
    }

    const abortController = new AbortController();

    void fetchHubSpotTasks(orgId, selectedOwnerId, 500, { signal: abortController.signal })
      .then(setHubspotTasks)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setHubspotTasks([]);
      });

    return () => abortController.abort();
  }, [isConnected, orgId, selectedOwnerId]);


  return (
    <main className="ae-inbox">
      <Sidebar
        activeView={dashboard.activeView}
        onSignOut={onSignOut}
        onViewChange={dashboard.setActiveView}
        showDigest={canViewTeamForecast}
      />
      <section className="ae-main-panel">
        {dashboard.activeView !== "tasks" ? (
          <>
            <HubSpotHeader
              eyebrow={pageCopy.eyebrow}
              generatedAt={generatedAt}
              hubspotPortalId={hubspotPortalId}
              integrationStatusClassName={dashboard.integrationStatusClassName}
              integrationStatusLabel={dashboard.integrationStatusLabel}
              isConnected={isConnected}
              isRefreshing={isRefreshing}
              pulseSlot={canViewTeamForecast ? <PulseNotificationCenter /> : undefined}
              subtitle={pageCopy.subtitle}
              title={pageCopy.title}
            />

            <AdminFeedback error={dashboard.adminError} message={dashboard.adminMessage} />
          </>
        ) : null}

        <Suspense fallback={<WorkspaceFallback />}>
          {dashboard.activeView === "stats" ? (
            <StatsView
              forecastChart={dashboard.forecastChart}
              hideClosedLostStage={dashboard.hideClosedLostStage}
              metricCards={dashboard.metricCards}
              onHideClosedLostStageChange={dashboard.setHideClosedLostStage}
              overdueCloseProspects={dashboard.overdueCloseProspects}
              stageChart={dashboard.stageChart}
              orgId={orgId}
              owners={owners}
              selectedOwnerId={selectedOwnerId}
              canViewTeamForecast={canViewTeamForecast}
            />
          ) : null}

          {dashboard.activeView === "tasks" ? (
            <TasksView
              hubspotPortalId={hubspotPortalId}
              lastUpdates={lastUpdates}
              onOwnerChange={onOwnerChange}
              orgId={orgId}
              owners={owners}
              prospects={prospects}
              selectedOwnerId={selectedOwnerId}
            />
          ) : null}

          {dashboard.activeView === "settings" ? (
            <SettingsView
              canManagePulse={canViewTeamForecast}
              hubSpot={{
                disconnectLoading: dashboard.disconnectLoading,
                generatedAt,
                hubspotDealCount,
                hubspotPortalId,
                integrationStatusClassName: dashboard.integrationStatusClassName,
                integrationStatusLabel: dashboard.integrationStatusLabel,
                isConnected,
                isRefreshing,
                onConnectHubSpot,
                onDisconnectHubSpot: dashboard.handleDisconnectHubSpot,
                onOwnerChange,
                onSyncHubSpot: dashboard.handleSyncHubSpot,
                ownerName,
                selectedOwnerId,
                syncJob: dashboard.syncJob,
                syncLoading: dashboard.syncLoading,
              }}
              onProviderChange={dashboard.setSelectedAiProviderId}
              orgId={orgId}
              owners={owners}
              selectedProvider={dashboard.selectedAiProvider}
              selectedProviderId={dashboard.selectedAiProviderId}
            />
          ) : null}

          {dashboard.activeView === "dealAnalysis" ? (
            <DealAnalysisView
              activeProspect={dashboard.activeProspect}
              hubspotPortalId={hubspotPortalId}
              orgId={orgId}
              onBack={() => dashboard.setActiveView("overview")}
              ownerName={ownerName}
              selectedAiProvider={dashboard.selectedAiProvider}
            />
          ) : null}

          {dashboard.activeView === "closeLostAnalysis" ? (
            <CloseLostAnalysisView
              orgId={orgId}
              owners={owners}
              selectedAiProvider={dashboard.selectedAiProvider}
              selectedOwnerId={selectedOwnerId}
            />
          ) : null}

          {dashboard.activeView === "calls" ? (
            <CallsView
              canViewTeamInsights={canViewTeamForecast}
              orgId={orgId}
              role={canViewTeamForecast ? "manager" : "sales"}
            />
          ) : null}

          {dashboard.activeView === "winAnalysis" ? (
            canViewTeamForecast ? (
              <WinAnalysisView orgId={orgId} />
            ) : (
              <section className="ae-view-panel">
                <p className="ae-empty">La win analysis est reservee aux administrateurs et managers.</p>
              </section>
            )
          ) : null}

          {dashboard.activeView === "coaching" ? (
            canViewTeamForecast ? (
              <CoachingView />
            ) : (
              <section className="ae-view-panel">
                <p className="ae-empty">Le coaching IA est reserve aux administrateurs et managers.</p>
              </section>
            )
          ) : null}

          {dashboard.activeView === "digest" ? (
            canViewTeamForecast ? (
              <DigestView
                prospects={prospects}
                onOpenDealAnalysis={(prospectId) => {
                  dashboard.setActiveProspectId(prospectId);
                  dashboard.setActiveView("dealAnalysis");
                }}
              />
            ) : (
              <section className="ae-view-panel">
                <p className="ae-empty">Le digest est reserve aux administrateurs et managers.</p>
              </section>
            )
          ) : null}

          {dashboard.activeView === "forecast" ? (
            <ForecastView
              orgId={orgId}
              owners={owners}
              selectedAiProvider={dashboard.selectedAiProvider}
              selectedOwnerId={selectedOwnerId}
              canViewTeamForecast={canViewTeamForecast}
            />
          ) : null}

          {dashboard.activeView === "playbook" ? (
            <PlaybookView canEdit={canViewTeamForecast} orgId={orgId} />
          ) : null}

          {dashboard.activeView === "leads" ? (
            <LeadsView
              hubspotPortalId={hubspotPortalId}
              onOwnerChange={onOwnerChange}
              orgId={orgId}
              owners={owners}
              selectedOwnerId={selectedOwnerId}
            />
          ) : null}
        </Suspense>

        {dashboard.activeView === "overview" ? (
          <OverviewView
            activeBucket={dashboard.activeBucket}
            activeProspect={dashboard.activeProspect}
            averageProbability={dashboard.averageProbability}
            bucketCounts={dashboard.bucketCounts}
            filteredProspects={dashboard.filteredProspects}
            filters={dashboard.filters}
            hubspotDealCount={hubspotDealCount}
            orgId={orgId}
            isLoadingLiveDeals={dashboard.isLoadingLiveDeals}
            lastUpdates={lastUpdates}
            onActiveBucketChange={dashboard.setActiveBucket}
            onActiveProspectChange={dashboard.setActiveProspectId}
            onCloseDateFromChange={dashboard.setCloseDateFrom}
            onCloseDatePresetChange={dashboard.setCloseDatePreset}
            onCloseDateToChange={dashboard.setCloseDateTo}
            onOpenDealAnalysis={(prospectId) => {
              if (prospectId) {
                dashboard.setActiveProspectId(prospectId);
              }
              dashboard.setActiveView("dealAnalysis");
            }}
            onSearchTermChange={dashboard.setSearchTerm}
            onStageFilterChange={dashboard.setStageFilter}
            onStatusFilterChange={dashboard.setStatusFilter}
            plannedTasksByProspectId={plannedTasksByProspectId}
            prospects={prospects}
            totalPipeline={dashboard.totalPipeline}
          />
        ) : null}
      </section>
    </main>
  );
};
