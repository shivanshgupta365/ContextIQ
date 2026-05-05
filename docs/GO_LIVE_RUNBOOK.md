# ContextIQ Master Go-Live Runbook (One-Time Manual Setup)

This is the single setup artifact for running ContextIQ as an AI-native customer workspace.

## 1) Supabase Project + SQL Migrations

Create a Supabase project and apply migrations in this exact order:

1. `supabase/migrations/20260425_contextiq_init.sql`
2. `supabase/migrations/20260427_gmail_integrations.sql`
3. `supabase/migrations/20260427_linkedin_integrations.sql`
4. `supabase/migrations/20260427_integration_action_events.sql`
5. `supabase/migrations/20260430_ai_native_workspace.sql`
6. `supabase/migrations/20260502_outlook_slack_integrations.sql`
7. `supabase/migrations/20260503_set_fixed_hydra_tenant_contextiq9.sql`
8. `supabase/migrations/20260504_authenticated_role_permissions.sql`
9. `supabase/migrations/20260504_live_workspace_demo_purge.sql`
10. `supabase/migrations/20260504_slack_user_scope_upgrade.sql`
11. `supabase/migrations/20260505_workspace_context_pins.sql`
12. `supabase/migrations/20260505_workspace_context_pins_service_role_grants.sql`

Required API values:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## 2) Auth Providers (Workspace Login)

Enable these Supabase auth providers:

- Google OAuth
- Azure (Microsoft OAuth)

Set `Site URL` and callback allow-list:

- `https://<your-domain>/auth/callback`

## 3) Integration Provider Apps

Create provider apps and register redirect/webhook URLs for:

- Gmail/Google APIs
- Microsoft Graph (Outlook)
- Slack
- Twilio (SMS/WhatsApp)
- LinkedIn
- Google Calendar
- Zoom
- HubSpot
- Salesforce
- Intercom
- Notion
- Resend

Important: Some providers are approval-gated (restricted scopes, product access, business verification). ContextIQ handles these as `pending_approval` until production access is granted.

## 4) Vercel Environment Variables

Set all values from `.env.example` in Vercel (`Production`, optionally `Preview`):

- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Core: `HYDRADB_API_KEY`, `HYDRADB_BASE_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `APP_BASE_URL`, `INTEGRATION_TOKEN_SECRET`
- Auth/Providers:
  - `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
  - `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`
  - `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`
  - `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`
  - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
  - `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`
  - `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET`
  - `INTERCOM_ACCESS_TOKEN`
  - `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`
  - `RESEND_API_KEY`
  - `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`
- Jobs/Security: `CRON_SYNC_SECRET`, `CRON_SECRET` (set same value)

## 5) Webhooks + Cron

Configure provider webhooks to:

- `POST /api/webhooks/:provider`

ContextIQ integration APIs:

- `POST /api/integrations/:provider/connect`
- `POST /api/integrations/:provider/sync`
- `POST /api/integrations/:provider/writeback`
- `POST /api/actions/execute`
- `POST /api/command/search`

Cron route (daily unified sync):

- `GET /api/cron/sync-integrations`

Use `Authorization: Bearer <CRON_SYNC_SECRET>`.

## 6) Approval-Gated Providers

If a provider is not fully approved, ContextIQ must remain usable:

- provider status shown as `pending_approval`
- sync/writeback returns deterministic pending response
- no tab breaks due to unavailable provider scope

## 7) Go-Live Verification Matrix

Verify end-to-end:

1. Auth login with Google and Microsoft.
2. Command Center returns search results from normalized or fallback records.
3. Accounts and People surfaces load.
4. Conversations and Meetings surfaces show imported or fallback activity.
5. Actions tab records action executions and writeback status.
6. Notes/Briefs renders notes + documents.
7. Activity/Audit shows timeline events, action executions, and sync runs.
8. Hydra-backed memories still render in rail and generated outputs.
9. Provider readiness reflects `connected` vs `pending_approval`.
10. Run `npm run verify:rollout` from a machine that has production env vars loaded.

Rollout verifier checks:

- public app and sign-in routes respond without server errors
- authenticated workspace routes at least redirect or load cleanly
- critical Supabase tables exist in the production schema cache
- `workspace_context_pins` is present so Recent Context pinning works in live

## 8) Post-Deploy Security Checks

- Confirm no secret is exposed in client bundles.
- Confirm RLS isolation on all v1 and v2 tables.
- Confirm encrypted token fields are not stored in plaintext.
- Confirm webhook and cron endpoints reject unauthorized requests.
