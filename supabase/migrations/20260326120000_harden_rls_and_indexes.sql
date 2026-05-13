create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create index if not exists prospects_owner_user_id_idx on public.prospects (owner_user_id);
create index if not exists calls_user_id_idx on public.calls (user_id);
create index if not exists calls_prospect_id_idx on public.calls (prospect_id);
create index if not exists actions_user_id_idx on public.actions (user_id);
create index if not exists actions_prospect_id_idx on public.actions (prospect_id);
create index if not exists actions_call_id_idx on public.actions (call_id);

drop policy if exists "prospects_write_org" on public.prospects;
create policy "prospects_insert_org"
on public.prospects
for insert
to authenticated
with check (public.is_current_org_member(org_id));

create policy "prospects_update_org"
on public.prospects
for update
to authenticated
using (public.is_current_org_member(org_id))
with check (public.is_current_org_member(org_id));

create policy "prospects_delete_org"
on public.prospects
for delete
to authenticated
using (public.is_current_org_member(org_id));

drop policy if exists "calls_write_org" on public.calls;
create policy "calls_insert_org"
on public.calls
for insert
to authenticated
with check (public.is_current_org_member(org_id));

create policy "calls_update_org"
on public.calls
for update
to authenticated
using (public.is_current_org_member(org_id))
with check (public.is_current_org_member(org_id));

create policy "calls_delete_org"
on public.calls
for delete
to authenticated
using (public.is_current_org_member(org_id));

drop policy if exists "actions_write_org" on public.actions;
create policy "actions_insert_org"
on public.actions
for insert
to authenticated
with check (public.is_current_org_member(org_id));

create policy "actions_update_org"
on public.actions
for update
to authenticated
using (public.is_current_org_member(org_id))
with check (public.is_current_org_member(org_id));

create policy "actions_delete_org"
on public.actions
for delete
to authenticated
using (public.is_current_org_member(org_id));

drop policy if exists "daily_kpis_write_manager" on public.daily_kpis;
create policy "daily_kpis_insert_manager"
on public.daily_kpis
for insert
to authenticated
with check (public.is_current_org_manager(org_id));

create policy "daily_kpis_update_manager"
on public.daily_kpis
for update
to authenticated
using (public.is_current_org_manager(org_id))
with check (public.is_current_org_manager(org_id));

create policy "daily_kpis_delete_manager"
on public.daily_kpis
for delete
to authenticated
using (public.is_current_org_manager(org_id));

drop policy if exists "usage_sessions_write_self" on public.usage_sessions;
create policy "usage_sessions_insert_self"
on public.usage_sessions
for insert
to authenticated
with check (public.is_same_user(user_id));

create policy "usage_sessions_update_self"
on public.usage_sessions
for update
to authenticated
using (public.is_same_user(user_id))
with check (public.is_same_user(user_id));

create policy "usage_sessions_delete_self"
on public.usage_sessions
for delete
to authenticated
using (public.is_same_user(user_id));
