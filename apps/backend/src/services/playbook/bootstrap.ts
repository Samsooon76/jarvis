import { compactText } from "../../lib/text.js";
import type { PlaybookBootstrapReadiness, PlaybookDetail, PlaybookPlayCategory } from "@jarvis/shared";
import type { CloseWonDealAnalysis, CloseWonPortfolioAnalysis, PlaybookBootstrapPlay } from "../llm/llm.provider.js";
import {
  PLAYBOOK_BOOTSTRAP_MIN_CATEGORIES,
  PLAYBOOK_BOOTSTRAP_MIN_PLAYS,
  PLAYBOOK_BOOTSTRAP_TARGET_PLAYS,
  sortPlaysBySalesCycle,
} from "../llm/playbook-bootstrap.js";
import { analyzeWonDealContext } from "../win-analysis/analysis.js";
import { loadLatestWinAnalyses, loadWonDealContexts } from "../win-analysis/data-access.js";
import {
  CLOSE_WON_ANALYSIS_CONCURRENCY,
  getDefaultDateRange,
  parseNumber,
  resolveProvider,
} from "../win-analysis/shared.js";
import type { DealContext } from "../win-analysis/types.js";
import { createPlay, createPlaybook, getPlaybookDetail, updatePlaybook } from "./playbook.service.js";
import { trySynthesizePlaybookOverview } from "./overview.js";
import { deleteNonArchivedPlays, loadPlaybooks, loadPlays } from "./data-access.js";
import { validatePlayInput } from "./shared.js";
import {
  ensureTeamDealsForPlaybook,
  loadPlaybookTeamOwnerNames,
  resolvePlaybookTeamOwnerIds,
} from "./team-deals.js";

export const DEFAULT_BOOTSTRAP_DEAL_COUNT = 10;
export const MIN_BOOTSTRAP_DEAL_COUNT = 3;
export const MAX_BOOTSTRAP_DEAL_COUNT = 20;

export type BootstrapPlaybookInput = {
  orgId: string;
  createdBy?: string | null;
  dealCount?: number;
  lookbackDays?: number;
};

export type BootstrapPlaybookResult = {
  playbook: PlaybookDetail;
  analyzedDealCount: number;
  reusedAnalysisCount: number;
  generatedPlayCount: number;
  confidence: "low" | "medium" | "high";
};

type BootstrapReadinessOptions = {
  teamOwnerIds?: string[];
  teamOwnerNames?: string[];
  teamDealCount?: number;
};

const countPlaybookPlays = (plays: Awaited<ReturnType<typeof loadPlays>>) => {
  let playCount = 0;
  let activePlayCount = 0;
  let draftPlayCount = 0;

  for (const play of plays) {
    if (play.status === "archived") {
      continue;
    }

    playCount += 1;

    if (play.status === "active") {
      activePlayCount += 1;
    }

    if (play.status === "draft") {
      draftPlayCount += 1;
    }
  }

  return { playCount, activePlayCount, draftPlayCount };
};

const buildDealSummary = (context: DealContext, analysis: CloseWonDealAnalysis): string =>
  [
    `dealId: ${context.row.hubspot_deal_id}`,
    `Deal: ${context.row.deal_name ?? context.row.hubspot_deal_id}`,
    `Entreprise: ${context.companyName ?? "inconnue"}`,
    `Montant: ${parseNumber(context.row.amount) ?? 0}`,
    `Owner: ${context.ownerName ?? "inconnu"}`,
    `Facteur: ${analysis.primaryWinFactor}`,
    `Categorie: ${analysis.winFactorCategory}`,
    `Moments cles: ${analysis.keyMoments.map((moment) => moment.moment).join("; ") || "n/a"}`,
    `Tactiques replicables: ${analysis.replicablePlays.map((play) => `${play.play} (${play.when})`).join("; ") || "n/a"}`,
    `Resume: ${analysis.summary}`,
  ].join("\n");

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

const buildPortfolioSummary = (
  deals: Array<{ context: DealContext; analysis: CloseWonDealAnalysis }>,
  portfolio: CloseWonPortfolioAnalysis | null,
): string => {
  const factors = new Map<string, number>();

  for (const deal of deals) {
    factors.set(deal.analysis.winFactorCategory, (factors.get(deal.analysis.winFactorCategory) ?? 0) + 1);
  }

  const topFactors = [...factors.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([category, count]) => `${category} (${count})`)
    .join(", ");

  const lines = [
    `Deals analyses: ${deals.length}`,
    `Facteurs dominants: ${topFactors || "n/a"}`,
    `Moments cles transverses: ${deals.flatMap((deal) => deal.analysis.keyMoments.map((moment) => moment.moment)).slice(0, 8).join("; ") || "n/a"}`,
  ];

  if (portfolio) {
    lines.push(`Insight cle: ${portfolio.keyInsight}`);
    lines.push(`Sequence gagnante type: ${portfolio.idealSequence.join(" -> ") || "n/a"}`);
    lines.push(`Patterns recurrents: ${portfolio.winningPatterns.join("; ") || "n/a"}`);
  }

  return lines.join("\n");
};

const inferPlayCategory = (text: string): PlaybookPlayCategory => {
  const normalized = text.toLowerCase();

  if (/qualif|mql|bant|scor/i.test(normalized)) {
    return "qualification";
  }

  if (/demo|démo|presentation|présentation/i.test(normalized)) {
    return "demo";
  }

  if (/objection|concurrent|battle|prix trop/i.test(normalized)) {
    return "objection_handling";
  }

  if (/negoc|offre|pricing|tarif|contrat/i.test(normalized)) {
    return "negotiation";
  }

  if (/clos|signature|signer|final/i.test(normalized)) {
    return "closing";
  }

  if (/suivi|relance|follow/i.test(normalized)) {
    return "follow_up";
  }

  if (/discover|besoin|pain|cadrage|diagnostic/i.test(normalized)) {
    return "discovery";
  }

  return "discovery";
};

const buildStructuredPlayResponse = (objective: string, steps: string[], signals: string[], nextStep: string): string =>
  [
    `Objectif: ${objective}`,
    steps.length > 0 ? `Etapes:\n${steps.map((step) => `- ${step}`).join("\n")}` : null,
    signals.length > 0 ? `Signaux de succes:\n${signals.map((signal) => `- ${signal}`).join("\n")}` : null,
    `Next step: ${nextStep}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");

const playDedupKey = (play: Pick<PlaybookBootstrapPlay, "category" | "title" | "triggerDescription">): string =>
  `${play.category}:${play.title}:${play.triggerDescription}`.toLowerCase();

const enrichBootstrapPlays = (
  plays: PlaybookBootstrapPlay[],
  analyzedDeals: Array<{ context: DealContext; analysis: CloseWonDealAnalysis }>,
  options?: { idealSequence?: string[]; winningPatterns?: string[] },
  targetCount = PLAYBOOK_BOOTSTRAP_TARGET_PLAYS,
): PlaybookBootstrapPlay[] => {
  const enriched = [...plays];
  const existingKeys = new Set(enriched.map(playDedupKey));
  const coveredCategories = new Set(enriched.map((play) => play.category));
  const defaultSourceDealIds = analyzedDeals.slice(0, 3).map((deal) => deal.context.row.hubspot_deal_id);

  const pushPlay = (candidate: PlaybookBootstrapPlay): void => {
    const key = playDedupKey(candidate);

    if (existingKeys.has(key)) {
      return;
    }

    existingKeys.add(key);
    coveredCategories.add(candidate.category);
    enriched.push(candidate);
  };

  for (const [index, step] of (options?.idealSequence ?? []).entries()) {
    if (enriched.length >= targetCount && coveredCategories.size >= PLAYBOOK_BOOTSTRAP_MIN_CATEGORIES) {
      break;
    }

    const category = inferPlayCategory(step);

    if (enriched.some((play) => play.category === category && play.title.toLowerCase().includes(step.slice(0, 24).toLowerCase()))) {
      continue;
    }

    const relatedMoments = analyzedDeals.flatMap((deal) =>
      deal.analysis.keyMoments
        .filter((moment) => inferPlayCategory(moment.stage ?? moment.moment) === category)
        .map((moment) => moment),
    );

    const validated = validatePlayInput({
      category,
      title: compactText(step, 120),
      triggerDescription: compactText(`Etape ${index + 1} du cycle gagnant — ${step}`, 600),
      recommendedResponse: buildStructuredPlayResponse(
        step,
        relatedMoments.slice(0, 3).map((moment) => `${moment.moment}: ${moment.impact}`),
        relatedMoments.slice(0, 2).map((moment) => moment.impact),
        index < (options?.idealSequence?.length ?? 0) - 1
          ? (options?.idealSequence?.[index + 1] ?? "Passer a l'etape suivante du cycle")
          : "Clore le cycle et documenter les learnings dans le CRM",
      ),
    });

    pushPlay({
      category: validated.category,
      title: validated.title,
      triggerDescription: validated.triggerDescription,
      recommendedResponse: validated.recommendedResponse,
      sourceDealIds: defaultSourceDealIds,
    });
  }

  for (const pattern of options?.winningPatterns ?? []) {
    if (enriched.length >= targetCount) {
      break;
    }

    const category = inferPlayCategory(pattern);
    const relatedDeals = analyzedDeals.filter((deal) =>
      deal.analysis.keyMoments.some((moment) => moment.moment.toLowerCase().includes(pattern.slice(0, 20).toLowerCase())),
    );

    pushPlay({
      category,
      title: compactText(pattern, 120),
      triggerDescription: compactText(`Pattern observe sur deals gagnes — ${pattern}`, 600),
      recommendedResponse: buildStructuredPlayResponse(
        `Repliquer le pattern: ${pattern}`,
        relatedDeals.flatMap((deal) => deal.analysis.keyMoments.map((moment) => moment.moment)).slice(0, 3),
        ["Pattern observe sur plusieurs victoires", "Comportement client aligne avec le pattern"],
        "Valider l'avancement de stage avant de poursuivre",
      ),
      sourceDealIds:
        relatedDeals.length > 0
          ? relatedDeals.slice(0, 2).map((deal) => deal.context.row.hubspot_deal_id)
          : defaultSourceDealIds,
    });
  }

  for (const { context, analysis } of analyzedDeals) {
    if (enriched.length >= targetCount && coveredCategories.size >= PLAYBOOK_BOOTSTRAP_MIN_CATEGORIES) {
      break;
    }

    for (const moment of analysis.keyMoments) {
      if (enriched.length >= targetCount) {
        break;
      }

      const category = inferPlayCategory(moment.stage ?? moment.moment);

      if (coveredCategories.has(category) && enriched.filter((play) => play.category === category).length >= 2) {
        continue;
      }

      pushPlay({
        category,
        title: compactText(moment.moment, 120),
        triggerDescription: compactText(
          moment.stage ? `Stage ${moment.stage} — signal d'avancement observe` : "Signal d'avancement observe sur deal gagne",
          600,
        ),
        recommendedResponse: buildStructuredPlayResponse(
          moment.moment,
          [moment.impact],
          [moment.impact],
          "Enchaîner sur l'etape suivante du cycle",
        ),
        sourceDealIds: [context.row.hubspot_deal_id],
      });
    }
  }

  return sortPlaysBySalesCycle(enriched).slice(0, 12);
};

const resolveBootstrapLookback = (lookbackDays?: number): { dateFrom: string; dateTo: string } => {
  const lookback = lookbackDays ?? 365;
  const dateTo = new Date();
  const dateFrom = new Date(dateTo);
  dateFrom.setUTCDate(dateFrom.getUTCDate() - lookback);

  return getDefaultDateRange(dateFrom.toISOString().slice(0, 10), dateTo.toISOString().slice(0, 10));
};

export const getPlaybookBootstrapReadiness = async (
  orgId: string,
  options?: BootstrapReadinessOptions,
): Promise<PlaybookBootstrapReadiness> => {
  const teamOwnerIds = options?.teamOwnerIds ?? (await resolvePlaybookTeamOwnerIds(orgId));
  const teamOwnerNames =
    options?.teamOwnerNames ?? (teamOwnerIds.length > 0 ? await loadPlaybookTeamOwnerNames(orgId, teamOwnerIds) : []);
  const { dateFrom, dateTo } = resolveBootstrapLookback();
  const wonDealCount = (await loadWonDealContexts(orgId, dateFrom, dateTo, null, teamOwnerIds)).length;
  const existingPlaybooks = await loadPlaybooks(orgId);
  const activePlaybookRow = existingPlaybooks.find((playbook) => playbook.status === "active") ?? existingPlaybooks[0] ?? null;
  const hasPlaybook = activePlaybookRow !== null;
  const playRows = activePlaybookRow ? await loadPlays(orgId, [activePlaybookRow.id]) : [];
  const { playCount, activePlayCount, draftPlayCount } = countPlaybookPlays(playRows);
  const playbookIsEmpty = playCount === 0;
  const replacesDrafts = draftPlayCount > 0 && activePlayCount === 0;
  const recommendedDealCount = Math.min(DEFAULT_BOOTSTRAP_DEAL_COUNT, Math.max(MIN_BOOTSTRAP_DEAL_COUNT, wonDealCount));

  let blockingReason: string | null = null;
  const hasEnoughLocalWonDeals = wonDealCount >= MIN_BOOTSTRAP_DEAL_COUNT;
  const canTryTeamBootstrap = teamOwnerIds.length > 0;

  if (activePlayCount > 0) {
    blockingReason = `${activePlayCount} play(s) actif(s) deja publie(s). Utilisez l'onglet Suggestions pour enrichir le playbook.`;
  } else if (!hasEnoughLocalWonDeals) {
    const teamLabel =
      teamOwnerIds.length > 0
        ? ` pour l'equipe (${teamOwnerIds.length} commercial${teamOwnerIds.length > 1 ? "aux" : ""})`
        : "";

    blockingReason =
      wonDealCount === 0
        ? canTryTeamBootstrap
          ? `Aucun deal gagne synchronise${teamLabel} pour l'instant. La generation lancera une sync HubSpot de l'equipe.`
          : `Aucun deal gagne synchronise${teamLabel}. Connectez HubSpot et verifiez les owners de l'equipe.`
        : `Seulement ${wonDealCount} deal(s) gagne(s)${teamLabel} en base — la generation tentera une sync equipe puis il en faut au moins ${MIN_BOOTSTRAP_DEAL_COUNT}.`;
  }

  return {
    wonDealCount,
    minDealCount: MIN_BOOTSTRAP_DEAL_COUNT,
    recommendedDealCount,
    canBootstrap: activePlayCount === 0 && (hasEnoughLocalWonDeals || canTryTeamBootstrap),
    hasPlaybook,
    playbookIsEmpty,
    playCount,
    activePlayCount,
    draftPlayCount,
    replacesDrafts,
    teamOwnerCount: teamOwnerIds.length,
    teamDealCount: options?.teamDealCount ?? wonDealCount,
    teamOwnerNames,
    blockingReason,
  };
};

export const bootstrapPlaybookFromWonDeals = async (input: BootstrapPlaybookInput): Promise<BootstrapPlaybookResult> => {
  const teamSync = await ensureTeamDealsForPlaybook(input.orgId);
  const readiness = await getPlaybookBootstrapReadiness(input.orgId, {
    teamOwnerIds: teamSync.ownerIds,
    teamOwnerNames: teamSync.ownerNames,
    teamDealCount: teamSync.dealCount,
  });

  if (!readiness.canBootstrap) {
    throw new Error(readiness.blockingReason ?? "Le bootstrap du playbook n'est pas disponible.");
  }

  const existingPlaybooks = await loadPlaybooks(input.orgId);
  const targetPlaybookRow = existingPlaybooks.find((playbook) => playbook.status === "active") ?? existingPlaybooks[0] ?? null;
  const dealCount = Math.min(
    MAX_BOOTSTRAP_DEAL_COUNT,
    Math.max(MIN_BOOTSTRAP_DEAL_COUNT, input.dealCount ?? readiness.recommendedDealCount),
    readiness.wonDealCount,
  );
  const { dateFrom: resolvedFrom, dateTo: resolvedTo } = resolveBootstrapLookback(input.lookbackDays);
  const provider = await resolveProvider(input.orgId);
  const contexts = (await loadWonDealContexts(input.orgId, resolvedFrom, resolvedTo, null, teamSync.ownerIds)).slice(
    0,
    dealCount,
  );

  if (contexts.length < MIN_BOOTSTRAP_DEAL_COUNT) {
    throw new Error(
      `Pas assez de deals gagnes pour generer un playbook (${contexts.length}/${MIN_BOOTSTRAP_DEAL_COUNT} minimum).`,
    );
  }

  const cachedAnalyses = await loadLatestWinAnalyses(
    input.orgId,
    contexts.map((context) => context.row.hubspot_deal_id),
    provider.providerName,
    provider.modelName,
  );
  const analyzedDeals: Array<{ context: DealContext; analysis: CloseWonDealAnalysis }> = [];
  let reusedAnalysisCount = 0;
  let nextContextIndex = 0;

  const processNextContext = async (): Promise<void> => {
    while (nextContextIndex < contexts.length) {
      const index = nextContextIndex;
      nextContextIndex += 1;
      const context = contexts[index];

      try {
        const result = await analyzeWonDealContext(
          input.orgId,
          context,
          provider,
          cachedAnalyses.get(context.row.hubspot_deal_id) ?? null,
        );

        if (result.cached) {
          reusedAnalysisCount += 1;
        }

        analyzedDeals.push({ context, analysis: result.analysis });
      } catch {
        // On continue avec les autres deals: un echec unitaire ne bloque pas le bootstrap.
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CLOSE_WON_ANALYSIS_CONCURRENCY, contexts.length) }, () => processNextContext()),
  );

  if (analyzedDeals.length < MIN_BOOTSTRAP_DEAL_COUNT) {
    throw new Error("Impossible d'analyser assez de deals gagnes pour generer un playbook.");
  }

  const knownDealIds = analyzedDeals.map((deal) => deal.context.row.hubspot_deal_id);
  const totalWonValue = analyzedDeals.reduce(
    (sum, deal) => sum + (parseNumber(deal.context.row.amount) ?? 0),
    0,
  );

  let portfolio: CloseWonPortfolioAnalysis | null = null;

  try {
    portfolio = await provider.analyzeCloseWonPortfolio({
      dealsSummary: buildPortfolioDealsSummary(analyzedDeals),
      dateFrom: resolvedFrom,
      dateTo: resolvedTo,
      scopeLabel: "Equipe Sales AE",
      wonDealCount: contexts.length,
      totalWonValue,
      analyzedDealCount: analyzedDeals.length,
    });
  } catch {
    // La synthese portefeuille enrichit le playbook mais n'est pas bloquante.
  }

  const enrichOptions = {
    idealSequence: portfolio?.idealSequence,
    winningPatterns: portfolio?.winningPatterns,
  };
  const bootstrapInput = {
    dealsSummary: analyzedDeals.map((deal) => buildDealSummary(deal.context, deal.analysis)).join("\n\n---\n\n"),
    portfolioSummary: buildPortfolioSummary(analyzedDeals, portfolio),
    analyzedDealCount: analyzedDeals.length,
    dateFrom: resolvedFrom,
    dateTo: resolvedTo,
    knownDealIds,
    keyInsight: portfolio?.keyInsight,
    winningPatterns: portfolio?.winningPatterns,
    idealSequence: portfolio?.idealSequence,
  };

  const finalizeBootstrapPlays = (plays: PlaybookBootstrapPlay[]): PlaybookBootstrapPlay[] =>
    sortPlaysBySalesCycle(enrichBootstrapPlays(plays, analyzedDeals, enrichOptions));

  let bootstrap = await provider.generatePlaybookBootstrap(bootstrapInput);
  const finalizedPlays = finalizeBootstrapPlays(bootstrap.plays);
  bootstrap = {
    ...bootstrap,
    plays: finalizedPlays,
    confidence: finalizedPlays.length < PLAYBOOK_BOOTSTRAP_MIN_PLAYS ? "low" : bootstrap.confidence,
  };

  if (bootstrap.plays.length < PLAYBOOK_BOOTSTRAP_MIN_PLAYS) {
    bootstrap = await provider.generatePlaybookBootstrap(bootstrapInput);
    bootstrap = {
      ...bootstrap,
      plays: finalizeBootstrapPlays(bootstrap.plays),
    };
  }

  if (bootstrap.plays.length < PLAYBOOK_BOOTSTRAP_MIN_PLAYS) {
    throw new Error(
      `Impossible de construire un playbook exploitable (${bootstrap.plays.length}/${PLAYBOOK_BOOTSTRAP_MIN_PLAYS} plays minimum).`,
    );
  }
  const playbook =
    targetPlaybookRow
      ? await updatePlaybook(input.orgId, targetPlaybookRow.id, {
          name: bootstrap.name,
          description: bootstrap.description,
        })
      : await createPlaybook({
          orgId: input.orgId,
          name: bootstrap.name,
          description: bootstrap.description,
          createdBy: input.createdBy ?? null,
        });

  if (readiness.replacesDrafts) {
    await deleteNonArchivedPlays(input.orgId, playbook.id);
  } else {
    const existingPlays = await loadPlays(input.orgId, [playbook.id]);

    if (existingPlays.some((play) => play.status !== "archived")) {
      throw new Error("Ce playbook contient deja des plays.");
    }
  }

  for (const play of bootstrap.plays) {
    await createPlay(
      input.orgId,
      playbook.id,
      {
        category: play.category,
        title: play.title,
        triggerDescription: play.triggerDescription,
        recommendedResponse: play.recommendedResponse,
        status: "draft",
        evidence: play.sourceDealIds.map((dealId) => ({
          kind: "deal",
          refId: dealId,
          note: "Genere depuis deals gagnes",
        })),
      },
      "ai_suggested",
    );
  }

  await trySynthesizePlaybookOverview(input.orgId, playbook.id);
  const detail = await getPlaybookDetail(input.orgId, playbook.id);

  return {
    playbook: detail,
    analyzedDealCount: analyzedDeals.length,
    reusedAnalysisCount,
    generatedPlayCount: bootstrap.plays.length,
    confidence: bootstrap.confidence,
  };
};