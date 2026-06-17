import { buildDealAnalysisBundleForProspect } from "../deal-intelligence.service.js";
import { extractOpenAiRateLimitRetryMs, isTransientLlmError } from "../llm/llm-rate-limiter.js";
import type {
  AnalyzeForecastOptions,
  ForecastAnalyzeDealResult,
  ForecastAnalyzeResult,
  ForecastDeal,
  ForecastGenerateSynthesisResult,
  ForecastOverviewOptions,
} from "./types.js";
import { chunkArray, clamp, getProvider, wait } from "./shared.js";
import { isFreshAnalysisMetadata, loadLatestDealAnalysisMetadata } from "./data-access.js";
import { getForecastOverview } from "./overview.js";
import { runForecastSynthesis } from "./synthesis.js";

const MAX_ANALYZE_DEALS = 40;
const DEFAULT_ANALYZE_BATCH_SIZE = 5;
const MAX_ANALYZE_BATCH_SIZE = 10;
const DEFAULT_RETRY_FAILED_COUNT = 2;
const MAX_RETRY_FAILED_COUNT = 3;

export const analyzeForecastOpenDeals = async (options: AnalyzeForecastOptions): Promise<ForecastAnalyzeResult> => {
  const provider = getProvider(options.llmProvider, options.llmModel);
  const overview = await getForecastOverview(options);
  const batchSize = clamp(
    Math.round(options.batchSize ?? DEFAULT_ANALYZE_BATCH_SIZE),
    1,
    MAX_ANALYZE_BATCH_SIZE,
  );
  const retryFailedCount = clamp(
    Math.round(options.retryFailedCount ?? DEFAULT_RETRY_FAILED_COUNT),
    0,
    MAX_RETRY_FAILED_COUNT,
  );
  const openDeals = overview.deals.filter((deal) => deal.forecastBucket === "openForecast");
  const [qualificationCoverage, activityPlanCoverage] = await Promise.all([
    loadLatestDealAnalysisMetadata(
      options.orgId,
      openDeals.map((deal) => deal.hubspotDealId),
      provider.providerName,
      provider.modelName,
      "deal_qualification",
    ),
    loadLatestDealAnalysisMetadata(
      options.orgId,
      openDeals.map((deal) => deal.hubspotDealId),
      provider.providerName,
      provider.modelName,
      "deal_activity_plan",
    ),
  ]);
  const candidates = overview.deals
    .filter((deal) => deal.forecastBucket === "openForecast")
    .filter(
      (deal) =>
        options.refresh ||
        deal.analysisStatus !== "fresh" ||
        !isFreshAnalysisMetadata(qualificationCoverage.get(deal.hubspotDealId)) ||
        !isFreshAnalysisMetadata(activityPlanCoverage.get(deal.hubspotDealId)),
    )
    .slice(0, clamp(Math.round(options.limit ?? MAX_ANALYZE_DEALS), 1, MAX_ANALYZE_DEALS));
  options.onProgress?.({
    progress: 8,
    step: "Deals ouverts charges",
    message: `${candidates.length} deal(s) a analyser par lots de ${batchSize}. Retry echec(s): ${retryFailedCount}.`,
  });
  let analyzedCount = 0;
  let reusedCount = 0;
  let failedCount = 0;
  const errors: ForecastAnalyzeResult["errors"] = [];

  const chunks = chunkArray(candidates, batchSize);

  for (const [chunkIndex, chunk] of chunks.entries()) {
    options.onProgress?.({
      progress: 10 + Math.round((chunkIndex / Math.max(chunks.length, 1)) * 75),
      step: `Analyse du lot ${chunkIndex + 1}/${chunks.length}`,
      message: `Traitement de ${chunk.length} deal(s) en parallele.`,
    });
    const analyzeDealWithRetry = async (deal: ForecastDeal) => {
      let lastError: string | null = null;

      for (let attempt = 0; attempt <= retryFailedCount; attempt += 1) {
        try {
          if (attempt > 0) {
            options.onProgress?.({
              progress: 10 + Math.round((chunkIndex / Math.max(chunks.length, 1)) * 75),
              step: `Retry ${attempt}/${retryFailedCount}`,
              level: "warning",
              message: `Nouvelle tentative pour ${deal.dealName ?? deal.hubspotDealId}.`,
            });
            const rateLimitDelayMs = lastError ? extractOpenAiRateLimitRetryMs(lastError) : null;

            await wait(rateLimitDelayMs ?? 750 * attempt);
          }

          const result = await buildDealAnalysisBundleForProspect(`hubspot:${deal.hubspotDealId}`, {
            orgId: options.orgId,
            hubspotDealId: deal.hubspotDealId,
            llmProvider: provider.providerName,
            llmModel: provider.modelName,
            contactName: deal.contactName,
            companyName: deal.companyName,
            ownerName: deal.ownerName,
            closeDate: deal.closeDate,
            currentCloseProbability: deal.crmProbability,
            dealAmount: deal.amount,
            dealStage: deal.stage,
            refresh: options.refresh === true,
          });

          return {
            hubspotDealId: deal.hubspotDealId,
            cached: result.page.cached && result.qualification.cached && result.activityPlan.cached,
            retried: attempt > 0,
            error: null,
          };
        } catch (error) {
          lastError = error instanceof Error ? error.message : "Erreur inconnue pendant l'analyse IA.";

          if (!isTransientLlmError(error)) {
            break;
          }
        }
      }

      return {
        hubspotDealId: deal.hubspotDealId,
        cached: false,
        retried: retryFailedCount > 0,
        error: lastError ?? "Erreur inconnue pendant l'analyse IA.",
      };
    };

    const chunkResults = await Promise.all(chunk.map(analyzeDealWithRetry));

    for (const result of chunkResults) {
      if (result.error) {
        failedCount += 1;
        errors.push({
          hubspotDealId: result.hubspotDealId,
          message: result.error,
        });
      } else if (result.cached) {
        reusedCount += 1;
      } else {
        analyzedCount += 1;
      }
    }

    options.onProgress?.({
      progress: 10 + Math.round(((chunkIndex + 1) / Math.max(chunks.length, 1)) * 75),
      step: `Lot ${chunkIndex + 1}/${chunks.length} termine`,
      level: chunkResults.some((result) => result.error) ? "warning" : "success",
      message: `${analyzedCount} traite(s), ${reusedCount} reutilise(s), ${failedCount} echec(s).`,
    });
  }

  options.onProgress?.({
    progress: 88,
    step: "Rechargement du forecast",
    message: "Lecture des analyses stockees depuis Supabase.",
  });

  const reloadedOverview = await getForecastOverview({
    ...options,
    llmProvider: provider.providerName,
    llmModel: provider.modelName,
  });

  options.onProgress?.({
    progress: 94,
    step: "Synthese forecast IA",
    message: "Classement des deals et plan d'action par l'IA.",
  });

  let finalOverview = reloadedOverview;

  try {
    const synthesis = await runForecastSynthesis(reloadedOverview, provider);
    finalOverview = { ...reloadedOverview, synthesis: synthesis ?? reloadedOverview.synthesis };
    options.onProgress?.({
      progress: 99,
      step: "Synthese forecast IA prete",
      level: "success",
      message: synthesis
        ? `Synthese generee: ${synthesis.deals.length} deal(s) classe(s).`
        : "Aucun deal ouvert frais a synthetiser.",
    });
  } catch (synthesisError) {
    options.onProgress?.({
      progress: 99,
      step: "Synthese forecast IA",
      level: "warning",
      message: `Synthese non generee: ${synthesisError instanceof Error ? synthesisError.message : "erreur inconnue"}.`,
    });
  }

  return {
    orgId: options.orgId,
    provider: provider.providerName,
    model: provider.modelName,
    requestedCount: candidates.length,
    batchSize,
    analyzedCount,
    reusedCount,
    failedCount,
    errors,
    overview: finalOverview,
  };
};

export const generateForecastSynthesis = async (
  options: ForecastOverviewOptions,
): Promise<ForecastGenerateSynthesisResult> => {
  const provider = getProvider(options.llmProvider, options.llmModel);
  const overview = await getForecastOverview({
    ...options,
    llmProvider: provider.providerName,
    llmModel: provider.modelName,
  });
  if (overview.synthesis?.status === "fresh") {
    return {
      orgId: options.orgId,
      provider: provider.providerName,
      model: provider.modelName,
      synthesis: overview.synthesis,
      overview,
    };
  }

  const synthesis = await runForecastSynthesis(overview, provider);

  return {
    orgId: options.orgId,
    provider: provider.providerName,
    model: provider.modelName,
    synthesis: synthesis ?? overview.synthesis,
    overview: { ...overview, synthesis: synthesis ?? overview.synthesis },
  };
};

export const analyzeForecastDeal = async (
  hubspotDealId: string,
  options: AnalyzeForecastOptions,
): Promise<ForecastAnalyzeDealResult> => {
  const provider = getProvider(options.llmProvider, options.llmModel);
  const overview = await getForecastOverview({
    ...options,
    llmProvider: provider.providerName,
    llmModel: provider.modelName,
  });
  const deal = overview.deals.find((candidate) => candidate.hubspotDealId === hubspotDealId);

  if (!deal) {
    throw new Error("Deal HubSpot introuvable dans le forecast courant.");
  }

  if (deal.forecastBucket !== "openForecast") {
    throw new Error("Un deal close won est deja integre a 100% et ne necessite pas d'analyse IA forecast.");
  }

  const bundle = await buildDealAnalysisBundleForProspect(`hubspot:${deal.hubspotDealId}`, {
    orgId: options.orgId,
    hubspotDealId: deal.hubspotDealId,
    llmProvider: provider.providerName,
    llmModel: provider.modelName,
    contactName: deal.contactName,
    companyName: deal.companyName,
    ownerName: deal.ownerName,
    closeDate: deal.closeDate,
    currentCloseProbability: deal.crmProbability,
    dealAmount: deal.amount,
    dealStage: deal.stage,
    refresh: options.refresh === true,
  });

  return {
    orgId: options.orgId,
    provider: provider.providerName,
    model: provider.modelName,
    hubspotDealId: deal.hubspotDealId,
    cached: bundle.page.cached && bundle.qualification.cached && bundle.activityPlan.cached,
    analysis: bundle.page,
    overview: await getForecastOverview({
      ...options,
      llmProvider: provider.providerName,
      llmModel: provider.modelName,
    }),
  };
};
