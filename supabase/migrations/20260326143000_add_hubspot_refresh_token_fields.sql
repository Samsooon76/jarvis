alter table private.organization_integrations
add column if not exists hubspot_refresh_token text,
add column if not exists hubspot_token_expires_at timestamptz;
