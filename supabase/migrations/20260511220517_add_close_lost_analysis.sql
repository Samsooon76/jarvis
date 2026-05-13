alter table public.hubspot_deals
add column if not exists deal_lifecycle_status text,
add column if not exists is_closed_deal boolean;

alter table public.hubspot_deals
drop constraint if exists hubspot_deals_lifecycle_status_check;

alter table public.hubspot_deals
add constraint hubspot_deals_lifecycle_status_check
check (deal_lifecycle_status in ('pending', 'won', 'lost') or deal_lifecycle_status is null);

update public.hubspot_deals as deal
set
  deal_lifecycle_status = coalesce(
    deal.deal_lifecycle_status,
    case
      when lower(coalesce(deal.deal_stage_label, deal.deal_stage, '')) like '%lost%'
        or lower(coalesce(deal.deal_stage_label, deal.deal_stage, '')) like '%perdu%'
        or stage.probability = 0
      then 'lost'
      when lower(coalesce(deal.deal_stage_label, deal.deal_stage, '')) like '%won%'
        or lower(coalesce(deal.deal_stage_label, deal.deal_stage, '')) like '%gagn%'
        or stage.probability >= 1
      then 'won'
      when stage.is_closed = false
      then 'pending'
      else null
    end
  ),
  is_closed_deal = coalesce(
    deal.is_closed_deal,
    case
      when stage.is_closed is not null then stage.is_closed
      when lower(coalesce(deal.deal_stage_label, deal.deal_stage, '')) like '%closed%'
        or lower(coalesce(deal.deal_stage_label, deal.deal_stage, '')) like '%perdu%'
        or lower(coalesce(deal.deal_stage_label, deal.deal_stage, '')) like '%gagn%'
      then true
      else null
    end
  )
from public.hubspot_deal_stages as stage
where deal.org_id = stage.org_id
  and deal.pipeline = stage.pipeline_id
  and deal.deal_stage = stage.stage_id;

create index if not exists hubspot_deals_org_lifecycle_closed_idx
  on public.hubspot_deals (org_id, deal_lifecycle_status, closed_at desc);

create index if not exists hubspot_deals_org_owner_lifecycle_closed_idx
  on public.hubspot_deals (org_id, hubspot_owner_id, deal_lifecycle_status, closed_at desc);

create table if not exists public.close_lost_deal_analyses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  hubspot_deal_id text not null,
  provider text not null,
  model text not null,
  input_hash text not null,
  analysis jsonb not null,
  source_synced_at timestamptz,
  generated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (org_id, hubspot_deal_id, provider, model, input_hash)
);

create index if not exists close_lost_deal_analyses_lookup_idx
  on public.close_lost_deal_analyses (org_id, hubspot_deal_id, provider, model, generated_at desc);

create index if not exists close_lost_deal_analyses_org_generated_idx
  on public.close_lost_deal_analyses (org_id, generated_at desc);

drop trigger if exists close_lost_deal_analyses_set_updated_at on public.close_lost_deal_analyses;
create trigger close_lost_deal_analyses_set_updated_at
before update on public.close_lost_deal_analyses
for each row
execute function public.set_updated_at();

alter table public.close_lost_deal_analyses enable row level security;

drop policy if exists "close_lost_deal_analyses_read_org" on public.close_lost_deal_analyses;
create policy "close_lost_deal_analyses_read_org"
on public.close_lost_deal_analyses
for select
to authenticated
using (public.is_current_org_member(org_id));

drop policy if exists "close_lost_deal_analyses_insert_org" on public.close_lost_deal_analyses;
create policy "close_lost_deal_analyses_insert_org"
on public.close_lost_deal_analyses
for insert
to authenticated
with check (public.is_current_org_member(org_id));

drop policy if exists "close_lost_deal_analyses_update_org" on public.close_lost_deal_analyses;
create policy "close_lost_deal_analyses_update_org"
on public.close_lost_deal_analyses
for update
to authenticated
using (public.is_current_org_member(org_id))
with check (public.is_current_org_member(org_id));

drop policy if exists "close_lost_deal_analyses_delete_org" on public.close_lost_deal_analyses;
create policy "close_lost_deal_analyses_delete_org"
on public.close_lost_deal_analyses
for delete
to authenticated
using (public.is_current_org_member(org_id));

create table if not exists public.close_lost_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  scope text not null default 'sales_ae' check (scope in ('sales_ae', 'owner')),
  hubspot_owner_id text,
  sales_ae_owner_ids text[] not null default '{}'::text[],
  provider text not null,
  model text not null,
  date_from date not null,
  date_to date not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  progress integer not null default 0 check (progress between 0 and 100),
  current_step text not null default 'Queued',
  logs jsonb not null default '[]'::jsonb,
  deal_count integer not null default 0,
  analyzed_count integer not null default 0,
  reused_count integer not null default 0,
  failed_count integer not null default 0,
  result jsonb,
  error text,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists close_lost_analysis_runs_org_created_idx
  on public.close_lost_analysis_runs (org_id, created_at desc);

create index if not exists close_lost_analysis_runs_org_scope_idx
  on public.close_lost_analysis_runs (org_id, scope, hubspot_owner_id, date_from, date_to, created_at desc);

drop trigger if exists close_lost_analysis_runs_set_updated_at on public.close_lost_analysis_runs;
create trigger close_lost_analysis_runs_set_updated_at
before update on public.close_lost_analysis_runs
for each row
execute function public.set_updated_at();

alter table public.close_lost_analysis_runs enable row level security;

drop policy if exists "close_lost_analysis_runs_read_org" on public.close_lost_analysis_runs;
create policy "close_lost_analysis_runs_read_org"
on public.close_lost_analysis_runs
for select
to authenticated
using (public.is_current_org_member(org_id));

drop policy if exists "close_lost_analysis_runs_insert_org" on public.close_lost_analysis_runs;
create policy "close_lost_analysis_runs_insert_org"
on public.close_lost_analysis_runs
for insert
to authenticated
with check (public.is_current_org_member(org_id));

drop policy if exists "close_lost_analysis_runs_update_org" on public.close_lost_analysis_runs;
create policy "close_lost_analysis_runs_update_org"
on public.close_lost_analysis_runs
for update
to authenticated
using (public.is_current_org_member(org_id))
with check (public.is_current_org_member(org_id));

drop policy if exists "close_lost_analysis_runs_delete_org" on public.close_lost_analysis_runs;
create policy "close_lost_analysis_runs_delete_org"
on public.close_lost_analysis_runs
for delete
to authenticated
using (public.is_current_org_member(org_id));

grant select, insert, update, delete on public.close_lost_deal_analyses to authenticated;
grant select, insert, update, delete on public.close_lost_analysis_runs to authenticated;
