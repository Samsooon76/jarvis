-- Hot path: public.get_user_queue(target_user_id, max_rows)
-- Filters by owner, skips skipped rows, excludes future snoozes, then orders by priority.
create index if not exists prospects_active_queue_owner_priority_idx
  on public.prospects (
    owner_user_id,
    ai_priority_score desc,
    last_contact_at asc nulls first
  )
  where skipped_at is null
    and (snoozed_until is null);

create index if not exists prospects_snoozed_queue_owner_priority_idx
  on public.prospects (
    owner_user_id,
    snoozed_until,
    ai_priority_score desc,
    last_contact_at asc nulls first
  )
  where skipped_at is null
    and snoozed_until is not null;

-- Dashboard/diagnostic paths still read HubSpot ownership from raw_data when the
-- Jarvis user mapping is incomplete. Keep this indexed until every prospect has
-- a robust owner_user_id.
create index if not exists prospects_org_raw_hubspot_source_owner_idx
  on public.prospects (
    org_id,
    ((raw_data ->> 'source')),
    ((raw_data ->> 'hubspotOwnerId')),
    deal_amount desc nulls last
  );

-- Supports .contains("raw_data", { source: "hubspot" }) and similar JSONB
-- containment filters used by legacy dashboard routes.
create index if not exists prospects_raw_data_gin_path_idx
  on public.prospects
  using gin (raw_data jsonb_path_ops);

-- Owner dashboards often sort by amount after scoping to org/owner.
create index if not exists prospects_org_owner_deal_amount_idx
  on public.prospects (
    org_id,
    owner_user_id,
    deal_amount desc nulls last
  );

-- Diagnostic endpoint counts active/snoozed/skipped prospects per owner.
create index if not exists prospects_org_owner_queue_state_idx
  on public.prospects (
    org_id,
    owner_user_id,
    skipped_at,
    snoozed_until
  );
