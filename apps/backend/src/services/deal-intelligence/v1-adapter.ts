import type { DealAnalysisV1 } from "@jarvis/shared";
import type {
  ActivityPlanAction,
  ActivityPlanDeadline,
  ActivityPlanInsight,
  ActivityPlanRecommendation,
  BuyingCommitteeMember,
  DealActivityPlanAnalysis,
  DealIntelligenceAnalysis,
  DealIntelligenceNextStep,
  DealQualificationAnalysis,
  MeddiccCriterion,
  QualificationInsight,
  QualificationRisk,
} from "../llm/llm.provider.js";
import { compactText } from "./shared.js";

const evidenceToText = (evidence: DealAnalysisV1["signals"][number]["evidence"]): string =>
  evidence.map((item) => item.quote).filter(Boolean).join(" | ");

export const mapDealAnalysisV1ToIntelligence = (analysis: DealAnalysisV1): DealIntelligenceAnalysis => {
  const nextSteps: DealIntelligenceNextStep[] = analysis.actionPlan.nextSteps.slice(0, 3).map((step) => ({
    title: compactText(step.action, 120),
    rationale: step.evidence.map((item) => item.quote).join(" ") || "Action recommandee depuis l'analyse deal unifiee.",
    dueInDays: 0,
    priority: step.priority,
    createHubSpotTask: step.createCrmTask,
  }));

  const risks = analysis.signals
    .filter((signal) => signal.kind === "risk" || signal.kind === "objection")
    .map((signal) => compactText(signal.title, 120))
    .slice(0, 4);

  const positiveSignals = [
    ...analysis.forecast.mainPositiveSignals,
    ...analysis.signals.filter((signal) => signal.kind === "opportunity").map((signal) => signal.title),
  ].slice(0, 5);

  const evidence = analysis.signals
    .flatMap((signal) => signal.evidence.map((item) => item.quote))
    .filter(Boolean)
    .slice(0, 4)
    .map((quote) => compactText(quote, 120));

  return {
    closeWonProbability: Math.round(
      analysis.dealOverview.closingProbability ?? analysis.forecast.probability ?? 0,
    ),
    dealHealth: analysis.dealOverview.dealHealth,
    executiveSummary: analysis.dealOverview.executiveSummary,
    detailedAnalysis: [compactText(analysis.dealOverview.summary, 500)].filter(Boolean),
    whyNow: analysis.dealOverview.whyNow ?? analysis.dealOverview.executiveSummary,
    suggestedMove: analysis.actionPlan.salesStrategy.recommendedAction,
    nextSteps,
    risks,
    positiveSignals,
    missingData: analysis.dataQuality.missingInformation,
    evidence,
    confidence: analysis.metadata.confidence,
  };
};

const mapQualificationStatus = (
  status: DealAnalysisV1["qualification"]["meddicc"][number]["status"],
): MeddiccCriterion["status"] => {
  if (status === "assumed") {
    return "partial";
  }

  if (status === "unclear") {
    return "weak";
  }

  return status;
};

export const mapDealAnalysisV1ToQualification = (analysis: DealAnalysisV1): DealQualificationAnalysis => {
  const buyingCommittee: BuyingCommitteeMember[] = analysis.stakeholders.slice(0, 6).map((stakeholder) => ({
    name: stakeholder.name,
    role: stakeholder.role ?? "Role inconnu",
    influence: stakeholder.influenceLevel,
    sentiment: stakeholder.sentiment === "unknown" ? "unknown" : stakeholder.sentiment,
    dealRole:
      stakeholder.buyerRole === "economic_buyer"
        ? "decision_maker"
        : stakeholder.buyerRole === "unknown"
          ? "unknown"
          : stakeholder.buyerRole,
    evidence: evidenceToText(stakeholder.evidence) || "Stakeholder identifie dans l'analyse deal unifiee.",
  }));

  const meddicc: MeddiccCriterion[] = analysis.qualification.meddicc.map((criterion) => ({
    id: criterion.id,
    label: criterion.label,
    status: mapQualificationStatus(criterion.status),
    score: criterion.score,
    evidence: evidenceToText(criterion.evidence) || "Critere evalue dans l'analyse deal unifiee.",
    gap: criterion.gap,
  }));

  const risks: QualificationRisk[] = analysis.signals
    .filter((signal) => signal.kind === "risk")
    .slice(0, 4)
    .map((signal) => ({
      title: compactText(signal.title, 120),
      severity: signal.severity,
      evidence: evidenceToText(signal.evidence) || signal.title,
    }));

  const strengths: QualificationInsight[] = analysis.qualification.productFit.strongFitReasons
    .slice(0, 4)
    .map((reason) => ({
      title: compactText(reason, 120),
      rationale: "Signal de fit produit issu de l'analyse deal unifiee.",
    }));

  const missingForWin: QualificationInsight[] = analysis.qualification.meddicc
    .filter((criterion) => criterion.gap)
    .slice(0, 4)
    .map((criterion) => ({
      title: compactText(criterion.label, 120),
      rationale: compactText(criterion.gap ?? "", 170),
    }));

  const budgetStatus =
    analysis.qualification.budget.status === "confirmed"
      ? "validated"
      : analysis.qualification.budget.status === "partial" || analysis.qualification.budget.status === "assumed"
        ? "to_confirm"
        : analysis.qualification.budget.status === "missing"
          ? "unknown"
          : "blocked";

  return {
    buyingCommittee,
    meddicc,
    decisionProcess: {
      decisionCalendar: analysis.qualification.decisionProcess.timeline,
      budgetStatus,
      purchaseProcess: analysis.qualification.decisionProcess.purchaseProcess,
      legalStatus: analysis.qualification.decisionProcess.legalStatus,
      nextGovernanceStep:
        analysis.qualification.decisionProcess.approvalSteps[0] ??
        analysis.qualification.decisionProcess.blockers[0] ??
        null,
    },
    risks,
    strengths,
    missingForWin,
    confidence: analysis.qualification.confidence,
  };
};

const mapActionStatus = (status: DealAnalysisV1["actionPlan"]["mutualActionPlan"][number]["status"]): ActivityPlanAction["status"] => {
  if (status === "completed") {
    return "done";
  }

  if (status === "in_progress") {
    return "in_progress";
  }

  if (status === "overdue") {
    return "planned";
  }

  return "todo";
};

export const mapDealAnalysisV1ToActivityPlan = (analysis: DealAnalysisV1): DealActivityPlanAnalysis => {
  const mutualActionPlan: ActivityPlanAction[] = analysis.actionPlan.mutualActionPlan.map((action) => ({
    title: action.title,
    ownerName: action.ownerName,
    dueDate: action.dueDate,
    status: mapActionStatus(action.status),
    priority: action.priority,
    rationale: action.rationale,
  }));

  const upcomingDeadlines: ActivityPlanDeadline[] = analysis.actionPlan.upcomingDeadlines.map((deadline) => ({
    title: deadline.title,
    date: deadline.date,
    timeWindow: deadline.timeWindow,
    ownerName: deadline.ownerName,
    description: deadline.description,
  }));

  const notesAndInsights: ActivityPlanInsight[] = analysis.signals
    .slice(0, 5)
    .map((signal) => ({
      title: compactText(signal.title, 100),
      detail: compactText(signal.businessImpact ?? signal.remainingConcern ?? signal.title, 220),
    }));

  const firstNextStep = analysis.actionPlan.nextSteps[0];
  const recommendation: ActivityPlanRecommendation = {
    priority: firstNextStep?.priority ?? "medium",
    summary: compactText(analysis.actionPlan.salesStrategy.recommendedAction, 220),
    nextBestAction: {
      title: firstNextStep?.action ?? analysis.actionPlan.salesStrategy.recommendedAction,
      rationale:
        analysis.actionPlan.salesStrategy.bestAngle ??
        "Prochaine action recommandee depuis l'analyse deal unifiee.",
      dueInDays: 0,
    },
  };

  return {
    mutualActionPlan,
    upcomingDeadlines,
    notesAndInsights,
    recommendation,
    confidence: analysis.metadata.confidence,
  };
};