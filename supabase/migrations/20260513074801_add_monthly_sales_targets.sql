create table if not exists public.monthly_sales_targets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  hubspot_owner_id text not null,
  owner_name text not null,
  target_month date not null,
  objective_amount numeric(12, 2) not null default 0 check (objective_amount >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (org_id, hubspot_owner_id, target_month),
  check (date_trunc('month', target_month::timestamp)::date = target_month)
);

create index if not exists monthly_sales_targets_org_month_idx
  on public.monthly_sales_targets (org_id, target_month, hubspot_owner_id);

create trigger monthly_sales_targets_set_updated_at
before update on public.monthly_sales_targets
for each row
execute function public.set_updated_at();

alter table public.monthly_sales_targets enable row level security;

create policy "monthly_sales_targets_read_org"
on public.monthly_sales_targets
for select
to authenticated
using (public.is_current_org_member(org_id));

create policy "monthly_sales_targets_write_manager"
on public.monthly_sales_targets
for all
to authenticated
using (public.is_current_org_manager(org_id))
with check (public.is_current_org_manager(org_id));
