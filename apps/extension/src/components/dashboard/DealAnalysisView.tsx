import { useEffect, useMemo, useRef, useState } from "react";
import type { QueueProspect } from "@jarvis/shared";
import {
  AlertTriangle,
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
  fetchDealAnalysisBundle,
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
import { CollapsibleSection } from "./deal/CollapsibleSection";
import { ActionRows, HealthDimension, InsightRows, TrendChart } from "./deal/OverviewPanels";
import { QualificationSection } from "./deal/QualificationSection";
import { ActivitySection } from "./deal/ActivitySection";
import { StakeholdersSummary } from "./deal/StakeholdersSummary";

type DealAnalysisViewProps = {
  activeProspect: QueueProspect | null;
  hubspotPortalId?: string | null;
  orgId: string;
  ownerName?: string;
  onBack: () => void;
  selectedAiProvider: AiProviderOption;
};

const pageCache = new Map<string, DealAnalysisPageResult>();
const qualificationCache = new Map<string, DealQualificationResult>();
const activityPlanCache = new Map<string, DealActivityPlanResult>();

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

const MissingGapsPanel = ({ items }: { items: Array<{ title: string; rationale: string }> }) => {
  const visible = items.slice(0, 3);

  if (visible.length === 0) {
    return null;
  }

  return (
    <article className="jv-theme-block">
      <SectionLabel icon={CircleHelp}>Ce qui manque pour gagner</SectionLabel>
      <ul className="jv-bullet-list">
        {visible.map((item) => (
          <li key={item.title}>
            <strong>{item.title}</strong> — {item.rationale}
          </li>
        ))}
      </ul>
    </article>
  );
};

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

  const loadBundle = async (refresh = false): Promise<DealAnalysisBundleResult | null> => {
    if (!activeProspect) {
      return null;
    }

    const cacheKey = getDealAnalysisCacheKey(orgId, selectedAiProvider, activeProspect.id);

    if (!refresh) {
      const cachedPage = pageCache.get(cacheKey);
      const cachedQualification = qualificationCache.get(cacheKey);
      const cachedActivityPlan = activityPlanCache.get(cacheKey);

      if (cachedPage && cachedQualification && cachedActivityPlan) {
        setPage(cachedPage);
        setQualification(cachedQualification);
        setActivityPlan(cachedActivityPlan);
        setAnalysisError(null);
        setQualificationError(null);
        setActivityPlanError(null);
        return {
          page: cachedPage,
          qualification: cachedQualification,
          activityPlan: cachedActivityPlan,
        };
      }
    }

    try {
      setIsAnalyzing(true);
      setQualificationLoading(true);
      setActivityPlanLoading(true);
      setRefreshAttempt(null);
      setAnalysisJobStep(null);
      setAnalysisError(null);
      setQualificationError(null);
      setActivityPlanError(null);

      const bundle = refresh
        ? await runDealAnalysisJob(true)
        : await fetchDealAnalysisBundle(activeProspect, orgId, selectedAiProvider, false);

      if (activeProspectIdRef.current !== activeProspect.id) {
        return null;
      }

      applyBundle(bundle, cacheKey);
      return bundle;
    } catch (error) {
      captureAppError(error, {
        feature: "deal_analysis",
        operation: refresh ? "refresh_deal_analysis" : "load_deal_analysis_bundle",
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
      return null;
    } finally {
      setIsAnalyzing(false);
      setQualificationLoading(false);
      setActivityPlanLoading(false);
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
    setQualification(null);
    setQualificationError(null);
    setActivityPlan(null);
    setActivityPlanError(null);

    if (activeProspect) {
      void loadBundle(false);
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

  const handleRefresh = () => {
    if (!activeProspect) {
      return;
    }

    const cacheKey = getDealAnalysisCacheKey(orgId, selectedAiProvider, activeProspect.id);

    void (async () => {
      setRefreshMessage(null);
      setTaskResult(null);
      pageCache.delete(cacheKey);
      qualificationCache.delete(cacheKey);
      activityPlanCache.delete(cacheKey);

      const bundle = await loadBundle(true);

      if (activeProspectIdRef.current !== activeProspect.id || !bundle) {
        return;
      }

      setRefreshMessage(`Deal rafraîchi avec l'analyse du ${formatOptionalDateTime(bundle.page.generatedAt)}.`);
    })();
  };

  const snapshot = page?.snapshot ?? null;
  const analysis = page?.analysis ?? null;
  const primaryAction = page?.primaryActions[0] ?? null;
  const refreshLoading = isAnalyzing || qualificationLoading || activityPlanLoading;
  const scoreExplanation = useMemo(() => (analysis ? buildScoreExplanation(analysis) : []), [analysis]);
  const probabilityDegrees = analysis ? Math.round((analysis.closeWonProbability / 100) * 360) : 0;
  const qualificationGaps = qualification?.qualification.missingForWin ?? [];
  const stakeholders = qualification?.qualification.buyingCommittee ?? [];

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
              <p>{analysis.executiveSummary}</p>
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

          <section aria-label="Action prioritaire" className="jv-callout jv-callout-primary">
            <Sparkles aria-hidden="true" size={15} strokeWidth={1.5} />
            <div>
              <p>À faire maintenant</p>
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
          </section>

          <section className="jv-themes-row">
            <div className="jv-theme-block">
              <SectionLabel icon={AlertTriangle}>Risques clés</SectionLabel>
              <InsightRows items={analysis.risks} tone="red" />
            </div>
            <div className="jv-theme-block">
              <SectionLabel icon={Lightbulb}>Signaux positifs</SectionLabel>
              <InsightRows icon={Lightbulb} items={analysis.positiveSignals} tone="green" />
            </div>
          </section>

          <div className="jv-deal-focus-grid">
            <StakeholdersSummary members={stakeholders} />
            <MissingGapsPanel items={qualificationGaps} />
          </div>

          <article className="jv-theme-block">
            <SectionLabel icon={ListChecks}>Prochaines actions</SectionLabel>
            <ActionRows actions={page.primaryActions.slice(0, 3)} />
            <button className="jv-link-button" disabled={taskLoading} onClick={handleCreateTask} type="button">
              {taskLoading ? "Création..." : "Créer une tâche HubSpot"}
            </button>
          </article>

          <div className="jv-deal-details">
            <CollapsibleSection
              subtitle="MEDDICC, processus de décision et atouts"
              title="Qualification détaillée"
            >
              <QualificationSection
                embedded
                error={qualificationError}
                isLoading={qualificationLoading}
                onRefresh={handleRefresh}
                result={qualification}
              />
            </CollapsibleSection>

            <CollapsibleSection
              subtitle="Timeline CRM, next steps et engagement par canal"
              title="Activité & timeline"
            >
              <ActivitySection
                embedded
                error={activityPlanError}
                hubspotPortalId={hubspotPortalId}
                isLoading={activityPlanLoading}
                onRefresh={handleRefresh}
                result={activityPlan}
              />
            </CollapsibleSection>

            <CollapsibleSection
              subtitle="Santé du deal, tendance, historique et écarts vs wins"
              title="Analyse approfondie"
            >
              <div className="jv-deal-grid">
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

                {activeProspect.hubspotDealId ? (
                  <WinGapsCard hubspotDealId={activeProspect.hubspotDealId} orgId={orgId} />
                ) : null}
              </div>
            </CollapsibleSection>
          </div>
        </>
      ) : (
        <AnalysisLoadingPanel
          error={null}
          idleText="Analyse IA en attente."
          isLoading={isAnalyzing}
          steps={dealAnalysisLoadingSteps}
          title="Analyse du deal"
        />
      )}
    </div>
  );
};