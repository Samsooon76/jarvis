import { useEffect, useMemo, useRef, useState } from "react";
import type { QueueProspect } from "@jarvis/shared";
import { CircleHelp, Loader2 } from "lucide-react";
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
  formatOptionalDate,
  formatOptionalDateTime,
  getDealAnalysisCacheKey,
} from "../../utils/dashboard/dealAnalysis";
import { getInitials } from "../../utils/dashboard/prospects";
import { DealProbabilityHistoryPanel } from "./DealProbabilityHistoryPanel";
import { WinGapsCard } from "./WinGapsCard";
import { AnalysisLoadingPanel, type LoadingStep } from "./deal/AnalysisLoadingPanel";
import { ActionRows, HealthDimension, InsightRows, MetricCard, TrendChart } from "./deal/OverviewPanels";
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

const getErrorMessage = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback);

const dealAnalysisLoadingSteps: LoadingStep[] = [
  {
    label: "Resolution du deal",
    detail: "Identification du prospect, du deal HubSpot et du contexte organisation.",
  },
  {
    label: "Lecture HubSpot",
    detail: "Chargement de la timeline, du snapshot deal et des contacts associes.",
  },
  {
    label: "Analyse IA",
    detail: "Evaluation de la probabilite, des risques et des prochaines actions.",
  },
  {
    label: "Preparation dashboard",
    detail: "Construction des metriques, tendances et cartes de synthese.",
  },
];

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
      setActivityPlanError(getErrorMessage(error, "Activite deal indisponible."));
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
      throw new Error("Aucun deal selectionne.");
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
      // Warm the other sections in parallel so switching tabs is instant.
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
      setAnalysisError(getErrorMessage(error, "Impossible de creer la tache HubSpot."));
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
        setRefreshMessage(`Deal rafraichi avec l'analyse du ${formatOptionalDateTime(result.page.generatedAt)}.`);
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
        const message = getErrorMessage(error, "Erreur inconnue pendant le rafraichissement du deal.");
        setAnalysisError(`Impossible de rafraichir le deal complet. Reessaie le rafraichissement. Detail: ${message}`);
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

  if (!activeProspect) {
    return (
      <section className="ae-deal-page" aria-label="Analyse deal">
        <button className="ae-deal-back" onClick={onBack} type="button">
          Retour overview
        </button>
        <p className="ae-empty">Selectionne un deal dans l'overview pour ouvrir son analyse.</p>
      </section>
    );
  }

  return (
    <section className="ae-deal-page" aria-label="Analyse deal">
      <div className="ae-deal-titlebar">
        <button className="ae-deal-back" onClick={onBack} type="button">
          Retour overview
        </button>
        <div>
          <p className="ae-eyebrow">Pipeline inbox / Deal analysis</p>
          <h2>{snapshot?.companyName ?? activeProspect.company}</h2>
        </div>
        <div className="ae-deal-sync-note">
          <span>Derniere analyse</span>
          <strong>{formatOptionalDateTime(page?.generatedAt)}</strong>
        </div>
        <button
          className="ae-deal-refresh"
          disabled={refreshLoading}
          onClick={handleRefresh}
          type="button"
        >
          {refreshLoading ? (
            <span className="ae-button-spinner" aria-label="Rafraichissement en cours" role="status">
              <Loader2 size={15} strokeWidth={2.4} />
              <small>{analysisJobStep ?? (refreshAttempt ? `Analyse ${refreshAttempt}%` : "Analyse...")}</small>
            </span>
          ) : (
            "Rafraichir le deal complet"
          )}
        </button>
      </div>

      {analysisError ? <p className="ae-detail-error">{analysisError}</p> : null}
      {refreshMessage ? <p className="ae-detail-success">{refreshMessage}</p> : null}
      {taskResult ? (
        <p className="ae-detail-success">
          {taskResult.created ? "Task HubSpot creee." : taskResult.recommendation.rationale}
        </p>
      ) : null}

      {activeProspect.hubspotDealId ? (
        <WinGapsCard hubspotDealId={activeProspect.hubspotDealId} orgId={orgId} />
      ) : null}

      {page && snapshot && analysis ? (
        <>
          <section className="ae-deal-hero">
            <div className="ae-deal-company-block">
              <span aria-hidden="true">{getInitials(snapshot.companyName)}</span>
              <div>
                <h3>{snapshot.companyName}</h3>
                <strong>{snapshot.contactName}</strong>
                <p>
                  {[snapshot.contactEmail, snapshot.contactPhone].filter(Boolean).join(" · ") || "Contact CRM"}
                </p>
              </div>
            </div>

            <dl className="ae-deal-hero-facts">
              <div>
                <dt>Proprietaire du deal</dt>
                <dd>{snapshot.ownerName ?? "Non assigne"}</dd>
              </div>
              <div>
                <dt>Valeur</dt>
                <dd>{formatAmount(snapshot.amount)}</dd>
              </div>
              <div>
                <dt>Etape</dt>
                <dd>
                  <i aria-hidden="true" />
                  {snapshot.stage}
                </dd>
              </div>
              <div>
                <dt className="ae-score-label">
                  Probabilite de gain
                  <span className="ae-score-help" tabIndex={0}>
                    <CircleHelp size={14} strokeWidth={2.2} />
                    <span className="ae-score-tooltip" role="tooltip">
                      <strong>Pourquoi ce score ?</strong>
                      {scoreExplanation.length > 0 ? (
                        scoreExplanation.map((item) => <small key={item}>{item}</small>)
                      ) : (
                        <small>Analyse IA non disponible pour expliquer ce score.</small>
                      )}
                    </span>
                  </span>
                </dt>
                <dd>{analysis.closeWonProbability} %</dd>
                <span className="ae-deal-probability-bar">
                  <i style={{ width: `${analysis.closeWonProbability}%` }} />
                </span>
              </div>
              <div>
                <dt>Prevision</dt>
                <dd className="green">{forecastLabels[snapshot.forecastLabel]}</dd>
              </div>
              <div>
                <dt>Date de cloture prevue</dt>
                <dd>{formatOptionalDate(snapshot.closeDate)}</dd>
                <small>{formatCloseDelta(snapshot.closeDate)}</small>
              </div>
            </dl>

            <div className="ae-deal-hero-actions">
              <h3>Actions principales</h3>
              {page.primaryActions.slice(0, 3).map((action) => (
                <p key={`${action.title}:${action.dueAt}`}>
                  <span aria-hidden="true" />
                  {action.title}
                </p>
              ))}
            </div>
          </section>

          <nav className="ae-deal-tabs" aria-label="Analyse deal sections">
            <button
              className={activeSection === "overview" ? "active" : undefined}
              onClick={() => handleSectionChange("overview")}
              type="button"
            >
              Vue d'ensemble
            </button>
            <button
              className={activeSection === "qualification" ? "active" : undefined}
              onClick={() => handleSectionChange("qualification")}
              type="button"
            >
              Comite & qualification
            </button>
            <button
              className={activeSection === "activity" ? "active" : undefined}
              onClick={() => handleSectionChange("activity")}
              type="button"
            >
              Activite & plan d'action
            </button>
          </nav>

          {activeSection === "overview" ? (
            <>
              <section className="ae-deal-metrics" aria-label="Deal metrics">
                {page.metrics.map((metric) => (
                  <MetricCard key={metric.id} metric={metric} />
                ))}
              </section>

              <section className="ae-deal-grid">
                <article className="ae-deal-panel ae-summary-panel">
                  <h3>Resume IA</h3>
                  {summaryLines.map((line) => (
                    <p key={line}>{compactText(line, 180)}</p>
                  ))}
                  <div className="ae-next-best-action">
                    <span>Prochaine meilleure action</span>
                    <button disabled={taskLoading} onClick={handleCreateTask} type="button">
                      <strong>{primaryAction?.title ?? analysis.suggestedMove}</strong>
                      <small>
                        {primaryAction ? primaryAction.rationale : "Synchronise depuis l'analyse IA du deal."}
                      </small>
                    </button>
                  </div>
                </article>

                <article className="ae-deal-panel ae-health-panel">
                  <h3>Sante du deal</h3>
                  <div className="ae-health-grid">
                    {page.healthDimensions.map((dimension) => (
                      <HealthDimension dimension={dimension} key={dimension.id} />
                    ))}
                  </div>
                </article>

                <article className="ae-deal-panel ae-chart-panel">
                  <TrendChart points={page.probabilityTrend} />
                </article>

                <DealProbabilityHistoryPanel orgId={orgId} hubspotDealId={activeProspect.hubspotDealId ?? null} />

                <article className="ae-deal-panel">
                  <h3>Risques cles</h3>
                  <InsightRows items={analysis.risks} tone="red" />
                </article>

                <article className="ae-deal-panel">
                  <h3>Signaux positifs</h3>
                  <InsightRows items={analysis.positiveSignals} tone="green" />
                </article>

                <article className="ae-deal-panel">
                  <h3>Prochaines actions</h3>
                  <ActionRows actions={page.primaryActions} />
                  <button className="ae-link-button" disabled={taskLoading} onClick={handleCreateTask} type="button">
                    {taskLoading ? "Creation..." : "Creer une tache HubSpot"}
                  </button>
                </article>
              </section>
            </>
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
    </section>
  );
};
