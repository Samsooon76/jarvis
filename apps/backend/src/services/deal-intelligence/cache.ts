import { env } from "../../config/env.js";
import { getSupabaseAdmin } from "../../db/client.js";
import { isMissingAnalysisTypeColumnError, isMissingDealAiAnalysesTableError } from "./shared.js";
import type { DealAiAnalysisCacheRow, DealAiAnalysisType } from "./types.js";

export const buildExpiresAt = (): string => {
  const ttlHours = Number.isFinite(env.dealAiCacheTtlHours) && env.dealAiCacheTtlHours > 0 ? env.dealAiCacheTtlHours : 6;
  const expiresAt = new Date();
  expiresAt.setUTCHours(expiresAt.getUTCHours() + ttlHours);

  return expiresAt.toISOString();
};

export const loadCachedAnalysis = async <TAnalysis>(
  analysisType: DealAiAnalysisType,
  orgId: string,
  hubspotDealId: string,
  provider: string,
  model: string,
  inputHash?: string | null,
): Promise<DealAiAnalysisCacheRow<TAnalysis> | null> => {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("deal_ai_analyses")
    .select("id, analysis, analysis_type, provider, model, input_hash, generated_at, expires_at")
    .eq("org_id", orgId)
    .eq("hubspot_deal_id", hubspotDealId)
    .eq("analysis_type", analysisType)
    .eq("provider", provider)
    .eq("model", model)
    .gt("expires_at", new Date().toISOString());

  if (inputHash) {
    query = query.eq("input_hash", inputHash);
  }

  const { data, error } = await query.order("generated_at", { ascending: false }).limit(1).maybeSingle();

  if (error) {
    if (isMissingDealAiAnalysesTableError(error)) {
      return null;
    }

    if (isMissingAnalysisTypeColumnError(error) && inputHash) {
      const { data: legacyData, error: legacyError } = await supabase
        .from("deal_ai_analyses")
        .select("id, analysis, provider, model, input_hash, generated_at, expires_at")
        .eq("org_id", orgId)
        .eq("hubspot_deal_id", hubspotDealId)
        .eq("provider", provider)
        .eq("model", model)
        .eq("input_hash", inputHash)
        .gt("expires_at", new Date().toISOString())
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (legacyError) {
        if (isMissingDealAiAnalysesTableError(legacyError)) {
          return null;
        }

        throw new Error(`Impossible de charger le cache d'analyse IA: ${legacyError.message}`);
      }

      return legacyData as DealAiAnalysisCacheRow<TAnalysis> | null;
    }

    throw new Error(`Impossible de charger le cache d'analyse IA: ${error.message}`);
  }

  return data as DealAiAnalysisCacheRow<TAnalysis> | null;
};

export const loadReusableCachedAnalysis = async <TAnalysis>(
  analysisType: DealAiAnalysisType,
  orgId: string,
  hubspotDealId: string,
  provider: string,
  model: string,
  inputHash: string,
): Promise<DealAiAnalysisCacheRow<TAnalysis> | null> => {
  const exactCachedAnalysis = await loadCachedAnalysis<TAnalysis>(
    analysisType,
    orgId,
    hubspotDealId,
    provider,
    model,
    inputHash,
  );

  if (exactCachedAnalysis) {
    return exactCachedAnalysis;
  }

  return loadCachedAnalysis<TAnalysis>(
    analysisType,
    orgId,
    hubspotDealId,
    provider,
    model,
  );
};

export const persistAnalysis = async <TAnalysis>({
  analysisType,
  orgId,
  hubspotDealId,
  provider,
  model,
  inputHash,
  analysis,
  closeWonProbability,
  expiresAt,
}: {
  analysisType: DealAiAnalysisType;
  orgId: string;
  hubspotDealId: string;
  provider: string;
  model: string;
  inputHash: string;
  analysis: TAnalysis;
  closeWonProbability: number;
  expiresAt: string;
}): Promise<DealAiAnalysisCacheRow<TAnalysis> | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("deal_ai_analyses")
    .upsert(
      {
        org_id: orgId,
        hubspot_deal_id: hubspotDealId,
        provider,
        model,
        analysis_type: analysisType,
        input_hash: inputHash,
        analysis,
        close_won_probability: closeWonProbability,
        generated_at: new Date().toISOString(),
        expires_at: expiresAt,
      },
      {
        onConflict: "org_id,hubspot_deal_id,provider,model,input_hash",
      },
    )
    .select("id, analysis, analysis_type, provider, model, input_hash, generated_at, expires_at")
    .single();

  if (error) {
    if (isMissingDealAiAnalysesTableError(error)) {
      return null;
    }

    if (isMissingAnalysisTypeColumnError(error)) {
      const { data: legacyData, error: legacyError } = await supabase
        .from("deal_ai_analyses")
        .upsert(
          {
            org_id: orgId,
            hubspot_deal_id: hubspotDealId,
            provider,
            model,
            input_hash: inputHash,
            analysis,
            close_won_probability: closeWonProbability,
            generated_at: new Date().toISOString(),
            expires_at: expiresAt,
          },
          {
            onConflict: "org_id,hubspot_deal_id,provider,model,input_hash",
          },
        )
        .select("id, analysis, provider, model, input_hash, generated_at, expires_at")
        .single();

      if (legacyError) {
        if (isMissingDealAiAnalysesTableError(legacyError)) {
          return null;
        }

        throw new Error(`Impossible de sauvegarder l'analyse IA du deal: ${legacyError.message}`);
      }

      return legacyData as DealAiAnalysisCacheRow<TAnalysis>;
    }

    throw new Error(`Impossible de sauvegarder l'analyse IA du deal: ${error.message}`);
  }

  return data as DealAiAnalysisCacheRow<TAnalysis>;
};
