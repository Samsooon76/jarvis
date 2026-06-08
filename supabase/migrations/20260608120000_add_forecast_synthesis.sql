-- Synthese forecast IA au niveau du portefeuille (classement des deals + plan d'action).
-- Une ligne par (org, scope, owner, periode, provider, model); upsert deterministe.
create table if not exists public.forecast_synthesis (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  scope text not null default 'all' check (scope in ('all', 'owner')),
  hubspot_owner_id text not null default '',
  date_from date not null,
  date_to date not null,
  provider text not null,
  model text not null,
  input_hash text not null,
  analysis jsonb not null,
  generated_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (org_id, scope, hubspot_owner_id, date_from, date_to, provider, model)
);

create index if not exists forecast_synthesis_lookup_idx
  on public.forecast_synthesis (org_id, scope, hubspot_owner_id, date_from, date_to, provider, model, generated_at desc);

create index if not exists forecast_synthesis_org_generated_idx
  on public.forecast_synthesis (org_id, generated_at desc);

drop trigger if exists forecast_synthesis_set_updated_at on public.forecast_synthesis;
create trigger forecast_synthesis_set_updated_at
before update on public.forecast_synthesis
for each row
execute function public.set_updated_at();

alter table public.forecast_synthesis enable row level security;

drop policy if exists "forecast_synthesis_read_org" on public.forecast_synthesis;
create policy "forecast_synthesis_read_org"
on public.forecast_synthesis
for select
to authenticated
using (public.is_current_org_member(org_id));

drop policy if exists "forecast_synthesis_insert_org" on public.forecast_synthesis;
create policy "forecast_synthesis_insert_org"
on public.forecast_synthesis
for insert
to authenticated
with check (public.is_current_org_member(org_id));

drop policy if exists "forecast_synthesis_update_org" on public.forecast_synthesis;
create policy "forecast_synthesis_update_org"
on public.forecast_synthesis
for update
to authenticated
using (public.is_current_org_member(org_id))
with check (public.is_current_org_member(org_id));

drop policy if exists "forecast_synthesis_delete_org" on public.forecast_synthesis;
create policy "forecast_synthesis_delete_org"
on public.forecast_synthesis
for delete
to authenticated
using (public.is_current_org_member(org_id));

grant select, insert, update, delete on public.forecast_synthesis to authenticated;
