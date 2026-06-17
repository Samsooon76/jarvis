import type { DealAnalysisType, DealAnalysisV1, DealLifecycleStatus } from "@jarvis/shared";
import type { AnalyzeDealAnalysisV1Input } from "./llm.provider.js";
import { parseDealAnalysisV1Body } from "./deal-analysis-v1.parse.js";

const lifecycleSchema = (lifecycleStatus: DealLifecycleStatus): string => {
  if (lifecycleStatus === "lost") {
    return `"lifecycle": {
    "kind": "lost",
    "primaryLossReason": string,
    "secondaryLossReason": string | null,
    "lossReasonCategory": "pricing" | "timing" | "competition" | "product_gap" | "budget" | "authority" | "no_decision" | "other",
    "whatHappened": string[],
    "reactivationScore": number | null,
    "reactivationRationale": string | null,
    "reactivationPlaybook": [{ "title": string, "timing": string, "rationale": string }]
  }`;
  }

  if (lifecycleStatus === "won") {
    return `"lifecycle": {
    "kind": "won",
    "primaryWinFactor": string,
    "winFactorCategory": "champion" | "timing" | "product_fit" | "pricing" | "process" | "relationship" | "other",
    "keyMoments": [{ "date": string | null, "moment": string, "stage": string | null, "impact": "positive" | "neutral" | "negative", "evidence": EvidenceRef[] }],
    "replicablePlays": [{ "play": string, "when": string }]
  }`;
  }

  return `"lifecycle": { "kind": "open" }`;
};

const DEAL_ANALYSIS_V1_SCHEMA = (lifecycleStatus: DealLifecycleStatus): string => `{
  "confidence": "low" | "medium" | "high",
  "company": {
    "name": string | null,
    "industry": string | null,
    "size": string | null,
    "country": string | null,
    "currentTools": string[],
    "crmUrl": string | null
  },
  "dealOverview": {
    "summary": string,
    "stage": string | null,
    "pipeline": string | null,
    "amount": number | null,
    "currency": "EUR",
    "expectedCloseDate": string | null,
    "closingProbability": number | null,
    "confidenceLevel": "low" | "medium" | "high",
    "dealHealth": "strong" | "medium" | "at_risk" | "blocked" | "unknown",
    "executiveSummary": string,
    "whyNow": string | null,
    "mainObjective": string | null,
    "businessImpact": string | null,
    "urgencyLevel": "low" | "medium" | "high",
    "strategicImportance": string | null
  },
  "stakeholders": [{
    "name": string,
    "role": string | null,
    "influenceLevel": "low" | "medium" | "high",
    "sentiment": "positive" | "neutral" | "negative" | "unknown",
    "buyerRole": "decision_maker" | "champion" | "blocker" | "influencer" | "user" | "economic_buyer" | "unknown",
    "mainConcerns": string[],
    "evidence": EvidenceRef[]
  }],
  "signals": [{
    "id": string,
    "kind": "pain" | "risk" | "objection" | "opportunity",
    "title": string,
    "severity": "low" | "medium" | "high",
    "status": "active" | "resolved" | "handled" | "monitoring" | "unclear",
    "objectionType": "price" | "product" | "timing" | "trust" | "competitor" | "technical" | "security" | "other" | null,
    "businessImpact": string | null,
    "responseGiven": string | null,
    "remainingConcern": string | null,
    "evidence": EvidenceRef[],
    "lastUpdated": string | null
  }],
  "qualification": {
    "meddicc": [{
      "id": "metrics" | "economicBuyer" | "decisionCriteria" | "decisionProcess" | "paperProcess" | "identifyPain" | "champion" | "competition",
      "label": string,
      "status": "confirmed" | "partial" | "assumed" | "unclear" | "missing",
      "score": number,
      "evidence": EvidenceRef[],
      "gap": string | null
    }],
    "decisionProcess": {
      "status": "clear" | "partial" | "unclear",
      "decisionMakers": string[],
      "champions": string[],
      "blockers": string[],
      "influencers": string[],
      "approvalSteps": string[],
      "legalProcurementRequired": boolean,
      "technicalValidationRequired": boolean,
      "legalStatus": "approved" | "in_review" | "blocked" | "unknown",
      "purchaseProcess": "clear" | "to_confirm" | "blocked" | "unknown",
      "timeline": string | null,
      "evidence": EvidenceRef[]
    },
    "budget": {
      "status": "confirmed" | "partial" | "assumed" | "unclear" | "missing",
      "amount": number | null,
      "currency": "EUR",
      "budgetOwner": string | null,
      "pricingSensitivity": "low" | "medium" | "high" | "unknown",
      "evidence": EvidenceRef[]
    },
    "competition": {
      "status": "none" | "suspected" | "confirmed" | "unknown",
      "competitors": string[],
      "currentSolution": string | null,
      "competitiveRisks": string[],
      "positioningAngle": string | null,
      "evidence": EvidenceRef[]
    },
    "productFit": {
      "fitScore": number | null,
      "strongFitReasons": string[],
      "weakFitReasons": string[],
      "missingFeatures": string[],
      "technicalConstraints": string[],
      "integrationRequirements": string[],
      "securityCompliance": string[],
      "evidence": EvidenceRef[]
    },
    "multiThreading": {
      "status": "single_threaded" | "partial" | "multi_threaded" | "unknown",
      "contactedRoles": string[],
      "missingRoles": string[],
      "evidence": EvidenceRef[]
    },
    "confidence": "low" | "medium" | "high"
  },
  "activitySignals": {
    "lastTouchAt": string | null,
    "daysSinceLastTouch": number | null,
    "touchpointCount30d": number | null,
    "callsCountByStage": Record<string, number>,
    "emailsCountByStage": Record<string, number>,
    "meetingsCountByStage": Record<string, number>,
    "benchmarkGaps": [{
      "stage": string,
      "metric": "calls" | "emails" | "meetings" | "touchpoints" | "days_in_stage",
      "actual": number,
      "benchmark": number,
      "severity": "low" | "medium" | "high"
    }],
    "engagementTrend": "increasing" | "stable" | "decreasing" | "unknown",
    "stageAgeDays": number | null
  },
  "forecast": {
    "forecastCategory": "commit" | "best_case" | "pipeline" | "at_risk" | "slipping" | "lost_risk",
    "probability": number | null,
    "mainPositiveSignals": string[],
    "mainNegativeSignals": string[],
    "dealMomentum": "increasing" | "stable" | "decreasing" | "unknown",
    "riskOfSlippage": "low" | "medium" | "high",
    "reasoningSummary": string,
    "confidence": "low" | "medium" | "high"
  },
  "actionPlan": {
    "nextSteps": [{
      "action": string,
      "owner": "sales_rep" | "prospect" | "customer_success" | "product" | "legal" | "other",
      "dueDate": string | null,
      "priority": "low" | "medium" | "high",
      "status": "pending" | "in_progress" | "completed" | "overdue",
      "createCrmTask": boolean,
      "evidence": EvidenceRef[]
    }],
    "mutualActionPlan": [{
      "title": string,
      "ownerName": string | null,
      "dueDate": string | null,
      "status": "pending" | "in_progress" | "completed" | "overdue",
      "priority": "low" | "medium" | "high",
      "rationale": string
    }],
    "upcomingDeadlines": [{
      "title": string,
      "date": string | null,
      "timeWindow": string | null,
      "ownerName": string | null,
      "description": string
    }],
    "salesStrategy": {
      "recommendedAction": string,
      "managerAdvice": string | null,
      "bestAngle": string | null,
      "whatToAvoid": string[],
      "suggestedMessage": string | null,
      "talkingPoints": string[]
    }
  },
  ${lifecycleSchema(lifecycleStatus)},
  "timeline": {
    "firstContactDate": string | null,
    "lastInteractionDate": string | null,
    "keyEvents": [{
      "date": string | null,
      "event": string,
      "impact": "positive" | "neutral" | "negative",
      "evidence": EvidenceRef[]
    }]
  },
  "dataQuality": {
    "missingInformation": string[],
    "uncertainAssumptions": string[],
    "fieldsRequiringHumanReview": string[]
  }
}

EvidenceRef = {
  "activityId": string | null,
  "activityType": "call" | "email" | "note" | "meeting" | "sms" | "communication" | "task" | "deal" | "crm_field" | "transcript",
  "occurredAt": string | null,
  "title": string | null,
  "quote": string,
  "confidence": "low" | "medium" | "high"
}`;

export type DealAnalysisV1Enrichment = {
  provider: string;
  model: string;
  inputHash: string;
  sourceSyncedAt: string | null;
  analysisType: DealAnalysisType;
  generatedAt: string;
};

export const buildDealAnalysisV1Enrichment = (
  input: AnalyzeDealAnalysisV1Input,
  provider: string,
  model: string,
  generatedAt = new Date().toISOString(),
): DealAnalysisV1Enrichment => ({
  provider,
  model,
  inputHash: input.inputHash ?? "",
  sourceSyncedAt: input.sourceSyncedAt ?? null,
  analysisType: input.analysisType ?? "deal_full",
  generatedAt,
});

export const buildDealAnalysisV1Instructions = (lifecycleStatus: DealLifecycleStatus): string => `Tu es Jarvis, un sales copilot B2B. Analyse ce deal HubSpot et reponds uniquement en JSON valide.

Ne renseigne PAS identifiers ni metadata: le backend les ajoute apres coup.
Produis les 11 blocs suivants dans cet ordre logique:
1. company + dealOverview
2. stakeholders
3. signals[]
4. qualification (MEDDICC complet sur les 8 criteres)
5. activitySignals
6. forecast
7. actionPlan
8. lifecycle (${lifecycleStatus})
9. timeline
10. dataQuality
+ confidence globale a la racine.

Schema JSON exact:
${DEAL_ANALYSIS_V1_SCHEMA(lifecycleStatus)}

Regles strictes:
- Utilise uniquement l'historique CRM, les resumes fournis et les activites source.
- Ne rien inventer: si une info manque, mets status "unclear"/"missing" et liste-la dans dataQuality.missingInformation.
- L'historique est trie du plus ancien au plus recent. Donne plus de poids aux evenements recents.
- Aujourd'hui est la date de reference absolue. Un evenement passe ne doit jamais devenir une prochaine echeance.
- Regroupe pains, risques, objections et opportunites dans signals[] (pas de sections paralleles).
- Chaque signal important doit avoir au moins une evidence avec quote factuelle.
- Si des activites source sont listees, reutilise leur activityId dans evidence quand pertinent.
- closingProbability et forecast.probability: entiers 0-100. Evite les extremes sans preuve explicite.
- Pour lifecycle.kind="${lifecycleStatus}", ne remplis que l'extension correspondante.
- activitySignals.benchmarkGaps: recopie uniquement les ecarts fournis dans le contexte benchmark, sinon [].
- Contenu en francais, factuel, actionnable, concis.`;

export const buildDealAnalysisV1Prompt = ({
  history,
  companyName,
  dealName,
  companyContext,
  dealContext,
  dealStage,
  objective,
  today,
  lastContactAt,
  nextAction,
  contactNames,
  currentCloseProbability,
  dealAmount,
  closeDate,
  ownerName,
  crmActivitySummary,
  pendingActionsSummary,
  channelEngagementSummary,
  lifecycleStatus,
  pipeline,
  companyIndustry,
  activitySignalsSummary,
  winBenchmarkSummary,
}: AnalyzeDealAnalysisV1Input): string => `${buildDealAnalysisV1Instructions(lifecycleStatus)}

Contexte deal:
- Statut lifecycle: ${lifecycleStatus}
- Entreprise: ${companyName ?? "inconnue"}
- Industrie: ${companyIndustry ?? "inconnue"}
- Contacts: ${contactNames && contactNames.length > 0 ? contactNames.join(", ") : "inconnus"}
- Deal: ${dealName ?? "inconnu"}
- Owner: ${ownerName ?? "inconnu"}
- Stage: ${dealStage ?? "inconnu"}
- Pipeline: ${pipeline ?? "inconnu"}
- Montant: ${dealAmount ?? "inconnu"}
- Probabilite HubSpot actuelle: ${currentCloseProbability ?? "inconnue"}
- Date de cloture: ${closeDate ?? "inconnue"}
- Aujourd'hui: ${today ?? new Date().toISOString()}
- Dernier contact connu: ${lastContactAt ?? "inconnu"}
- Prochaine action stockee: ${nextAction ?? "aucune"}
- Objectif: ${objective ?? "produire une analyse deal complete et actionnable"}

Resume activite CRM:
${crmActivitySummary ?? "non disponible"}

Actions deja stockees:
${pendingActionsSummary ?? "aucune"}

Engagement par canal:
${channelEngagementSummary ?? "non disponible"}

Signaux d'activite pre-calcules:
${activitySignalsSummary ?? "non disponible"}

Benchmark win (si present, a injecter dans activitySignals.benchmarkGaps):
${winBenchmarkSummary ?? "non disponible"}

Contexte entreprise:
${companyContext ?? "non disponible"}

Contexte deal:
${dealContext ?? "non disponible"}

Historique HubSpot chronologique (ancien -> recent):
${history}`;

export const buildDealAnalysisV1UserPrompt = (input: AnalyzeDealAnalysisV1Input): string => {
  const lightUserPrompt = input.lightUserPrompt?.trim();

  if (lightUserPrompt) {
    return `${buildDealAnalysisV1Instructions(input.lifecycleStatus)}\n\n${lightUserPrompt}`;
  }

  return buildDealAnalysisV1Prompt(input);
};

export const assembleDealAnalysisV1 = (
  input: AnalyzeDealAnalysisV1Input,
  body: Omit<DealAnalysisV1, "identifiers" | "metadata">,
  enrichment: DealAnalysisV1Enrichment,
  confidence: DealAnalysisV1["metadata"]["confidence"],
): DealAnalysisV1 => ({
  identifiers: {
    hubspotDealId: input.hubspotDealId,
    orgId: input.orgId,
    hubspotOwnerId: input.hubspotOwnerId ?? null,
    primaryContactId: input.primaryContactId ?? null,
    primaryCompanyId: input.primaryCompanyId ?? null,
    prospectId: input.prospectId ?? null,
  },
  metadata: {
    generatedAt: enrichment.generatedAt,
    lastUpdated: enrichment.generatedAt,
    modelUsed: enrichment.model,
    provider: enrichment.provider,
    analysisVersion: "1.0",
    confidence,
    cache: {
      inputHash: enrichment.inputHash,
      sourceSyncedAt: enrichment.sourceSyncedAt,
      analysisType: enrichment.analysisType,
      lifecycleStatus: input.lifecycleStatus,
    },
  },
  ...body,
});

export const parseDealAnalysisV1 = (
  value: string,
  providerName: string,
  input: AnalyzeDealAnalysisV1Input,
  enrichment: DealAnalysisV1Enrichment,
): DealAnalysisV1 => {
  const { body, confidence } = parseDealAnalysisV1Body(value, providerName, input.lifecycleStatus);

  return assembleDealAnalysisV1(input, body, enrichment, confidence);
};