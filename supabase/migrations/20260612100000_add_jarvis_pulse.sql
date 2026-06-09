-- Jarvis Pulse: notifications quasi temps reel sur les changements de deals HubSpot.
-- Source: evenements webhook HubSpot deja persistes (hubspot_webhook_events).
-- Destinataires: utilisateurs admin/manager de l'organisation, selon leurs preferences.

-- Preferences Pulse par utilisateur (un reglage global + un toggle par type d'evenement).
-- Le champ jsonb `settings` reste disponible pour des seuils futurs sans nouvelle migration.
create table if not exists public.pulse_preferences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  pulse_enabled boolean not null default true,
  notify_probability boolean not null default true,
  notify_amount boolean not null default true,
  notify_stage boolean not null default true,
  notify_close_date boolean not null default true,
  notify_owner boolean not null default true,
  notify_pipeline boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (org_id, user_id)
);

drop trigger if exists pulse_preferences_set_updated_at on public.pulse_preferences;
create trigger pulse_preferences_set_updated_at
before update on public.pulse_preferences
for each row
execute function public.set_updated_at();

-- Notifications Pulse persistees par destinataire (etat lu / non-lu).
create table if not exists public.pulse_notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  -- Identifiant de l'evenement webhook source: garantit l'idempotence par destinataire.
  source_event_id uuid not null,
  event_type text not null check (
    event_type in ('probability', 'amount', 'stage', 'close_date', 'owner', 'pipeline')
  ),
  hubspot_deal_id text not null,
  deal_name text,
  title text not null,
  message text not null,
  previous_value text,
  new_value text,
  occurred_at timestamptz not null default timezone('utc', now()),
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, source_event_id)
);

create index if not exists pulse_notifications_user_created_idx
  on public.pulse_notifications (user_id, created_at desc);

create index if not exists pulse_notifications_user_unread_idx
  on public.pulse_notifications (user_id)
  where read_at is null;

-- Index de purge / retention (90 jours par defaut, geree cote backend).
create index if not exists pulse_notifications_created_idx
  on public.pulse_notifications (created_at);

-- RLS: acces reserve au backend (service role), comme le reste des tables sensibles.
alter table public.pulse_preferences enable row level security;
alter table public.pulse_notifications enable row level security;

revoke all on table public.pulse_preferences from anon, authenticated;
revoke all on table public.pulse_notifications from anon, authenticated;
