import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "../../db/client.js";
import type { ForecastSynthesisAnalysis, ForecastSynthesisCategory } from "../llm/llm.provider.js";
import { buildWinBenchmarkSummaryForPrompt } from "../win-analysis.service.js";
import type {
  ForecastDeal,
  ForecastOverviewResult,
  ForecastScope,
  ForecastSynthesis,
  ForecastSynthesisCategorySummary,
  ForecastSynthesisDeal,
  ForecastSynthesisRow,
  ForecastSynthesisStatus,
} from "./types.js";
import { getProvider } from "./shared.js";

const FORECAST_SYNTHESIS_CACHE_TTL_HOURS = 12;
const MAX_SYNTHESIS_DEALS = 60;

const FORECAST_SYNTHESIS_CATEGORY_LABELS: Record<ForecastSynthesisCategory, string> = {
  commit: "Commit",
  bestCase: "Best case",
  atRisk: "A risque",
  slipping: "Va slipper",
};

const FORECAST_SYNTHESIS_CATEGORY_ORDER: ForecastSynthesisCategory[] = ["commit", "bestCase", "atRisk", "slipping"];

const isMissingForecastSynthesisTableError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const typedError = error as { code?: string; message?: string };
  const message = typedError.message ?? "";

  return typedError.code === "42P01" || typedError.code === "PGRST205" || message.includes("forecast_synthesis");
};

const buildSynthesisScopeLabel = (scope: ForecastScope, deals: ForecastDeal[]): string => {
  if (scope !== "owner") {
    return "Equipe (tous les sales)";
  }

  const ownerName = deals.find((deal) => deal.ownerName && !/^Owner \d+$/i.test(deal.ownerName))?.ownerName;

  return ownerName ? `Owner ${ownerName}` : "Owner";
};

const isDateAfter = (closeDate: string | null, dateTo: string): boolean => {
  if (!closeDate) {
    return false;
  }

  const closeTimestamp = new Date(closeDate).getTime();
  const periodEnd = new Date(`${dateTo}T23:59:59.999Z`).getTime();

  return !Number.isNaN(closeTimestamp) && !Number.isNaN(periodEnd) && closeTimestamp > periodEnd;
};

// Fallback deterministe pour les deals que l'IA n'a pas explicitement classes.
const fallbackCategory = (deal: ForecastDeal, dateTo: string): ForecastSynthesisCategory => {
  const probability = deal.aiProbability ?? deal.crmProbability;

  if (isDateAfter(deal.closeDate, dateTo)) {
    return "slipping";
  }

  if (deal.dealHealth === "blocked" || deal.dealHealth === "at_risk") {
    return "atRisk";
  }

  if (probability >= 70 || deal.dealHealth === "strong") {
    return "commit";
  }

  if (probability >= 40) {
    return "bestCase";
  }

  return "atRisk";
};

export const buildForecastSynthesisInputHash = (
  deals: ForecastDeal[],
  objectiveAmount: number | null,
  dateFrom: string,
  dateTo: string,
): string => {
  const dealSignature = deals
    .map((deal) => `${deal.hubspotDealId}:${deal.analyzedAt ?? ""}`)
    .sort()
    .join("|");

  return createHash("sha256").update(`${dateFrom}|${dateTo}|${objectiveAmount ?? "null"}|${dealSignature}`).digest("hex");
};

export const enrichForecastSynthesis = ({
  analysis,
  analyzedOpenDeals,
  objectiveAmount,
  gapToObjective,
  signedAmount,
  dateTo,
  provider,
  model,
  generatedAt,
  status,
}: {
  analysis: ForecastSynthesisAnalysis;
  analyzedOpenDeals: ForecastDeal[];
  objectiveAmount: number | null;
  gapToObjective: number | null;
  signedAmount: number;
  dateTo: string;
  provider: string;
  model: string;
  generatedAt: string;
  status: ForecastSynthesisStatus;
}): ForecastSynthesis => {
  const verdictByDealId = new Map(analysis.dealVerdicts.map((verdict) => [verdict.hubspotDealId, verdict]));
  const deals: ForecastSynthesisDeal[] = analyzedOpenDeals.map((deal) => {
    const verdict = verdictByDealId.get(deal.hubspotDealId);
    const category = verdict?.category ?? fallbackCategory(deal, dateTo);

    return {
      hubspotDealId: deal.hubspotDealId,
      dealName: deal.dealName,
      companyName: deal.companyName,
      ownerName: deal.ownerName,
      amount: deal.amount,
      forecastAmount: deal.forecastAmount,
      aiProbability: deal.aiProbability,
      crmProbability: deal.crmProbability,
      stage: deal.stage,
      closeDate: deal.closeDate,
      dealHealth: deal.dealHealth,
      category,
      reason: verdict?.reason ?? "Classement automatique (deal non couvert par la synthese IA).",
      recommendedAction: verdict?.recommendedAction ?? deal.suggestedMove,
    };
  });

  const categories: ForecastSynthesisCategorySummary[] = FORECAST_SYNTHESIS_CATEGORY_ORDER.map((category) => {
    const categoryDeals = deals.filter((deal) => deal.category === category);

    return {
      category,
      label: FORECAST_SYNTHESIS_CATEGORY_LABELS[category],
      dealCount: categoryDeals.length,
      amount: categoryDeals.reduce((sum, deal) => sum + deal.amount, 0),
      weightedAmount: categoryDeals.reduce((sum, deal) => sum + deal.forecastAmount, 0),
    };
  });

  const commitAmount = categories.find((category) => category.category === "commit")?.amount ?? 0;

  return {
    generatedAt,
    provider,
    model,
    status,
    headline: analysis.headline,
    confidence: analysis.confidence,
    analyzedDealCount: deals.length,
    objectiveAmount,
    gapToObjective,
    projectedCloseAmount: signedAmount + commitAmount,
    categories,
    deals,
    actionPlan: analysis.actionPlan,
  };
};

const buildSynthesisDealsSummary = (deals: ForecastDeal[]): string =>
  deals
    .map((deal) =>
      [
        `id=${deal.hubspotDealId}`,
        deal.companyName,
        `montant=${deal.amount}`,
        `stage=${deal.stage}`,
        `closeDate=${deal.closeDate ? deal.closeDate.slice(0, 10) : "sans date"}`,
        `probaIA=${deal.aiProbability ?? deal.crmProbability}%`,
        `sante=${deal.dealHealth ?? "inconnue"}`,
        `risques=${deal.risks.slice(0, 3).join("; ") || "aucun"}`,
        `move=${deal.suggestedMove ?? "n/a"}`,
        `resume=${deal.summary ?? "n/a"}`,
      ].join(" | "),
    )
    .join("\n");

const loadLatestForecastSynthesis = async (params: {
  orgId: string;
  scope: ForecastScope;
  hubspotOwnerId: string;
  dateFrom: string;
  dateTo: string;
  provider: string;
  model: string;
}): Promise<ForecastSynthesisRow | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("forecast_synthesis")
    .select("analysis, input_hash, generated_at")
    .eq("org_id", params.orgId)
    .eq("scope", params.scope)
    .eq("hubspot_owner_id", params.hubspotOwnerId)
    .eq("date_from", params.dateFrom)
    .eq("date_to", params.dateTo)
    .eq("provider", params.provider)
    .eq("model", params.model)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingForecastSynthesisTableError(error)) {
      return null;
    }

    throw new Error(`Impossible de charger la synthese forecast IA: ${error.message}`);
  }

  return (data as ForecastSynthesisRow | null) ?? null;
};

const persistForecastSynthesis = async (params: {
  orgId: string;
  scope: ForecastScope;
  hubspotOwnerId: string;
  dateFrom: string;
  dateTo: string;
  provider: string;
  model: string;
  inputHash: string;
  synthesis: ForecastSynthesis;
}): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const expiresAt = new Date();
  expiresAt.setUTCHours(expiresAt.getUTCHours() + FORECAST_SYNTHESIS_CACHE_TTL_HOURS);
  const { error } = await supabase.from("forecast_synthesis").upsert(
    {
      org_id: params.orgId,
      scope: params.scope,
      hubspot_owner_id: params.hubspotOwnerId,
      date_from: params.dateFrom,
      date_to: params.dateTo,
      provider: params.provider,
      model: params.model,
      input_hash: params.inputHash,
      analysis: params.synthesis,
      generated_at: params.synthesis.generatedAt,
      expires_at: expiresAt.toISOString(),
    },
    {
      onConflict: "org_id,scope,hubspot_owner_id,date_from,date_to,provider,model",
    },
  );

  if (error && !isMissingForecastSynthesisTableError(error)) {
    throw new Error(`Impossible de sauvegarder la synthese forecast IA: ${error.message}`);
  }
};

export const loadStoredForecastSynthesis = async (params: {
  orgId: string;
  scope: ForecastScope;
  hubspotOwnerId: string;
  dateFrom: string;
  dateTo: string;
  provider: string;
  model: string;
  freshOpenDeals: ForecastDeal[];
  objectiveAmount: number | null;
}): Promise<ForecastSynthesis | null> => {
  const stored = await loadLatestForecastSynthesis(params);

  if (!stored) {
    return null;
  }

  const currentHash = buildForecastSynthesisInputHash(
    params.freshOpenDeals,
    params.objectiveAmount,
    params.dateFrom,
    params.dateTo,
  );

  return {
    ...stored.analysis,
    status: stored.input_hash === currentHash ? "fresh" : "stale",
  };
};

// Genere la synthese forecast IA a partir des deals ouverts deja analyses (1 appel LLM).
// Renvoie null si aucun deal ouvert frais n'est disponible. Best-effort sur la persistance.
export const runForecastSynthesis = async (
  overview: ForecastOverviewResult,
  provider: ReturnType<typeof getProvider>,
): Promise<ForecastSynthesis | null> => {
  if (overview.synthesis?.status === "fresh") {
    return overview.synthesis;
  }

  const analyzedOpenDeals = overview.deals
    .filter((deal) => deal.forecastBucket === "openForecast" && deal.analysisStatus === "fresh")
    .slice(0, MAX_SYNTHESIS_DEALS);

  if (analyzedOpenDeals.length === 0) {
    return null;
  }

  // Boucle Win Analysis: benchmark des deals gagnes injecte dans le prompt
  // (0 LLM supplementaire; null si le benchmark n'est pas significatif).
  const winBenchmarkSummary = await buildWinBenchmarkSummaryForPrompt(overview.orgId);
  const analysis = await provider.analyzeForecastSynthesis({
    winBenchmarkSummary,
    dealsSummary: buildSynthesisDealsSummary(analyzedOpenDeals),
    knownDealIds: analyzedOpenDeals.map((deal) => deal.hubspotDealId),
    dateFrom: overview.dateFrom,
    dateTo: overview.dateTo,
    scopeLabel: buildSynthesisScopeLabel(overview.scope, analyzedOpenDeals),
    openDealCount: analyzedOpenDeals.length,
    totalOpenAmount: overview.openPipelineAmount,
    signedAmount: overview.signedAmount,
    landingAmount: overview.landingAmount,
    objectiveAmount: overview.objectiveAmount,
    gapToObjective: overview.gapToObjective,
    today: new Date().toISOString(),
  });

  const synthesis = enrichForecastSynthesis({
    analysis,
    analyzedOpenDeals,
    objectiveAmount: overview.objectiveAmount,
    gapToObjective: overview.gapToObjective,
    signedAmount: overview.signedAmount,
    dateTo: overview.dateTo,
    provider: provider.providerName,
    model: provider.modelName,
    generatedAt: new Date().toISOString(),
    status: "fresh",
  });

  await persistForecastSynthesis({
    orgId: overview.orgId,
    scope: overview.scope,
    hubspotOwnerId: overview.scope === "owner" ? overview.hubspotOwnerId ?? "" : "",
    dateFrom: overview.dateFrom,
    dateTo: overview.dateTo,
    provider: provider.providerName,
    model: provider.modelName,
    inputHash: buildForecastSynthesisInputHash(
      analyzedOpenDeals,
      overview.objectiveAmount,
      overview.dateFrom,
      overview.dateTo,
    ),
    synthesis,
  });

  return synthesis;
};
