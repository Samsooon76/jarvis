create extension if not exists pgcrypto;

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  hubspot_portal_id text,
  telephony_provider text check (
    telephony_provider in ('aircall', 'ringover', 'onoff')
    or telephony_provider is null
  ),
  plan text not null default 'trial' check (plan in ('trial', 'starter', 'pro', 'team')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  org_id uuid references public.organizations (id) on delete set null,
  email text not null unique,
  name text not null,
  role text not null default 'sales' check (role in ('sales', 'manager', 'admin')),
  hubspot_owner_id text,
  avatar_url text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists private.organization_integrations (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  hubspot_access_token text,
  telephony_api_key text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  owner_user_id uuid references public.users (id) on delete set null,
  hubspot_contact_id text not null,
  hubspot_deal_id text,
  name text not null,
  company text,
  title text,
  phone text,
  email text,
  deal_stage text,
  deal_amount numeric(12, 2),
  close_probability integer not null default 0 check (close_probability between 0 and 100),
  last_contact_at timestamptz,
  next_action text,
  next_action_at timestamptz,
  ai_summary text,
  ai_priority_score numeric(10, 2) not null default 0,
  tags text[] not null default '{}'::text[],
  raw_data jsonb not null default '{}'::jsonb,
  snoozed_until timestamptz,
  skipped_at timestamptz,
  synced_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (org_id, hubspot_contact_id)
);

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references public.users (id) on delete set null,
  prospect_id uuid references public.prospects (id) on delete set null,
  external_call_id text,
  direction text not null default 'outbound' check (direction in ('inbound', 'outbound')),
  status text check (status in ('completed', 'missed', 'voicemail')),
  duration_seconds integer,
  started_at timestamptz,
  ended_at timestamptz,
  transcript text,
  ai_summary text,
  ai_sentiment text check (ai_sentiment in ('positive', 'neutral', 'negative')),
  ai_objections text[] not null default '{}'::text[],
  ai_next_steps jsonb not null default '[]'::jsonb,
  ai_close_probability_change integer,
  created_at timestamptz not null default timezone('utc', now()),
  unique (org_id, external_call_id)
);

create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references public.users (id) on delete set null,
  prospect_id uuid references public.prospects (id) on delete set null,
  call_id uuid references public.calls (id) on delete set null,
  type text not null check (type in ('email', 'call', 'meeting', 'task', 'crm_update')),
  title text not null,
  description text,
  status text not null default 'pending' check (status in ('pending', 'done', 'skipped', 'snoozed')),
  due_at timestamptz,
  completed_at timestamptz,
  ai_generated boolean not null default true,
  hubspot_synced boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.daily_kpis (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  date date not null,
  calls_made integer not null default 0,
  calls_connected integer not null default 0,
  calls_duration_total integer not null default 0,
  emails_sent integer not null default 0,
  meetings_booked integer not null default 0,
  actions_completed integer not null default 0,
  actions_pending integer not null default 0,
  deals_moved integer not null default 0,
  pipeline_value_added numeric(12, 2) not null default 0,
  contact_rate numeric(5, 2) not null default 0,
  avg_call_duration integer not null default 0,
  ai_coaching_notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, date)
);

create table if not exists public.usage_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  started_at timestamptz not null default timezone('utc', now()),
  ended_at timestamptz,
  actions_taken jsonb not null default '[]'::jsonb
);

create index if not exists users_org_id_idx on public.users (org_id);
create index if not exists prospects_org_owner_priority_idx
  on public.prospects (org_id, owner_user_id, ai_priority_score desc, last_contact_at asc);
create index if not exists prospects_sync_idx on public.prospects (org_id, synced_at desc);
create index if not exists calls_org_user_started_at_idx on public.calls (org_id, user_id, started_at desc);
create index if not exists actions_org_user_due_at_idx on public.actions (org_id, user_id, due_at asc);
create index if not exists daily_kpis_org_date_idx on public.daily_kpis (org_id, date desc);
create index if not exists usage_sessions_user_started_at_idx on public.usage_sessions (user_id, started_at desc);

create or replace function public.current_user_record_id()
returns uuid
language sql
stable
set search_path = public
as $$
  select u.id
  from public.users as u
  where u.auth_user_id = auth.uid()
  limit 1;
$$;

create or replace function public.current_org_id()
returns uuid
language sql
stable
set search_path = public
as $$
  select u.org_id
  from public.users as u
  where u.auth_user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_same_user(target_user_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.users as u
    where u.id = target_user_id
      and u.auth_user_id = auth.uid()
  );
$$;

create or replace function public.is_current_org_member(target_org_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.users as u
    where u.auth_user_id = auth.uid()
      and u.org_id = target_org_id
  );
$$;

create or replace function public.is_current_org_manager(target_org_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.users as u
    where u.auth_user_id = auth.uid()
      and u.org_id = target_org_id
      and u.role in ('manager', 'admin')
  );
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (
    auth_user_id,
    email,
    name,
    avatar_url
  )
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Nouveau commercial'
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (auth_user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_auth_user();

create trigger organizations_set_updated_at
before update on public.organizations
for each row
execute function public.set_updated_at();

create trigger users_set_updated_at
before update on public.users
for each row
execute function public.set_updated_at();

create trigger organization_integrations_set_updated_at
before update on private.organization_integrations
for each row
execute function public.set_updated_at();

create trigger prospects_set_updated_at
before update on public.prospects
for each row
execute function public.set_updated_at();

create trigger actions_set_updated_at
before update on public.actions
for each row
execute function public.set_updated_at();

create trigger daily_kpis_set_updated_at
before update on public.daily_kpis
for each row
execute function public.set_updated_at();

alter table public.organizations enable row level security;
alter table public.users enable row level security;
alter table public.prospects enable row level security;
alter table public.calls enable row level security;
alter table public.actions enable row level security;
alter table public.daily_kpis enable row level security;
alter table public.usage_sessions enable row level security;

create policy "organizations_select_own_org"
on public.organizations
for select
to authenticated
using (public.is_current_org_member(id));

create policy "users_select_self_or_manager"
on public.users
for select
to authenticated
using (
  id = public.current_user_record_id()
  or public.is_current_org_manager(org_id)
);

create policy "users_update_self"
on public.users
for update
to authenticated
using (id = public.current_user_record_id())
with check (id = public.current_user_record_id());

create policy "prospects_read_org"
on public.prospects
for select
to authenticated
using (public.is_current_org_member(org_id));

create policy "prospects_write_org"
on public.prospects
for all
to authenticated
using (public.is_current_org_member(org_id))
with check (public.is_current_org_member(org_id));

create policy "calls_read_org"
on public.calls
for select
to authenticated
using (public.is_current_org_member(org_id));

create policy "calls_write_org"
on public.calls
for all
to authenticated
using (public.is_current_org_member(org_id))
with check (public.is_current_org_member(org_id));

create policy "actions_read_org"
on public.actions
for select
to authenticated
using (public.is_current_org_member(org_id));

create policy "actions_write_org"
on public.actions
for all
to authenticated
using (public.is_current_org_member(org_id))
with check (public.is_current_org_member(org_id));

create policy "daily_kpis_read_self_or_manager"
on public.daily_kpis
for select
to authenticated
using (
  public.is_same_user(user_id)
  or public.is_current_org_manager(org_id)
);

create policy "daily_kpis_write_manager"
on public.daily_kpis
for all
to authenticated
using (public.is_current_org_manager(org_id))
with check (public.is_current_org_manager(org_id));

create policy "usage_sessions_read_self"
on public.usage_sessions
for select
to authenticated
using (public.is_same_user(user_id));

create policy "usage_sessions_write_self"
on public.usage_sessions
for all
to authenticated
using (public.is_same_user(user_id))
with check (public.is_same_user(user_id));

insert into public.organizations (
  id,
  name,
  hubspot_portal_id,
  telephony_provider,
  plan
)
values (
  '11111111-1111-4111-8111-111111111111',
  'Jarvis Demo',
  'portal-demo-jarvis',
  'aircall',
  'trial'
)
on conflict (id) do nothing;

insert into public.users (
  id,
  org_id,
  email,
  name,
  role,
  settings
)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'claire.moreau@jarvis.demo',
  'Claire Moreau',
  'sales',
  '{"timezone":"Europe/Paris"}'::jsonb
)
on conflict (email) do nothing;

insert into public.prospects (
  id,
  org_id,
  owner_user_id,
  hubspot_contact_id,
  hubspot_deal_id,
  name,
  company,
  title,
  phone,
  email,
  deal_stage,
  deal_amount,
  close_probability,
  last_contact_at,
  next_action,
  next_action_at,
  ai_summary,
  ai_priority_score,
  tags,
  raw_data
)
values
  (
    '33333333-3333-4333-8333-333333333331',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'hs-contact-1001',
    'hs-deal-5001',
    'Claire Moreau',
    'Nexa Cloud',
    'VP Sales',
    '+33 6 12 34 56 78',
    'claire.moreau@nexacloud.fr',
    'Demo planifiee',
    24000,
    72,
    '2026-03-21T09:15:00+00:00',
    'Appeler pour confirmer les besoins avant la demo de mardi',
    '2026-03-27T08:30:00+00:00',
    'Budget valide, timing rapide et attente d''une reponse Enterprise plus structuree.',
    92,
    array['urgent', 'enterprise'],
    '{"source":"hubspot","engagement_signals":3}'::jsonb
  ),
  (
    '33333333-3333-4333-8333-333333333332',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'hs-contact-1002',
    'hs-deal-5002',
    'Thomas Garnier',
    'Klymb',
    'Head of RevOps',
    '+33 6 98 76 54 32',
    'thomas.garnier@klymb.io',
    'Qualification',
    18000,
    48,
    '2026-03-18T14:40:00+00:00',
    'Relancer avec une synthese ROI et un cas client SaaS',
    '2026-03-27T10:00:00+00:00',
    'Deal actif mais encore bloque sur le business case et le chiffrage du ROI.',
    67,
    array['important', 'revops'],
    '{"source":"hubspot","engagement_signals":2}'::jsonb
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'hs-contact-1003',
    'hs-deal-5003',
    'Sarah Benali',
    'Orbyte',
    'Directrice Commerciale',
    '+33 6 11 22 33 44',
    'sarah.benali@orbyte.fr',
    'Premier contact',
    9500,
    26,
    '2026-03-12T11:05:00+00:00',
    'Envoyer un email de suivi avec disponibilites pour un discovery call',
    '2026-03-28T09:00:00+00:00',
    'Lead engage mais sans next step bloque depuis deux semaines.',
    34,
    array['routine'],
    '{"source":"hubspot","engagement_signals":1}'::jsonb
  )
on conflict (org_id, hubspot_contact_id) do update
set
  owner_user_id = excluded.owner_user_id,
  hubspot_deal_id = excluded.hubspot_deal_id,
  name = excluded.name,
  company = excluded.company,
  title = excluded.title,
  phone = excluded.phone,
  email = excluded.email,
  deal_stage = excluded.deal_stage,
  deal_amount = excluded.deal_amount,
  close_probability = excluded.close_probability,
  last_contact_at = excluded.last_contact_at,
  next_action = excluded.next_action,
  next_action_at = excluded.next_action_at,
  ai_summary = excluded.ai_summary,
  ai_priority_score = excluded.ai_priority_score,
  tags = excluded.tags,
  raw_data = excluded.raw_data,
  synced_at = timezone('utc', now());
