import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "../db/client.js";
import type { Json } from "../db/database.types.js";
import { formatHubSpotTimelineForPrompt } from "./hubspot-history-formatting.service.js";
import { hubSpotService } from "./hubspot.service.js";
import { getHubSpotAccessToken } from "./hubspot-auth.service.js";
import { buildBusinessDueAtFromDays } from "./business-days.js";
import { createLlmProvider } from "./llm/provider.factory.js";
import type { FollowUpTaskRecommendation } from "./llm/llm.provider.js";

const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTO_FOLLOW_UP_PROSPECT_LIMIT = 20;
const FOLLOW_UP_TASK_CACHE_TTL_HOURS = 6;

type ProspectRow = {
  id: string;
  org_id: string;
  owner_user_id: string | null;
  hubspot_contact_id: string;
  hubspot_deal_id: string | null;
  name: string;
  company: string | null;
  deal_stage: string | null;
  last_contact_at: string | null;
  next_action: string | null;
  next_action_at: string | null;
  raw_data: unknown;
};

type UserRow = {
  hubspot_owner_id: string | null;
};

type ActionInsertRow = {
  id: string;
};

type ProspectRawData = {
  hubspotOwnerId?: string | null;
  dealOwnerHubSpotId?: string | null;
  contactOwnerHubSpotId?: string | null;
};

type FollowUpTaskAnalysisRow = {
  recommendation: FollowUpTaskRecommendation;
  provider: string;
  model: string;
  input_hash: string;
  expires_at: string;
};

export type FollowUpTaskRequestContext = {
  orgId?: string | null;
  hubspotOwnerId?: string | null;
  hubspotContactId?: string | null;
  hubspotDealId?: string | null;
  contactName?: string | null;
  company?: string | null;
  dealName?: string | null;
  dealStage?: string | null;
  lastContactAt?: string | null;
  nextAction?: string | null;
};

type FollowUpTaskDebugStep = {
  step: string;
  status: "ok" | "skipped" | "error";
  detail: string;
};

export type FollowUpTaskDebugInfo = {
  llmProvider: string;
  prospectResolution: "local-id" | "hubspot-identifiers" | "live-context";
  resolvedProspectId: string | null;
  orgId: string | null;
  hubspotContactId: string | null;
  hubspotDealId: string | null;
  timelineItemCount: number;
  historyLength: number;
  createdHubspotTask: boolean;
  persistedLocalAction: boolean;
  steps: FollowUpTaskDebugStep[];
};

export type FollowUpTaskExecutionResult = {
  prospectId: string;
  created: boolean;
  recommendation: FollowUpTaskRecommendation;
  hubspotTaskId: string | null;
  localActionId: string | null;
  localActionPersisted: boolean;
  debug: FollowUpTaskDebugInfo;
};

export type AutoFollowUpSyncSummary = {
  analyzedCount: number;
  createdCount: number;
  skippedCount: number;
  failedCount: number;
};

export type FollowUpTaskPreviewResult = {
  prospectId: string;
  recommendation: FollowUpTaskRecommendation;
  debug: FollowUpTaskDebugInfo;
};

type ResolvedFollowUpTarget = {
  prospect: ProspectRow | null;
  orgId: string;
  hubspotContactId: string;
  hubspotDealId: string;
  company: string | null;
  dealName: string | null;
  dealStage: string | null;
  lastContactAt: string | null;
  nextAction: string | null;
  ownerHubSpotId: string | null;
};

type FollowUpAnalysisResult = {
  accessToken: string;
  recommendation: FollowUpTaskRecommendation;
  resolvedTarget: ResolvedFollowUpTarget;
  debug: FollowUpTaskDebugInfo;
};

const FOLLOW_UP_OVERDUE_KEYWORDS = [
  "follow up",
  "follow-up",
  "relance",
  "relancer",
  "suivi",
  "reviens",
  "reprendre contact",
  "proposal",
  "proposition",
  "propal",
  "devis",
  "pricing",
  "quote",
  "comparer les couts",
  "compare les couts",
  "comparison",
  "contrat",
];

const isUuid = (value: string): boolean => UUID_V4_LIKE_PATTERN.test(value.trim());

const parseCompositeProspectId = (prospectId: string): { hubspotContactId: string; hubspotDealId: string | null } | null => {
  const separatorIndex = prospectId.indexOf(":");

  if (separatorIndex <= 0) {
    return null;
  }

  const hubspotContactId = prospectId.slice(0, separatorIndex).trim();
  const rawDealId = prospectId.slice(separatorIndex + 1).trim();
  const hubspotDealId = rawDealId && rawDealId !== "contact" ? rawDealId : null;

  if (!hubspotContactId) {
    return null;
  }

  return {
    hubspotContactId,
    hubspotDealId,
  };
};

const getProspectOwnerHubSpotId = (rawData: unknown): string | null => {
  if (!rawData || typeof rawData !== "object") {
    return null;
  }

  const typedRawData = rawData as ProspectRawData;

  return typedRawData.hubspotOwnerId ?? typedRawData.dealOwnerHubSpotId ?? typedRawData.contactOwnerHubSpotId ?? null;
};

const resolvePreferredOwnerHubSpotId = ({
  contextOwnerHubSpotId,
  rawData,
}: {
  contextOwnerHubSpotId?: string | null;
  rawData: unknown;
}): string | null => {
  const trimmedContextOwnerHubSpotId = contextOwnerHubSpotId?.trim() || null;

  if (trimmedContextOwnerHubSpotId) {
    return trimmedContextOwnerHubSpotId;
  }

  return getProspectOwnerHubSpotId(rawData);
};

const createDebugInfo = (): FollowUpTaskDebugInfo => ({
  llmProvider: "pending",
  prospectResolution: "live-context",
  resolvedProspectId: null,
  orgId: null,
  hubspotContactId: null,
  hubspotDealId: null,
  timelineItemCount: 0,
  historyLength: 0,
  createdHubspotTask: false,
  persistedLocalAction: false,
  steps: [],
});

const addDebugStep = (
  debug: FollowUpTaskDebugInfo,
  step: string,
  status: FollowUpTaskDebugStep["status"],
  detail: string,
): void => {
  debug.steps.push({
    step,
    status,
    detail,
  });
};

const toErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const withStageError = (stage: string, error: unknown, debug: FollowUpTaskDebugInfo): never => {
  addDebugStep(debug, stage, "error", toErrorMessage(error));
  throw new Error(`Etape ${stage}: ${toErrorMessage(error)}`);
};

const getDaysSinceIsoDate = (value: string | null): number | null => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.max(0, Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24)));
};

const historyContainsOverdueSignal = (historyText: string): boolean => {
  const normalizedHistory = historyText.toLowerCase();

  return FOLLOW_UP_OVERDUE_KEYWORDS.some((keyword) => normalizedHistory.includes(keyword));
};

const normalizeFollowUpRecommendation = (
  recommendation: FollowUpTaskRecommendation,
  historyText: string,
  resolvedTarget: ResolvedFollowUpTarget,
): FollowUpTaskRecommendation => {
  if (!recommendation.shouldCreateTask) {
    return recommendation;
  }

  const daysSinceLastContact = getDaysSinceIsoDate(resolvedTarget.lastContactAt);
  const overdueSignal = historyContainsOverdueSignal(historyText);
  let normalizedDueInDays = recommendation.dueInDays;

  if (overdueSignal && daysSinceLastContact !== null && daysSinceLastContact >= 2) {
    normalizedDueInDays = 0;
  } else if (daysSinceLastContact !== null && daysSinceLastContact >= 5) {
    normalizedDueInDays = 0;
  } else if (daysSinceLastContact !== null && daysSinceLastContact >= 3) {
    normalizedDueInDays = Math.min(normalizedDueInDays, 1);
  }

  if (normalizedDueInDays === recommendation.dueInDays) {
    return recommendation;
  }

  const adjustmentReason =
    normalizedDueInDays === 0
      ? "Echeance recadree a aujourd'hui car la relance parait deja en retard."
      : "Echeance recadree a court terme car le dernier contact n'est plus recent.";

  return {
    ...recommendation,
    dueInDays: normalizedDueInDays,
    rationale: `${recommendation.rationale} ${adjustmentReason}`.trim(),
  };
};

const hasOpenTask = async (prospectId: string): Promise<boolean> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("actions")
    .select("id")
    .eq("prospect_id", prospectId)
    .eq("type", "task")
    .in("status", ["pending", "snoozed"])
    .limit(1);

  if (error) {
    throw new Error(`Impossible de verifier les actions existantes: ${error.message}`);
  }

  return (data?.length ?? 0) > 0;
};

const shouldSkipProspect = async (prospect: ProspectRow): Promise<boolean> => {
  if (!prospect.hubspot_deal_id) {
    return true;
  }

  if (prospect.next_action_at && new Date(prospect.next_action_at).getTime() > Date.now()) {
    return true;
  }

  return hasOpenTask(prospect.id);
};

const hashInput = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const loadCachedFollowUpRecommendation = async (params: {
  orgId: string;
  prospectId: string;
  hubspotDealId: string;
  provider: string;
  model: string;
  inputHash: string;
}): Promise<FollowUpTaskRecommendation | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("follow_up_task_ai_analyses")
    .select("recommendation, provider, model, input_hash, expires_at")
    .eq("org_id", params.orgId)
    .eq("prospect_id", params.prospectId)
    .eq("hubspot_deal_id", params.hubspotDealId)
    .eq("provider", params.provider)
    .eq("model", params.model)
    .eq("input_hash", params.inputHash)
    .gt("expires_at", new Date().toISOString())
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return null;
  }

  return ((data as FollowUpTaskAnalysisRow | null)?.recommendation ?? null);
};

const persistFollowUpRecommendation = async (params: {
  orgId: string;
  prospectId: string;
  hubspotDealId: string;
  provider: string;
  model: string;
  inputHash: string;
  recommendation: FollowUpTaskRecommendation;
}): Promise<void> => {
  const expiresAt = new Date();
  expiresAt.setUTCHours(expiresAt.getUTCHours() + FOLLOW_UP_TASK_CACHE_TTL_HOURS);

  const { error } = await getSupabaseAdmin().from("follow_up_task_ai_analyses").upsert(
    {
      org_id: params.orgId,
      prospect_id: params.prospectId,
      hubspot_deal_id: params.hubspotDealId,
      provider: params.provider,
      model: params.model,
      input_hash: params.inputHash,
      recommendation: params.recommendation as unknown as Json,
      generated_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
    },
    {
      onConflict: "org_id,prospect_id,hubspot_deal_id,provider,model,input_hash",
    },
  );

  if (error) {
    throw new Error(`Impossible de sauvegarder le cache de relance IA: ${error.message}`);
  }
};

const loadProspect = async (prospectId: string): Promise<ProspectRow | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("prospects")
    .select(
      "id, org_id, owner_user_id, hubspot_contact_id, hubspot_deal_id, name, company, deal_stage, last_contact_at, next_action, next_action_at, raw_data",
    )
    .eq("id", prospectId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le prospect: ${error.message}`);
  }

  return data as ProspectRow | null;
};

const loadProspectByHubSpotReference = async (
  orgId: string,
  hubspotContactId: string,
): Promise<ProspectRow | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("prospects")
    .select(
      "id, org_id, owner_user_id, hubspot_contact_id, hubspot_deal_id, name, company, deal_stage, last_contact_at, next_action, next_action_at, raw_data",
    )
    .eq("org_id", orgId)
    .eq("hubspot_contact_id", hubspotContactId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le prospect via les identifiants HubSpot: ${error.message}`);
  }

  return data as ProspectRow | null;
};

const resolveFollowUpTarget = async (
  prospectId: string,
  context: FollowUpTaskRequestContext,
  debug: FollowUpTaskDebugInfo,
): Promise<ResolvedFollowUpTarget> => {
  const compositeId = parseCompositeProspectId(prospectId);
  const hubspotContactId = context.hubspotContactId?.trim() || compositeId?.hubspotContactId || null;
  const hubspotDealId = context.hubspotDealId?.trim() || compositeId?.hubspotDealId || null;
  const orgId = context.orgId?.trim() || null;

  if (isUuid(prospectId)) {
    const localProspect = await loadProspect(prospectId);

    if (!localProspect) {
      throw new Error("Prospect introuvable.");
    }

    debug.prospectResolution = "local-id";
    debug.resolvedProspectId = localProspect.id;
    debug.orgId = localProspect.org_id;
    debug.hubspotContactId = localProspect.hubspot_contact_id;
    debug.hubspotDealId = localProspect.hubspot_deal_id;
    addDebugStep(debug, "resolve_prospect", "ok", `Prospect local resolu via UUID ${localProspect.id}.`);

    if (!localProspect.hubspot_deal_id) {
      throw new Error("Ce prospect n'a pas de deal HubSpot associe.");
    }

    return {
      prospect: localProspect,
      orgId: localProspect.org_id,
      hubspotContactId: localProspect.hubspot_contact_id,
      hubspotDealId: localProspect.hubspot_deal_id,
      company: localProspect.company,
      dealName: null,
      dealStage: localProspect.deal_stage,
      lastContactAt: localProspect.last_contact_at,
      nextAction: localProspect.next_action,
      ownerHubSpotId: resolvePreferredOwnerHubSpotId({
        contextOwnerHubSpotId: context.hubspotOwnerId,
        rawData: localProspect.raw_data,
      }),
    };
  }

  if (orgId && hubspotContactId) {
    const localProspect = await loadProspectByHubSpotReference(orgId, hubspotContactId);

    if (localProspect) {
      debug.prospectResolution = "hubspot-identifiers";
      debug.resolvedProspectId = localProspect.id;
      debug.orgId = localProspect.org_id;
      debug.hubspotContactId = localProspect.hubspot_contact_id;
      debug.hubspotDealId = localProspect.hubspot_deal_id ?? hubspotDealId;
      addDebugStep(
        debug,
        "resolve_prospect",
        "ok",
        `Prospect local ${localProspect.id} resolu via les identifiants HubSpot.`,
      );

      if (!localProspect.hubspot_deal_id && !hubspotDealId) {
        throw new Error("Ce prospect n'a pas de deal HubSpot associe.");
      }

      return {
        prospect: localProspect,
        orgId: localProspect.org_id,
        hubspotContactId: localProspect.hubspot_contact_id,
        hubspotDealId: localProspect.hubspot_deal_id ?? hubspotDealId ?? "",
        company: localProspect.company ?? context.company ?? null,
        dealName: context.dealName ?? null,
        dealStage: localProspect.deal_stage ?? context.dealStage ?? null,
        lastContactAt: localProspect.last_contact_at ?? context.lastContactAt ?? null,
        nextAction: localProspect.next_action ?? context.nextAction ?? null,
        ownerHubSpotId: resolvePreferredOwnerHubSpotId({
          contextOwnerHubSpotId: context.hubspotOwnerId,
          rawData: localProspect.raw_data,
        }),
      };
    }
  }

  if (!orgId) {
    throw new Error("orgId est obligatoire pour analyser un deal HubSpot non encore synchronise localement.");
  }

  if (!hubspotContactId) {
    throw new Error("hubspotContactId est obligatoire pour analyser un deal HubSpot non encore synchronise localement.");
  }

  if (!hubspotDealId) {
    throw new Error("hubspotDealId est obligatoire pour analyser un deal HubSpot non encore synchronise localement.");
  }

  debug.prospectResolution = "live-context";
  debug.resolvedProspectId = null;
  debug.orgId = orgId;
  debug.hubspotContactId = hubspotContactId;
  debug.hubspotDealId = hubspotDealId;
  addDebugStep(
    debug,
    "resolve_prospect",
    "ok",
    "Aucun prospect local trouve. Fallback sur le contexte live HubSpot.",
  );

  return {
    prospect: null,
    orgId,
    hubspotContactId,
    hubspotDealId,
    company: context.company ?? null,
    dealName: context.dealName ?? null,
    dealStage: context.dealStage ?? null,
    lastContactAt: context.lastContactAt ?? null,
    nextAction: context.nextAction ?? null,
    ownerHubSpotId: context.hubspotOwnerId ?? null,
  };
};

const analyzeFollowUpTaskForProspect = async (
  prospectId: string,
  objective: string,
  context: FollowUpTaskRequestContext,
): Promise<FollowUpAnalysisResult> => {
  const debug = createDebugInfo();

  const resolvedTarget = await resolveFollowUpTarget(prospectId, context, debug).catch((error: unknown) =>
    withStageError("resolve_prospect", error, debug),
  );

  const accessToken = await getHubSpotAccessToken(resolvedTarget.orgId).catch((error: unknown) =>
    withStageError("load_hubspot_token", error, debug),
  );
  addDebugStep(debug, "load_hubspot_token", "ok", `Token HubSpot charge pour l'organisation ${resolvedTarget.orgId}.`);

  const dealHistory = await hubSpotService
    .fetchDealHistory(accessToken, resolvedTarget.hubspotDealId)
    .catch((error: unknown) => withStageError("fetch_deal_history", error, debug));
  debug.timelineItemCount = dealHistory.timeline.length;
  addDebugStep(
    debug,
    "fetch_deal_history",
    "ok",
    `Historique HubSpot charge avec ${dealHistory.timeline.length} evenement(s).`,
  );

  const historyText = buildHistoryText(dealHistory.timeline);
  debug.historyLength = historyText.length;
  const provider = createLlmProvider();
  debug.llmProvider = `${provider.providerName}:${provider.modelName}`;
  const recommendationInput = {
    history: historyText,
    companyName: dealHistory.companyName ?? resolvedTarget.company,
    dealName: dealHistory.dealName ?? resolvedTarget.dealName,
    companyContext: dealHistory.companyContext,
    dealContext: dealHistory.dealContext,
    dealStage: resolvedTarget.dealStage,
    objective,
    today: new Date().toISOString().slice(0, 10),
    lastContactAt: resolvedTarget.lastContactAt,
    nextAction: resolvedTarget.nextAction,
    contactNames: dealHistory.contactNames,
  };
  const inputHash = hashInput(recommendationInput);
  const cachedRecommendation = await loadCachedFollowUpRecommendation({
    orgId: resolvedTarget.orgId,
    prospectId,
    hubspotDealId: resolvedTarget.hubspotDealId,
    provider: provider.providerName,
    model: provider.modelName,
    inputHash,
  });
  const recommendation = cachedRecommendation ?? await provider
    .recommendFollowUpTask(recommendationInput)
    .catch((error: unknown) => withStageError("llm_recommendation", error, debug));

  if (!cachedRecommendation) {
    await persistFollowUpRecommendation({
      orgId: resolvedTarget.orgId,
      prospectId,
      hubspotDealId: resolvedTarget.hubspotDealId,
      provider: provider.providerName,
      model: provider.modelName,
      inputHash,
      recommendation,
    }).catch((error: unknown) => withStageError("persist_llm_cache", error, debug));
  }
  const normalizedRecommendation = normalizeFollowUpRecommendation(recommendation, historyText, resolvedTarget);
  addDebugStep(
    debug,
    "llm_recommendation",
    "ok",
    `Recommandation LLM ${cachedRecommendation ? "reutilisee depuis le cache" : "recue"}. shouldCreateTask=${recommendation.shouldCreateTask ? "true" : "false"}. dueInDays=${recommendation.dueInDays}, normalise=${normalizedRecommendation.dueInDays}.`,
  );

  return {
    accessToken,
    recommendation: normalizedRecommendation,
    resolvedTarget,
    debug,
  };
};

export const runFollowUpTaskForProspect = async (
  prospectId: string,
  objective = "Detecter si une relance commerciale doit etre creee dans HubSpot",
  context: FollowUpTaskRequestContext = {},
): Promise<FollowUpTaskExecutionResult> => {
  const analysis = await analyzeFollowUpTaskForProspect(prospectId, objective, context);

  return finalizeFollowUpTaskForProspect({
    accessToken: analysis.accessToken,
    target: analysis.resolvedTarget,
    recommendation: analysis.recommendation,
    debug: analysis.debug,
  });
};

export const previewFollowUpTaskForProspect = async (
  prospectId: string,
  objective = "Detecter si une relance commerciale doit etre creee dans HubSpot",
  context: FollowUpTaskRequestContext = {},
): Promise<FollowUpTaskPreviewResult> => {
  const analysis = await analyzeFollowUpTaskForProspect(prospectId, objective, context);

  return {
    prospectId: analysis.resolvedTarget.prospect?.id ?? prospectId,
    recommendation: analysis.recommendation,
    debug: analysis.debug,
  };
};

const finalizeFollowUpTaskForProspect = async ({
  accessToken,
  target,
  recommendation,
  debug,
}: {
  accessToken: string;
  target: ResolvedFollowUpTarget;
  recommendation: FollowUpTaskRecommendation;
  debug: FollowUpTaskDebugInfo;
}): Promise<FollowUpTaskExecutionResult> => {
  const supabase = getSupabaseAdmin();
  const prospect = target.prospect;

  if (!recommendation.shouldCreateTask) {
    addDebugStep(debug, "create_hubspot_task", "skipped", "Le LLM a decide qu'aucune task HubSpot n'etait necessaire.");
    addDebugStep(debug, "persist_local_action", "skipped", "Aucune action locale a persister car aucune task n'a ete creee.");

    return {
      prospectId: prospect?.id ?? `${target.hubspotContactId}:${target.hubspotDealId}`,
      created: false,
      recommendation,
      hubspotTaskId: null,
      localActionId: null,
      localActionPersisted: false,
      debug,
    };
  }

  let ownerHubSpotId = target.ownerHubSpotId;

  if (!ownerHubSpotId && prospect?.owner_user_id) {
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("hubspot_owner_id")
      .eq("id", prospect.owner_user_id)
      .maybeSingle();
    const user = userData as UserRow | null;

    if (userError) {
      throw new Error(`Impossible de charger l'owner du prospect: ${userError.message}`);
    }

    ownerHubSpotId = user?.hubspot_owner_id ?? null;
  }

  const dueAt = buildBusinessDueAtFromDays(recommendation.dueInDays);

  const createdTask = await hubSpotService.createTask(accessToken, {
    title: recommendation.title,
    body: recommendation.description,
    dueAt,
    ownerHubSpotId,
    priority: recommendation.priority,
    associations: [
      {
        objectType: "deal",
        objectId: target.hubspotDealId,
      },
      {
        objectType: "contact",
        objectId: target.hubspotContactId,
      },
    ],
  });
  debug.createdHubspotTask = true;
  addDebugStep(debug, "create_hubspot_task", "ok", `Task HubSpot ${createdTask.taskId} creee.`);

  let localActionId: string | null = null;
  let localActionPersisted = false;

  if (!prospect) {
    addDebugStep(
      debug,
      "persist_local_action",
      "skipped",
      "Aucun prospect local associe. Action locale non persistee dans Jarvis.",
    );

    return {
      prospectId: `${target.hubspotContactId}:${target.hubspotDealId}`,
      created: true,
      recommendation,
      hubspotTaskId: createdTask.taskId,
      localActionId,
      localActionPersisted,
      debug,
    };
  }

  const { data: actionData, error: actionError } = await supabase
    .from("actions")
    .insert({
      org_id: prospect.org_id,
      user_id: prospect.owner_user_id,
      prospect_id: prospect.id,
      type: "task",
      title: recommendation.title,
      description: recommendation.description,
      due_at: dueAt,
      ai_generated: true,
      hubspot_synced: true,
    })
    .select("id")
    .single();
  const action = actionData as ActionInsertRow | null;

  if (actionError) {
    throw new Error(`La tache HubSpot a ete creee mais l'action locale n'a pas pu etre persistee: ${actionError.message}`);
  }

  localActionId = action?.id ?? null;
  localActionPersisted = true;
  debug.persistedLocalAction = true;
  addDebugStep(
    debug,
    "persist_local_action",
    "ok",
    `Action locale ${localActionId ?? "sans id"} persistee dans Jarvis.`,
  );

  const { error: updateProspectError } = await supabase
    .from("prospects")
    .update({
      next_action: recommendation.title,
      next_action_at: dueAt,
    })
    .eq("id", prospect.id);

  if (updateProspectError) {
    throw new Error(
      `La tache HubSpot a ete creee mais le prospect n'a pas pu etre mis a jour: ${updateProspectError.message}`,
    );
  }

  return {
    prospectId: prospect.id,
    created: true,
    recommendation,
    hubspotTaskId: createdTask.taskId,
    localActionId,
    localActionPersisted,
    debug,
  };
};

export const runAutomaticFollowUpTasksForOrg = async (
  orgId: string,
  logger?: { warn: (payload: Record<string, unknown>, message: string) => void },
): Promise<AutoFollowUpSyncSummary> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("prospects")
    .select(
      "id, org_id, owner_user_id, hubspot_contact_id, hubspot_deal_id, name, company, deal_stage, last_contact_at, next_action, next_action_at, raw_data",
    )
    .eq("org_id", orgId)
    .contains("raw_data", { source: "hubspot" })
    .not("hubspot_deal_id", "is", null)
    .order("ai_priority_score", { ascending: false })
    .limit(AUTO_FOLLOW_UP_PROSPECT_LIMIT);

  if (error) {
    throw new Error(`Impossible de charger les prospects pour les relances auto: ${error.message}`);
  }

  const prospects = (data ?? []) as ProspectRow[];
  const summary: AutoFollowUpSyncSummary = {
    analyzedCount: 0,
    createdCount: 0,
    skippedCount: 0,
    failedCount: 0,
  };

  for (const prospect of prospects) {
    if (await shouldSkipProspect(prospect)) {
      summary.skippedCount += 1;
      continue;
    }

    summary.analyzedCount += 1;

    try {
      const result = await runFollowUpTaskForProspect(prospect.id);

      if (result.created) {
        summary.createdCount += 1;
      } else {
        summary.skippedCount += 1;
      }
    } catch (error) {
      summary.failedCount += 1;
      logger?.warn(
        { error, orgId, prospectId: prospect.id },
        "Impossible de generer automatiquement une tache de relance pour ce prospect.",
      );
    }
  }

  return summary;
};
