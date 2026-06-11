export type HubSpotTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  hub_id?: number;
  token_type?: string;
};

export type HubSpotTokenInfoResponse = {
  hub_id?: number;
  hub_domain?: string;
  user_id?: number;
  app_id?: number;
  expires_in?: number;
};

export type HubSpotErrorPayload = {
  status?: string;
  message?: string;
  errorType?: string;
  correlationId?: string;
  policyName?: string;
  groupName?: string;
};

export type HubSpotCollectionResponse<T> = {
  results: T[];
  paging?: {
    next?: {
      after?: string;
    };
  };
};

export type HubSpotSearchResponse<T> = {
  results: T[];
  total: number;
  paging?: {
    next?: {
      after?: string;
    };
  };
};

export type HubSpotAssociationResponse = {
  results?: Array<{ toObjectId?: string | number; toObjectIdStr?: string }>;
  paging?: {
    next?: {
      after?: string;
    };
  };
};

export type HubSpotBatchAssociationResponse = {
  results?: Array<{
    from?: {
      id?: string | number;
    };
    to?: Array<{
      toObjectId?: string | number;
    }>;
  }>;
};

export type HubSpotContact = {
  id: string;
  properties: Record<string, string | null | undefined>;
  associations?: {
    deals?: {
      results: Array<{ id: string }>;
    };
  };
};

export type HubSpotDeal = {
  id: string;
  properties: Record<string, string | null | undefined>;
  associations?: {
    contacts?: {
      results: Array<{ id: string }>;
    };
    companies?: {
      results: Array<{ id: string }>;
    };
  };
};

export type HubSpotCompany = {
  id: string;
  properties: Record<string, string | null | undefined>;
};

export type HubSpotLead = {
  id: string;
  properties: Record<string, string | null | undefined>;
  associations?: {
    contacts?: {
      results: Array<{ id: string }>;
    };
    companies?: {
      results: Array<{ id: string }>;
    };
  };
};

export type HubSpotLeadRecord = {
  id: string;
  hubspotOwnerId: string | null;
  name: string;
  pipelineId: string | null;
  pipelineLabel: string | null;
  phaseId: string | null;
  phaseLabel: string | null;
  associatedContactIds: string[];
  associatedCompanyIds: string[];
  createdAt: string | null;
  updatedAt: string | null;
  properties: Record<string, string | null>;
};

export type HubSpotDealStageMetadata = {
  isClosed?: string;
  probability?: string;
};

export type HubSpotDealStage = {
  id?: string | null;
  stageId?: string | null;
  label?: string | null;
  displayOrder?: number | null;
  metadata?: HubSpotDealStageMetadata | null;
};

export type HubSpotDealPipeline = {
  id?: string | null;
  pipelineId?: string | null;
  label?: string | null;
  stages?: HubSpotDealStage[];
};

export type HubSpotNote = {
  id: string;
  properties: Record<string, string | null | undefined>;
};

export type HubSpotCall = {
  id: string;
  properties: Record<string, string | null | undefined>;
};

export type HubSpotMeeting = {
  id: string;
  properties: Record<string, string | null | undefined>;
};

export type HubSpotEmail = {
  id: string;
  properties: Record<string, string | null | undefined>;
};

export type HubSpotCommunication = {
  id: string;
  properties: Record<string, string | null | undefined>;
};

export type HubSpotActivityType = "call" | "communication" | "email" | "note" | "meeting";

export type HubSpotActivityAssociations = {
  contacts?: {
    results: Array<{ id: string }>;
  };
  companies?: {
    results: Array<{ id: string }>;
  };
  deals?: {
    results: Array<{ id: string }>;
  };
};

export type HubSpotActivityRecord = {
  id: string;
  properties: Record<string, string | null | undefined>;
  associations?: HubSpotActivityAssociations;
};

export type HubSpotOwner = {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  userId?: number | null;
  userIdIncludingInactive?: number | null;
  archived?: boolean;
  teams?: Array<{
    id: string;
    name: string;
    primary?: boolean;
  }>;
};

export type HubSpotProspectSyncItem = {
  hubspotContactId: string;
  hubspotDealId: string | null;
  name: string;
  company: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
  dealStage: string | null;
  dealStageLabel: string | null;
  dealAmount: number | null;
  closeProbability: number;
  closedAt: string | null;
  dealLifecycleStatus: DealLifecycleStatus | null;
  isClosedDeal: boolean | null;
  lastContactAt: string | null;
  ownerHubSpotId: string | null;
  rawData: {
    source: "hubspot";
    hubspotContactId: string;
    hubspotDealId: string | null;
    dealName: string | null;
    dealStageLabel: string | null;
    closedAt: string | null;
    dealLifecycleStatus: DealLifecycleStatus | null;
    isClosedDeal: boolean | null;
    hubspotOwnerId: string | null;
    contactOwnerHubSpotId: string | null;
    dealOwnerHubSpotId: string | null;
    contact: {
      id: string;
      properties: Record<string, string | null>;
    };
    associatedContactIds: string[];
    deal: {
      id: string | null;
      properties: Record<string, string | null>;
    } | null;
    company: {
      id: string;
      properties: Record<string, string | null>;
    } | null;
  };
};

export type HubSpotCrmSyncSnapshot = {
  contacts: Array<{
    id: string;
    properties: Record<string, string | null>;
  }>;
  deals: Array<{
    id: string;
    properties: Record<string, string | null>;
    associatedContactIds: string[];
    associatedCompanyIds: string[];
  }>;
  companies: Array<{
    id: string;
    properties: Record<string, string | null>;
  }>;
  leads: HubSpotLeadRecord[];
  dealStages: Array<{
    pipelineId: string;
    pipelineLabel: string | null;
    stageId: string;
    stageLabel: string;
    displayOrder: number | null;
    isClosed: boolean | null;
    probability: number | null;
  }>;
  prospects: HubSpotProspectSyncItem[];
};

export type HubSpotContactSnapshotItem = HubSpotCrmSyncSnapshot["contacts"][number];

export type DealLifecycleStatus = "pending" | "won" | "lost";

export type HubSpotPropertyHistoryEntry = {
  value: string | null;
  timestamp: string;
};

export type HubSpotDealHistoryItem = {
  id: string;
  type: "deal" | "note" | "call" | "meeting" | "email" | "sms" | "communication" | "task";
  timestamp: string | null;
  title: string;
  body: string | null;
  metadata: Record<string, string | null>;
};

export type HubSpotDealHistory = {
  dealId: string;
  dealName: string | null;
  companyName: string | null;
  dealContext: string | null;
  companyContext: string | null;
  contactNames: string[];
  timeline: HubSpotDealHistoryItem[];
};

export type HubSpotDealActivityDebug = {
  dealId: string;
  directAssociationCounts: Record<"notes" | "calls" | "meetings" | "emails" | "communications" | "tasks", number>;
  contactAssociationCounts: Record<"notes" | "calls" | "meetings" | "emails" | "communications" | "tasks", number>;
  companyAssociationCounts: Record<"notes" | "calls" | "meetings" | "emails" | "communications" | "tasks", number>;
  totalUniqueActivityCounts: Record<"notes" | "calls" | "meetings" | "emails" | "communications" | "sms" | "tasks", number>;
  timelineCount: number;
  timelineTypes: Record<HubSpotDealHistoryItem["type"], number>;
};

export type CreateHubSpotTaskInput = {
  title: string;
  body: string;
  dueAt: string;
  ownerHubSpotId?: string | null;
  priority?: HubSpotTaskPriority | null;
  associations: Array<{
    objectType: "contact" | "company" | "deal";
    objectId: string;
  }>;
};

export type CreatedHubSpotTask = {
  taskId: string;
  title: string;
  dueAt: string;
};

export type HubSpotTask = {
  id: string;
  properties: Record<string, string | null | undefined>;
  associations?: {
    contacts?: {
      results: Array<{ id: string }>;
    };
    companies?: {
      results: Array<{ id: string }>;
    };
    deals?: {
      results: Array<{ id: string }>;
    };
  };
};

export type HubSpotTaskPriority = "low" | "medium" | "high";

export type HubSpotTaskStatus = "not_started" | "in_progress" | "waiting" | "completed" | "deferred" | "unknown";

export type HubSpotTaskListItem = {
  id: string;
  title: string;
  body: string | null;
  status: HubSpotTaskStatus;
  priority: HubSpotTaskPriority | null;
  dueAt: string | null;
  ownerHubSpotId: string | null;
  taskType: string | null;
  contactName: string | null;
  contactEmail: string | null;
  companyName: string | null;
  dealName: string | null;
  createdAt: string | null;
  associatedContactIds: string[];
  associatedCompanyIds: string[];
  associatedDealIds: string[];
};

export type HubSpotActivitySnapshot = {
  id: string;
  activityType: HubSpotActivityType;
  channel: string | null;
  occurredAt: string | null;
  title: string;
  body: string | null;
  metadata: Record<string, string | null>;
  properties: Record<string, string | null>;
  associatedContactIds: string[];
  associatedCompanyIds: string[];
  associatedDealIds: string[];
};
