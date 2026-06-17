import type {
  Playbook,
  PlaybookDetail,
  PlaybookPlay,
  PlaybookPlayInput,
  PlaybookPlayStatus,
  PlaybookBootstrapReadiness,
  PlaybookBootstrapResult,
  PlaybookOverviewResult,
  PlaybookSuggestion,
  PlaybookSuggestionGenerationResult,
  PlaybookStatus,
} from "@jarvis/shared";
import { apiPath, patchJson, postJson } from "./client";
import { ANALYTICS_OVERVIEW_CACHE_TTL_MS, clearAnalyticsCacheByPrefix, getCachedJson } from "./cache";

const PLAYBOOK_CACHE_PREFIX = "playbook:";
const PLAYBOOK_SUGGESTION_CACHE_PREFIX = "playbook-suggestions:";

const clearPlaybookCache = (): void => {
  clearAnalyticsCacheByPrefix(PLAYBOOK_CACHE_PREFIX);
  clearAnalyticsCacheByPrefix(PLAYBOOK_SUGGESTION_CACHE_PREFIX);
};

export const fetchPlaybooks = async (orgId: string, forceRefresh = false): Promise<Playbook[]> => {
  const path = apiPath("/api/playbook", { orgId });

  return getCachedJson<Playbook[]>(`${PLAYBOOK_CACHE_PREFIX}list:${path}`, path, ANALYTICS_OVERVIEW_CACHE_TTL_MS, forceRefresh);
};

export const fetchPlaybookDetail = async (
  orgId: string,
  playbookId: string,
  forceRefresh = false,
): Promise<PlaybookDetail> => {
  const path = apiPath(`/api/playbook/${encodeURIComponent(playbookId)}`, { orgId });

  return getCachedJson<PlaybookDetail>(
    `${PLAYBOOK_CACHE_PREFIX}detail:${path}`,
    path,
    ANALYTICS_OVERVIEW_CACHE_TTL_MS,
    forceRefresh,
  );
};

export const createPlaybook = async (orgId: string, name: string, description?: string | null): Promise<Playbook> =>
  postJson<Playbook>("/api/playbook", { orgId, name, description: description ?? null }).finally(clearPlaybookCache);

export const fetchPlaybookBootstrapReadiness = async (
  orgId: string,
  forceRefresh = false,
): Promise<PlaybookBootstrapReadiness> => {
  const path = apiPath("/api/playbook/bootstrap/readiness", { orgId });

  return getCachedJson<PlaybookBootstrapReadiness>(
    `${PLAYBOOK_CACHE_PREFIX}bootstrap-readiness:${path}`,
    path,
    30_000,
    forceRefresh,
  );
};

export const bootstrapPlaybookFromWonDeals = async (
  orgId: string,
  options?: { dealCount?: number; lookbackDays?: number },
): Promise<PlaybookBootstrapResult> =>
  postJson<PlaybookBootstrapResult>("/api/playbook/bootstrap", { orgId, ...options }).finally(clearPlaybookCache);

export const synthesizePlaybookOverview = async (
  orgId: string,
  playbookId: string,
): Promise<PlaybookOverviewResult> =>
  postJson<PlaybookOverviewResult>(`/api/playbook/${encodeURIComponent(playbookId)}/synthesize`, { orgId }).finally(
    clearPlaybookCache,
  );

export const updatePlaybook = async (
  orgId: string,
  playbookId: string,
  patch: { name?: string; description?: string | null; status?: PlaybookStatus },
): Promise<Playbook> =>
  patchJson<Playbook>(`/api/playbook/${encodeURIComponent(playbookId)}`, { orgId, ...patch }).finally(clearPlaybookCache);

export const createPlaybookPlay = async (
  orgId: string,
  playbookId: string,
  play: PlaybookPlayInput,
): Promise<PlaybookPlay> =>
  postJson<PlaybookPlay>(`/api/playbook/${encodeURIComponent(playbookId)}/plays`, { orgId, ...play }).finally(
    clearPlaybookCache,
  );

export const updatePlaybookPlay = async (
  orgId: string,
  playbookId: string,
  playId: string,
  patch: Partial<PlaybookPlayInput> & { status?: PlaybookPlayStatus },
): Promise<PlaybookPlay> =>
  patchJson<PlaybookPlay>(
    `/api/playbook/${encodeURIComponent(playbookId)}/plays/${encodeURIComponent(playId)}`,
    { orgId, ...patch },
  ).finally(clearPlaybookCache);

export const reorderPlaybookPlays = async (
  orgId: string,
  playbookId: string,
  orderedPlayIds: string[],
): Promise<void> => {
  await postJson<{ reordered: boolean }>(`/api/playbook/${encodeURIComponent(playbookId)}/plays/reorder`, {
    orgId,
    orderedPlayIds,
  }).finally(clearPlaybookCache);
};

export const fetchPlaybookSuggestions = async (
  orgId: string,
  playbookId: string,
  forceRefresh = false,
): Promise<PlaybookSuggestion[]> => {
  const path = apiPath(`/api/playbook/${encodeURIComponent(playbookId)}/suggestions`, { orgId });

  return getCachedJson<PlaybookSuggestion[]>(
    `${PLAYBOOK_SUGGESTION_CACHE_PREFIX}list:${path}`,
    path,
    ANALYTICS_OVERVIEW_CACHE_TTL_MS,
    forceRefresh,
  );
};

export const generatePlaybookSuggestions = async (
  orgId: string,
  playbookId: string,
): Promise<PlaybookSuggestionGenerationResult> =>
  postJson<PlaybookSuggestionGenerationResult>(
    `/api/playbook/${encodeURIComponent(playbookId)}/suggestions/generate`,
    { orgId },
  ).finally(clearPlaybookCache);

export const acceptPlaybookSuggestion = async (
  orgId: string,
  playbookId: string,
  suggestionId: string,
  play: PlaybookPlayInput,
): Promise<PlaybookPlay> =>
  postJson<PlaybookPlay>(
    `/api/playbook/${encodeURIComponent(playbookId)}/suggestions/${encodeURIComponent(suggestionId)}/accept`,
    { orgId, play },
  ).finally(clearPlaybookCache);

export const rejectPlaybookSuggestion = async (
  orgId: string,
  playbookId: string,
  suggestionId: string,
): Promise<PlaybookSuggestion> =>
  postJson<PlaybookSuggestion>(
    `/api/playbook/${encodeURIComponent(playbookId)}/suggestions/${encodeURIComponent(suggestionId)}/reject`,
    { orgId },
  ).finally(clearPlaybookCache);
