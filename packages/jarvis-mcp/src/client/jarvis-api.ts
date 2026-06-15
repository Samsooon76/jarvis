import type { ApiResponse, AskJarvisRequest, AskJarvisResult, ManagerDigest, ManagerDigestPeriod, QueueData } from "@jarvis/shared";
import type { JarvisMcpConfig } from "../config.js";
import { JarvisApiError } from "../errors.js";

export type ProspectDetail = {
  id: string;
  orgId: string;
  ownerUserId: string | null;
  name: string;
  company: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  dealStage: string | null;
  dealAmount: number | null;
  closeProbability: number;
  lastContactAt: string | null;
  nextAction: string | null;
  aiSummary: string | null;
  aiPriorityScore: number;
  hubspotContactId: string;
  hubspotDealId: string | null;
};

export type ForecastOverviewPayload = {
  orgId: string;
  scope: "all" | "owner";
  hubspotOwnerId: string | null;
  dateFrom: string;
  dateTo: string;
  generatedAt: string;
  openDealCount: number;
  wonDealCount: number;
  analyzedDealCount: number;
  signedAmount: number;
  landingAmount: number;
  forecastAmount: number;
  objectiveAmount: number | null;
  gapToObjective: number | null;
  confidenceScore: number;
  scenarios: Array<{ id: string; label: string; amount: number; probability: number }>;
  risks: Array<{ title: string; severity: string; dealCount: number; amount: number }>;
  levers: Array<{ title: string; impactAmount: number; rationale: string }>;
  deals: Array<{
    hubspotDealId: string;
    dealName: string | null;
    companyName: string;
    amount: number;
    stage: string;
    aiProbability: number | null;
    dealHealth: string | null;
    summary: string | null;
    suggestedMove: string | null;
    risks: string[];
  }>;
  synthesis: {
    headline: string;
    confidence: string;
    dealVerdicts: Array<{
      hubspotDealId: string;
      category: string;
      reason: string;
      recommendedAction: string | null;
    }>;
    actionPlan: Array<{
      title: string;
      rationale: string;
      priority: string;
    }>;
  } | null;
};

export type DealIntelligencePayload = {
  prospectId: string;
  orgId: string;
  hubspotDealId: string;
  cached: boolean;
  provider: string;
  model: string;
  generatedAt: string;
  expiresAt: string;
  analysis: {
    closeWonProbability: number;
    dealHealth: string;
    executiveSummary: string;
    suggestedMove: string;
    risks: string[];
    positiveSignals: string[];
    confidence: string;
  };
};

type RequestOptions = {
  method?: "GET" | "POST";
  query?: Record<string, string | undefined>;
  body?: unknown;
};

export class JarvisApiClient {
  private readonly config: JarvisMcpConfig;

  constructor(config: JarvisMcpConfig) {
    this.config = config;
  }

  get defaultOrgId(): string | null {
    return this.config.defaultOrgId;
  }

  get defaultUserId(): string | null {
    return this.config.defaultUserId;
  }

  resolveOrgId(orgId?: string | null): string {
    const resolved = orgId?.trim() || this.config.defaultOrgId?.trim();

    if (!resolved) {
      throw new JarvisApiError(
        "orgId est obligatoire. Passe-le dans l'appel du tool ou configure JARVIS_ORG_ID.",
        400,
      );
    }

    return resolved;
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(`${this.config.apiUrl}${path}`);

    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value) {
          url.searchParams.set(key, value);
        }
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.authToken}`,
          "Content-Type": "application/json",
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      const payload = (await response.json()) as ApiResponse<T>;

      if (!response.ok || !payload.success || payload.data === undefined) {
        throw new JarvisApiError(payload.error ?? `Reponse Jarvis invalide (${response.status}).`, response.status);
      }

      return payload.data;
    } catch (error) {
      if (error instanceof JarvisApiError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new JarvisApiError(`Timeout Jarvis apres ${this.config.requestTimeoutMs}ms.`, 504);
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async askJarvis(input: AskJarvisRequest): Promise<AskJarvisResult> {
    return this.request<AskJarvisResult>("/api/llm/ask", {
      method: "POST",
      body: input,
    });
  }

  async getProspect(prospectId: string, orgId?: string | null): Promise<ProspectDetail> {
    return this.request<ProspectDetail>(`/api/prospects/${encodeURIComponent(prospectId)}`, {
      query: {
        orgId: this.resolveOrgId(orgId),
      },
    });
  }

  async getQueue(userId: string, orgId?: string | null): Promise<QueueData> {
    return this.request<QueueData>(`/api/queue/${encodeURIComponent(userId)}`, {
      query: {
        orgId: this.resolveOrgId(orgId),
      },
    });
  }

  async analyzeDealIntelligence(input: {
    prospectId: string;
    orgId: string;
    refresh?: boolean;
  }): Promise<DealIntelligencePayload> {
    return this.request<DealIntelligencePayload>(`/api/prospects/${encodeURIComponent(input.prospectId)}/deal-intelligence`, {
      query: {
        orgId: input.orgId,
        refresh: input.refresh ? "true" : undefined,
      },
    });
  }

  async getForecastOverview(input: {
    orgId: string;
    scope?: "all" | "owner";
    hubspotOwnerId?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<ForecastOverviewPayload> {
    return this.request<ForecastOverviewPayload>("/api/forecast/overview", {
      query: {
        orgId: input.orgId,
        scope: input.scope,
        hubspotOwnerId: input.hubspotOwnerId,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
      },
    });
  }

  async getManagerDigest(period: ManagerDigestPeriod = "daily", orgId?: string | null): Promise<ManagerDigest> {
    return this.request<ManagerDigest>("/api/digest", {
      query: {
        orgId: this.resolveOrgId(orgId),
        period,
      },
    });
  }
}