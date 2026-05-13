create table if not exists public.deal_ai_analyses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  hubspot_deal_id text not null,
  provider text not null,
  model text not null,
  input_hash text not null,
  analysis jsonb not null,
  close_won_probability integer not null check (close_won_probability between 0 and 100),
  generated_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (org_id, hubspot_deal_id, provider, model, input_hash)
);

create index if not exists deal_ai_analyses_lookup_idx
  on public.deal_ai_analyses (org_id, hubspot_deal_id, provider, model, expires_at desc);

create index if not exists deal_ai_analyses_generated_idx
  on public.deal_ai_analyses (org_id, generated_at desc);

create trigger deal_ai_analyses_set_updated_at
before update on public.deal_ai_analyses
for each row
execute function public.set_updated_at();

alter table public.deal_ai_analyses enable row level security;

create policy "deal_ai_analyses_read_org"
on public.deal_ai_analyses
for select
to authenticated
using (public.is_current_org_member(org_id));

create policy "deal_ai_analyses_write_org"
on public.deal_ai_analyses
for all
to authenticated
using (public.is_current_org_member(org_id))
with check (public.is_current_org_member(org_id));
