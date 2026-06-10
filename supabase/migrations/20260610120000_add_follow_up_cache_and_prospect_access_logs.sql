create table if not exists public.follow_up_task_ai_analyses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  hubspot_deal_id text not null,
  provider text not null,
  model text not null,
  input_hash text not null,
  recommendation jsonb not null,
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, prospect_id, hubspot_deal_id, provider, model, input_hash)
);

create index if not exists follow_up_task_ai_analyses_lookup_idx
  on public.follow_up_task_ai_analyses (org_id, prospect_id, hubspot_deal_id, provider, model, input_hash, expires_at desc);

drop trigger if exists follow_up_task_ai_analyses_set_updated_at on public.follow_up_task_ai_analyses;
create trigger follow_up_task_ai_analyses_set_updated_at
before update on public.follow_up_task_ai_analyses
for each row execute function public.set_updated_at();

alter table public.follow_up_task_ai_analyses enable row level security;

drop policy if exists "follow_up_task_ai_analyses_read_org" on public.follow_up_task_ai_analyses;
create policy "follow_up_task_ai_analyses_read_org"
on public.follow_up_task_ai_analyses
for select
using (org_id in (select public.current_user_org_id()));

drop policy if exists "follow_up_task_ai_analyses_write_org" on public.follow_up_task_ai_analyses;
create policy "follow_up_task_ai_analyses_write_org"
on public.follow_up_task_ai_analyses
for all
using (org_id in (select public.current_user_org_id()))
with check (org_id in (select public.current_user_org_id()));

create table if not exists public.prospect_access_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  prospect_id uuid references public.prospects(id) on delete cascade,
  source text not null,
  accessed_at timestamptz not null default now()
);

create index if not exists prospect_access_logs_org_accessed_idx
  on public.prospect_access_logs (org_id, accessed_at desc);

create index if not exists prospect_access_logs_prospect_idx
  on public.prospect_access_logs (prospect_id, accessed_at desc);

alter table public.prospect_access_logs enable row level security;

drop policy if exists "prospect_access_logs_read_org" on public.prospect_access_logs;
create policy "prospect_access_logs_read_org"
on public.prospect_access_logs
for select
using (org_id in (select public.current_user_org_id()));

drop policy if exists "prospect_access_logs_insert_org" on public.prospect_access_logs;
create policy "prospect_access_logs_insert_org"
on public.prospect_access_logs
for insert
with check (org_id in (select public.current_user_org_id()));

grant select, insert, update, delete on public.follow_up_task_ai_analyses to authenticated;
grant select, insert on public.prospect_access_logs to authenticated;
