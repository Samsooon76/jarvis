import type {
  DistributedPlaybookPlay,
  JsonObject,
  PlaybookDistribution,
  PlaybookPlayCategory,
} from "@jarvis/shared";
import { getSupabaseAdmin } from "../../db/client.js";
import { loadActivePlays, loadEvidence, loadPlaybook, loadPlaybooks } from "./data-access.js";
import { mapPlayRow } from "./shared.js";
import type { PlaybookPlayEvidenceRow, PlaybookPlayRow, PlaybookRow } from "./types.js";

export type PlaybookDistributionInput = {
  orgId: string;
  playbookId?: string | null;
  prospectId?: string | null;
  hubspotDealId?: string | null;
  stage?: string | null;
  dealText?: string | null;
  prospectText?: string | null;
  categories?: PlaybookPlayCategory[];
  limit?: number;
};

export type PlaybookDistributionAccessContext = {
  hubspotOwnerId: string | null;
  ownerUserId: string | null;
};

type ProspectContextRow = {
  id: string;
  org_id: string;
  owner_user_id: string | null;
  hubspot_deal_id: string | null;
  name: string | null;
  company: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  deal_stage: string | null;
  next_action: string | null;
  ai_summary: string | null;
  raw_data: JsonObject;
};

type DealContextRow = {
  hubspot_deal_id: string;
  hubspot_owner_id: string | null;
  deal_name: string | null;
  deal_stage: string | null;
  deal_stage_label: string | null;
  pipeline_label: string | null;
  properties: JsonObject;
};

type LoadedContext = {
  prospect: ProspectContextRow | null;
  deal: DealContextRow | null;
};

const MAX_LIMIT = 10;
const DEFAULT_LIMIT = 5;
const MIN_RELEVANCE_SCORE = 2;

const CATEGORY_STAGE_KEYWORDS: Record<PlaybookPlayCategory, string[]> = {
  qualification: ["qualif", "qualification", "qualified", "new", "lead", "opportunity", "prospect"],
  discovery: ["discovery", "decouverte", "diagnostic", "needs", "besoin"],
  demo: ["demo", "demonstration", "presentation", "evaluation", "trial", "pilot"],
  objection_handling: ["objection", "blocked", "risk", "risque", "concern", "legal", "security", "securite"],
  negotiation: ["negotiation", "negotiate", "pricing", "price", "budget", "procurement", "achat", "quote"],
  closing: ["closing", "close", "contract", "signature", "commit", "decision", "decisionmaker", "verbal"],
  follow_up: ["follow", "relance", "followup", "next", "task", "callback", "meeting", "rappel"],
};

const TOKEN_STOPWORDS = new Set([
  "avec",
  "dans",
  "deal",
  "des",
  "for",
  "les",
  "pour",
  "prospect",
  "the",
  "une",
]);

const asJsonObject = (value: unknown): JsonObject =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};

const cleanText = (value: string | null | undefined): string => value?.trim() ?? "";

const normalizeText = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const tokenize = (value: string): string[] =>
  Array.from(
    new Set(
      normalizeText(value)
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !TOKEN_STOPWORDS.has(token)),
    ),
  );

const getRawString = (object: JsonObject, key: string): string | null => {
  const value = object[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const loadProspectContext = async (orgId: string, prospectId: string | null): Promise<ProspectContextRow | null> => {
  if (!prospectId) {
    return null;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("prospects")
    .select(
      "id, org_id, owner_user_id, hubspot_deal_id, name, company, title, email, phone, deal_stage, next_action, ai_summary, raw_data",
    )
    .eq("org_id", orgId)
    .eq("id", prospectId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le prospect pour le playbook: ${error.message}`);
  }

  if (!data) {
    throw new Error("Prospect introuvable.");
  }

  const row = data as Record<string, unknown>;

  return {
    id: String(row.id),
    org_id: String(row.org_id),
    owner_user_id: typeof row.owner_user_id === "string" ? row.owner_user_id : null,
    hubspot_deal_id: typeof row.hubspot_deal_id === "string" ? row.hubspot_deal_id : null,
    name: typeof row.name === "string" ? row.name : null,
    company: typeof row.company === "string" ? row.company : null,
    title: typeof row.title === "string" ? row.title : null,
    email: typeof row.email === "string" ? row.email : null,
    phone: typeof row.phone === "string" ? row.phone : null,
    deal_stage: typeof row.deal_stage === "string" ? row.deal_stage : null,
    next_action: typeof row.next_action === "string" ? row.next_action : null,
    ai_summary: typeof row.ai_summary === "string" ? row.ai_summary : null,
    raw_data: asJsonObject(row.raw_data),
  };
};

const loadDealContext = async (orgId: string, hubspotDealId: string | null): Promise<DealContextRow | null> => {
  if (!hubspotDealId) {
    return null;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("hubspot_deals")
    .select("hubspot_deal_id, hubspot_owner_id, deal_name, deal_stage, deal_stage_label, pipeline_label, properties")
    .eq("org_id", orgId)
    .eq("hubspot_deal_id", hubspotDealId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le deal pour le playbook: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  const row = data as Record<string, unknown>;

  return {
    hubspot_deal_id: String(row.hubspot_deal_id),
    hubspot_owner_id: typeof row.hubspot_owner_id === "string" ? row.hubspot_owner_id : null,
    deal_name: typeof row.deal_name === "string" ? row.deal_name : null,
    deal_stage: typeof row.deal_stage === "string" ? row.deal_stage : null,
    deal_stage_label: typeof row.deal_stage_label === "string" ? row.deal_stage_label : null,
    pipeline_label: typeof row.pipeline_label === "string" ? row.pipeline_label : null,
    properties: asJsonObject(row.properties),
  };
};

const loadContext = async (input: PlaybookDistributionInput): Promise<LoadedContext> => {
  const prospect = await loadProspectContext(input.orgId, input.prospectId ?? null);
  const dealId = cleanText(input.hubspotDealId) || prospect?.hubspot_deal_id || null;
  const deal = await loadDealContext(input.orgId, dealId);

  return { prospect, deal };
};

const resolveActivePlaybook = async (orgId: string, playbookId: string | null): Promise<PlaybookRow> => {
  if (playbookId) {
    const playbook = await loadPlaybook(orgId, playbookId);

    if (playbook.status !== "active") {
      throw new Error("Playbook archive.");
    }

    return playbook;
  }

  const activePlaybook = (await loadPlaybooks(orgId)).find((playbook) => playbook.status === "active");

  if (!activePlaybook) {
    throw new Error("Aucun playbook actif disponible pour cette organisation.");
  }

  return activePlaybook;
};

const groupEvidenceByPlayId = (rows: PlaybookPlayEvidenceRow[]): Map<string, PlaybookPlayEvidenceRow[]> => {
  const byPlayId = new Map<string, PlaybookPlayEvidenceRow[]>();

  for (const row of rows) {
    const existing = byPlayId.get(row.play_id) ?? [];
    existing.push(row);
    byPlayId.set(row.play_id, existing);
  }

  return byPlayId;
};

const buildContextText = (input: PlaybookDistributionInput, context: LoadedContext): string =>
  [
    input.stage,
    input.dealText,
    input.prospectText,
    context.deal?.deal_name,
    context.deal?.deal_stage,
    context.deal?.deal_stage_label,
    context.deal?.pipeline_label,
    getRawString(context.deal?.properties ?? {}, "dealtype"),
    getRawString(context.deal?.properties ?? {}, "closed_lost_reason"),
    context.prospect?.name,
    context.prospect?.company,
    context.prospect?.title,
    context.prospect?.next_action,
    context.prospect?.ai_summary,
  ]
    .map((item) => cleanText(item))
    .filter(Boolean)
    .join(" ");

const inferStageCategories = (stageText: string): Set<PlaybookPlayCategory> => {
  const normalizedStage = normalizeText(stageText);
  const categories = new Set<PlaybookPlayCategory>();

  for (const [category, keywords] of Object.entries(CATEGORY_STAGE_KEYWORDS) as Array<[PlaybookPlayCategory, string[]]>) {
    if (keywords.some((keyword) => normalizedStage.includes(normalizeText(keyword)))) {
      categories.add(category);
    }
  }

  return categories;
};

const scorePlay = (
  play: PlaybookPlayRow,
  contextTokens: Set<string>,
  contextText: string,
  requestedCategories: Set<PlaybookPlayCategory>,
  stageCategories: Set<PlaybookPlayCategory>,
): { score: number; reasons: string[] } => {
  const reasons: string[] = [];
  let score = 0;

  if (requestedCategories.has(play.category)) {
    score += 8;
    reasons.push("categorie demandee");
  }

  if (stageCategories.has(play.category)) {
    score += 6;
    reasons.push("categorie coherente avec le stage");
  }

  const playTokens = tokenize(`${play.title} ${play.trigger_description} ${play.recommended_response}`);
  const overlap = playTokens.filter((token) => contextTokens.has(token));

  if (overlap.length > 0) {
    score += Math.min(overlap.length, 8);
    reasons.push(`mots cles: ${overlap.slice(0, 4).join(", ")}`);
  }

  const normalizedContext = normalizeText(contextText);
  const normalizedTrigger = normalizeText(play.trigger_description);
  const triggerWords = tokenize(play.trigger_description);
  const strongTriggerMatch = triggerWords.length > 0 && triggerWords.slice(0, 8).some((token) => normalizedContext.includes(token));

  if (strongTriggerMatch || (normalizedTrigger.length >= 12 && normalizedContext.includes(normalizedTrigger))) {
    score += 4;
    reasons.push("declencheur proche du contexte");
  }

  if (score === 0 && requestedCategories.size === 0 && stageCategories.size === 0) {
    score = 1;
    reasons.push("play actif");
  }

  return { score, reasons };
};

export const getPlaybookDistributionAccessContext = async (
  input: PlaybookDistributionInput,
): Promise<PlaybookDistributionAccessContext> => {
  const context = await loadContext(input);

  return {
    hubspotOwnerId:
      context.deal?.hubspot_owner_id ??
      getRawString(context.prospect?.raw_data ?? {}, "hubspotOwnerId") ??
      getRawString(context.prospect?.raw_data ?? {}, "hubspot_owner_id"),
    ownerUserId: context.prospect?.owner_user_id ?? null,
  };
};

export const getRelevantPlaybookPlays = async (input: PlaybookDistributionInput): Promise<PlaybookDistribution> => {
  const context = await loadContext(input);
  const activePlaybook = await resolveActivePlaybook(input.orgId, cleanText(input.playbookId) || null);
  const activePlays = await loadActivePlays(input.orgId, activePlaybook.id);
  const evidenceByPlayId = groupEvidenceByPlayId(await loadEvidence(input.orgId, activePlays.map((play) => play.id)));
  const contextText = buildContextText(input, context);
  const contextTokens = new Set(tokenize(contextText));
  const requestedCategories = new Set(input.categories ?? []);
  const stageText = [input.stage, context.deal?.deal_stage_label, context.deal?.deal_stage, context.prospect?.deal_stage]
    .map((item) => cleanText(item))
    .filter(Boolean)
    .join(" ");
  const stageCategories = inferStageCategories(stageText);
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const scoredPlays: DistributedPlaybookPlay[] = activePlays
    .map((play) => {
      const relevance = scorePlay(play, contextTokens, contextText, requestedCategories, stageCategories);

      return {
        ...mapPlayRow(play, evidenceByPlayId.get(play.id) ?? []),
        relevanceScore: relevance.score,
        matchReasons: relevance.reasons,
      };
    })
    .filter((play) => play.relevanceScore >= MIN_RELEVANCE_SCORE || (requestedCategories.size === 0 && stageCategories.size === 0))
    .sort((left, right) => right.relevanceScore - left.relevanceScore || left.position - right.position)
    .slice(0, limit);

  return {
    generatedAt: new Date().toISOString(),
    context: {
      orgId: input.orgId,
      playbookId: activePlaybook.id,
      prospectId: context.prospect?.id ?? (cleanText(input.prospectId) || null),
      hubspotDealId:
        context.deal?.hubspot_deal_id ?? (cleanText(input.hubspotDealId) || (context.prospect?.hubspot_deal_id ?? null)),
      dealStage: cleanText(input.stage) || context.deal?.deal_stage_label || context.deal?.deal_stage || context.prospect?.deal_stage || null,
      dealName: context.deal?.deal_name ?? null,
      prospectName: context.prospect?.name ?? null,
      company: context.prospect?.company ?? null,
      matchedText: contextText,
    },
    plays: scoredPlays,
  };
};
