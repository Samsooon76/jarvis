create or replace function public.get_hubspot_integration_auth(target_org_id uuid)
returns table (
  hubspot_access_token text,
  hubspot_refresh_token text,
  hubspot_token_expires_at timestamptz
)
language sql
security definer
set search_path = public, private
as $$
  select
    oi.hubspot_access_token,
    oi.hubspot_refresh_token,
    oi.hubspot_token_expires_at
  from private.organization_integrations as oi
  where oi.org_id = target_org_id
  limit 1;
$$;

revoke all on function public.get_hubspot_integration_auth(uuid) from public;
grant execute on function public.get_hubspot_integration_auth(uuid) to authenticated, service_role;
