-- Playbook de vente vivant (phase 1: socle CRUD).
-- 1. playbooks: le referentiel par organisation (en pratique un seul actif, le schema en autorise plusieurs).
-- 2. playbook_plays: les plays (declencheur -> reponse recommandee), versionnes, archives jamais supprimes.
-- 3. playbook_play_evidence: preuves rattachees a un play (call, deal ou analyse IA).

create table if not exists public.playbooks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (btrim(name) <> '' and char_length(name) <= 120),
  description text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, org_id)
);

create index if not exists playbooks_org_status_idx
  on public.playbooks (org_id, status, created_at desc);

drop trigger if exists playbooks_set_updated_at on public.playbooks;
create trigger playbooks_set_updated_at
before update on public.playbooks
for each row
execute function public.set_updated_at();

create table if not exists public.playbook_plays (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  playbook_id uuid not null references public.playbooks (id) on delete cascade,
  category text not null check (
    category in ('qualification', 'discovery', 'demo', 'objection_handling', 'negotiation', 'closing', 'follow_up')
  ),
  title text not null check (btrim(title) <> '' and char_length(title) <= 160),
  -- "Quand le prospect dit/fait X": le declencheur du play.
  trigger_description text not null check (btrim(trigger_description) <> '' and char_length(trigger_description) <= 600),
  recommended_response text not null check (btrim(recommended_response) <> '' and char_length(recommended_response) <= 4000),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  source text not null default 'manual' check (source in ('manual', 'ai_suggested')),
  position integer not null default 0 check (position >= 0),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, org_id),
  foreign key (playbook_id, org_id) references public.playbooks (id, org_id) on delete cascade
);

create index if not exists playbook_plays_playbook_idx
  on public.playbook_plays (playbook_id, status, category, position);

create index if not exists playbook_plays_org_idx
  on public.playbook_plays (org_id, status);

drop trigger if exists playbook_plays_set_updated_at on public.playbook_plays;
create trigger playbook_plays_set_updated_at
before update on public.playbook_plays
for each row
execute function public.set_updated_at();

create table if not exists public.playbook_play_evidence (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  play_id uuid not null references public.playbook_plays (id) on delete cascade,
  kind text not null check (kind in ('call', 'deal', 'analysis')),
  -- Identifiant de la source (hubspot_deal_id, calls.id, run/analyse id selon kind).
  ref_id text not null check (btrim(ref_id) <> ''),
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (play_id, org_id) references public.playbook_plays (id, org_id) on delete cascade
);

create index if not exists playbook_play_evidence_play_idx
  on public.playbook_play_evidence (play_id);

-- RLS: acces reserve au backend (service role), comme pulse/manager_digests.
alter table public.playbooks enable row level security;
alter table public.playbook_plays enable row level security;
alter table public.playbook_play_evidence enable row level security;

revoke all on table public.playbooks from anon, authenticated;
revoke all on table public.playbook_plays from anon, authenticated;
revoke all on table public.playbook_play_evidence from anon, authenticated;
