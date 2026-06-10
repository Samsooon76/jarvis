import { createHash } from "node:crypto";
import { env } from "../config/env.js";
import { getSupabaseAdmin } from "../db/client.js";
import { getHubSpotAccessToken } from "./hubspot-auth.service.js";
import { formatHubSpotTimelineForPrompt } from "./hubspot-history-formatting.service.js";
import { hubSpotService, type HubSpotDealHistoryItem, type HubSpotTaskListItem } from "./hubspot.service.js";
import { buildBusinessDueAtFromDays } from "./business-days.js";
import { createLlmProvider } from "./llm/provider.factory.js";
import { resolveLlmProviderPreference } from "./llm/provider-preference.service.js";
import type { AnalyzeTaskInput, TaskAnalysis } from "./llm/llm.provider.js";
import { buildWinBenchmarkSummaryForPrompt } from "./win-analysis.service.js";

type AnalyzeTaskOptions = {
  orgId: string;
  hubspotTaskId: string;
  llmProvider?: string | null;
  llmModel?: string | null;
  refresh?: boolean;
  includeHistory?: boolean;
};

type ProspectRow = {
  id: string;
  org_id: string;
  owner_user_id: string | null;
  hubspot_contact_id: string;
  hubspot_deal_id: string | null;
  name: string;
  email: string | null;
  company: string | null;
  title: string | null;
  deal_stage: string | null;
  deal_amount: number | null;
  close_probability: number;
  last_contact_at: string | null;
  next_action: string | null;
  raw_data: unknown;
};

type ProspectRawData = {
  dealName?: string | null;
  dealStageLabel?: string | null;
};

type TaskAiAnalysisRow = {
  id: string;
  analysis: TaskAnalysis;
  provider: string;
  model: string;
  input_hash: string;
  generated_at: string;
  expires_at: string;
};

type TaskSnapshot = {
  task: HubSpotTaskListItem;
  prospectId: string | null;
  historyItemCount: number;
};

export type TaskAnalyzerResult = {
  orgId: string;
  hubspotTaskId: string;
  hubspotDealId: string | null;
  hubspotContactId: string | null;
  prospectId: string | null;
  cached: boolean;
  provider: string;
  model: string;
  generatedAt: string;
  expiresAt: string;
  analysis: TaskAnalysis;
  task: HubSpotTaskListItem;
};

export type TaskAnalyzerApplyResult = {
  orgId: string;
  hubspotTaskId: string;
  action: "completed" | "rescheduled" | "consolidated";
  completedTask: HubSpotTaskListItem | null;
  completedTaskIds: string[];
  createdTask: HubSpotTaskListItem | null;
  retainedTask: HubSpotTaskListItem | null;
  analysis: TaskAnalysis;
  message: string;
};

const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidUuid = (value: string): boolean => UUID_V4_LIKE_PATTERN.test(value.trim());

const hashInput = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const compactText = (value: string, maxLength: number): string => {
  const compacted = value.replace(/\s+/g, " ").trim();

  if (compacted.length <= maxLength) {
    return compacted;
  }

  return `${compacted.slice(0, maxLength - 1).trim()}…`;
};

const isOpenTask = (task: HubSpotTaskListItem): boolean => task.status !== "completed";

const hasIntersection = (left: string[], right: string[]): boolean => {
  const rightSet = new Set(right);

  return left.some((value) => rightSet.has(value));
};

const isSameHubSpotWorkItem = (left: HubSpotTaskListItem, right: HubSpotTaskListItem): boolean => {
  if (left.id === right.id) {
    return true;
  }

  if (hasIntersection(left.associatedDealIds, right.associatedDealIds)) {
    return true;
  }

  if (hasIntersection(left.associatedCompanyIds, right.associatedCompanyIds)) {
    return true;
  }

  return hasIntersection(left.associatedContactIds, right.associatedContactIds);
};

const getTodayStart = (baseDate = new Date()): Date => {
  const todayStart = new Date(baseDate.getTime());
  todayStart.setHours(0, 0, 0, 0);

  return todayStart;
};

const isTaskBeforeToday = (task: HubSpotTaskListItem, baseDate = new Date()): boolean => {
  if (!task.dueAt) {
    return false;
  }

  const dueAt = new Date(task.dueAt);

  if (Number.isNaN(dueAt.getTime())) {
    return false;
  }

  return dueAt.getTime() < getTodayStart(baseDate).getTime();
};

const isTaskTodayOrLater = (task: HubSpotTaskListItem, baseDate = new Date()): boolean => {
  if (!task.dueAt) {
    return false;
  }

  const dueAt = new Date(task.dueAt);

  return !Number.isNaN(dueAt.getTime()) && dueAt.getTime() >= getTodayStart(baseDate).getTime();
};

const getExpiresAt = (): string => {
  const expiresAt = new Date();
  expiresAt.setUTCHours(expiresAt.getUTCHours() + env.dealAiCacheTtlHours);

  return expiresAt.toISOString();
};

const buildHistoryText = (timeline: HubSpotDealHistoryItem[]): string =>
  formatHubSpotTimelineForPrompt(timeline).slice(-10_000);

const parseRawData = (value: unknown): ProspectRawData => {
  if (!value || typeof value !== "object") {
    return {};
  }

  return value as ProspectRawData;
};

const loadProspectForTask = async ({
  orgId,
  hubspotDealId,
  hubspotContactId,
}: {
  orgId: string;
  hubspotDealId: string | null;
  hubspotContactId: string | null;
}): Promise<ProspectRow | null> => {
  const supabase = getSupabaseAdmin();
  const selectColumns =
    "id, org_id, owner_user_id, hubspot_contact_id, hubspot_deal_id, name, email, company, title, deal_stage, deal_amount, close_probability, last_contact_at, next_action, raw_data";

  if (hubspotDealId) {
    const { data, error } = await supabase
      .from("prospects")
      .select(selectColumns)
      .eq("org_id", orgId)
      .eq("hubspot_deal_id", hubspotDealId)
      .maybeSingle();

    if (error) {
      throw new Error(`Impossible de charger le prospect lie au deal: ${error.message}`);
    }

    if (data) {
      return data as ProspectRow;
    }
  }

  if (!hubspotContactId) {
    return null;
  }

  const { data, error } = await supabase
    .from("prospects")
    .select(selectColumns)
    .eq("org_id", orgId)
    .eq("hubspot_contact_id", hubspotContactId)
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le prospect lie au contact: ${error.message}`);
  }

  return data as ProspectRow | null;
};

const normalizeOverdueRecommendation = (analysis: TaskAnalysis, input: AnalyzeTaskInput): TaskAnalysis => {
  if (!input.dueAt) {
    return analysis;
  }

  const dueTimestamp = new Date(input.dueAt).getTime();
  const todayTimestamp = new Date(input.today ?? new Date().toISOString()).getTime();

  if (Number.isNaN(dueTimestamp) || Number.isNaN(todayTimestamp) || dueTimestamp >= todayTimestamp) {
    return analysis;
  }

  if (analysis.recommendation === "keep_planned") {
    return {
      ...analysis,
      recommendation: "do_now",
      shouldReschedule: false,
      suggestedDueInDays: null,
      rationale: compactText(`${analysis.rationale} Tache deja en retard: a traiter maintenant ou requalifier.`, 220),
    };
  }

  return analysis;
};

const inferTaskAnalysisType = (task: HubSpotTaskListItem): TaskAnalysis["taskType"] => {
  const text = `${task.title} ${task.body ?? ""}`.toLowerCase();

  if (/\b(call|appel|appeler|telephone)\b/.test(text)) {
    return "cold_call";
  }

  if (/\b(email|mail|relance|relancer|rendez-vous|rdv|suivi)\b/.test(text)) {
    return "deal_follow_up";
  }

  return "unknown";
};

const buildDeterministicOverdueAnalysis = (task: HubSpotTaskListItem): TaskAnalysis => {
  const suggestedAction = compactText(task.title || "Traiter la tache en retard", 90);

  return {
    taskType: inferTaskAnalysisType(task),
    recommendation: "reschedule",
    priority: task.priority ?? "high",
    shouldReschedule: true,
    suggestedDueInDays: 0,
    suggestedAction,
    rationale:
      "Tache en retard: Jarvis la replanifie aujourd'hui et cloture l'ancienne tache pour eviter qu'elle reste bloquee dans la liste en retard.",
    outreachAngle: null,
    evidence: task.dueAt ? [`Echeance initiale: ${task.dueAt}`] : [],
    missingData: [],
    confidence: "high",
  };
};

const buildAlreadyCompletedAnalysis = (task: HubSpotTaskListItem): TaskAnalysis => ({
  taskType: "obsolete",
  recommendation: "skip",
  priority: task.priority ?? "low",
  shouldReschedule: false,
  suggestedDueInDays: null,
  suggestedAction: compactText(task.title || "Tache deja terminee", 90),
  rationale: "Tache deja terminee dans HubSpot: Jarvis ne relance pas d'analyse et considere le traitement comme deja applique.",
  outreachAngle: null,
  evidence: [],
  missingData: [],
  confidence: "high",
});

const buildDeterministicOverdueResult = async ({
  orgId,
  hubspotTaskId,
}: {
  orgId: string;
  hubspotTaskId: string;
}): Promise<TaskAnalyzerResult | null> => {
  if (!isValidUuid(orgId)) {
    throw new Error("orgId doit etre un UUID Jarvis valide.");
  }

  const accessToken = await getHubSpotAccessToken(orgId);
  const task = await hubSpotService.fetchTaskListItem(accessToken, hubspotTaskId);

  if (!isOpenTask(task)) {
    const generatedAt = new Date().toISOString();

    return {
      orgId,
      hubspotTaskId,
      hubspotDealId: task.associatedDealIds[0] ?? null,
      hubspotContactId: task.associatedContactIds[0] ?? null,
      prospectId: null,
      cached: false,
      provider: "jarvis-rules",
      model: "already-completed-v1",
      generatedAt,
      expiresAt: generatedAt,
      analysis: buildAlreadyCompletedAnalysis(task),
      task,
    };
  }

  if (!isTaskBeforeToday(task)) {
    return null;
  }

  const generatedAt = new Date().toISOString();

  return {
    orgId,
    hubspotTaskId,
    hubspotDealId: task.associatedDealIds[0] ?? null,
    hubspotContactId: task.associatedContactIds[0] ?? null,
    prospectId: null,
    cached: false,
    provider: "jarvis-rules",
    model: "overdue-reschedule-v1",
    generatedAt,
    expiresAt: generatedAt,
    analysis: buildDeterministicOverdueAnalysis(task),
    task,
  };
};

const buildRescheduledTitle = (analysis: TaskAnalysis, task: HubSpotTaskListItem): string => {
  const actionTitle = analysis.suggestedAction.trim();

  if (actionTitle) {
    return compactText(actionTitle, 90);
  }

  return compactText(task.title, 90);
};

const buildRescheduledBody = (analysis: TaskAnalysis, task: HubSpotTaskListItem): string =>
  [
    analysis.rationale,
    analysis.outreachAngle ? `Angle recommande: ${analysis.outreachAngle}` : null,
    task.body ? `Contexte ancienne tache: ${task.body}` : null,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n\n")
    .slice(0, 2_500);

const buildManualTaskBody = (analysis: TaskAnalysis, task: HubSpotTaskListItem): string =>
  [
    analysis.rationale,
    `Action recommandee: ${analysis.suggestedAction}`,
    analysis.outreachAngle ? `Angle recommande: ${analysis.outreachAngle}` : null,
    analysis.evidence.length > 0 ? `Faits observes:\n- ${analysis.evidence.join("\n- ")}` : null,
    analysis.missingData.length > 0 ? `Infos a clarifier:\n- ${analysis.missingData.join("\n- ")}` : null,
    task.body ? `Contexte ancienne tache: ${task.body}` : null,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n\n")
    .slice(0, 2_500);

const buildTaskAssociations = (task: HubSpotTaskListItem): Array<{
  objectType: "contact" | "company" | "deal";
  objectId: string;
}> => [
  ...task.associatedDealIds.map((objectId) => ({ objectType: "deal" as const, objectId })),
  ...task.associatedContactIds.map((objectId) => ({ objectType: "contact" as const, objectId })),
  ...task.associatedCompanyIds.map((objectId) => ({ objectType: "company" as const, objectId })),
];

const buildCompletedTaskSnapshot = (task: HubSpotTaskListItem): HubSpotTaskListItem => ({
  ...task,
  status: "completed",
});

const buildCreatedTaskSnapshot = ({
  sourceTask,
  taskId,
  title,
  body,
  dueAt,
  priority,
}: {
  sourceTask: HubSpotTaskListItem;
  taskId: string;
  title: string;
  body: string;
  dueAt: string;
  priority: TaskAnalysis["priority"];
}): HubSpotTaskListItem => ({
  ...sourceTask,
  id: taskId,
  title,
  body,
  status: "not_started",
  priority,
  dueAt,
  createdAt: new Date().toISOString(),
});

const loadOpenTasksForSameWorkItem = async (
  accessToken: string,
  sourceTask: HubSpotTaskListItem,
): Promise<HubSpotTaskListItem[]> => {
  if (!sourceTask.ownerHubSpotId) {
    return [sourceTask];
  }

  const ownerTasks = await hubSpotService.fetchTasksByOwner(accessToken, sourceTask.ownerHubSpotId, 500, false);
  const sameWorkItemTasks = ownerTasks.filter((task) => isOpenTask(task) && isSameHubSpotWorkItem(task, sourceTask));

  if (sameWorkItemTasks.some((task) => task.id === sourceTask.id)) {
    return sameWorkItemTasks;
  }

  return [sourceTask, ...sameWorkItemTasks];
};

const pickRetainedOpenTask = (tasks: HubSpotTaskListItem[], sourceTaskId: string): HubSpotTaskListItem | null =>
  tasks
    .filter((task) => task.id !== sourceTaskId && isTaskTodayOrLater(task))
    .sort((left, right) => {
      const leftDueAt = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const rightDueAt = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;

      return leftDueAt - rightDueAt;
    })[0] ?? null;

const completeOpenDuplicateTasks = async ({
  accessToken,
  keepTaskId,
  tasks,
}: {
  accessToken: string;
  keepTaskId: string | null;
  tasks: HubSpotTaskListItem[];
}): Promise<string[]> => {
  const taskIdsToComplete = Array.from(
    new Set(tasks.filter((task) => isOpenTask(task) && task.id !== keepTaskId).map((task) => task.id)),
  );

  for (const taskId of taskIdsToComplete) {
    await hubSpotService.markTaskCompleted(accessToken, taskId);
  }

  return taskIdsToComplete;
};

const applyTaskAnalysisResult = async (result: TaskAnalyzerResult): Promise<TaskAnalyzerApplyResult> => {
  const accessToken = await getHubSpotAccessToken(result.orgId);
  const analysis = result.analysis;

  if (analysis.recommendation === "skip" || analysis.taskType === "obsolete") {
    await hubSpotService.markTaskCompleted(accessToken, result.hubspotTaskId);

    return {
      orgId: result.orgId,
      hubspotTaskId: result.hubspotTaskId,
      action: "completed",
      completedTask: buildCompletedTaskSnapshot(result.task),
      completedTaskIds: [result.hubspotTaskId],
      createdTask: null,
      retainedTask: null,
      analysis,
      message: "Tache marquee comme terminee dans HubSpot.",
    };
  }

  {
    const dueInDays = analysis.suggestedDueInDays ?? (analysis.recommendation === "reschedule" || analysis.shouldReschedule ? 1 : 0);
    const dueAt = buildBusinessDueAtFromDays(dueInDays);
    const title = buildRescheduledTitle(analysis, result.task);
    const body = analysis.recommendation === "reschedule" || analysis.shouldReschedule
      ? buildRescheduledBody(analysis, result.task)
      : buildManualTaskBody(analysis, result.task);
    const actionSource = result.provider === "jarvis-rules" ? "regle Jarvis" : "recommandation IA";
    const sameWorkItemOpenTasks = await loadOpenTasksForSameWorkItem(accessToken, result.task);
    const retainedTask = pickRetainedOpenTask(sameWorkItemOpenTasks, result.hubspotTaskId);

    if (retainedTask) {
      const completedTaskIds = await completeOpenDuplicateTasks({
        accessToken,
        keepTaskId: retainedTask.id,
        tasks: sameWorkItemOpenTasks,
      });

      return {
        orgId: result.orgId,
        hubspotTaskId: result.hubspotTaskId,
        action: "consolidated",
        completedTask: completedTaskIds.includes(result.hubspotTaskId) ? buildCompletedTaskSnapshot(result.task) : null,
        completedTaskIds,
        createdTask: null,
        retainedTask,
        analysis,
        message: `Taches doublons cloturees; une tache deja planifiee est conservee pour ${retainedTask.dueAt ?? "aujourd'hui"}.`,
      };
    }

    const created = await hubSpotService.createTask(accessToken, {
      title,
      body,
      dueAt,
      priority: analysis.priority,
      ownerHubSpotId: result.task.ownerHubSpotId,
      associations: buildTaskAssociations(result.task),
    });
    const completedTaskIds = await completeOpenDuplicateTasks({
      accessToken,
      keepTaskId: created.taskId,
      tasks: sameWorkItemOpenTasks,
    });

    return {
      orgId: result.orgId,
      hubspotTaskId: result.hubspotTaskId,
      action: "rescheduled",
      completedTask: buildCompletedTaskSnapshot(result.task),
      completedTaskIds,
      createdTask: buildCreatedTaskSnapshot({
        sourceTask: result.task,
        taskId: created.taskId,
        title,
        body,
        dueAt,
        priority: analysis.priority,
      }),
      retainedTask: null,
      analysis,
      message: dueInDays === 0
        ? `Doublons termines et nouvelle tache unique planifiee aujourd'hui avec la ${actionSource}.`
        : `Doublons termines et nouvelle tache unique planifiee a J+${dueInDays}.`,
    };
  }
};

export const analyzeHubSpotTask = async ({
  orgId,
  hubspotTaskId,
  llmProvider,
  llmModel,
  refresh = false,
  includeHistory = false,
}: AnalyzeTaskOptions): Promise<TaskAnalyzerResult> => {
  if (!isValidUuid(orgId)) {
    throw new Error("orgId doit etre un UUID Jarvis valide.");
  }

  const accessToken = await getHubSpotAccessToken(orgId);
  const task = await hubSpotService.fetchTaskListItem(accessToken, hubspotTaskId);
  const hubspotDealId = task.associatedDealIds[0] ?? null;
  const hubspotContactId = task.associatedContactIds[0] ?? null;
  const prospect = await loadProspectForTask({ orgId, hubspotDealId, hubspotContactId });
  const rawData = parseRawData(prospect?.raw_data);
  const dealHistory = includeHistory && hubspotDealId ? await hubSpotService.fetchDealHistory(accessToken, hubspotDealId) : null;
  const history = dealHistory ? buildHistoryText(dealHistory.timeline) : null;
  const preference = await resolveLlmProviderPreference(orgId, llmProvider, llmModel);
  const provider = createLlmProvider({
    provider: preference.provider,
    model: preference.model,
  });
  const today = new Date().toISOString().slice(0, 10);

  const input: AnalyzeTaskInput = {
    taskTitle: task.title,
    taskBody: task.body,
    taskStatus: task.status,
    taskPriority: task.priority,
    taskType: task.taskType,
    dueAt: task.dueAt,
    createdAt: task.createdAt,
    today,
    contactName: task.contactName ?? prospect?.name ?? null,
    contactEmail: task.contactEmail ?? prospect?.email ?? null,
    companyName: task.companyName ?? prospect?.company ?? dealHistory?.companyName ?? null,
    dealName: task.dealName ?? rawData.dealName ?? dealHistory?.dealName ?? null,
    dealStage: rawData.dealStageLabel ?? prospect?.deal_stage ?? null,
    dealAmount: prospect?.deal_amount ?? null,
    closeProbability: prospect?.close_probability ?? null,
    lastContactAt: prospect?.last_contact_at ?? null,
    nextAction: prospect?.next_action ?? null,
    history,
    // Boucle Win Analysis: benchmark wins dans le prompt; le hash d'input change
    // quand le benchmark evolue -> invalidation de cache naturelle.
    winBenchmarkSummary: hubspotDealId ? await buildWinBenchmarkSummaryForPrompt(orgId) : null,
  };
  const inputHash = hashInput(input);
  const supabase = getSupabaseAdmin();

  if (!refresh) {
    const { data, error } = await supabase
      .from("task_ai_analyses")
      .select("id, analysis, provider, model, input_hash, generated_at, expires_at")
      .eq("org_id", orgId)
      .eq("hubspot_task_id", hubspotTaskId)
      .eq("provider", provider.providerName)
      .eq("model", provider.modelName)
      .eq("input_hash", inputHash)
      .gt("expires_at", new Date().toISOString())
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Impossible de charger le cache d'analyse de tache: ${error.message}`);
    }

    const cached = data as TaskAiAnalysisRow | null;

    if (cached) {
      return {
        orgId,
        hubspotTaskId,
        hubspotDealId,
        hubspotContactId,
        prospectId: prospect?.id ?? null,
        cached: true,
        provider: cached.provider,
        model: cached.model,
        generatedAt: cached.generated_at,
        expiresAt: cached.expires_at,
        analysis: cached.analysis,
        task,
      };
    }
  }

  const analysis = normalizeOverdueRecommendation(await provider.analyzeTask(input), input);
  const generatedAt = new Date().toISOString();
  const expiresAt = getExpiresAt();
  const taskSnapshot: TaskSnapshot = {
    task,
    prospectId: prospect?.id ?? null,
    historyItemCount: dealHistory?.timeline.length ?? 0,
  };

  const { data, error } = await supabase
    .from("task_ai_analyses")
    .upsert(
      {
        org_id: orgId,
        hubspot_task_id: hubspotTaskId,
        hubspot_deal_id: hubspotDealId,
        hubspot_contact_id: hubspotContactId,
        prospect_id: prospect?.id ?? null,
        provider: provider.providerName,
        model: provider.modelName,
        input_hash: inputHash,
        task_snapshot: taskSnapshot,
        analysis,
        generated_at: generatedAt,
        expires_at: expiresAt,
      },
      {
        onConflict: "org_id,hubspot_task_id,provider,model,input_hash",
      },
    )
    .select("id, analysis, provider, model, input_hash, generated_at, expires_at")
    .single();

  if (error) {
    throw new Error(`Impossible de persister l'analyse de tache: ${error.message}`);
  }

  const saved = data as TaskAiAnalysisRow | null;

  return {
    orgId,
    hubspotTaskId,
    hubspotDealId,
    hubspotContactId,
    prospectId: prospect?.id ?? null,
    cached: false,
    provider: saved?.provider ?? provider.providerName,
    model: saved?.model ?? provider.modelName,
    generatedAt: saved?.generated_at ?? generatedAt,
    expiresAt: saved?.expires_at ?? expiresAt,
    analysis: saved?.analysis ?? analysis,
    task,
  };
};

export const applyHubSpotTaskAnalysis = async ({
  orgId,
  hubspotTaskId,
}: {
  orgId: string;
  hubspotTaskId: string;
}): Promise<TaskAnalyzerApplyResult> => {
  const deterministicResult = await buildDeterministicOverdueResult({ orgId, hubspotTaskId });
  const result = deterministicResult ?? await analyzeHubSpotTask({
    orgId,
    hubspotTaskId,
  });

  return applyTaskAnalysisResult(result);
};

export const analyzeAndApplyHubSpotTask = async (options: AnalyzeTaskOptions): Promise<TaskAnalyzerApplyResult> => {
  const deterministicResult = await buildDeterministicOverdueResult(options);
  const result = deterministicResult ?? await analyzeHubSpotTask(options);

  return applyTaskAnalysisResult(result);
};
