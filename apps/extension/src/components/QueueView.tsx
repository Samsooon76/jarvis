import { AdminFeedback } from "./dashboard/AdminFeedback";
import { CloseLostAnalysisView } from "./dashboard/CloseLostAnalysisView";
import { DealAnalysisView } from "./dashboard/DealAnalysisView";
import { ForecastView } from "./dashboard/ForecastView";
import { HubSpotHeader } from "./dashboard/HubSpotHeader";
import { OverviewView } from "./dashboard/OverviewView";
import { Sidebar } from "./dashboard/Sidebar";
import { SettingsView } from "./dashboard/SettingsView";
import { StatsView } from "./dashboard/StatsView";
import { TasksView } from "./dashboard/TasksView";
import type { QueueViewProps } from "./dashboard/types";
import { useQueueDashboard } from "../hooks/dashboard/useQueueDashboard";
import "./QueueView.css";

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
  onSyncHubSpot,
  owners = [],
  ownerName,
  selectedOwnerId,
  prospects,
}: QueueViewProps) => {
  const dashboard = useQueueDashboard({
    isConnected,
    isRefreshing,
    onDisconnectHubSpot,
    onSyncHubSpot,
    prospects,
  });
  const pageCopy = {
    closeLostAnalysis: {
      eyebrow: "Revenue workspace",
      title: "Close Lost Analysis",
      subtitle: "Comprendre pourquoi les deals sont perdus et prioriser les leviers d'amelioration.",
    },
    dealAnalysis: {
      eyebrow: "Deal workspace",
      title: "Deal analysis",
      subtitle: "Analyse approfondie d'un deal, separee de la queue operationnelle.",
    },
    forecast: {
      eyebrow: "Revenue workspace",
      title: "Forecast IA",
      subtitle: "Analyser les deals ouverts HubSpot et anticiper l'atterrissage de fin de periode.",
    },
    overview: {
      eyebrow: "AE workspace",
      title: "Pipeline inbox",
      subtitle: "La queue priorisee pour savoir qui relancer, pourquoi, et avec quel angle.",
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
  }[dashboard.activeView];

  return (
    <main className="ae-inbox">
      <Sidebar activeView={dashboard.activeView} onViewChange={dashboard.setActiveView} />
      <section className="ae-main-panel">
        <HubSpotHeader
          eyebrow={pageCopy.eyebrow}
          generatedAt={generatedAt}
          hubspotPortalId={hubspotPortalId}
          integrationStatusClassName={dashboard.integrationStatusClassName}
          integrationStatusLabel={dashboard.integrationStatusLabel}
          isConnected={isConnected}
          isRefreshing={isRefreshing}
          subtitle={pageCopy.subtitle}
          title={pageCopy.title}
        />

        <AdminFeedback error={dashboard.adminError} message={dashboard.adminMessage} />

        {dashboard.activeView === "stats" ? (
          <StatsView
            forecastChart={dashboard.forecastChart}
            hideClosedLostStage={dashboard.hideClosedLostStage}
            metricCards={dashboard.metricCards}
            onHideClosedLostStageChange={dashboard.setHideClosedLostStage}
            overdueCloseProspects={dashboard.overdueCloseProspects}
            stageChart={dashboard.stageChart}
          />
        ) : null}

        {dashboard.activeView === "tasks" ? <TasksView taskProspects={dashboard.taskProspects} /> : null}

        {dashboard.activeView === "settings" ? (
          <SettingsView
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

        {dashboard.activeView === "forecast" ? (
          <ForecastView
            orgId={orgId}
            owners={owners}
            selectedAiProvider={dashboard.selectedAiProvider}
            selectedOwnerId={selectedOwnerId}
          />
        ) : null}

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
            prospects={prospects}
            totalPipeline={dashboard.totalPipeline}
          />
        ) : null}
      </section>
    </main>
  );
};
