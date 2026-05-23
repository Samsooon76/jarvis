-- Fix Supabase advisor 0003_auth_rls_initplan.
-- The scalar subquery lets Postgres evaluate auth.uid() once per statement
-- instead of once per row while checking RLS.
drop policy if exists "backend_jobs_read_org" on public.backend_jobs;
create policy "backend_jobs_read_org"
on public.backend_jobs
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.org_id = backend_jobs.org_id
      and u.auth_user_id = (select auth.uid())
  )
);

drop policy if exists "hubspot_sync_status_read_org" on public.hubspot_sync_status;
create policy "hubspot_sync_status_read_org"
on public.hubspot_sync_status
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.org_id = hubspot_sync_status.org_id
      and u.auth_user_id = (select auth.uid())
  )
);

-- Fix Supabase advisor 0006_multiple_permissive_policies.
-- FOR ALL policies also apply to SELECT, so they duplicate the dedicated read
-- policies. Replace them with write-only policies.
drop policy if exists "deal_ai_analyses_write_org" on public.deal_ai_analyses;
drop policy if exists "deal_ai_analyses_insert_org" on public.deal_ai_analyses;
drop policy if exists "deal_ai_analyses_update_org" on public.deal_ai_analyses;
drop policy if exists "deal_ai_analyses_delete_org" on public.deal_ai_analyses;

create policy "deal_ai_analyses_insert_org"
on public.deal_ai_analyses
for insert
to authenticated
with check (public.is_current_org_member(org_id));

create policy "deal_ai_analyses_update_org"
on public.deal_ai_analyses
for update
to authenticated
using (public.is_current_org_member(org_id))
with check (public.is_current_org_member(org_id));

create policy "deal_ai_analyses_delete_org"
on public.deal_ai_analyses
for delete
to authenticated
using (public.is_current_org_member(org_id));

drop policy if exists "monthly_sales_targets_write_manager" on public.monthly_sales_targets;
drop policy if exists "monthly_sales_targets_insert_manager" on public.monthly_sales_targets;
drop policy if exists "monthly_sales_targets_update_manager" on public.monthly_sales_targets;
drop policy if exists "monthly_sales_targets_delete_manager" on public.monthly_sales_targets;

create policy "monthly_sales_targets_insert_manager"
on public.monthly_sales_targets
for insert
to authenticated
with check (public.is_current_org_manager(org_id));

create policy "monthly_sales_targets_update_manager"
on public.monthly_sales_targets
for update
to authenticated
using (public.is_current_org_manager(org_id))
with check (public.is_current_org_manager(org_id));

create policy "monthly_sales_targets_delete_manager"
on public.monthly_sales_targets
for delete
to authenticated
using (public.is_current_org_manager(org_id));
