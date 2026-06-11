-- Jarvis Pulse: notification lorsqu'un nouveau deal HubSpot entre dans le pipe.

alter table public.pulse_preferences
  add column if not exists notify_deal_created boolean not null default true;

alter table public.pulse_notifications
  drop constraint if exists pulse_notifications_event_type_check;

alter table public.pulse_notifications
  add constraint pulse_notifications_event_type_check
  check (
    event_type in ('deal_created', 'probability', 'amount', 'stage', 'close_date', 'owner', 'pipeline')
  );
