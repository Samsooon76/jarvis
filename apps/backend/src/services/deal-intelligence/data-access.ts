import { getSupabaseAdmin } from "../../db/client.js";
import { loadLocalHubSpotDealHistory } from "../hubspot-activity-history.service.js";
import { hubSpotService } from "../hubspot.service.js";
import type { DealIntelligenceAnalysis } from "../llm/llm.provider.js";
import { isMissingDealAiAnalysesTableError, isUuid, parseCompositeProspectId } from "./shared.js";
import type {
  ActionSnapshotRow,
  DealIntelligenceContext,
  HubSpotCompanySnapshotRow,
  HubSpotContactSnapshotRow,
  HubSpotDealSnapshotRow,
  OwnerUserSnapshotRow,
  ProspectRow,
  ResolvedDealTarget,
} from "./types.js";

export const resolveDealTarget = async (prospectId: string, context: DealIntelligenceContext): Promise<ResolvedDealTarget> => {
  const supabase = getSupabaseAdmin();

  if (isUuid(prospectId)) {
    const { data, error } = await supabase
      .from("prospects")
      .select(
        "id, org_id, owner_user_id, hubspot_contact_id, hubspot_deal_id, name, email, phone, company, title, deal_stage, deal_amount, close_probability, last_contact_at, next_action, next_action_at, raw_data, synced_at",
      )
      .eq("id", prospectId)
      .maybeSingle();

    if (error) {
      throw new Error(`Impossible de charger le prospect: ${error.message}`);
    }

    const prospect = data as ProspectRow | null;

    if (!prospect) {
      throw new Error("Prospect introuvable.");
    }

    if (!prospect.hubspot_deal_id) {
      throw new Error("Ce prospect n'a pas de deal HubSpot associe.");
    }

    return {
      prospect,
      orgId: prospect.org_id,
      hubspotContactId: prospect.hubspot_contact_id,
      hubspotDealId: prospect.hubspot_deal_id,
    };
  }

  const compositeId = parseCompositeProspectId(prospectId);
  const orgId = context.orgId?.trim() || null;
  const contextHubSpotDealId = context.hubspotDealId?.trim() || null;

  if (!orgId) {
    throw new Error("orgId est obligatoire pour analyser un deal non synchronise localement.");
  }

  if (!contextHubSpotDealId && !compositeId?.hubspotDealId) {
    throw new Error("hubspotDealId est obligatoire pour analyser ce deal.");
  }

  return {
    prospect: null,
    orgId,
    hubspotContactId: compositeId?.hubspotContactId ?? null,
    hubspotDealId: contextHubSpotDealId ?? compositeId?.hubspotDealId ?? "",
  };
};

export const loadHubSpotDealSnapshot = async (
  orgId: string,
  hubspotDealId: string,
): Promise<HubSpotDealSnapshotRow | null> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("hubspot_deals")
    .select(
      "hubspot_owner_id, primary_contact_id, primary_company_id, deal_name, amount, deal_stage, deal_stage_label, close_probability, closed_at, hubspot_created_at, hubspot_updated_at, properties, synced_at",
    )
    .eq("org_id", orgId)
    .eq("hubspot_deal_id", hubspotDealId)
    .maybeSingle();

  if (error) {
    if (isMissingDealAiAnalysesTableError(error)) {
      return null;
    }

    throw new Error(`Impossible de charger le snapshot HubSpot du deal: ${error.message}`);
  }

  return data as HubSpotDealSnapshotRow | null;
};

export const loadHubSpotContactSnapshot = async (
  orgId: string,
  hubspotContactId: string | null,
): Promise<HubSpotContactSnapshotRow | null> => {
  if (!hubspotContactId) {
    return null;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("hubspot_contacts")
    .select("email, name, phone, title, company_name, properties")
    .eq("org_id", orgId)
    .eq("hubspot_contact_id", hubspotContactId)
    .maybeSingle();

  if (error) {
    if (isMissingDealAiAnalysesTableError(error)) {
      return null;
    }

    throw new Error(`Impossible de charger le contact HubSpot du deal: ${error.message}`);
  }

  return data as HubSpotContactSnapshotRow | null;
};

export const loadHubSpotCompanySnapshot = async (
  orgId: string,
  hubspotCompanyId: string | null,
): Promise<HubSpotCompanySnapshotRow | null> => {
  if (!hubspotCompanyId) {
    return null;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("hubspot_companies")
    .select("name, domain, industry, country, properties")
    .eq("org_id", orgId)
    .eq("hubspot_company_id", hubspotCompanyId)
    .maybeSingle();

  if (error) {
    if (isMissingDealAiAnalysesTableError(error)) {
      return null;
    }

    throw new Error(`Impossible de charger l'entreprise HubSpot du deal: ${error.message}`);
  }

  return data as HubSpotCompanySnapshotRow | null;
};

export const loadOwnerUserName = async (ownerUserId: string | null): Promise<string | null> => {
  if (!ownerUserId) {
    return null;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("users")
    .select("name")
    .eq("id", ownerUserId)
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de charger le proprietaire du deal: ${error.message}`);
  }

  return (data as OwnerUserSnapshotRow | null)?.name ?? null;
};

export const loadPendingActions = async (prospectId: string | null, limit = 3): Promise<ActionSnapshotRow[]> => {
  if (!prospectId || !isUuid(prospectId)) {
    return [];
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("actions")
    .select("title, description, due_at, status, ai_generated")
    .eq("prospect_id", prospectId)
    .in("status", ["pending", "snoozed"])
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) {
    throw new Error(`Impossible de charger les prochaines actions du deal: ${error.message}`);
  }

  return (data ?? []) as ActionSnapshotRow[];
};

export const loadDealHistoryForAnalysis = async (
  orgId: string,
  accessToken: string,
  hubspotDealId: string,
) => {
  return hubSpotService.fetchDealHistory(accessToken, hubspotDealId).catch((error: unknown) => {
    return loadLocalHubSpotDealHistory(orgId, hubspotDealId).then((localHistory) => {
      if (localHistory) {
        return localHistory;
      }

      throw error;
    });
  });
};

export const updateProspectWithAnalysis = async (prospect: ProspectRow | null, analysis: DealIntelligenceAnalysis): Promise<void> => {
  if (!prospect) {
    return;
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("prospects")
    .update({
      ai_summary: analysis.whyNow,
      next_action: analysis.suggestedMove,
      ai_priority_score: analysis.closeWonProbability,
    })
    .eq("id", prospect.id);

  if (error) {
    throw new Error(`Analyse IA sauvegardee, mais prospect non mis a jour: ${error.message}`);
  }
};
