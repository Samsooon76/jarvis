export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export type ProspectPriority = "urgent" | "important" | "routine";

export type QueueProspect = {
  id: string;
  name: string;
  title: string;
  company: string;
  dealAmount: number;
  dealStage: string;
  closeProbability: number;
  closeDate: string | null;
  lastContactAt: string;
  nextAction: string;
  reason: string;
  priority: ProspectPriority;
  email?: string | null;
  phone?: string | null;
  dealName?: string | null;
  hubspotDealId?: string | null;
};

export type QueueData = {
  userId: string;
  generatedAt: string;
  prospects: QueueProspect[];
};

export type HubSpotConnectionStatus = {
  orgId: string;
  connected: boolean;
  hubspotPortalId: string | null;
  prospectCount: number;
  dealCount: number;
  lastSyncedAt: string | null;
};
