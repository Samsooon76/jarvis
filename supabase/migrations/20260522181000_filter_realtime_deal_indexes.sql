create index if not exists hubspot_deals_realtime_scope_idx
  on public.hubspot_deals (org_id, deal_lifecycle_status, hubspot_owner_id, hubspot_deal_id);

create index if not exists users_org_hubspot_owner_not_null_idx
  on public.users (org_id, hubspot_owner_id)
  where hubspot_owner_id is not null;
