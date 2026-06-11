import { getSupabaseAdmin } from "../../db/client.js";
import type { CloseLostDealAnalysis } from "../llm/llm.provider.js";
import { analyzeContext } from "./analysis.js";
import { loadCloseLostDealContexts, loadLatestAnalyses, loadRun, updateRun } from "./data-access.js";
import {
  appendRunLog,
  buildScopeLabel,
  CLOSE_LOST_ANALYSIS_CONCURRENCY,
  getAnalysisStatus,
  getDefaultDateRange,
  getProvider,
  mapRunRow,
  parseNumber,
} from "./shared.js";
import type {
  CloseLostAnalysisRun,
  CloseLostAnalysisRunRow,
  CloseLostDealContext,
  CloseLostRunOptions,
} from "./types.js";

export const getCloseLostAnalysisRun = async (runId: string): Promise<CloseLostAnalysisRun> => loadRun(runId);

export const createCloseLostAnalysisRun = async (options: CloseLostRunOptions): Promise<CloseLostAnalysisRun> => {
  const provider = getProvider(options.llmProvider, options.llmModel);
  const { dateFrom, dateTo } = getDefaultDateRange(options.dateFrom, options.dateTo);
  const supabase = getSupabaseAdmin();
  const initialLogs = appendRunLog([], "info", "Run close lost cree.");
  const { data, error } = await supabase
    .from("close_lost_analysis_runs")
    .insert({
      org_id: options.orgId,
      scope: options.scope,
      hubspot_owner_id: options.scope === "owner" ? options.hubspotOwnerId ?? null : null,
      sales_ae_owner_ids: options.scope === "sales_ae" ? options.salesAeOwnerIds ?? [] : [],
      provider: provider.providerName,
      model: provider.modelName,
      date_from: dateFrom,
      date_to: dateTo,
      status: "queued",
      progress: 0,
      current_step: "Queued",
      logs: initialLogs,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Impossible de creer le run close lost: ${error.message}`);
  }

  return mapRunRow(data as CloseLostAnalysisRunRow);
};

const buildPortfolioDealsSummary = (
  deals: Array<{ context: CloseLostDealContext; analysis: CloseLostDealAnalysis }>,
): string =>
  deals
    .map(({ context, analysis }) =>
      [
        `Deal: ${context.row.deal_name ?? context.row.hubspot_deal_id}`,
        `Entreprise: ${context.company?.name ?? context.contact?.company_name ?? "inconnue"}`,
        `Montant: ${parseNumber(context.row.amount) ?? 0}`,
        `Stage: ${context.row.deal_stage_label ?? context.row.deal_stage ?? "inconnu"}`,
        `Raison: ${analysis.primaryLossReason}`,
        `Categorie: ${analysis.lossReasonCategory}`,
        `Concurrent: ${analysis.competitorName ?? "non identifie"}`,
        `Reactivation: ${analysis.reactivationScore}`,
        `Resume: ${analysis.summary}`,
      ].join(" | "),
    )
    .join("\n");

export const executeCloseLostAnalysisRun = async (runId: string): Promise<void> => {
  const run = await loadRun(runId);
  const provider = getProvider(run.provider, run.model);
  let logs = appendRunLog(run.logs, "info", "Chargement des deals perdus depuis Supabase.");
  let analyzedCount = 0;
  let reusedCount = 0;
  let failedCount = 0;

  await updateRun(run.id, {
    status: "running",
    progress: 5,
    current_step: "Chargement des deals perdus",
    logs,
  });

  try {
    const contexts = await loadCloseLostDealContexts({
      orgId: run.orgId,
      scope: run.scope,
      hubspotOwnerId: run.hubspotOwnerId,
      salesAeOwnerIds: run.salesAeOwnerIds,
      dateFrom: run.dateFrom,
      dateTo: run.dateTo,
    });
    const latestAnalyses = await loadLatestAnalyses(
      run.orgId,
      contexts.map((context) => context.row.hubspot_deal_id),
      provider.providerName,
      provider.modelName,
    );
    const analyzedDeals: Array<{ context: CloseLostDealContext; analysis: CloseLostDealAnalysis }> = [];

    logs = appendRunLog(logs, "info", `${contexts.length} deal(s) close lost a traiter.`);
    await updateRun(run.id, {
      progress: 10,
      current_step: "Analyse des deals",
      logs,
      deal_count: contexts.length,
    });

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

        const latestAnalysis = latestAnalyses.get(context.row.hubspot_deal_id) ?? null;

        if (latestAnalysis && getAnalysisStatus(context.row, latestAnalysis) === "fresh") {
          reusedCount += 1;
          analyzedDeals.push({
            context,
            analysis: latestAnalysis.analysis,
          });
        } else {
          try {
            const result = await analyzeContext(run.orgId, context, provider, false);
            analyzedCount += result.cached ? 0 : 1;
            reusedCount += result.cached ? 1 : 0;
            analyzedDeals.push({
              context,
              analysis: result.row.analysis,
            });
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
        }

        processedCount += 1;
        const progress = 10 + Math.round((processedCount / Math.max(contexts.length, 1)) * 70);
        await updateRun(run.id, {
          progress,
          current_step: `Analyse des deals ${processedCount}/${contexts.length}`,
          logs,
          analyzed_count: analyzedCount,
          reused_count: reusedCount,
          failed_count: failedCount,
        });
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(CLOSE_LOST_ANALYSIS_CONCURRENCY, Math.max(contexts.length, 1)) },
        () => processNextContext(),
      ),
    );

    logs = appendRunLog(logs, "info", "Generation de la synthese globale close lost.");
    await updateRun(run.id, {
      progress: 86,
      current_step: "Synthese globale",
      logs,
    });

    const totalLostValue = contexts.reduce((sum, context) => sum + (parseNumber(context.row.amount) ?? 0), 0);
    const ownerName = contexts.find((context) => context.ownerName)?.ownerName ?? null;
    const portfolio =
      analyzedDeals.length > 0
        ? await provider.analyzeCloseLostPortfolio({
            dealsSummary: buildPortfolioDealsSummary(analyzedDeals),
            dateFrom: run.dateFrom,
            dateTo: run.dateTo,
            scopeLabel: buildScopeLabel(run.scope, ownerName),
            lostDealCount: contexts.length,
            totalLostValue,
            analyzedDealCount: analyzedDeals.length,
          })
        : null;

    logs = appendRunLog(logs, "success", "Run close lost termine.");
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
    const message = error instanceof Error ? error.message : "Erreur inconnue pendant le run close lost.";
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
