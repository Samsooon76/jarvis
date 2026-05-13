create or replace function public.set_hubspot_integration(
  target_org_id uuid,
  target_access_token text,
  target_refresh_token text default null,
  target_token_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  insert into private.organization_integrations (
    org_id,
    hubspot_access_token,
    hubspot_refresh_token,
    hubspot_token_expires_at
  )
  values (
    target_org_id,
    target_access_token,
    target_refresh_token,
    target_token_expires_at
  )
  on conflict (org_id) do update
  set
    hubspot_access_token = excluded.hubspot_access_token,
    hubspot_refresh_token = excluded.hubspot_refresh_token,
    hubspot_token_expires_at = excluded.hubspot_token_expires_at,
    updated_at = timezone('utc', now());
end;
$$;

create or replace function public.get_hubspot_access_token(target_org_id uuid)
returns text
language sql
security definer
set search_path = public, private
as $$
  select oi.hubspot_access_token
  from private.organization_integrations as oi
  where oi.org_id = target_org_id
  limit 1;
$$;

revoke all on function public.set_hubspot_integration(uuid, text, text, timestamptz) from public;
revoke all on function public.get_hubspot_access_token(uuid) from public;

grant execute on function public.set_hubspot_integration(uuid, text, text, timestamptz) to authenticated, service_role;
grant execute on function public.get_hubspot_access_token(uuid) to authenticated, service_role;
