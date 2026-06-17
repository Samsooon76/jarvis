-- DealAnalysisV1: analyse deal unifiee (remplace les 3 appels intelligence/qualification/activity_plan).

alter table public.deal_ai_analyses
drop constraint if exists deal_ai_analyses_analysis_type_check;

alter table public.deal_ai_analyses
add constraint deal_ai_analyses_analysis_type_check
check (analysis_type in ('deal_intelligence', 'deal_qualification', 'deal_activity_plan', 'close_won', 'deal_analysis_v1'));