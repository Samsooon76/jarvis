-- Migration to remove the initial seed / mock data
delete from public.prospects where org_id = '11111111-1111-4111-8111-111111111111';
delete from public.users where org_id = '11111111-1111-4111-8111-111111111111' or email = 'claire.moreau@jarvis.demo';
delete from public.organizations where id = '11111111-1111-4111-8111-111111111111';
