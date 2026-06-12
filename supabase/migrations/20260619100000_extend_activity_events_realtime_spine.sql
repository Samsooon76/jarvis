alter table public.activity_events
  drop constraint if exists activity_events_event_type_check;

alter table public.activity_events
  add constraint activity_events_event_type_check
  check (
    event_type in (
      'call.received',
      'call.completed',
      'email.received',
      'email.sent',
      'sms.received',
      'sms.sent',
      'meeting.completed',
      'note.created',
      'deal.created',
      'deal.updated',
      'deal.stage_changed',
      'deal.amount_changed',
      'deal.probability_changed',
      'deal.close_date_changed',
      'deal.owner_changed',
      'deal.pipeline_changed',
      'deal.won',
      'deal.lost'
    )
  );

alter table public.activity_events
  drop constraint if exists activity_events_channel_check;

alter table public.activity_events
  add constraint activity_events_channel_check
  check (channel in ('call', 'email', 'sms', 'meeting', 'note', 'deal'));

create index if not exists activity_events_type_occurred_idx
  on public.activity_events (org_id, event_type, occurred_at desc);
