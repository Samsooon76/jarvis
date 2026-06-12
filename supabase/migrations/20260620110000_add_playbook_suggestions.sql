-- Playbook suggestions (phase 2): propositions IA ou systeme a valider avant modification du playbook.

create table if not exists public.playbook_suggestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  playbook_id uuid not null references public.playbooks (id) on delete cascade,
  kind text not null check (kind in ('new_play', 'update_play', 'retire_play')),
  payload jsonb not null default '{}'::jsonb,
  rationale text not null check (btrim(rationale) <> '' and char_length(rationale) <= 4000),
  evidence jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  resolved_by uuid references public.users (id) on delete set null,
  foreign key (playbook_id, org_id) references public.playbooks (id, org_id) on delete cascade,
  check (
    (status = 'pending' and resolved_at is null and resolved_by is null)
    or (status in ('accepted', 'rejected') and resolved_at is not null)
  )
);

create index if not exists playbook_suggestions_playbook_status_idx
  on public.playbook_suggestions (playbook_id, status, created_at desc);

create index if not exists playbook_suggestions_org_status_idx
  on public.playbook_suggestions (org_id, status, created_at desc);

-- RLS: acces reserve au backend (service role), comme les tables playbook phase 1.
alter table public.playbook_suggestions enable row level security;

revoke all on table public.playbook_suggestions from anon, authenticated;
