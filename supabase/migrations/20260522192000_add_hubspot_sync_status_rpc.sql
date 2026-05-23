create or replace function public.set_hubspot_integration_sync_status(
  target_org_id uuid,
  target_started_at timestamptz default null,
  target_finished_at timestamptz default null,
  target_status text default null,
  target_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if target_status is not null and target_status not in ('queued', 'running', 'completed', 'failed') then
    raise exception 'Invalid HubSpot sync status: %', target_status;
  end if;

  update private.organization_integrations
  set
    last_sync_started_at = coalesce(target_started_at, last_sync_started_at),
    last_sync_finished_at = target_finished_at,
    last_sync_status = target_status,
    last_sync_error = target_error,
    updated_at = timezone('utc', now())
  where org_id = target_org_id;
end;
$$;

revoke all on function public.set_hubspot_integration_sync_status(uuid, timestamptz, timestamptz, text, text) from public;
revoke all on function public.set_hubspot_integration_sync_status(uuid, timestamptz, timestamptz, text, text) from anon;
revoke all on function public.set_hubspot_integration_sync_status(uuid, timestamptz, timestamptz, text, text) from authenticated;
grant execute on function public.set_hubspot_integration_sync_status(uuid, timestamptz, timestamptz, text, text) to service_role;

revoke all on function public.get_user_queue(uuid, integer) from public;
revoke all on function public.get_user_queue(uuid, integer) from anon;
grant execute on function public.get_user_queue(uuid, integer) to authenticated, service_role;

revoke all on function public.get_hubspot_integration_auth(uuid) from public;
revoke all on function public.get_hubspot_integration_auth(uuid) from anon;
revoke all on function public.get_hubspot_integration_auth(uuid) from authenticated;
grant execute on function public.get_hubspot_integration_auth(uuid) to service_role;

revoke all on function public.get_hubspot_access_token(uuid) from public;
revoke all on function public.get_hubspot_access_token(uuid) from anon;
revoke all on function public.get_hubspot_access_token(uuid) from authenticated;
grant execute on function public.get_hubspot_access_token(uuid) to service_role;

revoke all on function public.set_hubspot_integration(uuid, text, text, timestamptz) from public;
revoke all on function public.set_hubspot_integration(uuid, text, text, timestamptz) from anon;
revoke all on function public.set_hubspot_integration(uuid, text, text, timestamptz) from authenticated;
grant execute on function public.set_hubspot_integration(uuid, text, text, timestamptz) to service_role;
