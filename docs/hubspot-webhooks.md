# HubSpot realtime webhooks

## Backend public URL

Set the backend public URL in production:

```sh
API_PUBLIC_URL=https://api.your-domain.com
REDIS_URL=redis://...
HUBSPOT_WEBHOOK_DEBOUNCE_SECONDS=90
CRM_ACTIVITY_RETENTION_DAYS=180
```

HubSpot target URL:

```text
https://api.your-domain.com/api/webhooks/hubspot
```

For local webhook testing, expose the backend with a tunnel and set `API_PUBLIC_URL` to the tunnel origin, for example:

```sh
API_PUBLIC_URL=https://<your-tunnel>.ngrok-free.app
HUBSPOT_REDIRECT_URI=https://<your-tunnel>.ngrok-free.app/api/auth/hubspot/callback
```

## Subscriptions

Create these generic webhook subscriptions in the HubSpot app Webhooks page, then activate them:

| Object | HubSpot object type ID | Event |
|---|---:|---|
| Call | `0-48` | Created |
| Communication | `0-18` | Created |
| Email | `0-49` | Created |
| Note | `0-46` | Created |
| Meeting event | `0-47` | Created |
| Call | `0-48` | Association changed |
| Communication | `0-18` | Association changed |
| Email | `0-49` | Association changed |
| Note | `0-46` | Association changed |
| Meeting event | `0-47` | Association changed |
| Deal | `0-3` | Property changed: `dealstage`, `amount`, `closedate`, `hubspot_owner_id`, `hs_deal_stage_probability`, `pipeline` |
| Task | `0-27` | Created |
| Task | `0-27` | Deleted |
| Task | `0-27` | Property changed: `hs_task_status`, `hs_task_priority`, `hs_task_subject`, `hs_task_body`, `hs_timestamp`, `hubspot_owner_id` |
| Task | `0-27` | Association changed |
| Lead | `0-136` | Created |
| Lead | `0-136` | Deleted |
| Lead | `0-136` | Property changed: `hs_lead_name`, `hs_pipeline`, `hs_pipeline_stage`, `hubspot_owner_id` |
| Lead | `0-136` | Association changed |

Add the legacy subscription separately:

```text
contact.privacyDeletion
```

Generic webhooks currently do not support `contact.privacyDeletion`, so this one must use the legacy format.

## HubSpot UI path

1. Open the HubSpot developer account.
2. Go to **Apps**.
3. Open the Jarvis app.
4. Go to **Webhooks**.
5. Set **Target URL** to `https://api.your-domain.com/api/webhooks/hubspot`.
6. Click **Create subscription**.
7. Select the object and event from the table above.
8. Save, then activate each subscription.

HubSpot sends batches to the endpoint. Jarvis validates the HubSpot signature, deduplicates retries, then:

- **Activities** (calls, emails, notes, meetings, communications): hydrated through the HubSpot API, mirrored in Supabase, and debounced deal analysis by `HUBSPOT_WEBHOOK_DEBOUNCE_SECONDS`.
- **Deals**: property changes applied directly to `hubspot_deals` and `prospects`, with Jarvis Pulse notifications and optional re-analysis.
- **Tasks**: cache invalidated so the tasks view reflects completions and edits within the next UI refresh.
- **Leads**: upserted into `hubspot_leads` (or deleted on `object.deletion`) for near-real-time lead pipeline updates.
