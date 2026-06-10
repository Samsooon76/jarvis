-- Forecast vs realite: photographies quotidiennes des deals ouverts pour mesurer
-- a posteriori la fiabilite des previsions (par sales, par source CRM/IA, par
-- categorie de verdict). Capture 100% deterministe: les probas/categories IA
-- sont lues depuis les caches existants, aucune analyse n'est declenchee.
create table if not exists public.forecast_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  snapshot_date date not null,
  hubspot_deal_id text not null,
  owner_user_id uuid references public.users (id) on delete set null,
  hubspot_owner_id text,
  deal_stage text,
  amount numeric(12, 2),
  close_date date,
  crm_probability numeric(5, 2),
  ai_probability numeric(5, 2),
  ai_category text check (ai_category in ('commit', 'bestCase', 'atRisk', 'slipping') or ai_category is null),
  forecast_period text,
  -- Resolution a la cloture du deal (webhook deal.stage): on fige la realite.
  outcome text check (outcome in ('won', 'lost') or outcome is null),
  final_amount numeric(12, 2),
  closed_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (org_id, hubspot_deal_id, snapshot_date)
);

create index if not exists forecast_snapshots_org_date_idx
  on public.forecast_snapshots (org_id, snapshot_date desc);

create index if not exists forecast_snapshots_org_deal_idx
  on public.forecast_snapshots (org_id, hubspot_deal_id);

create index if not exists forecast_snapshots_unresolved_idx
  on public.forecast_snapshots (org_id, hubspot_deal_id)
  where resolved_at is null;

-- Index de purge / retention (18 mois, geree cote backend).
create index if not exists forecast_snapshots_created_idx
  on public.forecast_snapshots (created_at);

-- RLS: acces reserve au backend (service role); l'API garde manager/admin
-- (+ le sales pour sa propre vue).
alter table public.forecast_snapshots enable row level security;

revoke all on table public.forecast_snapshots from anon, authenticated;
