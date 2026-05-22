create index if not exists task_ai_analyses_prospect_id_idx
  on public.task_ai_analyses (prospect_id);

create index if not exists prospects_org_hubspot_deal_id_idx
  on public.prospects (org_id, hubspot_deal_id)
  where hubspot_deal_id is not null;

create index if not exists deal_ai_analyses_latest_by_type_idx
  on public.deal_ai_analyses (
    org_id,
    provider,
    model,
    analysis_type,
    hubspot_deal_id,
    generated_at desc
  );

create index if not exists hubspot_webhook_events_status_updated_idx
  on public.hubspot_webhook_events (processing_status, updated_at desc);

create index if not exists hubspot_webhook_events_object_lookup_idx
  on public.hubspot_webhook_events (org_id, object_type_id, object_id, created_at desc)
  where org_id is not null;

create index if not exists hubspot_activities_org_type_activity_idx
  on public.hubspot_activities (org_id, activity_type, hubspot_activity_id);

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
      and u.auth_user_id = (select auth.uid())
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
      and u.auth_user_id = (select auth.uid())
  )
);
