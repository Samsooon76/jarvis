import { useEffect, useMemo, useRef, useState } from "react";
import type { QueueProspect } from "@jarvis/shared";
import {
  AlertTriangle,
  AlignLeft,
  ArrowLeft,
  ChartNoAxesCombined,
  CircleHelp,
  Lightbulb,
  ListChecks,
  Radar,
  RefreshCw,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import {
  createFollowUpTask,
  fetchDealActivityPlan,
  fetchDealAnalysisPage,
  fetchDealQualification,
  startAndPollDealAnalysisRun,
  type AiProviderOption,
  type DealActivityPlanResult,
  type DealAnalysisBundleResult,
  type DealAnalysisPageResult,
  type DealQualificationResult,
  type FollowUpTaskResult,
} from "../../services/api";
import { captureAppError } from "../../sentry";
import { formatAmount } from "../../utils/dashboard/formatters";
import {
  buildScoreExplanation,
  compactText,
  forecastLabels,
  formatCloseDelta,
  formatMetricCaption,
  formatMetricValue,
  formatOptionalDate,
  formatOptionalDateTime,
  getDealAnalysisCacheKey,
} from "../../utils/dashboard/dealAnalysis";
import { getInitials } from "../../utils/dashboard/prospects";
import "../styles/deal-analysis.css";
import { DealProbabilityHistoryPanel } from "./DealProbabilityHistoryPanel";
import { WinGapsCard } from "./WinGapsCard";
import { AnalysisLoadingPanel, type LoadingStep } from "./deal/AnalysisLoadingPanel";
import { ActionRows, HealthDimension, InsightRows, TrendChart } from "./deal/OverviewPanels";
import { QualificationSection } from "./deal/QualificationSection";
import { ActivitySection } from "./deal/ActivitySection";

type DealAnalysisViewProps = {
  activeProspect: QueueProspect | null;
  hubspotPortalId?: string | null;
  orgId: string;
  ownerName?: string;
  onBack: () => void;
  selectedAiProvider: AiProviderOption;
};

type DealSection = "overview" | "qualification" | "activity";

const pageCache = new Map<string, DealAnalysisPageResult>();
const qualificationCache = new Map<string, DealQualificationResult>();
const activityPlanCache = new Map<string, DealActivityPlanResult>();

const sectionOptions: Array<{ id: DealSection; label: string }> = [
  { id: "overview", label: "Vue d'ensemble" },
  { id: "qualification", label: "Comité & qualification" },
  { id: "activity", label: "Activité & plan" },
];

const dealAnalysisLoadingSteps: LoadingStep[] = [
  {
    label: "Résolution du deal",
    detail: "Identification du prospect, du deal HubSpot et du contexte organisation.",
  },
  {
    label: "Lecture HubSpot",
    detail: "Chargement de la timeline, du snapshot deal et des contacts associés.",
  },
  {
    label: "Analyse IA",
    detail: "Évaluation de la probabilité, des risques et des prochaines actions.",
  },
  {
    label: "Préparation dashboard",
    detail: "Construction des métriques, tendances et cartes de synthèse.",
  },
];

const getErrorMessage = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback);

const SectionLabel = ({ children, icon: Icon }: { children: string; icon: LucideIcon }) => (
  <span className="jv-section-label">
    <Icon aria-hidden="true" className="jv-section-icon" size={13} strokeWidth={1.5} />
    {children}
  </span>
);

const FilterPills = <T extends string>({
  active,
  onChange,
  options,
}: {
  active: T;
  onChange: (value: T) => void;
  options: Array<{ id: T; label: string }>;
}) => (
  <div aria-label="Sections analyse deal" className="jv-filter-pills" role="group">
    {options.map((option) => (
      <button
        className={active === option.id ? "active" : undefined}
        key={option.id}
        onClick={() => onChange(option.id)}
        type="button"
      >
        {option.label}
      </button>
    ))}
  </div>
);

export const DealAnalysisView = ({
  activeProspect,
  hubspotPortalId,
  orgId,
  ownerName,
  onBack,
  selectedAiProvider,
}: DealAnalysisViewProps) => {
  const [page, setPage] = useState<DealAnalysisPageResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<DealSection>("overview");
  const [qualification, setQualification] = useState<DealQualificationResult | null>(null);
  const [qualificationLoading, setQualificationLoading] = useState(false);
  const [qualificationError, setQualificationError] = useState<string | null>(null);
  const [activityPlan, setActivityPlan] = useState<DealActivityPlanResult | null>(null);
  const [activityPlanLoading, setActivityPlanLoading] = useState(false);
  const [activityPlanError, setActivityPlanError] = useState<string | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskResult, setTaskResult] = useState<FollowUpTaskResult | null>(null);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [refreshAttempt, setRefreshAttempt] = useState<number | null>(null);
  const [analysisJobStep, setAnalysisJobStep] = useState<string | null>(null);
  const activeProspectIdRef = useRef<string | null>(activeProspect?.id ?? null);

  useEffect(() => {
    activeProspectIdRef.current = activeProspect?.id ?? null;
  }, [activeProspect?.id]);

  const loadQualification = async (refresh = false) => {
    if (!activeProspect) {
      return;
    }

    const cacheKey = getDealAnalysisCacheKey(orgId, selectedAiProvider, activeProspect.id);

    if (!refresh) {
      const cached = qualificationCache.get(cacheKey);

      if (cached) {
        setQualification(cached);
        setQualificationError(null);
        return;
      }
    }

    try {
      setQualificationLoading(true);
      setQualificationError(null);

      const result = await fetchDealQualification(activeProspect, orgId, selectedAiProvider, refresh);
      qualificationCache.set(cacheKey, result);
      if (activeProspectIdRef.current !== activeProspect.id) {
        return;
      }
      setQualification(result);
    } catch (error) {
      captureAppError(error, {
        feature: "deal_analysis",
        operation: "load_qualification",
        orgId,
        prospectId: activeProspect.id,
        hubspotDealId: activeProspect.hubspotDealId ?? null,
        provider: selectedAiProvider.id,
        model: selectedAiProvider.model,
        refresh,
      });
      setQualificationError(getErrorMessage(error, "Qualification deal indisponible."));
    } finally {
      setQualificationLoading(false);
    }
  };

  const loadActivityPlan = async (refresh = false) => {
    if (!activeProspect) {
      return;
    }

    const cacheKey = getDealAnalysisCacheKey(orgId, selectedAiProvider, activeProspect.id);

    if (!refresh) {
      const cached = activityPlanCache.get(cacheKey);

      if (cached) {
        setActivityPlan(cached);
        setActivityPlanError(null);
        return;
      }
    }

    try {
      setActivityPlanLoading(true);
      setActivityPlanError(null);

      const result = await fetchDealActivityPlan(activeProspect, orgId, selectedAiProvider, refresh);
      activityPlanCache.set(cacheKey, result);
      if (activeProspectIdRef.current !== activeProspect.id) {
        return;
      }
      setActivityPlan(result);
    } catch (error) {
      captureAppError(error, {
        feature: "deal_analysis",
        operation: "load_activity_plan",
        orgId,
        prospectId: activeProspect.id,
        hubspotDealId: activeProspect.hubspotDealId ?? null,
        provider: selectedAiProvider.id,
        model: selectedAiProvider.model,
        refresh,
      });
      setActivityPlanError(getErrorMessage(error, "Activité deal indisponible."));
    } finally {
      setActivityPlanLoading(false);
    }
  };

  const applyBundle = (bundle: DealAnalysisBundleResult, cacheKey: string) => {
    pageCache.set(cacheKey, bundle.page);
    qualificationCache.set(cacheKey, bundle.qualification);
    activityPlanCache.set(cacheKey, bundle.activityPlan);
    setPage(bundle.page);
    setQualification(bundle.qualification);
    setActivityPlan(bundle.activityPlan);
    setAnalysisError(null);
    setQualificationError(null);
    setActivityPlanError(null);
  };

  const runDealAnalysisJob = async (refresh: boolean): Promise<DealAnalysisBundleResult> => {
    if (!activeProspect) {
      throw new Error("Aucun deal sélectionné.");
    }

    return startAndPollDealAnalysisRun(activeProspect, orgId, selectedAiProvider, refresh, (status) => {
      setRefreshAttempt(status.progress);
      setAnalysisJobStep(status.currentStep);
    });
  };

  const loadPage = async (refresh = false) => {
    if (!activeProspect) {
      return;
    }

    const cacheKey = getDealAnalysisCacheKey(orgId, selectedAiProvider, activeProspect.id);

    if (!refresh) {
      const cached = pageCache.get(cacheKey);

      if (cached) {
        setPage(cached);
        setAnalysisError(null);
        return;
      }
    }

    try {
      setIsAnalyzing(true);
      setRefreshAttempt(null);
      setAnalysisJobStep(null);
      setAnalysisError(null);
      setQualificationError(null);
      setActivityPlanError(null);

      if (refresh) {
        const result = await runDealAnalysisJob(true);
        if (activeProspectIdRef.current !== activeProspect.id) {
          return;
        }
        applyBundle(result, cacheKey);
        return;
      }

      const result = await fetchDealAnalysisPage(activeProspect, orgId, selectedAiProvider, false);
      if (activeProspectIdRef.current !== activeProspect.id) {
        return;
      }
      pageCache.set(cacheKey, result);
      setPage(result);
      setAnalysisError(null);
    } catch (error) {
      captureAppError(error, {
        feature: "deal_analysis",
        operation: "load_page",
        orgId,
        prospectId: activeProspect.id,
        hubspotDealId: activeProspect.hubspotDealId ?? null,
        provider: selectedAiProvider.id,
        model: selectedAiProvider.model,
        refresh,
      });
      const message = getErrorMessage(error, "Analyse deal indisponible.");
      setAnalysisError(message);
      setQualificationError(message);
      setActivityPlanError(message);
    } finally {
      setIsAnalyzing(false);
      setRefreshAttempt(null);
      setAnalysisJobStep(null);
    }
  };

  useEffect(() => {
    setPage(null);
    setTaskResult(null);
    setRefreshMessage(null);
    setRefreshAttempt(null);
    setAnalysisJobStep(null);
    setAnalysisError(null);
    setActiveSection("overview");
    setQualification(null);
    setQualificationError(null);
    setActivityPlan(null);
    setActivityPlanError(null);

    if (activeProspect) {
      void loadPage(false);
      void loadQualification(false);
      void loadActivityPlan(false);
    }
  }, [activeProspect?.id, orgId, ownerName, selectedAiProvider.id, selectedAiProvider.model]);

  const handleCreateTask = async () => {
    if (!activeProspect) {
      return;
    }

    try {
      setTaskLoading(true);
      setTaskResult(null);

      const result = await createFollowUpTask(activeProspect, orgId);
      setTaskResult(result);
    } catch (error) {
      captureAppError(error, {
        feature: "deal_analysis",
        operation: "create_follow_up_task",
        orgId,
        prospectId: activeProspect.id,
        hubspotDealId: activeProspect.hubspotDealId ?? null,
        provider: selectedAiProvider.id,
        model: selectedAiProvider.model,
      });
      setAnalysisError(getErrorMessage(error, "Impossible de créer la tâche HubSpot."));
    } finally {
      setTaskLoading(false);
    }
  };

  const handleSectionChange = (section: DealSection) => {
    setActiveSection(section);

    if (section === "qualification" && !qualification && !qualificationLoading) {
      void loadQualification(false);
    }

    if (section === "activity" && !activityPlan && !activityPlanLoading) {
      void loadActivityPlan(false);
    }
  };

  const handleRefresh = () => {
    if (!activeProspect) {
      return;
    }

    const cacheKey = getDealAnalysisCacheKey(orgId, selectedAiProvider, activeProspect.id);

    void (async () => {
      try {
        setIsAnalyzing(true);
        setQualificationLoading(true);
        setActivityPlanLoading(true);
        setRefreshMessage(null);
        setAnalysisJobStep(null);
        setAnalysisError(null);
        setQualificationError(null);
        setActivityPlanError(null);
        setTaskResult(null);

        const result = await runDealAnalysisJob(true);
        if (activeProspectIdRef.current !== activeProspect.id) {
          return;
        }

        pageCache.delete(cacheKey);
        qualificationCache.delete(cacheKey);
        activityPlanCache.delete(cacheKey);

        applyBundle(result, cacheKey);
        setRefreshMessage(`Deal rafraîchi avec l'analyse du ${formatOptionalDateTime(result.page.generatedAt)}.`);
      } catch (error) {
        captureAppError(error, {
          feature: "deal_analysis",
          operation: "refresh_deal_analysis",
          orgId,
          prospectId: activeProspect.id,
          hubspotDealId: activeProspect.hubspotDealId ?? null,
          provider: selectedAiProvider.id,
          model: selectedAiProvider.model,
          refresh: true,
        });
        const message = getErrorMessage(error, "Erreur inconnue pendant le rafraîchissement du deal.");
        setAnalysisError(`Impossible de rafraîchir le deal complet. Réessaie le rafraîchissement. Détail : ${message}`);
      } finally {
        setIsAnalyzing(false);
        setQualificationLoading(false);
        setActivityPlanLoading(false);
        setRefreshAttempt(null);
        setAnalysisJobStep(null);
      }
    })();
  };

  const snapshot = page?.snapshot ?? null;
  const analysis = page?.analysis ?? null;
  const primaryAction = page?.primaryActions[0] ?? null;
  const refreshLoading = isAnalyzing || qualificationLoading || activityPlanLoading;
  const summaryLines = useMemo(() => {
    if (!analysis) {
      return [];
    }

    return [analysis.executiveSummary, ...analysis.detailedAnalysis].filter(Boolean).slice(0, 3);
  }, [analysis]);
  const scoreExplanation = useMemo(() => (analysis ? buildScoreExplanation(analysis) : []), [analysis]);
  const probabilityDegrees = analysis ? Math.round((analysis.closeWonProbability / 100) * 360) : 0;

  if (!activeProspect) {
    return (
      <div aria-label="Analyse deal" className="jv-deal-page">
        <header className="jv-page-header">
          <ChartNoAxesCombined aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
          <h1>
            Analyse deal
            <span className="jv-page-kicker">pipeline</span>
          </h1>
        </header>
        <div className="jv-detail-empty">
          <ChartNoAxesCombined aria-hidden="true" size={20} strokeWidth={1.25} />
          <strong>Sélectionnez un deal</strong>
          <p>Choisissez un deal dans l'overview pour ouvrir son analyse.</p>
          <button className="jv-btn-ghost" onClick={onBack} type="button">
            <ArrowLeft size={14} strokeWidth={1.5} />
            Retour overview
          </button>
        </div>
      </div>
    );
  }

  return (
    <div aria-label="Analyse deal" className="jv-deal-page">
      <header className="jv-page-header">
        <ChartNoAxesCombined aria-hidden="true" className="jv-page-icon" size={18} strokeWidth={1.5} />
        <h1>
          Analyse deal
          <span className="jv-page-kicker">pipeline</span>
        </h1>
      </header>

      <div className="jv-toolbar">
        <div className="jv-toolbar-filters">
          <button className="jv-btn-ghost" onClick={onBack} type="button">
            <ArrowLeft size={14} strokeWidth={1.5} />
            Retour overview
          </button>
          <FilterPills active={activeSection} onChange={handleSectionChange} options={sectionOptions} />
        </div>
        <div className="jv-toolbar-actions">
          <span className="jv-sync-note">
            Dernière analyse
            <strong>{formatOptionalDateTime(page?.generatedAt)}</strong>
          </span>
          <button className="jv-btn-primary" disabled={refreshLoading} onClick={handleRefresh} type="button">
            {refreshLoading ? (
              <>
                <RefreshCw aria-hidden="true" className="jv-spin" size={14} strokeWidth={1.5} />
                {analysisJobStep ?? (refreshAttempt ? `Analyse ${refreshAttempt}%` : "Analyse...")}
              </>
            ) : (
              <>
                <Sparkles aria-hidden="true" size={14} strokeWidth={1.5} />
                Rafraîchir le deal
              </>
            )}
          </button>
        </div>
      </div>

      {analysisError ? <p className="jv-banner jv-banner-error">{analysisError}</p> : null}
      {refreshMessage ? <p className="jv-banner jv-banner-success">{refreshMessage}</p> : null}
      {taskResult ? (
        <p className="jv-banner jv-banner-success">
          {taskResult.created ? "Tâche HubSpot créée." : taskResult.recommendation.rationale}
        </p>
      ) : null}

      {page && snapshot && analysis ? (
        <>
          <div className="jv-deal-head">
            <span aria-hidden="true" className="jv-deal-avatar">
              {getInitials(snapshot.companyName)}
            </span>
            <div className="jv-deal-head-main">
              <h2>{snapshot.companyName}</h2>
              <p>
                {[snapshot.contactName, snapshot.contactEmail, snapshot.contactPhone].filter(Boolean).join(" · ") ||
                  "Contact CRM"}
              </p>
              <div className="jv-item-meta">
                <span>{snapshot.ownerName ?? "Non assigné"}</span>
                <span>{snapshot.stage}</span>
                <span className="jv-meta-score">{forecastLabels[snapshot.forecastLabel]}</span>
              </div>
            </div>
            <div className="jv-sync-note">
              Valeur
              <strong>{formatAmount(snapshot.amount)}</strong>
            </div>
          </div>

          <section aria-label="Indicateurs deal" className={`jv-stat-strip${page.metrics.length === 4 ? " cols-4" : ""}`}>
            {page.metrics.map((metric, index) => (
              <div className="jv-stat" key={metric.id} style={{ animationDelay: `${index * 60}ms` }}>
                <span className="jv-stat-label">{metric.label}</span>
                <span className="jv-stat-value">{formatMetricValue(metric)}</span>
                {formatMetricCaption(metric) ? (
                  <small className="jv-stat-caption">{formatMetricCaption(metric)}</small>
                ) : null}
              </div>
            ))}
          </section>

          <section aria-label="Probabilité de gain" className="jv-score-banner">
            <div
              className="jv-score-ring"
              style={{
                background: `conic-gradient(var(--jv-terra) ${probabilityDegrees}deg, #ece9e3 0)`,
              }}
            >
              <span>{analysis.closeWonProbability} %</span>
            </div>
            <div className="jv-score-copy">
              <strong>Probabilité de gain</strong>
              <p>{compactText(analysis.executiveSummary, 160)}</p>
              <small>
                Clôture prévue {formatOptionalDate(snapshot.closeDate)} · {formatCloseDelta(snapshot.closeDate)}
              </small>
              <span className="jv-score-help" tabIndex={0} title="Pourquoi ce score ?">
                <CircleHelp size={13} strokeWidth={2} />
                <span className="jv-score-tooltip" role="tooltip">
                  {scoreExplanation.length > 0
                    ? scoreExplanation.map((item) => <small key={item}>{item}</small>)
                    : <small>Analyse IA non disponible pour expliquer ce score.</small>}
                </span>
              </span>
            </div>
            <span className="jv-score-badge">
              <Sparkles aria-hidden="true" size={11} strokeWidth={1.5} />
              IA
            </span>
          </section>

          <section className="jv-themes-row">
            <div className="jv-theme-block">
              <SectionLabel icon={AlertTriangle}>Risques clés</SectionLabel>
              <InsightRows items={analysis.risks.slice(0, 5)} tone="red" />
            </div>
            <div className="jv-theme-block">
              <SectionLabel icon={Lightbulb}>Signaux positifs</SectionLabel>
              <InsightRows icon={Lightbulb} items={analysis.positiveSignals.slice(0, 5)} tone="green" />
            </div>
          </section>

          {activeProspect.hubspotDealId ? (
            <WinGapsCard hubspotDealId={activeProspect.hubspotDealId} orgId={orgId} />
          ) : null}

          {activeSection === "overview" ? (
            <div className="jv-deal-content">
              <div className="jv-deal-grid">
                <article className="jv-theme-block span-2">
                  <SectionLabel icon={AlignLeft}>Résumé IA</SectionLabel>
                  {summaryLines.map((line) => (
                    <p className="jv-prose" key={line}>
                      {compactText(line, 220)}
                    </p>
                  ))}
                  <div className="jv-callout">
                    <Sparkles aria-hidden="true" size={15} strokeWidth={1.5} />
                    <div>
                      <p>Prochaine meilleure action</p>
                      <button
                        className="jv-callout-action"
                        disabled={taskLoading}
                        onClick={handleCreateTask}
                        type="button"
                      >
                        <strong>{primaryAction?.title ?? analysis.suggestedMove}</strong>
                        <small>
                          {primaryAction ? primaryAction.rationale : "Synchronisé depuis l'analyse IA du deal."}
                        </small>
                      </button>
                    </div>
                  </div>
                </article>

                <article className="jv-theme-block">
                  <SectionLabel icon={Radar}>Santé du deal</SectionLabel>
                  <div className="jv-health-grid">
                    {page.healthDimensions.map((dimension) => (
                      <HealthDimension dimension={dimension} key={dimension.id} />
                    ))}
                  </div>
                </article>

                <article className="jv-theme-block">
                  <SectionLabel icon={TrendingUp}>Évolution du deal</SectionLabel>
                  <TrendChart points={page.probabilityTrend} />
                </article>

                <DealProbabilityHistoryPanel orgId={orgId} hubspotDealId={activeProspect.hubspotDealId ?? null} />

                <article className="jv-theme-block">
                  <SectionLabel icon={ListChecks}>Prochaines actions</SectionLabel>
                  <ActionRows actions={page.primaryActions} />
                  <button className="jv-link-button" disabled={taskLoading} onClick={handleCreateTask} type="button">
                    {taskLoading ? "Création..." : "Créer une tâche HubSpot"}
                  </button>
                </article>
              </div>
            </div>
          ) : null}

          {activeSection === "qualification" ? (
            <QualificationSection
              error={qualificationError}
              isLoading={qualificationLoading}
              onRefresh={() => void loadQualification(true)}
              result={qualification}
            />
          ) : null}

          {activeSection === "activity" ? (
            <ActivitySection
              error={activityPlanError}
              hubspotPortalId={hubspotPortalId}
              isLoading={activityPlanLoading}
              onRefresh={() => void loadActivityPlan(true)}
              result={activityPlan}
            />
          ) : null}
        </>
      ) : (
        <AnalysisLoadingPanel
          error={null}
          idleText="Analyse IA en attente."
          isLoading={isAnalyzing}
          steps={dealAnalysisLoadingSteps}
          title="Vue d'ensemble du deal"
        />
      )}
    </div>
  );
};