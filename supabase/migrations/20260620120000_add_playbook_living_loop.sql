-- Playbook living loop (phase 4): versions, drift metadata et notification Pulse.

create table if not exists public.playbook_play_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  playbook_id uuid not null references public.playbooks (id) on delete cascade,
  play_id uuid not null references public.playbook_plays (id) on delete cascade,
  version integer not null check (version >= 1),
  category text not null,
  title text not null,
  trigger_description text not null,
  recommended_response text not null,
  status text not null,
  source text not null,
  changed_at timestamptz not null default timezone('utc', now()),
  changed_by uuid references public.users (id) on delete set null,
  change_reason text,
  foreign key (playbook_id, org_id) references public.playbooks (id, org_id) on delete cascade,
  foreign key (play_id, org_id) references public.playbook_plays (id, org_id) on delete cascade,
  unique (play_id, version)
);

create index if not exists playbook_play_versions_play_idx
  on public.playbook_play_versions (play_id, version desc);

create or replace function public.snapshot_playbook_play_version()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and (
    old.category is distinct from new.category
    or old.title is distinct from new.title
    or old.trigger_description is distinct from new.trigger_description
    or old.recommended_response is distinct from new.recommended_response
    or old.status is distinct from new.status
    or old.source is distinct from new.source
  ) then
    insert into public.playbook_play_versions (
      org_id,
      playbook_id,
      play_id,
      version,
      category,
      title,
      trigger_description,
      recommended_response,
      status,
      source,
      change_reason
    )
    values (
      old.org_id,
      old.playbook_id,
      old.id,
      old.version,
      old.category,
      old.title,
      old.trigger_description,
      old.recommended_response,
      old.status,
      old.source,
      'before_update'
    )
    on conflict (play_id, version) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists playbook_plays_snapshot_version on public.playbook_plays;
create trigger playbook_plays_snapshot_version
before update on public.playbook_plays
for each row
execute function public.snapshot_playbook_play_version();

alter table public.playbook_suggestions
  add column if not exists source text not null default 'manual',
  add column if not exists source_key text,
  add column if not exists confidence numeric(4, 3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  add column if not exists cooldown_until timestamptz;

create unique index if not exists playbook_suggestions_pending_source_key_idx
  on public.playbook_suggestions (org_id, playbook_id, source_key)
  where source_key is not null and status = 'pending';

create index if not exists playbook_suggestions_source_cooldown_idx
  on public.playbook_suggestions (org_id, playbook_id, source, cooldown_until desc);

alter table public.pulse_preferences
  add column if not exists notify_playbook boolean not null default true;

alter table public.pulse_notifications
  drop constraint if exists pulse_notifications_event_type_check;

alter table public.pulse_notifications
  add constraint pulse_notifications_event_type_check
  check (
    event_type in ('deal_created', 'probability', 'amount', 'stage', 'close_date', 'owner', 'pipeline', 'playbook_suggestion')
  );

alter table public.playbook_play_versions enable row level security;

revoke all on table public.playbook_play_versions from anon, authenticated;
