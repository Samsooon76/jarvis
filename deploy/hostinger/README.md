# Jarvis HubSpot webhook on Hostinger

This is a lightweight PHP ingress for HubSpot webhooks.

It is useful when you need a simple public URL on Hostinger:

```text
https://your-domain.com/api/webhooks/hubspot
```

## What it does

- Validates HubSpot webhook signatures, including v3.
- Accepts HubSpot batches.
- Deduplicates retries with the same fingerprint policy as the Node backend.
- Inserts raw webhook events into Supabase table `public.hubspot_webhook_events`.

## What it does not do

- It does not hydrate calls/emails/notes from HubSpot.
- It does not run BullMQ/Redis jobs.
- It does not run LLM analysis.

So this is a good public entrypoint, but a backend worker is still needed later to process queued events.

## Deployment

1. Upload `public_html/api/webhooks/hubspot/index.php` to Hostinger at:

   ```text
   public_html/api/webhooks/hubspot/index.php
   ```

2. Copy `jarvis-hostinger-config.example.php` to:

   ```text
   /home/<hostinger-account>/jarvis-hostinger-config.php
   ```

   Keep it outside `public_html` when Hostinger allows it.

3. Fill:

   ```php
   'supabase_url' => 'https://<project-ref>.supabase.co',
   'supabase_service_role_key' => '<service-role-key>',
   'hubspot_client_secret' => '<hubspot-client-secret>',
   'public_base_url' => 'https://your-domain.com',
   ```

4. In HubSpot, set Target URL to:

   ```text
   https://your-domain.com/api/webhooks/hubspot
   ```

## Security

The config contains a Supabase service-role key and a HubSpot client secret. Do not put the config in `public_html`.

If the config was ever uploaded to a public directory, rotate the Supabase service-role key and HubSpot client secret.
