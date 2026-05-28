create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references public.users (id) on delete set null,
  prospect_id uuid references public.prospects (id) on delete set null,
  source text not null default 'generic_webhook',
  external_event_id text,
  event_type text not null check (
    event_type in (
      'call.received',
      'call.completed',
      'email.received',
      'email.sent',
      'sms.received',
      'sms.sent',
      'deal.updated'
    )
  ),
  channel text not null check (channel in ('call', 'email', 'sms', 'deal')),
  direction text check (direction in ('inbound', 'outbound', 'system') or direction is null),
  occurred_at timestamptz not null default timezone('utc', now()),
  hubspot_contact_id text,
  hubspot_deal_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.sales_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references public.users (id) on delete set null,
  prospect_id uuid references public.prospects (id) on delete set null,
  source_event_id uuid references public.activity_events (id) on delete set null,
  task_key text not null,
  task_type text not null check (
    task_type in ('respond_to_client', 'follow_up', 'post_call_next_step', 'deal_review', 'crm_update')
  ),
  title text not null,
  context text,
  reason text not null,
  scheduled_at timestamptz not null,
  estimated_duration_minutes integer not null default 20 check (estimated_duration_minutes between 5 and 240),
  priority_score numeric(10, 2) not null default 0,
  status text not null default 'pending' check (
    status in ('pending', 'snoozed', 'skipped', 'done', 'canceled')
  ),
  snoozed_until timestamptz,
  completed_at timestamptz,
  skipped_at timestamptz,
  canceled_at timestamptz,
  hubspot_contact_id text,
  hubspot_deal_id text,
  metadata jsonb not null default '{}'::jsonb,
  last_recalculated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.sales_tasks
  add column if not exists estimated_duration_minutes integer not null default 20 check (estimated_duration_minutes between 5 and 240);

create unique index if not exists activity_events_external_event_unique_idx
  on public.activity_events (org_id, source, external_event_id)
  where external_event_id is not null;

create index if not exists activity_events_org_occurred_idx
  on public.activity_events (org_id, occurred_at desc);

create index if not exists activity_events_user_occurred_idx
  on public.activity_events (user_id, occurred_at desc)
  where user_id is not null;

create index if not exists activity_events_prospect_occurred_idx
  on public.activity_events (prospect_id, occurred_at desc)
  where prospect_id is not null;

create index if not exists activity_events_hubspot_deal_idx
  on public.activity_events (org_id, hubspot_deal_id, occurred_at desc)
  where hubspot_deal_id is not null;

create unique index if not exists sales_tasks_open_task_key_idx
  on public.sales_tasks (org_id, task_key)
  where status in ('pending', 'snoozed');

create index if not exists sales_tasks_user_scheduled_idx
  on public.sales_tasks (user_id, scheduled_at asc, priority_score desc)
  where user_id is not null;

create index if not exists sales_tasks_user_status_idx
  on public.sales_tasks (user_id, status, scheduled_at asc)
  where user_id is not null;

create index if not exists sales_tasks_prospect_status_idx
  on public.sales_tasks (prospect_id, status, scheduled_at desc)
  where prospect_id is not null;

drop trigger if exists activity_events_set_updated_at on public.activity_events;
create trigger activity_events_set_updated_at
before update on public.activity_events
for each row
execute function public.set_updated_at();

drop trigger if exists sales_tasks_set_updated_at on public.sales_tasks;
create trigger sales_tasks_set_updated_at
before update on public.sales_tasks
for each row
execute function public.set_updated_at();

alter table public.activity_events enable row level security;
alter table public.sales_tasks enable row level security;

drop policy if exists "activity_events_read_org" on public.activity_events;
create policy "activity_events_read_org"
on public.activity_events
for select
to authenticated
using (public.is_current_org_member(org_id));

drop policy if exists "activity_events_insert_org" on public.activity_events;
create policy "activity_events_insert_org"
on public.activity_events
for insert
to authenticated
with check (public.is_current_org_member(org_id));

drop policy if exists "sales_tasks_read_org" on public.sales_tasks;
create policy "sales_tasks_read_org"
on public.sales_tasks
for select
to authenticated
using (public.is_current_org_member(org_id));

drop policy if exists "sales_tasks_insert_org" on public.sales_tasks;
create policy "sales_tasks_insert_org"
on public.sales_tasks
for insert
to authenticated
with check (public.is_current_org_member(org_id));

drop policy if exists "sales_tasks_update_org" on public.sales_tasks;
create policy "sales_tasks_update_org"
on public.sales_tasks
for update
to authenticated
using (public.is_current_org_member(org_id))
with check (public.is_current_org_member(org_id));
