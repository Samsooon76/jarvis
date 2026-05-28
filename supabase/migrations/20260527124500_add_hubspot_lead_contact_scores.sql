create table if not exists public.hubspot_lead_contact_scores (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  hubspot_lead_id text not null,
  hubspot_contact_id text not null,
  deterministic_score numeric(10, 2) not null default 0,
  ai_score numeric(10, 2),
  final_score numeric(10, 2) not null default 0,
  priority text not null default 'routine' check (priority in ('urgent', 'important', 'routine')),
  reason text not null,
  recommended_action text not null,
  confidence text check (confidence in ('low', 'medium', 'high') or confidence is null),
  input_hash text not null,
  provider text,
  model text,
  expires_at timestamptz,
  analyzed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (org_id, hubspot_lead_id, hubspot_contact_id)
);

create index if not exists hubspot_lead_contact_scores_org_lead_score_idx
  on public.hubspot_lead_contact_scores (org_id, hubspot_lead_id, final_score desc);

create index if not exists hubspot_lead_contact_scores_expiry_idx
  on public.hubspot_lead_contact_scores (expires_at)
  where expires_at is not null;

drop trigger if exists hubspot_lead_contact_scores_set_updated_at on public.hubspot_lead_contact_scores;
create trigger hubspot_lead_contact_scores_set_updated_at
before update on public.hubspot_lead_contact_scores
for each row
execute function public.set_updated_at();

grant select on public.hubspot_lead_contact_scores to authenticated;
grant select, insert, update, delete on public.hubspot_lead_contact_scores to service_role;

alter table public.hubspot_lead_contact_scores enable row level security;

drop policy if exists "hubspot_lead_contact_scores_read_org" on public.hubspot_lead_contact_scores;
create policy "hubspot_lead_contact_scores_read_org"
on public.hubspot_lead_contact_scores
for select
to authenticated
using (public.is_current_org_member(org_id));

drop policy if exists "hubspot_lead_contact_scores_insert_org" on public.hubspot_lead_contact_scores;
create policy "hubspot_lead_contact_scores_insert_org"
on public.hubspot_lead_contact_scores
for insert
to authenticated
with check (public.is_current_org_member(org_id));

drop policy if exists "hubspot_lead_contact_scores_update_org" on public.hubspot_lead_contact_scores;
create policy "hubspot_lead_contact_scores_update_org"
on public.hubspot_lead_contact_scores
for update
to authenticated
using (public.is_current_org_member(org_id))
with check (public.is_current_org_member(org_id));

drop policy if exists "hubspot_lead_contact_scores_delete_org" on public.hubspot_lead_contact_scores;
create policy "hubspot_lead_contact_scores_delete_org"
on public.hubspot_lead_contact_scores
for delete
to authenticated
using (public.is_current_org_member(org_id));
