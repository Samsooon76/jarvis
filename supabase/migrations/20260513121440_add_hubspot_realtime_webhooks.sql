create table if not exists public.hubspot_webhook_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete cascade,
  portal_id text not null,
  app_id text,
  subscription_id text,
  subscription_type text not null,
  event_id text,
  event_fingerprint text not null,
  object_type_id text,
  object_id text,
  property_name text,
  property_value text,
  occurred_at timestamptz,
  attempt_number integer,
  payload jsonb not null default '{}'::jsonb,
  processing_status text not null default 'queued' check (
    processing_status in ('queued', 'processing', 'completed', 'failed', 'ignored')
  ),
  error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (event_fingerprint)
);

create table if not exists public.hubspot_activities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  hubspot_activity_id text not null,
  activity_type text not null check (
    activity_type in ('call', 'communication', 'email', 'note', 'meeting', 'sms')
  ),
  activity_channel text,
  hubspot_owner_id text,
  occurred_at timestamptz,
  title text,
  body text,
  direction text,
  status text,
  disposition text,
  source_object_type_id text,
  source_object_type text,
  properties jsonb not null default '{}'::jsonb,
  associated_contact_ids text[] not null default '{}'::text[],
  associated_company_ids text[] not null default '{}'::text[],
  associated_deal_ids text[] not null default '{}'::text[],
  last_hubspot_event_at timestamptz,
  synced_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (org_id, activity_type, hubspot_activity_id)
);

create table if not exists public.hubspot_activity_deal_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  activity_type text not null check (
    activity_type in ('call', 'communication', 'email', 'note', 'meeting', 'sms')
  ),
  hubspot_activity_id text not null,
  hubspot_deal_id text not null,
  link_source text not null default 'direct' check (
    link_source in ('direct', 'contact_or_company', 'association')
  ),
  last_seen_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (org_id, activity_type, hubspot_activity_id, hubspot_deal_id)
);

create table if not exists public.hubspot_realtime_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  hubspot_deal_id text not null,
  status text not null default 'queued' check (
    status in ('queued', 'running', 'completed', 'failed', 'skipped')
  ),
  reason text,
  scheduled_for timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz,
  trigger_event_ids uuid[] not null default '{}'::uuid[],
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists hubspot_webhook_events_org_created_idx
  on public.hubspot_webhook_events (org_id, created_at desc);

create index if not exists hubspot_webhook_events_org_status_idx
  on public.hubspot_webhook_events (org_id, processing_status, created_at desc);

create index if not exists hubspot_webhook_events_portal_created_idx
  on public.hubspot_webhook_events (portal_id, created_at desc);

create index if not exists hubspot_activities_org_occurred_idx
  on public.hubspot_activities (org_id, occurred_at desc);

create index if not exists hubspot_activities_org_contact_idx
  on public.hubspot_activities using gin (associated_contact_ids);

create index if not exists hubspot_activities_org_company_idx
  on public.hubspot_activities using gin (associated_company_ids);

create index if not exists hubspot_activities_org_deal_idx
  on public.hubspot_activities using gin (associated_deal_ids);

create index if not exists hubspot_activity_deal_links_org_deal_idx
  on public.hubspot_activity_deal_links (org_id, hubspot_deal_id, last_seen_at desc);

create index if not exists hubspot_realtime_analysis_runs_org_created_idx
  on public.hubspot_realtime_analysis_runs (org_id, created_at desc);

create index if not exists hubspot_realtime_analysis_runs_org_status_idx
  on public.hubspot_realtime_analysis_runs (org_id, status, scheduled_for asc);

create unique index if not exists hubspot_realtime_analysis_runs_one_queued_idx
  on public.hubspot_realtime_analysis_runs (org_id, hubspot_deal_id)
  where status = 'queued';

drop trigger if exists hubspot_webhook_events_set_updated_at on public.hubspot_webhook_events;
create trigger hubspot_webhook_events_set_updated_at
before update on public.hubspot_webhook_events
for each row
execute function public.set_updated_at();

drop trigger if exists hubspot_activities_set_updated_at on public.hubspot_activities;
create trigger hubspot_activities_set_updated_at
before update on public.hubspot_activities
for each row
execute function public.set_updated_at();

drop trigger if exists hubspot_activity_deal_links_set_updated_at on public.hubspot_activity_deal_links;
create trigger hubspot_activity_deal_links_set_updated_at
before update on public.hubspot_activity_deal_links
for each row
execute function public.set_updated_at();

drop trigger if exists hubspot_realtime_analysis_runs_set_updated_at on public.hubspot_realtime_analysis_runs;
create trigger hubspot_realtime_analysis_runs_set_updated_at
before update on public.hubspot_realtime_analysis_runs
for each row
execute function public.set_updated_at();

alter table public.hubspot_webhook_events enable row level security;
alter table public.hubspot_activities enable row level security;
alter table public.hubspot_activity_deal_links enable row level security;
alter table public.hubspot_realtime_analysis_runs enable row level security;

revoke all on table public.hubspot_webhook_events from anon, authenticated;
revoke all on table public.hubspot_activities from anon, authenticated;
revoke all on table public.hubspot_activity_deal_links from anon, authenticated;
revoke all on table public.hubspot_realtime_analysis_runs from anon, authenticated;
