create table if not exists private.organization_mcp_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  created_by_user_id uuid references public.users (id) on delete set null,
  label text not null default 'Cle MCP',
  token_hash text not null,
  token_prefix text not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists organization_mcp_keys_token_hash_active_uidx
  on private.organization_mcp_keys (token_hash)
  where revoked_at is null;

create index if not exists organization_mcp_keys_org_id_idx
  on private.organization_mcp_keys (org_id, created_at desc);

create or replace function public.insert_organization_mcp_key(
  target_org_id uuid,
  target_created_by_user_id uuid,
  target_label text,
  target_token_hash text,
  target_token_prefix text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  inserted_id uuid;
begin
  insert into private.organization_mcp_keys (
    org_id,
    created_by_user_id,
    label,
    token_hash,
    token_prefix
  )
  values (
    target_org_id,
    target_created_by_user_id,
    coalesce(nullif(trim(target_label), ''), 'Cle MCP'),
    target_token_hash,
    target_token_prefix
  )
  returning id into inserted_id;

  return inserted_id;
end;
$$;

create or replace function public.list_organization_mcp_keys(target_org_id uuid)
returns table (
  id uuid,
  label text,
  token_prefix text,
  created_by_user_id uuid,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = public, private
as $$
  select
    k.id,
    k.label,
    k.token_prefix,
    k.created_by_user_id,
    k.last_used_at,
    k.revoked_at,
    k.created_at
  from private.organization_mcp_keys as k
  where k.org_id = target_org_id
  order by k.created_at desc;
$$;

create or replace function public.revoke_organization_mcp_key(
  target_org_id uuid,
  target_key_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
begin
  update private.organization_mcp_keys
  set revoked_at = timezone('utc', now())
  where id = target_key_id
    and org_id = target_org_id
    and revoked_at is null;

  return found;
end;
$$;

create or replace function public.resolve_organization_mcp_key(target_token_hash text)
returns table (
  key_id uuid,
  org_id uuid,
  created_by_user_id uuid
)
language sql
security definer
set search_path = public, private
as $$
  select
    k.id,
    k.org_id,
    k.created_by_user_id
  from private.organization_mcp_keys as k
  where k.token_hash = target_token_hash
    and k.revoked_at is null
  limit 1;
$$;

create or replace function public.touch_organization_mcp_key(target_key_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  update private.organization_mcp_keys
  set last_used_at = timezone('utc', now())
  where id = target_key_id
    and revoked_at is null;
end;
$$;

revoke all on function public.insert_organization_mcp_key(uuid, uuid, text, text, text) from public;
revoke all on function public.list_organization_mcp_keys(uuid) from public;
revoke all on function public.revoke_organization_mcp_key(uuid, uuid) from public;
revoke all on function public.resolve_organization_mcp_key(text) from public;
revoke all on function public.touch_organization_mcp_key(uuid) from public;

grant execute on function public.insert_organization_mcp_key(uuid, uuid, text, text, text) to service_role;
grant execute on function public.list_organization_mcp_keys(uuid) to service_role;
grant execute on function public.revoke_organization_mcp_key(uuid, uuid) to service_role;
grant execute on function public.resolve_organization_mcp_key(text) to service_role;
grant execute on function public.touch_organization_mcp_key(uuid) to service_role;