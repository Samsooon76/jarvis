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

export type PulseEventType = "probability" | "amount" | "stage" | "close_date" | "owner" | "pipeline";

export type PulseNotification = {
  id: string;
  eventType: PulseEventType;
  hubspotDealId: string;
  dealName: string | null;
  title: string;
  message: string;
  previousValue: string | null;
  newValue: string | null;
  occurredAt: string;
  readAt: string | null;
  createdAt: string;
};

export type PulseNotificationList = {
  notifications: PulseNotification[];
  unreadCount: number;
};

export type PulseEventPreferences = Record<PulseEventType, boolean>;

export type PulsePreferences = {
  pulseEnabled: boolean;
  events: PulseEventPreferences;
};
