-- Win Analysis: les analyses des deals gagnes sont cachees dans deal_ai_analyses
-- avec un type dedie (TTL 30 jours; un deal gagne ne change plus, cache permanent de fait).
alter table public.deal_ai_analyses
drop constraint if exists deal_ai_analyses_analysis_type_check;

alter table public.deal_ai_analyses
add constraint deal_ai_analyses_analysis_type_check
check (analysis_type in ('deal_intelligence', 'deal_qualification', 'deal_activity_plan', 'close_won'));
