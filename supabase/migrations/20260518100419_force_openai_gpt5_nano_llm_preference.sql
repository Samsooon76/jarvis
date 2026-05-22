update public.organizations
set
  preferred_llm_provider = 'openai',
  preferred_llm_model = 'gpt-5-nano'
where
  preferred_llm_provider is distinct from 'openai'
  or preferred_llm_model is distinct from 'gpt-5-nano';

alter table public.organizations
drop constraint if exists organizations_preferred_llm_provider_check;

alter table public.organizations
add constraint organizations_preferred_llm_provider_check
check (
  preferred_llm_provider = 'openai'
  or preferred_llm_provider is null
);

alter table public.organizations
drop constraint if exists organizations_preferred_llm_model_check;

alter table public.organizations
add constraint organizations_preferred_llm_model_check
check (
  preferred_llm_model = 'gpt-5-nano'
  or preferred_llm_model is null
);
