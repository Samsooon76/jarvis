alter table public.deal_ai_analyses
add column if not exists analysis_type text not null default 'deal_intelligence';

alter table public.deal_ai_analyses
drop constraint if exists deal_ai_analyses_analysis_type_check;

alter table public.deal_ai_analyses
add constraint deal_ai_analyses_analysis_type_check
check (analysis_type in ('deal_intelligence', 'deal_qualification'));

create index if not exists deal_ai_analyses_type_lookup_idx
  on public.deal_ai_analyses (org_id, hubspot_deal_id, analysis_type, provider, model, expires_at desc);
