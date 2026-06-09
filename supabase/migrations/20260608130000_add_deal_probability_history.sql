-- Historique date de la probabilite de closing par deal.
-- Source initiale: backfill depuis HubSpot (propertiesWithHistory).
-- Entretien: webhook deal.propertyChange sur probabilite_de__closing.
create table if not exists public.deal_probability_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  hubspot_deal_id text not null,
  hubspot_owner_id text,
  probability integer not null check (probability between 0 and 100),
  recorded_at timestamptz not null,
  source text not null default 'hubspot' check (source in ('hubspot', 'webhook')),
  created_at timestamptz not null default timezone('utc', now()),
  unique (org_id, hubspot_deal_id, recorded_at)
);

create index if not exists deal_probability_history_org_deal_idx
  on public.deal_probability_history (org_id, hubspot_deal_id, recorded_at);

create index if not exists deal_probability_history_org_owner_idx
  on public.deal_probability_history (org_id, hubspot_owner_id, recorded_at);

alter table public.deal_probability_history enable row level security;

revoke all on table public.deal_probability_history from anon, authenticated;
