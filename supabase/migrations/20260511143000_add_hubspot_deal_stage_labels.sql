alter table public.hubspot_deals
add column if not exists pipeline_label text,
add column if not exists deal_stage_label text;

create table if not exists public.hubspot_deal_stages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  pipeline_id text not null,
  pipeline_label text,
  stage_id text not null,
  stage_label text not null,
  display_order integer,
  is_closed boolean,
  probability numeric(5, 4),
  synced_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (org_id, pipeline_id, stage_id)
);

create index if not exists hubspot_deal_stages_org_stage_idx
  on public.hubspot_deal_stages (org_id, stage_id);

drop trigger if exists hubspot_deal_stages_set_updated_at on public.hubspot_deal_stages;
create trigger hubspot_deal_stages_set_updated_at
before update on public.hubspot_deal_stages
for each row
execute function public.set_updated_at();

alter table public.hubspot_deal_stages enable row level security;

drop policy if exists "hubspot_deal_stages_read_org" on public.hubspot_deal_stages;
create policy "hubspot_deal_stages_read_org"
on public.hubspot_deal_stages
for select
to authenticated
using (public.is_current_org_member(org_id));

drop policy if exists "hubspot_deal_stages_insert_org" on public.hubspot_deal_stages;
create policy "hubspot_deal_stages_insert_org"
on public.hubspot_deal_stages
for insert
to authenticated
with check (public.is_current_org_member(org_id));

drop policy if exists "hubspot_deal_stages_update_org" on public.hubspot_deal_stages;
create policy "hubspot_deal_stages_update_org"
on public.hubspot_deal_stages
for update
to authenticated
using (public.is_current_org_member(org_id))
with check (public.is_current_org_member(org_id));

drop policy if exists "hubspot_deal_stages_delete_org" on public.hubspot_deal_stages;
create policy "hubspot_deal_stages_delete_org"
on public.hubspot_deal_stages
for delete
to authenticated
using (public.is_current_org_member(org_id));
