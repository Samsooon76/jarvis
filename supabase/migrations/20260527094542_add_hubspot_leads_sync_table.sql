create table if not exists public.hubspot_leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  hubspot_lead_id text not null,
  hubspot_owner_id text,
  associated_contact_ids text[] not null default '{}'::text[],
  associated_company_ids text[] not null default '{}'::text[],
  name text not null,
  pipeline_id text,
  pipeline_label text,
  phase_id text,
  phase_label text,
  hubspot_created_at timestamptz,
  hubspot_updated_at timestamptz,
  properties jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (org_id, hubspot_lead_id)
);

create index if not exists hubspot_leads_org_owner_updated_idx
  on public.hubspot_leads (org_id, hubspot_owner_id, hubspot_updated_at desc);

create index if not exists hubspot_leads_org_phase_idx
  on public.hubspot_leads (org_id, phase_id);

drop trigger if exists hubspot_leads_set_updated_at on public.hubspot_leads;
create trigger hubspot_leads_set_updated_at
before update on public.hubspot_leads
for each row
execute function public.set_updated_at();

grant select on public.hubspot_leads to authenticated;
grant select, insert, update, delete on public.hubspot_leads to service_role;

alter table public.hubspot_leads enable row level security;

drop policy if exists "hubspot_leads_read_org" on public.hubspot_leads;
create policy "hubspot_leads_read_org"
on public.hubspot_leads
for select
to authenticated
using (public.is_current_org_member(org_id));

drop policy if exists "hubspot_leads_insert_org" on public.hubspot_leads;
create policy "hubspot_leads_insert_org"
on public.hubspot_leads
for insert
to authenticated
with check (public.is_current_org_member(org_id));

drop policy if exists "hubspot_leads_update_org" on public.hubspot_leads;
create policy "hubspot_leads_update_org"
on public.hubspot_leads
for update
to authenticated
using (public.is_current_org_member(org_id))
with check (public.is_current_org_member(org_id));

drop policy if exists "hubspot_leads_delete_org" on public.hubspot_leads;
create policy "hubspot_leads_delete_org"
on public.hubspot_leads
for delete
to authenticated
using (public.is_current_org_member(org_id));
