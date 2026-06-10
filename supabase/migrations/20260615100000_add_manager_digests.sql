-- Digest quotidien/hebdo manager: synthese LLM "ce qui a bouge" par destinataire.
-- Source: donnees deja calculees (pulse_notifications, forecast_synthesis, daily_kpis).
-- Une ligne par (org, destinataire, periode, date de debut, hash d'input); le hash
-- permet de re-servir le digest sans appel LLM tant que les inputs n'ont pas change.
create table if not exists public.manager_digests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  period text not null check (period in ('daily', 'weekly')),
  date_from date not null,
  date_to date not null,
  input_hash text not null,
  digest jsonb not null,
  movements jsonb not null default '[]'::jsonb,
  movement_count integer not null default 0,
  provider text not null,
  model text not null,
  generated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (org_id, user_id, period, date_from, input_hash)
);

create index if not exists manager_digests_lookup_idx
  on public.manager_digests (org_id, user_id, period, date_from desc, generated_at desc);

-- Index de purge / retention (geree cote backend).
create index if not exists manager_digests_created_idx
  on public.manager_digests (created_at);

drop trigger if exists manager_digests_set_updated_at on public.manager_digests;
create trigger manager_digests_set_updated_at
before update on public.manager_digests
for each row
execute function public.set_updated_at();

-- RLS: acces reserve au backend (service role), comme pulse_notifications.
alter table public.manager_digests enable row level security;

revoke all on table public.manager_digests from anon, authenticated;
