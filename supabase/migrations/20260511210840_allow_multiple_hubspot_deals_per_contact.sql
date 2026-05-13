alter table public.prospects
drop constraint if exists prospects_org_id_hubspot_contact_id_key;

alter table public.prospects
add column if not exists hubspot_prospect_key text
generated always as (coalesce(hubspot_deal_id, 'contact:' || hubspot_contact_id)) stored;

create unique index if not exists prospects_org_hubspot_prospect_key_idx
  on public.prospects (org_id, hubspot_prospect_key);

create index if not exists prospects_org_hubspot_contact_id_idx
  on public.prospects (org_id, hubspot_contact_id);
