alter table public.organizations
add column if not exists preferred_llm_provider text,
add column if not exists preferred_llm_model text;

alter table public.organizations
drop constraint if exists organizations_preferred_llm_provider_check;

alter table public.organizations
add constraint organizations_preferred_llm_provider_check
check (
  preferred_llm_provider in ('deepseek', 'openai', 'vertex-gemini')
  or preferred_llm_provider is null
);
