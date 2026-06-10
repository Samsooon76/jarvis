-- Boucle Win Analysis: miroir du close-lost pour les deals GAGNES.
-- 1. Benchmark quantitatif deterministe (SQL, 0 LLM) des patterns de victoire,
--    reinjecte dans le scoring queue et les prompts existants.
-- 2. Runs d'analyse qualitative LLM (1 appel par deal gagne, cache; 1 appel portfolio par run).

create table if not exists public.win_pattern_benchmarks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- 'all' ou un libelle de pipeline (segments heterogenes -> benchmark par pipeline).
  segment text not null default 'all',
  date_from date not null,
  date_to date not null,
  sample_size integer not null default 0,
  benchmark jsonb not null,
  computed_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (org_id, segment)
);

drop trigger if exists win_pattern_benchmarks_set_updated_at on public.win_pattern_benchmarks;
create trigger win_pattern_benchmarks_set_updated_at
before update on public.win_pattern_benchmarks
for each row
execute function public.set_updated_at();

-- Runs d'analyse close won: copie du schema close_lost_analysis_runs.
create table if not exists public.close_won_analysis_runs (
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
  progress integer not null default 0,
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

create index if not exists close_won_analysis_runs_org_created_idx
  on public.close_won_analysis_runs (org_id, created_at desc);

drop trigger if exists close_won_analysis_runs_set_updated_at on public.close_won_analysis_runs;
create trigger close_won_analysis_runs_set_updated_at
before update on public.close_won_analysis_runs
for each row
execute function public.set_updated_at();

-- RLS: acces reserve au backend (service role), comme pulse/manager_digests.
alter table public.win_pattern_benchmarks enable row level security;
alter table public.close_won_analysis_runs enable row level security;

revoke all on table public.win_pattern_benchmarks from anon, authenticated;
revoke all on table public.close_won_analysis_runs from anon, authenticated;
