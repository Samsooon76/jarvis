create table if not exists public.queue_action_audit (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  user_id uuid references public.users (id) on delete set null,
  action text not null check (action in ('snooze', 'skip')),
  reason text,
  snoozed_until timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists queue_action_audit_prospect_created_idx
  on public.queue_action_audit (prospect_id, created_at desc);

create index if not exists queue_action_audit_user_created_idx
  on public.queue_action_audit (user_id, created_at desc);

create index if not exists prospects_org_owner_idx
  on public.prospects (org_id, owner_user_id);

create index if not exists prospects_skipped_at_idx
  on public.prospects (skipped_at);

create index if not exists prospects_snoozed_until_idx
  on public.prospects (snoozed_until);

create index if not exists prospects_ai_priority_score_desc_idx
  on public.prospects (ai_priority_score desc);

create index if not exists users_org_hubspot_owner_idx
  on public.users (org_id, hubspot_owner_id);

alter table public.queue_action_audit enable row level security;

drop policy if exists "queue_action_audit_read_org" on public.queue_action_audit;
create policy "queue_action_audit_read_org"
on public.queue_action_audit
for select
to authenticated
using (
  exists (
    select 1
    from public.prospects p
    join public.users u on u.org_id = p.org_id
    where p.id = queue_action_audit.prospect_id
      and u.auth_user_id = auth.uid()
  )
);

drop policy if exists "queue_action_audit_insert_org" on public.queue_action_audit;
create policy "queue_action_audit_insert_org"
on public.queue_action_audit
for insert
to authenticated
with check (
  exists (
    select 1
    from public.prospects p
    join public.users u on u.org_id = p.org_id
    where p.id = queue_action_audit.prospect_id
      and u.auth_user_id = auth.uid()
  )
);
