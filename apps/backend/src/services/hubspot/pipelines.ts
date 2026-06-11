import { HUBSPOT_DEFAULT_MAX_RETRIES, hubSpotFetch } from "./client.js";
import { normalizeClassifierText, compactClassifierText, parseBooleanValue, parseNumericValue, readProperty } from "./shared.js";
import type {
  DealLifecycleStatus,
  HubSpotCollectionResponse,
  HubSpotCrmSyncSnapshot,
  HubSpotDeal,
  HubSpotDealPipeline,
} from "./types.js";

export type HubSpotDealStageDefinition = {
  pipelineId: string;
  pipelineLabel: string | null;
  label: string | null;
  displayOrder: number | null;
  isClosed: boolean | null;
  probability: number | null;
};

export const inferLifecycleStatusFromStageText = (
  dealStageId: string | null | undefined,
  stageLabel: string | null | undefined,
): DealLifecycleStatus | null => {
  const normalizedStage = normalizeClassifierText(`${dealStageId ?? ""} ${stageLabel ?? ""}`);
  const compactStage = compactClassifierText(normalizedStage);

  if (!normalizedStage) {
    return null;
  }

  if (
    compactStage.includes("closedlost") ||
    compactStage.includes("closelost") ||
    compactStage === "lost" ||
    normalizedStage.includes(" lost") ||
    normalizedStage.includes("perdu") ||
    normalizedStage.includes("perdue")
  ) {
    return "lost";
  }

  if (
    compactStage.includes("closedwon") ||
    compactStage === "won" ||
    normalizedStage.includes(" won") ||
    normalizedStage.includes("gagne") ||
    normalizedStage.includes("gagnee") ||
    normalizedStage.includes("gagné") ||
    normalizedStage.includes("gagnée")
  ) {
    return "won";
  }

  return "pending";
};

export const buildDealStageLookup = (pipelines: HubSpotDealPipeline[]): Map<string, HubSpotDealStageDefinition> => {
  const stageDefinitionByStageId = new Map<string, HubSpotDealStageDefinition>();

  for (const pipeline of pipelines) {
    const pipelineId = pipeline.id ?? pipeline.pipelineId ?? null;

    if (!pipelineId) {
      continue;
    }

    for (const stage of pipeline.stages ?? []) {
      const stageId = stage.id ?? stage.stageId;

      if (!stageId) {
        continue;
      }

      stageDefinitionByStageId.set(stageId, {
        pipelineId,
        pipelineLabel: pipeline.label ?? null,
        label: stage.label ?? null,
        displayOrder: typeof stage.displayOrder === "number" ? stage.displayOrder : null,
        isClosed: parseBooleanValue(stage.metadata?.isClosed),
        probability: parseNumericValue(stage.metadata?.probability),
      });
    }
  }

  return stageDefinitionByStageId;
};

export const fetchPipelineStageLookup = async (
  accessToken: string,
  objectType: string,
): Promise<Map<string, HubSpotDealStageDefinition>> => {
  const pipelines = await hubSpotFetch<HubSpotCollectionResponse<HubSpotDealPipeline>>(
    `/crm/v3/pipelines/${objectType}`,
    {
      accessToken,
      maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
    },
  );

  return buildDealStageLookup(pipelines.results);
};

export const buildDealStageSnapshot = (dealStageLookup: Map<string, HubSpotDealStageDefinition>): HubSpotCrmSyncSnapshot["dealStages"] =>
  Array.from(dealStageLookup.entries())
    .map(([stageId, definition]) => ({
      pipelineId: definition.pipelineId,
      pipelineLabel: definition.pipelineLabel,
      stageId,
      stageLabel: definition.label ?? stageId,
      displayOrder: definition.displayOrder,
      isClosed: definition.isClosed,
      probability: definition.probability,
    }))
    .sort((left, right) => {
      if (left.pipelineId !== right.pipelineId) {
        return left.pipelineId.localeCompare(right.pipelineId);
      }

      return (left.displayOrder ?? 0) - (right.displayOrder ?? 0);
    });

export const resolveDealLifecycleStatus = (
  deal: HubSpotDeal | null,
  dealStageLookup: Map<string, HubSpotDealStageDefinition>,
): DealLifecycleStatus | null => {
  if (!deal) {
    return null;
  }

  const dealStageId = readProperty(deal.properties, "dealstage");
  const stageDefinition = dealStageId ? dealStageLookup.get(dealStageId) ?? null : null;
  const stageLabel = stageDefinition?.label ?? null;
  const inferredStatusFromText = inferLifecycleStatusFromStageText(dealStageId, stageLabel);
  const stageProbability = stageDefinition?.probability ?? null;
  const isClosed = stageDefinition?.isClosed ?? null;

  if (inferredStatusFromText === "lost") {
    return "lost";
  }

  if (inferredStatusFromText === "won") {
    return "won";
  }

  if (stageProbability !== null) {
    if (stageProbability <= 0) {
      return "lost";
    }

    if (stageProbability >= 1) {
      return "won";
    }
  }

  if (isClosed === true) {
    return "won";
  }

  if (isClosed === false) {
    return "pending";
  }

  return inferredStatusFromText;
};

export const resolveDealStageLabel = (
  deal: HubSpotDeal | null,
  dealStageLookup: Map<string, HubSpotDealStageDefinition>,
): string | null => {
  if (!deal) {
    return null;
  }

  const dealStageId = readProperty(deal.properties, "dealstage");

  return (dealStageId ? dealStageLookup.get(dealStageId)?.label ?? null : null) ?? null;
};

export const resolveDealClosedState = (dealLifecycleStatus: DealLifecycleStatus | null): boolean | null => {
  if (!dealLifecycleStatus) {
    return null;
  }

  return dealLifecycleStatus !== "pending";
};

export const fetchDealPipelines = async (accessToken: string): Promise<HubSpotDealPipeline[]> => {
  const pipelineIndex = await hubSpotFetch<HubSpotCollectionResponse<HubSpotDealPipeline>>("/crm/v3/pipelines/deals", {
    accessToken,
    maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
  });

  const pipelineIds = (pipelineIndex.results ?? [])
    .map((pipeline) => pipeline.id ?? pipeline.pipelineId ?? null)
    .filter((pipelineId): pipelineId is string => Boolean(pipelineId));

  if (pipelineIds.length === 0) {
    return [];
  }

  return Promise.all(
    pipelineIds.map((pipelineId) =>
      hubSpotFetch<HubSpotDealPipeline>(`/crm/v3/pipelines/deals/${pipelineId}`, {
        accessToken,
        maxRetries: HUBSPOT_DEFAULT_MAX_RETRIES,
      }),
    ),
  );
};
