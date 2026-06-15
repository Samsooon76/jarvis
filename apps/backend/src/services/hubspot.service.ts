export type {
  CreateHubSpotTaskInput,
  CreatedHubSpotTask,
  DealLifecycleStatus,
  HubSpotActivitySnapshot,
  HubSpotActivityType,
  HubSpotContactSnapshotItem,
  HubSpotCrmSyncSnapshot,
  HubSpotDealActivityDebug,
  HubSpotDealHistory,
  HubSpotDealHistoryItem,
  HubSpotLeadRecord,
  HubSpotOwner,
  HubSpotPropertyHistoryEntry,
  HubSpotProspectSyncItem,
  HubSpotTask,
  HubSpotTaskListItem,
  HubSpotTaskPriority,
  HubSpotTaskStatus,
} from "./hubspot/types.js";

import { fetchActivity } from "./hubspot/activities.js";
import { fetchAssociatedDealIdsForCompany } from "./hubspot/companies.js";
import { fetchAssociatedDealIdsForContact, fetchContactSnapshotsByIds } from "./hubspot/contacts.js";
import {
  fetchDealActivityDebug,
  fetchDealCount,
  fetchDealCountByOwner,
  fetchDealHistory,
  fetchDealPropertyHistory,
  fetchDealSalesActivityIds,
} from "./hubspot/deals.js";
import { fetchLeadById, fetchLeadsByOwner } from "./hubspot/leads.js";
import {
  buildAuthorizationUrl,
  decodeState,
  exchangeCodeForToken,
  fetchTokenInfo,
  refreshAccessToken,
} from "./hubspot/oauth.js";
import { fetchOwners } from "./hubspot/owners.js";
import {
  computePriorityScore,
  fetchCrmSnapshot,
  fetchCrmSnapshotByOwners,
  fetchProspects,
  fetchProspectsByContactNames,
  fetchProspectsByOwner,
} from "./hubspot/prospects.js";
import {
  completeTask,
  createTask,
  fetchTask,
  fetchTaskListItem,
  fetchTasksByOwner,
  markTaskCompleted,
  updateTaskPriority,
} from "./hubspot/tasks.js";

export const hubSpotService = {
  buildAuthorizationUrl,
  decodeState,
  exchangeCodeForToken,
  refreshAccessToken,
  fetchTokenInfo,
  fetchCrmSnapshot,
  fetchProspects,
  fetchProspectsByContactNames,
  fetchProspectsByOwner,
  fetchCrmSnapshotByOwners,
  fetchDealHistory,
  fetchDealPropertyHistory,
  fetchDealActivityDebug,
  fetchActivity,
  fetchAssociatedDealIdsForContact,
  fetchAssociatedDealIdsForCompany,
  fetchDealSalesActivityIds,
  fetchDealCount,
  fetchDealCountByOwner,
  fetchOwners,
  fetchLeadById,
  fetchLeadsByOwner,
  fetchContactsByIds: fetchContactSnapshotsByIds,
  createTask,
  fetchTask,
  fetchTaskListItem,
  fetchTasksByOwner,
  updateTaskPriority,
  markTaskCompleted,
  completeTask,
  computePriorityScore,
};
