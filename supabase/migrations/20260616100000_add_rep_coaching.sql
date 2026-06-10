-- Coaching IA par commercial: profil forces/faiblesses par sales, calcule a
-- partir de donnees deja en cache (deals HubSpot, analyses close-lost, daily_kpis).
-- Les stats deterministes sont recalculees a chaque lecture; seule la synthese
-- LLM est persistee ici, avec un cache long (TTL 7 jours) par input_hash.
create table if not exists public.rep_coaching_analyses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  target_user_id uuid not null references public.users (id) on delete cascade,
  date_from date not null,
  date_to date not null,
  stats jsonb not null,
  analysis jsonb not null,
  provider text not null,
  model text not null,
  input_hash text not null,
  generated_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (org_id, target_user_id, provider, model, input_hash)
);

create index if not exists rep_coaching_analyses_lookup_idx
  on public.rep_coaching_analyses (org_id, target_user_id, provider, model, generated_at desc);

create index if not exists rep_coaching_analyses_org_generated_idx
  on public.rep_coaching_analyses (org_id, generated_at desc);

drop trigger if exists rep_coaching_analyses_set_updated_at on public.rep_coaching_analyses;
create trigger rep_coaching_analyses_set_updated_at
before update on public.rep_coaching_analyses
for each row
execute function public.set_updated_at();

-- RLS: acces reserve au backend (service role); l'API garde l'acces aux
-- managers/admins uniquement (le sales ne voit pas son profil en v1).
alter table public.rep_coaching_analyses enable row level security;

revoke all on table public.rep_coaching_analyses from anon, authenticated;
