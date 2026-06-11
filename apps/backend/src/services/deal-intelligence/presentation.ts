import type { HubSpotDealHistoryItem } from "../hubspot.service.js";
import type { DealIntelligenceAnalysis } from "../llm/llm.provider.js";
import {
  loadHubSpotCompanySnapshot,
  loadHubSpotContactSnapshot,
  loadHubSpotDealSnapshot,
  loadOwnerUserName,
} from "./data-access.js";
import {
  addDays,
  asRecord,
  clampInteger,
  compactText,
  firstDefined,
  firstNonEmptyString,
  getDaysSince,
  normalizeTimestamp,
  parseNumber,
  parseProbability,
  readNestedRecord,
  readNestedString,
  readString,
  stripMarkup,
} from "./shared.js";
import type {
  ActionSnapshotRow,
  DealAnalysisAction,
  DealAnalysisHealthDimension,
  DealAnalysisMetric,
  DealAnalysisSnapshot,
  DealAnalysisTrendPoint,
  DealChannelEngagement,
  DealIntelligenceContext,
  DealRecentActivity,
  ResolvedDealTarget,
} from "./types.js";

export const resolveForecastLabel = (probability: number, health: DealIntelligenceAnalysis["dealHealth"]): DealAnalysisSnapshot["forecastLabel"] => {
  if (health === "blocked" || health === "at_risk" || probability < 15) {
    return "at_risk";
  }

  if (probability >= 70) {
    return "commit";
  }

  if (probability >= 30) {
    return "best_case";
  }

  return "pipeline";
};

export const getLevelLabel = (level: DealAnalysisHealthDimension["level"]): string => {
  if (level === "high") {
    return "Eleve";
  }

  if (level === "medium") {
    return "Moyen";
  }

  return "Faible";
};

export const buildHealthDimensions = (
  analysis: DealIntelligenceAnalysis,
  lastContactAt: string | null,
): DealAnalysisHealthDimension[] => {
  const risksText = analysis.risks.join(" ").toLowerCase();
  const daysSinceContact = getDaysSince(lastContactAt);
  const intentScore = clampInteger(
    analysis.closeWonProbability + analysis.positiveSignals.length * 7 - analysis.missingData.length * 4,
    0,
    100,
  );
  const momentumScore = clampInteger(
    (daysSinceContact <= 7 ? 72 : daysSinceContact <= 21 ? 48 : 28) + analysis.nextSteps.length * 5,
    0,
    100,
  );
  const competitionScore = clampInteger(
    (risksText.includes("concurr") || risksText.includes("prix") || risksText.includes("budget") ? 62 : 32) +
      analysis.risks.length * 6,
    0,
    100,
  );

  const intentLevel: DealAnalysisHealthDimension["level"] =
    intentScore >= 66 ? "high" : intentScore >= 36 ? "medium" : "low";
  const momentumLevel: DealAnalysisHealthDimension["level"] =
    momentumScore >= 66 ? "high" : momentumScore >= 36 ? "medium" : "low";
  const competitionLevel: DealAnalysisHealthDimension["level"] =
    competitionScore >= 66 ? "high" : competitionScore >= 36 ? "medium" : "low";

  const dimensions: DealAnalysisHealthDimension[] = [
    {
      id: "intent",
      label: "Intent",
      level: intentLevel,
      score: intentScore,
      tone: intentLevel === "high" ? "green" : intentLevel === "medium" ? "amber" : "red",
      rationale: analysis.positiveSignals[0] ?? "Base sur l'engagement et la probabilite IA.",
    },
    {
      id: "momentum",
      label: "Momentum",
      level: momentumLevel,
      score: momentumScore,
      tone: momentumLevel === "high" ? "green" : momentumLevel === "medium" ? "amber" : "red",
      rationale:
        daysSinceContact <= 7
          ? "Activite recente dans le CRM."
          : daysSinceContact <= 21
            ? "Progression moderee."
            : "Peu de signaux recents.",
    },
    {
      id: "competition",
      label: "Pression concurrentielle",
      level: competitionLevel,
      score: competitionScore,
      tone: competitionLevel === "high" ? "red" : competitionLevel === "medium" ? "amber" : "green",
      rationale:
        analysis.risks.find((risk) => /concurr|prix|budget/i.test(risk)) ??
        "Aucun signal concurrentiel explicite dans l'analyse.",
    },
  ];

  return dimensions.map((dimension) => ({
    ...dimension,
    rationale: dimension.rationale || getLevelLabel(dimension.level),
  }));
};

export const buildProbabilityTrend = (
  analysis: DealIntelligenceAnalysis,
  lastContactAt: string | null,
): DealAnalysisTrendPoint[] => {
  const finalProbability = analysis.closeWonProbability;
  const positiveLift = analysis.positiveSignals.length * 2;
  const riskDrag = analysis.risks.length * 2;
  const startProbability = clampInteger(finalProbability - 18 - positiveLift + riskDrag, 5, finalProbability);
  const offsets = [-28, -21, -14, -7, -3, 0];
  const anchorDate = lastContactAt ? new Date(lastContactAt) : new Date();

  if (Number.isNaN(anchorDate.getTime())) {
    anchorDate.setTime(Date.now());
  }

  return offsets.map((offset, index) => {
    const progress = offsets.length === 1 ? 1 : index / (offsets.length - 1);
    const jitter = index % 2 === 0 ? -1 : 1;
    const probability =
      index === offsets.length - 1
        ? finalProbability
        : clampInteger(startProbability + (finalProbability - startProbability) * progress + jitter, 0, 100);
    const date = addDays(anchorDate, offset);

    return {
      date,
      label: new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(new Date(date)),
      probability,
    };
  });
};

export const buildPrimaryActions = (
  analysis: DealIntelligenceAnalysis,
  pendingActions: ActionSnapshotRow[],
): DealAnalysisAction[] => {
  const today = new Date();
  const crmActions = pendingActions.map<DealAnalysisAction>((action) => ({
    title: action.title,
    rationale: action.description ?? "Action deja presente dans Jarvis.",
    dueAt: normalizeTimestamp(action.due_at) ?? addDays(today, 1),
    priority: "medium",
    source: action.ai_generated ? "ai" : "crm",
  }));
  const aiActions = analysis.nextSteps.map<DealAnalysisAction>((step) => ({
    title: step.title,
    rationale: step.rationale,
    dueAt: addDays(today, step.dueInDays),
    priority: step.priority,
    source: "ai",
  }));
  const seen = new Set<string>();

  return [...crmActions, ...aiActions].filter((action) => {
    const key = action.title.trim().toLowerCase();

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  }).slice(0, 4);
};

export const activityChannelLabels: Record<DealChannelEngagement["channel"], string> = {
  call: "Appels",
  communication: "Messages",
  email: "Emails",
  meeting: "Reunions",
  note: "Notes",
  sms: "SMS",
  task: "Taches",
};

export const toActivityChannel = (type: HubSpotDealHistoryItem["type"]): DealRecentActivity["channel"] =>
  type === "call" ||
  type === "email" ||
  type === "meeting" ||
  type === "note" ||
  type === "sms" ||
  type === "communication" ||
  type === "task"
    ? type
    : "deal";

export const buildRecentActivities = (
  timeline: HubSpotDealHistoryItem[],
  ownerName: string | null,
): DealRecentActivity[] =>
  [...timeline]
    .sort((left, right) => {
      const leftValue = left.timestamp ? new Date(left.timestamp).getTime() : 0;
      const rightValue = right.timestamp ? new Date(right.timestamp).getTime() : 0;

      return rightValue - leftValue;
    })
    .filter((item) => item.type !== "deal" || timeline.length <= 1)
    .slice(0, 80)
    .map((item) => ({
      id: item.id,
      type: item.type,
      occurredAt: normalizeTimestamp(item.timestamp),
      title: item.title,
      body: stripMarkup(item.body),
      actorName: ownerName ?? (item.metadata.ownerId ? `Owner ${item.metadata.ownerId}` : null),
      channel: toActivityChannel(item.type),
    }));

export const buildChannelEngagement = (timeline: HubSpotDealHistoryItem[]): DealChannelEngagement[] => {
  const channels: DealChannelEngagement["channel"][] = [
    "email",
    "call",
    "meeting",
    "note",
    "task",
    "sms",
    "communication",
  ];

  return channels.map((channel) => {
    const items = timeline.filter((item) => item.type === channel);

    return {
      channel,
      label: activityChannelLabels[channel],
      count: items.length,
      responseRate: null,
      caption: items.length > 0 ? `${items.length} evenement${items.length > 1 ? "s" : ""} HubSpot` : "Aucun signal HubSpot",
    };
  });
};

export const summarizeRecentActivities = (items: DealRecentActivity[]): string =>
  items
    .map((item) =>
      [
        item.occurredAt ?? "date inconnue",
        `[${item.channel}]`,
        item.title,
        item.actorName ? `owner: ${item.actorName}` : null,
        item.body ? compactText(item.body, 220) : null,
      ]
        .filter(Boolean)
        .join(" | "),
    )
    .join("\n");

export const summarizePendingActions = (actions: ActionSnapshotRow[]): string =>
  actions.length > 0
    ? actions
        .map((action) =>
          [
            action.title,
            action.description,
            action.due_at ? `due: ${normalizeTimestamp(action.due_at) ?? action.due_at}` : null,
            `status: ${action.status}`,
            action.ai_generated ? "source: ia" : "source: crm/local",
          ]
            .filter(Boolean)
            .join(" | "),
        )
        .join("\n")
    : "Aucune action locale ouverte.";

export const summarizeChannelEngagement = (items: DealChannelEngagement[]): string =>
  items.map((item) => `${item.label}: ${item.count}`).join(" | ");

export const buildDealAnalysisSnapshot = async (
  target: ResolvedDealTarget,
  context: DealIntelligenceContext,
  analysis: DealIntelligenceAnalysis,
): Promise<DealAnalysisSnapshot> => {
  const rawData = asRecord(target.prospect?.raw_data);
  const rawDeal = readNestedRecord(rawData, "deal");
  const rawDealProperties = readNestedRecord(rawDeal, "properties");
  const rawContact = readNestedRecord(rawData, "contact");
  const rawContactProperties = readNestedRecord(rawContact, "properties");
  const rawCompany = readNestedRecord(rawData, "company");
  const rawCompanyProperties = readNestedRecord(rawCompany, "properties");
  const hubspotDeal = await loadHubSpotDealSnapshot(target.orgId, target.hubspotDealId);
  const hubspotContactId = target.prospect?.hubspot_contact_id ?? target.hubspotContactId;
  const hubspotContact = await loadHubSpotContactSnapshot(
    target.orgId,
    hubspotDeal?.primary_contact_id ?? hubspotContactId,
  );
  const hubspotCompany = await loadHubSpotCompanySnapshot(target.orgId, hubspotDeal?.primary_company_id ?? null);
  const ownerNameFromUser = await loadOwnerUserName(target.prospect?.owner_user_id ?? null);
  const amount = firstDefined(
    parseNumber(hubspotDeal?.amount),
    target.prospect?.deal_amount ?? null,
    context.dealAmount ?? null,
    parseNumber(readNestedString(rawData, ["deal", "properties", "amount"])),
  ) ?? 0;
  const closeProbability =
    firstDefined(
      parseProbability(hubspotDeal?.close_probability),
      target.prospect?.close_probability ?? null,
      context.currentCloseProbability ?? null,
      parseProbability(readNestedString(rawData, ["deal", "properties", "hs_deal_stage_probability"])),
    ) ?? analysis.closeWonProbability;
  const stage = firstNonEmptyString(
    hubspotDeal?.deal_stage_label ?? null,
    readString(rawData, "dealStageLabel"),
    hubspotDeal?.deal_stage,
    target.prospect?.deal_stage,
    context.dealStage,
    readString(rawDealProperties, "dealstage"),
    "Stage HubSpot",
  ) ?? "Stage HubSpot";
  const stageEnteredAt = firstNonEmptyString(
    normalizeTimestamp(hubspotDeal?.hubspot_updated_at),
    normalizeTimestamp(target.prospect?.last_contact_at),
    normalizeTimestamp(target.prospect?.synced_at),
  );
  const contactName = firstNonEmptyString(context.contactName, hubspotContact?.name, target.prospect?.name, "Contact HubSpot") ??
    "Contact HubSpot";
  const companyName =
    firstNonEmptyString(
      context.companyName,
      hubspotCompany?.name,
      hubspotContact?.company_name,
      target.prospect?.company,
      readString(rawCompanyProperties, "name"),
      readString(rawContactProperties, "company"),
      "Entreprise HubSpot",
    ) ?? "Entreprise HubSpot";
  const contactEmail = firstNonEmptyString(context.contactEmail, hubspotContact?.email, target.prospect?.email, readString(rawContactProperties, "email"));
  const contactPhone = firstNonEmptyString(context.contactPhone, hubspotContact?.phone, target.prospect?.phone, readString(rawContactProperties, "phone"));
  const closeDate = firstNonEmptyString(
    normalizeTimestamp(context.closeDate),
    normalizeTimestamp(hubspotDeal?.closed_at),
    normalizeTimestamp(readString(rawData, "closedAt")),
    normalizeTimestamp(readString(rawDealProperties, "closedate")),
  );
  const ownerHubSpotId = firstNonEmptyString(
    hubspotDeal?.hubspot_owner_id,
    readString(rawData, "hubspotOwnerId"),
    readString(rawData, "dealOwnerHubSpotId"),
    readString(rawData, "contactOwnerHubSpotId"),
    readString(rawDealProperties, "hubspot_owner_id"),
  );
  const weightedAmount = Math.round(amount * (analysis.closeWonProbability / 100));

  return {
    prospectId: target.prospect?.id ?? `${target.hubspotContactId ?? "hubspot"}:${target.hubspotDealId}`,
    orgId: target.orgId,
    hubspotDealId: target.hubspotDealId,
    hubspotContactId,
    dealName: firstNonEmptyString(hubspotDeal?.deal_name, readString(rawData, "dealName"), readString(rawDealProperties, "dealname")),
    companyName,
    contactName,
    contactTitle: firstNonEmptyString(context.contactTitle, hubspotContact?.title, target.prospect?.title, readString(rawContactProperties, "jobtitle")),
    contactEmail,
    contactPhone,
    ownerName: firstNonEmptyString(context.ownerName, ownerNameFromUser, ownerHubSpotId ? `Owner ${ownerHubSpotId}` : null),
    ownerHubSpotId,
    amount,
    weightedAmount,
    stage,
    closeProbability,
    forecastLabel: resolveForecastLabel(analysis.closeWonProbability, analysis.dealHealth),
    closeDate,
    stageEnteredAt,
    stageAgeDays: getDaysSince(stageEnteredAt),
    lastContactAt: firstNonEmptyString(normalizeTimestamp(target.prospect?.last_contact_at), normalizeTimestamp(context.lastContactAt)),
    syncedAt: firstNonEmptyString(normalizeTimestamp(hubspotDeal?.synced_at), normalizeTimestamp(target.prospect?.synced_at)),
  };
};

export const buildDealMetrics = (
  snapshot: DealAnalysisSnapshot,
  analysis: DealIntelligenceAnalysis,
  healthDimensions: DealAnalysisHealthDimension[],
): DealAnalysisMetric[] => {
  const engagementScore = clampInteger(
    snapshot.closeProbability * 0.35 +
      analysis.positiveSignals.length * 12 +
      analysis.evidence.length * 8 +
      healthDimensions.reduce((sum, dimension) => sum + dimension.score, 0) / 6,
    0,
    100,
  );

  return [
    {
      id: "dealValue",
      label: "Deal value",
      value: snapshot.amount,
      unit: "currency",
      caption: snapshot.stage,
    },
    {
      id: "weightedValue",
      label: "Weighted value",
      value: snapshot.weightedAmount,
      unit: "currency",
      caption: `${analysis.closeWonProbability} % de probabilite`,
    },
    {
      id: "stageAge",
      label: "Stage age",
      value: snapshot.stageAgeDays,
      unit: "days",
      caption: snapshot.stageEnteredAt ? `Depuis ${snapshot.stageEnteredAt}` : "Date CRM indisponible",
    },
    {
      id: "engagementScore",
      label: "Engagement score",
      value: engagementScore,
      unit: "score",
      caption: engagementScore >= 70 ? "Eleve" : engagementScore >= 40 ? "Moyen" : "Faible",
    },
  ];
};

export const buildCrmFacts = (
  snapshot: DealAnalysisSnapshot,
  analysis: DealIntelligenceAnalysis,
): string[] => {
  const facts = [
    snapshot.dealName ? `Deal HubSpot: ${snapshot.dealName}` : null,
    snapshot.ownerName ? `Proprietaire: ${snapshot.ownerName}` : null,
    snapshot.closeDate ? `Date de cloture prevue: ${snapshot.closeDate}` : null,
    snapshot.lastContactAt ? `Dernier contact: ${snapshot.lastContactAt}` : null,
    ...analysis.evidence,
  ];
  const seen = new Set<string>();

  return facts
    .filter((fact): fact is string => Boolean(fact))
    .filter((fact) => {
      const key = fact.trim().toLowerCase();

      if (!key || seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .slice(0, 6);
};
