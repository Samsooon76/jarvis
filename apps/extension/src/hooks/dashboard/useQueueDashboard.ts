import { useEffect, useMemo, useState } from "react";
import type {
  CloseDatePreset,
  DealStatusFilter,
  QueueBucket,
  QueueViewProps,
  StageFilter,
  WorkspaceView,
} from "../../components/dashboard/types";
import { workspaceViews } from "../../components/dashboard/config";
import {
  getBucket,
  getDealStatus,
  matchesCloseDateFilter,
  matchesStageFilter,
  matchesStatusFilter,
} from "../../utils/dashboard/prospects";
import {
  buildForecastChart,
  buildMetricCards,
  buildStageChart,
  getPriorityTasks,
} from "../../utils/dashboard/viewModels";
import {
  aiProviderOptions,
  saveLlmProviderPreference,
  type AiProviderId,
  type HubSpotSyncJobStatus,
} from "../../services/api";

const AI_PROVIDER_STORAGE_KEY = "jarvis.aiProvider";
const ACTIVE_PROSPECT_STORAGE_KEY = "jarvis.activeProspectId";
const hashRoutedViews = new Set<WorkspaceView>([...workspaceViews.map((view) => view.id), "dealAnalysis"]);

const getViewFromHash = (): WorkspaceView => {
  const hashView = window.location.hash.replace("#", "");

  if (hashView === "hubspot") {
    return "settings";
  }

  return hashRoutedViews.has(hashView as WorkspaceView) ? (hashView as WorkspaceView) : "overview";
};

const getInitialAiProviderId = (): AiProviderId => {
  const storedValue = window.localStorage.getItem(AI_PROVIDER_STORAGE_KEY);

  if (aiProviderOptions.some((provider) => provider.id === storedValue)) {
    return storedValue as AiProviderId;
  }

  return "openai";
};

const getInitialActiveProspectId = (prospects: QueueViewProps["prospects"]): string | null => {
  const storedProspectId = window.localStorage.getItem(ACTIVE_PROSPECT_STORAGE_KEY)?.trim();

  if (storedProspectId && prospects.some((prospect) => prospect.id === storedProspectId)) {
    return storedProspectId;
  }

  return prospects[0]?.id ?? null;
};

export const useQueueDashboard = ({
  isConnected,
  isRefreshing = false,
  onDisconnectHubSpot,
  onSyncHubSpot,
  orgId,
  prospects,
}: Pick<QueueViewProps, "isConnected" | "isRefreshing" | "onDisconnectHubSpot" | "onSyncHubSpot" | "orgId" | "prospects">) => {
  const [activeView, setActiveViewState] = useState<WorkspaceView>(getViewFromHash);
  const [visitedViews, setVisitedViews] = useState<ReadonlySet<WorkspaceView>>(() => new Set([getViewFromHash()]));
  const [activeBucket, setActiveBucket] = useState<QueueBucket>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<DealStatusFilter>("open");
  const [closeDatePreset, setCloseDatePreset] = useState<CloseDatePreset>("all");
  const [closeDateFrom, setCloseDateFrom] = useState("");
  const [closeDateTo, setCloseDateTo] = useState("");
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [activeProspectId, setActiveProspectIdState] = useState<string | null>(() => getInitialActiveProspectId(prospects));
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncJob, setSyncJob] = useState<HubSpotSyncJobStatus | null>(null);
  const [disconnectLoading, setDisconnectLoading] = useState(false);
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [hideClosedLostStage, setHideClosedLostStage] = useState(false);
  const [selectedAiProviderId, setSelectedAiProviderIdState] = useState<AiProviderId>(getInitialAiProviderId);

  const selectedAiProvider = useMemo(
    () => aiProviderOptions.find((provider) => provider.id === selectedAiProviderId) ?? aiProviderOptions[0],
    [selectedAiProviderId],
  );

  const setActiveView = (view: WorkspaceView) => {
    setActiveViewState(view);

    if (window.location.hash !== `#${view}`) {
      window.history.pushState(null, "", `#${view}`);
    }
  };

  const setSelectedAiProviderId = (providerId: AiProviderId) => {
    setSelectedAiProviderIdState(providerId);
    window.localStorage.setItem(AI_PROVIDER_STORAGE_KEY, providerId);

    const provider = aiProviderOptions.find((option) => option.id === providerId);

    if (provider) {
      void saveLlmProviderPreference(orgId, provider).catch((error: unknown) => {
        setAdminError(error instanceof Error ? error.message : "Impossible d'enregistrer le provider IA.");
      });
    }
  };

  const setActiveProspectId = (prospectId: string | null) => {
    setActiveProspectIdState(prospectId);

    if (prospectId) {
      window.localStorage.setItem(ACTIVE_PROSPECT_STORAGE_KEY, prospectId);
      return;
    }

    window.localStorage.removeItem(ACTIVE_PROSPECT_STORAGE_KEY);
  };

  useEffect(() => {
    setVisitedViews((current) => {
      if (current.has(activeView)) {
        return current;
      }

      const next = new Set(current);
      next.add(activeView);
      return next;
    });
  }, [activeView]);

  useEffect(() => {
    const handleRouteChange = () => setActiveViewState(getViewFromHash());

    window.addEventListener("hashchange", handleRouteChange);
    window.addEventListener("popstate", handleRouteChange);

    if (!window.location.hash) {
      window.history.replaceState(null, "", "#overview");
    }

    return () => {
      window.removeEventListener("hashchange", handleRouteChange);
      window.removeEventListener("popstate", handleRouteChange);
    };
  }, []);

  useEffect(() => {
    setActiveProspectIdState((currentId) => {
      if (currentId && prospects.some((prospect) => prospect.id === currentId)) {
        return currentId;
      }

      const storedProspectId = window.localStorage.getItem(ACTIVE_PROSPECT_STORAGE_KEY)?.trim();

      if (storedProspectId && prospects.some((prospect) => prospect.id === storedProspectId)) {
        return storedProspectId;
      }

      const fallbackProspectId = prospects[0]?.id ?? null;

      if (fallbackProspectId) {
        window.localStorage.setItem(ACTIVE_PROSPECT_STORAGE_KEY, fallbackProspectId);
      } else {
        window.localStorage.removeItem(ACTIVE_PROSPECT_STORAGE_KEY);
      }

      return fallbackProspectId;
    });
  }, [prospects]);

  const filters = useMemo(
    () => ({
      searchTerm,
      statusFilter,
      closeDatePreset,
      closeDateFrom,
      closeDateTo,
      stageFilter,
    }),
    [closeDateFrom, closeDatePreset, closeDateTo, searchTerm, stageFilter, statusFilter],
  );

  const baseFilteredProspects = useMemo(
    () => {
      const normalizedSearchTerm = searchTerm.trim().toLowerCase();

      return prospects.filter((prospect) => {
        const matchesSearch =
          normalizedSearchTerm.length === 0 ||
          [prospect.company, prospect.name, prospect.title, prospect.dealStage, prospect.nextAction]
            .filter(Boolean)
            .some((value) => value.toLowerCase().includes(normalizedSearchTerm));

        return (
          matchesSearch &&
          matchesStatusFilter(prospect, statusFilter) &&
          matchesStageFilter(prospect, stageFilter) &&
          matchesCloseDateFilter(prospect, closeDatePreset, closeDateFrom, closeDateTo)
        );
      });
    },
    [closeDateFrom, closeDatePreset, closeDateTo, prospects, searchTerm, stageFilter, statusFilter],
  );

  const bucketCounts = useMemo(
    () =>
      baseFilteredProspects.reduce<Record<QueueBucket, number>>(
        (counts, prospect) => {
          counts[getBucket(prospect)] += 1;
          counts.all += 1;
          return counts;
        },
        { actNow: 0, thisWeek: 0, watch: 0, all: 0, lastUpdate: 0 },
      ),
    [baseFilteredProspects],
  );

  const filteredProspects = useMemo(
    () =>
      baseFilteredProspects.filter(
        (prospect) => activeBucket === "all" || activeBucket === "lastUpdate" || getBucket(prospect) === activeBucket,
      ),
    [activeBucket, baseFilteredProspects],
  );

  const activeProspect = useMemo(
    () => filteredProspects.find((prospect) => prospect.id === activeProspectId) ?? filteredProspects[0] ?? null,
    [activeProspectId, filteredProspects],
  );
  const isLoadingLiveDeals = isRefreshing && prospects.length === 0;
  const integrationStatusLabel = syncLoading
    ? "Sync en cours"
    : isRefreshing
      ? "Verification"
      : isConnected
        ? "Live"
      : "Non connecte";
  const integrationStatusClassName = isConnected ? "live" : "offline";

  const filteredSummary = useMemo(
    () => {
      const totalPipeline = filteredProspects.reduce((sum, prospect) => sum + prospect.dealAmount, 0);
      const averageProbability =
        filteredProspects.length > 0
          ? Math.round(
              filteredProspects.reduce((sum, prospect) => sum + prospect.closeProbability, 0) /
                filteredProspects.length,
            )
          : 0;

      return {
        averageProbability,
        totalPipeline,
      };
    },
    [filteredProspects],
  );

  const pipelineSummary = useMemo(
    () => {
      const openProspects: QueueViewProps["prospects"] = [];
      const overdueCloseProspects: QueueViewProps["prospects"] = [];
      let lostPipeline = 0;
      let openPipeline = 0;
      let weightedOpenPipeline = 0;
      let wonCount = 0;
      let wonPipeline = 0;
      let lostCount = 0;

      for (const prospect of prospects) {
        const dealStatus = getDealStatus(prospect);

        if (dealStatus === "open") {
          openProspects.push(prospect);
          openPipeline += prospect.dealAmount;
          weightedOpenPipeline += prospect.dealAmount * (prospect.closeProbability / 100);

          if (matchesCloseDateFilter(prospect, "overdue", "", "")) {
            overdueCloseProspects.push(prospect);
          }

          continue;
        }

        if (dealStatus === "won") {
          wonCount += 1;
          wonPipeline += prospect.dealAmount;
          continue;
        }

        if (dealStatus === "lost") {
          lostCount += 1;
          lostPipeline += prospect.dealAmount;
        }
      }

      const closedCount = wonCount + lostCount;
      const winRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : 0;

      return {
        lostPipeline,
        openPipeline,
        openProspects,
        overdueCloseProspects,
        weightedOpenPipeline,
        winRate,
        wonPipeline,
      };
    },
    [prospects],
  );
  const taskProspects = useMemo(() => getPriorityTasks(pipelineSummary.openProspects), [pipelineSummary.openProspects]);
  const forecastChart = useMemo(() => buildForecastChart(prospects), [prospects]);
  const stageChart = useMemo(() => buildStageChart(prospects, hideClosedLostStage), [hideClosedLostStage, prospects]);
  const metricCards = useMemo(
    () =>
      buildMetricCards({
        lostPipeline: pipelineSummary.lostPipeline,
        openPipeline: pipelineSummary.openPipeline,
        openProspectCount: pipelineSummary.openProspects.length,
        weightedOpenPipeline: pipelineSummary.weightedOpenPipeline,
        winRate: pipelineSummary.winRate,
        wonPipeline: pipelineSummary.wonPipeline,
      }),
    [
      pipelineSummary.lostPipeline,
      pipelineSummary.openPipeline,
      pipelineSummary.openProspects.length,
      pipelineSummary.weightedOpenPipeline,
      pipelineSummary.winRate,
      pipelineSummary.wonPipeline,
    ],
  );

  const handleSyncHubSpot = async () => {
    if (!onSyncHubSpot) {
      return;
    }

    try {
      setSyncLoading(true);
      setSyncJob(null);
      setAdminMessage(null);
      setAdminError(null);

      const result = await onSyncHubSpot(setSyncJob);
      const followUpMessage = result.autoFollowUp
        ? ` Relances: ${result.autoFollowUp.createdCount} creee(s), ${result.autoFollowUp.failedCount} echec(s).`
        : "";
      const crmMessage = result.crm
        ? ` CRM: ${result.crm.dealCount} deal(s), ${result.crm.contactCount} contact(s), ${result.crm.companyCount} entreprise(s), ${result.crm.leadCount} lead(s).`
        : "";

      setAdminMessage(
        `Sync terminee: ${result.syncedCount} prospect(s) mis a jour dans Supabase.${crmMessage}${followUpMessage}`,
      );
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Erreur inconnue pendant la sync HubSpot.");
    } finally {
      setSyncLoading(false);
    }
  };

  const handleDisconnectHubSpot = async () => {
    if (!onDisconnectHubSpot) {
      return;
    }

    const confirmed = window.confirm("Deconnecter HubSpot et purger les prospects HubSpot synchronises dans Jarvis ?");

    if (!confirmed) {
      return;
    }

    try {
      setDisconnectLoading(true);
      setAdminMessage(null);
      setAdminError(null);

      const result = await onDisconnectHubSpot();
      setAdminMessage(`HubSpot deconnecte. ${result.purgedProspectCount} prospect(s) purge(s).`);
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Erreur inconnue pendant la deconnexion HubSpot.");
    } finally {
      setDisconnectLoading(false);
    }
  };

  return {
    activeBucket,
    activeProspect,
    activeView,
    visitedViews,
    adminError,
    adminMessage,
    averageProbability: filteredSummary.averageProbability,
    baseFilteredProspects,
    bucketCounts,
    disconnectLoading,
    filteredProspects,
    filters,
    forecastChart,
    handleDisconnectHubSpot,
    handleSyncHubSpot,
    hideClosedLostStage,
    integrationStatusClassName,
    integrationStatusLabel,
    isLoadingLiveDeals,
    metricCards,
    overdueCloseProspects: pipelineSummary.overdueCloseProspects,
    selectedAiProvider,
    selectedAiProviderId,
    setActiveBucket,
    setActiveProspectId,
    setActiveView,
    setSelectedAiProviderId,
    setCloseDateFrom,
    setCloseDatePreset,
    setCloseDateTo,
    setHideClosedLostStage,
    setSearchTerm,
    setStageFilter,
    setStatusFilter,
    stageChart,
    syncLoading,
    syncJob,
    taskProspects,
    totalPipeline: filteredSummary.totalPipeline,
  };
};
