create table if not exists public.task_ai_analyses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  hubspot_task_id text not null,
  hubspot_deal_id text,
  hubspot_contact_id text,
  prospect_id uuid references public.prospects (id) on delete set null,
  provider text not null,
  model text not null,
  input_hash text not null,
  task_snapshot jsonb not null default '{}'::jsonb,
  analysis jsonb not null,
  generated_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (org_id, hubspot_task_id, provider, model, input_hash)
);

create index if not exists task_ai_analyses_org_task_generated_idx
  on public.task_ai_analyses (org_id, hubspot_task_id, generated_at desc);

create index if not exists task_ai_analyses_org_deal_generated_idx
  on public.task_ai_analyses (org_id, hubspot_deal_id, generated_at desc)
  where hubspot_deal_id is not null;

drop trigger if exists task_ai_analyses_set_updated_at on public.task_ai_analyses;
create trigger task_ai_analyses_set_updated_at
before update on public.task_ai_analyses
for each row
execute function public.set_updated_at();

alter table public.task_ai_analyses enable row level security;

revoke all on table public.task_ai_analyses from anon, authenticated;

drop policy if exists "task_ai_analyses_service_role_all" on public.task_ai_analyses;
create policy "task_ai_analyses_service_role_all"
on public.task_ai_analyses
for all
to service_role
using (true)
with check (true);
