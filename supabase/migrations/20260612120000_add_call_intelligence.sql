create table if not exists public.call_ai_analyses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  call_id uuid not null references public.calls (id) on delete cascade,
  user_id uuid references public.users (id) on delete set null,
  prospect_id uuid references public.prospects (id) on delete set null,
  provider text not null default 'deterministic',
  model text not null default 'call-intelligence-v1',
  input_hash text not null,
  source_kind text not null default 'transcript' check (source_kind in ('transcript', 'notes', 'summary')),
  analysis jsonb not null,
  generated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (call_id, input_hash)
);

create index if not exists call_ai_analyses_org_generated_idx
  on public.call_ai_analyses (org_id, generated_at desc);

create index if not exists call_ai_analyses_call_generated_idx
  on public.call_ai_analyses (call_id, generated_at desc);

create index if not exists call_ai_analyses_user_generated_idx
  on public.call_ai_analyses (org_id, user_id, generated_at desc);

create table if not exists public.call_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  requested_by_user_id uuid references public.users (id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  scope jsonb not null default '{}'::jsonb,
  processed_count integer not null default 0,
  analyzed_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  error text,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists call_analysis_runs_org_created_idx
  on public.call_analysis_runs (org_id, created_at desc);

alter table public.call_ai_analyses enable row level security;
alter table public.call_analysis_runs enable row level security;

drop policy if exists "call_ai_analyses_read_org" on public.call_ai_analyses;
create policy "call_ai_analyses_read_org"
on public.call_ai_analyses
for select
to authenticated
using (public.is_current_org_member(org_id));

drop policy if exists "call_ai_analyses_write_org" on public.call_ai_analyses;
create policy "call_ai_analyses_write_org"
on public.call_ai_analyses
for all
to authenticated
using (public.is_current_org_member(org_id))
with check (public.is_current_org_member(org_id));

drop policy if exists "call_analysis_runs_read_org" on public.call_analysis_runs;
create policy "call_analysis_runs_read_org"
on public.call_analysis_runs
for select
to authenticated
using (public.is_current_org_member(org_id));

drop policy if exists "call_analysis_runs_write_org" on public.call_analysis_runs;
create policy "call_analysis_runs_write_org"
on public.call_analysis_runs
for all
to authenticated
using (public.is_current_org_member(org_id))
with check (public.is_current_org_member(org_id));
