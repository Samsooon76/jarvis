-- Phase 5: mesure d'adherence transcript -> plays.
-- Ne stocke pas le transcript complet: seulement scores, ids et extraits courts d'evidence.

create table if not exists public.playbook_call_adherence (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  playbook_id uuid not null references public.playbooks (id) on delete cascade,
  call_id uuid not null references public.calls (id) on delete cascade,
  user_id uuid references public.users (id) on delete set null,
  prospect_id uuid references public.prospects (id) on delete set null,
  provider text not null default 'deterministic',
  model text not null default 'playbook-adherence-v1',
  input_hash text not null,
  score integer not null check (score >= 0 and score <= 100),
  scanned_play_count integer not null default 0 check (scanned_play_count >= 0),
  matched_play_count integer not null default 0 check (matched_play_count >= 0),
  missing_opportunity_count integer not null default 0 check (missing_opportunity_count >= 0),
  matched_plays jsonb not null default '[]'::jsonb,
  missing_opportunities jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (call_id, playbook_id, input_hash),
  unique (id, org_id),
  foreign key (playbook_id, org_id) references public.playbooks (id, org_id) on delete cascade
);

create index if not exists playbook_call_adherence_org_generated_idx
  on public.playbook_call_adherence (org_id, generated_at desc);

create index if not exists playbook_call_adherence_call_generated_idx
  on public.playbook_call_adherence (call_id, generated_at desc);

create index if not exists playbook_call_adherence_playbook_generated_idx
  on public.playbook_call_adherence (playbook_id, generated_at desc);

alter table public.playbook_call_adherence enable row level security;

revoke all on table public.playbook_call_adherence from anon, authenticated;
