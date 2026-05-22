alter table private.organization_integrations
add column if not exists last_sync_started_at timestamptz,
add column if not exists last_sync_finished_at timestamptz,
add column if not exists last_sync_status text check (last_sync_status in ('queued', 'running', 'completed', 'failed')),
add column if not exists last_sync_error text;

create table if not exists public.backend_jobs (
  id text primary key,
  org_id uuid references public.organizations (id) on delete cascade,
  type text not null,
  status text not null check (status in ('queued', 'running', 'completed', 'failed', 'skipped')),
  progress integer not null default 0 check (progress between 0 and 100),
  current_step text not null default '',
  logs jsonb not null default '[]'::jsonb,
  result jsonb,
  error text,
  started_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz
);

create index if not exists backend_jobs_org_type_updated_idx
  on public.backend_jobs (org_id, type, updated_at desc);

create table if not exists public.hubspot_sync_status (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  started_at timestamptz,
  finished_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  job_id text references public.backend_jobs (id) on delete set null,
  progress integer not null default 0 check (progress between 0 and 100),
  current_step text not null default '',
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists hubspot_sync_status_updated_idx
  on public.hubspot_sync_status (updated_at desc);

alter table public.backend_jobs enable row level security;
alter table public.hubspot_sync_status enable row level security;

drop policy if exists "backend_jobs_read_org" on public.backend_jobs;
create policy "backend_jobs_read_org"
on public.backend_jobs
for select
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.org_id = backend_jobs.org_id
      and u.auth_user_id = auth.uid()
  )
);

drop policy if exists "hubspot_sync_status_read_org" on public.hubspot_sync_status;
create policy "hubspot_sync_status_read_org"
on public.hubspot_sync_status
for select
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.org_id = hubspot_sync_status.org_id
      and u.auth_user_id = auth.uid()
  )
);

create or replace function public.get_user_queue(target_user_id uuid, max_rows integer default 50)
returns table (
  id uuid,
  name text,
  title text,
  company text,
  deal_amount numeric,
  deal_stage text,
  close_probability integer,
  last_contact_at timestamptz,
  next_action text,
  ai_summary text,
  ai_priority_score numeric,
  snoozed_until timestamptz,
  skipped_at timestamptz,
  created_at timestamptz,
  synced_at timestamptz,
  email text,
  phone text,
  hubspot_deal_id text,
  raw_data jsonb
)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    p.name,
    p.title,
    p.company,
    p.deal_amount,
    p.deal_stage,
    p.close_probability,
    p.last_contact_at,
    p.next_action,
    p.ai_summary,
    p.ai_priority_score,
    p.snoozed_until,
    p.skipped_at,
    p.created_at,
    p.synced_at,
    p.email,
    p.phone,
    p.hubspot_deal_id,
    p.raw_data
  from public.prospects p
  join public.users u on u.id = target_user_id and u.org_id = p.org_id
  where p.owner_user_id = target_user_id
    and p.skipped_at is null
    and (p.snoozed_until is null or p.snoozed_until <= timezone('utc', now()))
  order by p.ai_priority_score desc, p.last_contact_at asc nulls first
  limit greatest(1, least(coalesce(max_rows, 50), 200));
$$;

revoke all on function public.get_user_queue(uuid, integer) from public;
grant execute on function public.get_user_queue(uuid, integer) to authenticated, service_role;
