import { getSupabaseAdmin } from "../db/client.js";
import type { HubSpotDealHistory, HubSpotDealHistoryItem } from "./hubspot.service.js";

type HubSpotDealRow = {
  hubspot_deal_id: string;
  primary_contact_id: string | null;
  primary_company_id: string | null;
  associated_contact_ids: string[];
  associated_company_ids: string[];
  deal_name: string | null;
  amount: number | string | null;
  deal_stage: string | null;
  deal_stage_label?: string | null;
  close_probability: number | string | null;
  closed_at: string | null;
  hubspot_created_at: string | null;
  hubspot_updated_at: string | null;
  hubspot_owner_id: string | null;
  properties: unknown;
};

type HubSpotCompanyRow = {
  hubspot_company_id: string;
  name: string | null;
  domain: string | null;
  industry: string | null;
  city?: string | null;
  country: string | null;
  properties: unknown;
};

type HubSpotContactRow = {
  hubspot_contact_id: string;
  name: string;
  email: string | null;
};

type HubSpotActivityRow = {
  hubspot_activity_id: string;
  activity_type: "call" | "communication" | "email" | "note" | "meeting" | "sms";
  activity_channel: string | null;
  hubspot_owner_id: string | null;
  occurred_at: string | null;
  title: string | null;
  body: string | null;
  status: string | null;
  direction: string | null;
  disposition: string | null;
  properties: unknown;
};

type JsonRecord = Record<string, unknown>;
type SupabaseErrorLike = {
  code?: string;
  message?: string;
};

const asRecord = (value: unknown): JsonRecord | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;

const readString = (record: JsonRecord | null, key: string): string | null => {
  const value = record?.[key];

  return typeof value === "string" && value.trim() ? value : null;
};

const isMissingRealtimeMirrorError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const typedError = error as SupabaseErrorLike;
  const message = typedError.message ?? "";

  return (
    typedError.code === "42P01" ||
    typedError.code === "PGRST205" ||
    message.includes("hubspot_activities") ||
    message.includes("hubspot_activity_deal_links")
  );
};

const buildContextSummary = (entries: Array<[label: string, value: string | number | null | undefined]>): string | null => {
  const lines = entries
    .map(([label, value]) => {
      const normalizedValue = typeof value === "number" ? String(value) : value?.trim();

      return normalizedValue ? `${label}: ${normalizedValue}` : null;
    })
    .filter((value): value is string => Boolean(value));

  return lines.length > 0 ? lines.join("\n") : null;
};

const stripMarkup = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const stripped = value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  return stripped || null;
};

const normalizeActivityType = (activityType: HubSpotActivityRow["activity_type"]): HubSpotDealHistoryItem["type"] => {
  if (activityType === "communication") {
    return "sms";
  }

  return activityType;
};

const buildDealHistoryItem = (deal: HubSpotDealRow): HubSpotDealHistoryItem => ({
  id: deal.hubspot_deal_id,
  type: "deal",
  timestamp: deal.hubspot_created_at ?? deal.hubspot_updated_at ?? deal.closed_at,
  title: deal.deal_name ?? `Deal ${deal.hubspot_deal_id}`,
  body: "Creation du deal dans HubSpot.",
  metadata: {
    amount: deal.amount === null ? null : String(deal.amount),
    stage: deal.deal_stage_label ?? deal.deal_stage,
    ownerId: deal.hubspot_owner_id,
    probability: deal.close_probability === null ? null : String(deal.close_probability),
    createdAt: deal.hubspot_created_at,
    closedAt: deal.closed_at,
    lastModifiedAt: deal.hubspot_updated_at,
  },
});

const buildActivityHistoryItem = (activity: HubSpotActivityRow): HubSpotDealHistoryItem => ({
  id: activity.hubspot_activity_id,
  type: normalizeActivityType(activity.activity_type),
  timestamp: activity.occurred_at,
  title: activity.title ?? `${activity.activity_type} ${activity.hubspot_activity_id}`,
  body: stripMarkup(activity.body),
  metadata: {
    status: activity.status,
    direction: activity.direction,
    disposition: activity.disposition,
    channel: activity.activity_channel,
    ownerId: activity.hubspot_owner_id,
  },
});

const buildDealContext = (deal: HubSpotDealRow | null): string | null => {
  if (!deal) {
    return null;
  }

  return buildContextSummary([
    ["Nom du deal", deal.deal_name],
    ["Stage", deal.deal_stage_label ?? deal.deal_stage],
    ["Montant", deal.amount === null ? null : String(deal.amount)],
    ["Probabilite", deal.close_probability === null ? null : String(deal.close_probability)],
    ["Date de closing", deal.closed_at],
    ["Derniere modification", deal.hubspot_updated_at],
  ]);
};

const buildCompanyContext = (company: HubSpotCompanyRow | null): string | null => {
  if (!company) {
    return null;
  }

  const properties = asRecord(company.properties);

  return buildContextSummary([
    ["Entreprise", company.name],
    ["Domaine", company.domain],
    ["Secteur", company.industry],
    ["Ville", company.city ?? readString(properties, "city")],
    ["Pays", company.country],
    ["Employes", readString(properties, "numberofemployees")],
    ["Revenu annuel", readString(properties, "annualrevenue")],
    ["Lifecycle stage", readString(properties, "lifecyclestage")],
  ]);
};

export const loadLocalHubSpotDealHistory = async (
  orgId: string,
  hubspotDealId: string,
): Promise<HubSpotDealHistory | null> => {
  const supabase = getSupabaseAdmin();
  const { data: dealData, error: dealError } = await supabase
    .from("hubspot_deals")
    .select(
      "hubspot_deal_id, primary_contact_id, primary_company_id, associated_contact_ids, associated_company_ids, deal_name, amount, deal_stage, deal_stage_label, close_probability, closed_at, hubspot_created_at, hubspot_updated_at, hubspot_owner_id, properties",
    )
    .eq("org_id", orgId)
    .eq("hubspot_deal_id", hubspotDealId)
    .maybeSingle();

  if (dealError) {
    if (isMissingRealtimeMirrorError(dealError)) {
      return null;
    }

    throw new Error(`Impossible de charger le deal HubSpot local: ${dealError.message}`);
  }

  const deal = dealData as HubSpotDealRow | null;
  const contactIds = deal?.associated_contact_ids ?? [];
  const companyId = deal?.primary_company_id ?? deal?.associated_company_ids?.[0] ?? null;
  const [contactsResult, companyResult, activitiesResult] = await Promise.all([
    contactIds.length > 0
      ? supabase
          .from("hubspot_contacts")
          .select("hubspot_contact_id, name, email")
          .eq("org_id", orgId)
          .in("hubspot_contact_id", contactIds)
      : Promise.resolve({ data: [], error: null }),
    companyId
      ? supabase
          .from("hubspot_companies")
          .select("hubspot_company_id, name, domain, industry, city, country, properties")
          .eq("org_id", orgId)
          .eq("hubspot_company_id", companyId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("hubspot_activities")
      .select(
        "hubspot_activity_id, activity_type, activity_channel, hubspot_owner_id, occurred_at, title, body, status, direction, disposition, properties",
      )
      .eq("org_id", orgId)
      .contains("associated_deal_ids", [hubspotDealId])
      .order("occurred_at", { ascending: true, nullsFirst: true })
      .limit(200),
  ]);

  if (contactsResult.error) {
    if (isMissingRealtimeMirrorError(contactsResult.error)) {
      return null;
    }

    throw new Error(`Impossible de charger les contacts HubSpot locaux: ${contactsResult.error.message}`);
  }

  if (companyResult.error) {
    if (isMissingRealtimeMirrorError(companyResult.error)) {
      return null;
    }

    throw new Error(`Impossible de charger l'entreprise HubSpot locale: ${companyResult.error.message}`);
  }

  if (activitiesResult.error) {
    if (isMissingRealtimeMirrorError(activitiesResult.error)) {
      return null;
    }

    throw new Error(`Impossible de charger les activites HubSpot locales: ${activitiesResult.error.message}`);
  }

  const activities = (activitiesResult.data ?? []) as HubSpotActivityRow[];

  if (!deal && activities.length === 0) {
    return null;
  }

  const company = companyResult.data as HubSpotCompanyRow | null;
  const contacts = (contactsResult.data ?? []) as HubSpotContactRow[];
  const timeline = [
    ...(deal ? [buildDealHistoryItem(deal)] : []),
    ...activities.map((activity) => buildActivityHistoryItem(activity)),
  ].sort((left, right) => {
    const leftTime = left.timestamp ? new Date(left.timestamp).getTime() : 0;
    const rightTime = right.timestamp ? new Date(right.timestamp).getTime() : 0;

    return leftTime - rightTime;
  });

  return {
    dealId: hubspotDealId,
    dealName: deal?.deal_name ?? null,
    companyName: company?.name ?? null,
    dealContext: buildDealContext(deal),
    companyContext: buildCompanyContext(company),
    contactNames: contacts.map((contact) => contact.name || contact.email || `Contact ${contact.hubspot_contact_id}`),
    timeline,
  };
};
