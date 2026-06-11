import type { WinAnalysisRun } from "@jarvis/shared";
import { getSupabaseAdmin } from "../../db/client.js";
import { createLlmProvider } from "../llm/provider.factory.js";
import type { CloseWonDealAnalysis } from "../llm/llm.provider.js";
import { analyzeWonDealContext } from "./analysis.js";
import { computeWinBenchmarks } from "./benchmark.js";
import { loadLatestWinAnalyses, loadRun, loadWonDealContexts, updateRun } from "./data-access.js";
import {
  appendRunLog,
  CLOSE_WON_ANALYSIS_CONCURRENCY,
  getDefaultDateRange,
  mapRunRow,
  parseNumber,
  resolveProvider,
} from "./shared.js";
import type { DealContext, WinRunRow } from "./types.js";

// --- Runs d'analyse qualitative ----------------------------------------------

export const getWinAnalysisRun = async (runId: string): Promise<WinAnalysisRun> => loadRun(runId);

export const createWinAnalysisRun = async (options: {
  orgId: string;
  dateFrom?: string | null;
  dateTo?: string | null;
}): Promise<WinAnalysisRun> => {
  const provider = await resolveProvider(options.orgId);
  const { dateFrom, dateTo } = getDefaultDateRange(options.dateFrom, options.dateTo);
  const { data, error } = await getSupabaseAdmin()
    .from("close_won_analysis_runs")
    .insert({
      org_id: options.orgId,
      scope: "sales_ae",
      provider: provider.providerName,
      model: provider.modelName,
      date_from: dateFrom,
      date_to: dateTo,
      status: "queued",
      progress: 0,
      current_step: "Queued",
      logs: appendRunLog([], "info", "Run close won cree."),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Impossible de creer le run close won: ${error.message}`);
  }

  return mapRunRow(data as WinRunRow);
};

const buildPortfolioDealsSummary = (deals: Array<{ context: DealContext; analysis: CloseWonDealAnalysis }>): string =>
  deals
    .map(({ context, analysis }) =>
      [
        `Deal: ${context.row.deal_name ?? context.row.hubspot_deal_id}`,
        `Entreprise: ${context.companyName ?? "inconnue"}`,
        `Montant: ${parseNumber(context.row.amount) ?? 0}`,
        `Owner: ${context.ownerName ?? "inconnu"}`,
        `Facteur: ${analysis.primaryWinFactor}`,
        `Categorie: ${analysis.winFactorCategory}`,
        `Moments cles: ${analysis.keyMoments.map((moment) => moment.moment).join("; ") || "n/a"}`,
        `Resume: ${analysis.summary}`,
      ].join(" | "),
    )
    .join("\n");

export const executeWinAnalysisRun = async (runId: string): Promise<void> => {
  const run = await loadRun(runId);
  const provider = createLlmProvider({ provider: run.provider, model: run.model });
  let logs = appendRunLog(run.logs, "info", "Chargement des deals gagnes depuis Supabase.");
  let analyzedCount = 0;
  let reusedCount = 0;
  let failedCount = 0;

  await updateRun(run.id, { status: "running", progress: 5, current_step: "Chargement des deals gagnes", logs });

  try {
    const contexts = await loadWonDealContexts(run.orgId, run.dateFrom, run.dateTo);
    const cachedAnalyses = await loadLatestWinAnalyses(
      run.orgId,
      contexts.map((context) => context.row.hubspot_deal_id),
      provider.providerName,
      provider.modelName,
    );
    const analyzedDeals: Array<{ context: DealContext; analysis: CloseWonDealAnalysis }> = [];

    logs = appendRunLog(logs, "info", `${contexts.length} deal(s) gagne(s) a traiter (30 max par run).`);
    await updateRun(run.id, { progress: 10, current_step: "Analyse des deals gagnes", logs, deal_count: contexts.length });

    let nextContextIndex = 0;
    let processedCount = 0;

    const processNextContext = async (): Promise<void> => {
      while (nextContextIndex < contexts.length) {
        const index = nextContextIndex;
        nextContextIndex += 1;
        const context = contexts[index];

        if (!context) {
          continue;
        }

        try {
          const result = await analyzeWonDealContext(
            run.orgId,
            context,
            provider,
            cachedAnalyses.get(context.row.hubspot_deal_id) ?? null,
          );
          analyzedCount += result.cached ? 0 : 1;
          reusedCount += result.cached ? 1 : 0;
          analyzedDeals.push({ context, analysis: result.analysis });
        } catch (error) {
          failedCount += 1;
          logs = appendRunLog(
            logs,
            "warning",
            `Analyse echouee pour ${context.row.deal_name ?? context.row.hubspot_deal_id}: ${
              error instanceof Error ? error.message : "erreur inconnue"
            }`,
          );
        }

        processedCount += 1;
        await updateRun(run.id, {
          progress: 10 + Math.round((processedCount / Math.max(contexts.length, 1)) * 70),
          current_step: `Analyse des deals ${processedCount}/${contexts.length}`,
          logs,
          analyzed_count: analyzedCount,
          reused_count: reusedCount,
          failed_count: failedCount,
        });
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CLOSE_WON_ANALYSIS_CONCURRENCY, Math.max(contexts.length, 1)) }, () =>
        processNextContext(),
      ),
    );

    logs = appendRunLog(logs, "info", "Generation de la synthese des patterns de victoire.");
    await updateRun(run.id, { progress: 86, current_step: "Synthese des patterns", logs });

    const totalWonValue = contexts.reduce((sum, context) => sum + (parseNumber(context.row.amount) ?? 0), 0);
    const portfolio =
      analyzedDeals.length > 0
        ? await provider.analyzeCloseWonPortfolio({
            dealsSummary: buildPortfolioDealsSummary(analyzedDeals),
            dateFrom: run.dateFrom,
            dateTo: run.dateTo,
            scopeLabel: "Tous les Sales AE",
            wonDealCount: contexts.length,
            totalWonValue,
            analyzedDealCount: analyzedDeals.length,
          })
        : null;

    // Le benchmark quantitatif est rafraichi en fin de run (0 LLM).
    try {
      await computeWinBenchmarks(run.orgId);
      logs = appendRunLog(logs, "info", "Benchmark quantitatif des wins recalcule.");
    } catch (benchmarkError) {
      logs = appendRunLog(
        logs,
        "warning",
        `Benchmark wins non recalcule: ${benchmarkError instanceof Error ? benchmarkError.message : "erreur inconnue"}`,
      );
    }

    logs = appendRunLog(logs, "success", "Run close won termine.");
    await updateRun(run.id, {
      status: "completed",
      progress: 100,
      current_step: "Termine",
      logs,
      deal_count: contexts.length,
      analyzed_count: analyzedCount,
      reused_count: reusedCount,
      failed_count: failedCount,
      result: portfolio,
      error: null,
      finished_at: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue pendant le run close won.";
    logs = appendRunLog(logs, "error", message);
    await updateRun(run.id, {
      status: "failed",
      current_step: "Erreur",
      logs,
      analyzed_count: analyzedCount,
      reused_count: reusedCount,
      failed_count: failedCount,
      error: message,
      finished_at: new Date().toISOString(),
    });

    throw error;
  }
};
