create table if not exists public.hubspot_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  hubspot_contact_id text not null,
  hubspot_owner_id text,
  email text,
  name text not null,
  phone text,
  title text,
  company_name text,
  properties jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (org_id, hubspot_contact_id)
);

create table if not exists public.hubspot_companies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  hubspot_company_id text not null,
  name text,
  domain text,
  industry text,
  city text,
  country text,
  properties jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (org_id, hubspot_company_id)
);

create table if not exists public.hubspot_deals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  hubspot_deal_id text not null,
  hubspot_owner_id text,
  primary_contact_id text,
  primary_company_id text,
  associated_contact_ids text[] not null default '{}'::text[],
  associated_company_ids text[] not null default '{}'::text[],
  deal_name text,
  amount numeric(12, 2),
  pipeline text,
  deal_stage text,
  close_probability integer not null default 0 check (close_probability between 0 and 100),
  hubspot_created_at timestamptz,
  closed_at timestamptz,
  hubspot_updated_at timestamptz,
  properties jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (org_id, hubspot_deal_id)
);

create index if not exists hubspot_contacts_org_owner_idx
  on public.hubspot_contacts (org_id, hubspot_owner_id);
create index if not exists hubspot_companies_org_domain_idx
  on public.hubspot_companies (org_id, domain);
create index if not exists hubspot_deals_org_owner_updated_idx
  on public.hubspot_deals (org_id, hubspot_owner_id, hubspot_updated_at desc);
create index if not exists hubspot_deals_org_stage_idx
  on public.hubspot_deals (org_id, deal_stage);

drop trigger if exists hubspot_contacts_set_updated_at on public.hubspot_contacts;
create trigger hubspot_contacts_set_updated_at
before update on public.hubspot_contacts
for each row
execute function public.set_updated_at();

drop trigger if exists hubspot_companies_set_updated_at on public.hubspot_companies;
create trigger hubspot_companies_set_updated_at
before update on public.hubspot_companies
for each row
execute function public.set_updated_at();

drop trigger if exists hubspot_deals_set_updated_at on public.hubspot_deals;
create trigger hubspot_deals_set_updated_at
before update on public.hubspot_deals
for each row
execute function public.set_updated_at();

alter table public.hubspot_contacts enable row level security;
alter table public.hubspot_companies enable row level security;
alter table public.hubspot_deals enable row level security;

drop policy if exists "hubspot_contacts_read_org" on public.hubspot_contacts;
create policy "hubspot_contacts_read_org"
on public.hubspot_contacts
for select
to authenticated
using (public.is_current_org_member(org_id));

drop policy if exists "hubspot_contacts_insert_org" on public.hubspot_contacts;
create policy "hubspot_contacts_insert_org"
on public.hubspot_contacts
for insert
to authenticated
with check (public.is_current_org_member(org_id));

drop policy if exists "hubspot_contacts_update_org" on public.hubspot_contacts;
create policy "hubspot_contacts_update_org"
on public.hubspot_contacts
for update
to authenticated
using (public.is_current_org_member(org_id))
with check (public.is_current_org_member(org_id));

drop policy if exists "hubspot_contacts_delete_org" on public.hubspot_contacts;
create policy "hubspot_contacts_delete_org"
on public.hubspot_contacts
for delete
to authenticated
using (public.is_current_org_member(org_id));

drop policy if exists "hubspot_companies_read_org" on public.hubspot_companies;
create policy "hubspot_companies_read_org"
on public.hubspot_companies
for select
to authenticated
using (public.is_current_org_member(org_id));

drop policy if exists "hubspot_companies_insert_org" on public.hubspot_companies;
create policy "hubspot_companies_insert_org"
on public.hubspot_companies
for insert
to authenticated
with check (public.is_current_org_member(org_id));

drop policy if exists "hubspot_companies_update_org" on public.hubspot_companies;
create policy "hubspot_companies_update_org"
on public.hubspot_companies
for update
to authenticated
using (public.is_current_org_member(org_id))
with check (public.is_current_org_member(org_id));

drop policy if exists "hubspot_companies_delete_org" on public.hubspot_companies;
create policy "hubspot_companies_delete_org"
on public.hubspot_companies
for delete
to authenticated
using (public.is_current_org_member(org_id));

drop policy if exists "hubspot_deals_read_org" on public.hubspot_deals;
create policy "hubspot_deals_read_org"
on public.hubspot_deals
for select
to authenticated
using (public.is_current_org_member(org_id));

drop policy if exists "hubspot_deals_insert_org" on public.hubspot_deals;
create policy "hubspot_deals_insert_org"
on public.hubspot_deals
for insert
to authenticated
with check (public.is_current_org_member(org_id));

drop policy if exists "hubspot_deals_update_org" on public.hubspot_deals;
create policy "hubspot_deals_update_org"
on public.hubspot_deals
for update
to authenticated
using (public.is_current_org_member(org_id))
with check (public.is_current_org_member(org_id));

drop policy if exists "hubspot_deals_delete_org" on public.hubspot_deals;
create policy "hubspot_deals_delete_org"
on public.hubspot_deals
for delete
to authenticated
using (public.is_current_org_member(org_id));
