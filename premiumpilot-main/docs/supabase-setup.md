# Supabase Setup

PremiumPilot uses Supabase for auth, Postgres, encrypted Schwab token storage,
Edge Functions, and scheduled sync jobs.

## 1. Create The Project

1. Create a Supabase project.
2. Save these values from **Project Settings > API**:
   - Project URL
   - anon public key
   - service role key
3. Save the project ref from the URL:
   - `https://<PROJECT_REF>.supabase.co`

Keep the service role key private. It should never be exposed to the browser.

## 2. Configure Vercel

Set these Vercel environment variables for the deployed app:

```txt
NEXT_PUBLIC_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-public-key>
APP_URL=https://<vercel-production-domain>
```

Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` should be
client-visible. Do not add `NEXT_PUBLIC_` to service-role, Schwab, Resend, or
token-encryption secrets.

## 3. Configure Supabase Auth

In **Authentication > URL Configuration**:

```txt
Site URL: https://<vercel-production-domain>
Redirect URLs:
https://<vercel-production-domain>/auth/callback
http://localhost:3000/auth/callback
```

For local development, keep `http://localhost:3000` in `supabase/config.toml`.

Enable the providers you want:

- Email/password for the simplest first test.
- Google/Apple later, after creating provider credentials.

## 4. Install Supabase CLI

```bash
brew install supabase/tap/supabase
supabase login
supabase link --project-ref <PROJECT_REF>
```

## 5. Run Migrations

From the repo root:

```bash
supabase db push
```

This applies:

- core schema
- RLS policies
- token-encryption comments/helpers
- cron jobs
- Schwab connected-account uniqueness

If cron fails because `pg_cron`, `pg_net`, or Vault is not enabled, enable them
in the Supabase dashboard and rerun the migration.

## 6. Set Edge Function Secrets

Generate the token encryption key:

```bash
openssl rand -base64 32
```

Set function secrets:

```bash
supabase secrets set \
  APP_URL=https://<vercel-production-domain> \
  SUPABASE_URL=https://<PROJECT_REF>.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  TOKEN_ENCRYPTION_KEY=<openssl-output> \
  SCHWAB_CLIENT_ID=<schwab-client-id> \
  SCHWAB_CLIENT_SECRET=<schwab-client-secret> \
  SCHWAB_REDIRECT_URI=https://<PROJECT_REF>.supabase.co/functions/v1/schwab-oauth
```

Optional notification secrets:

```bash
supabase secrets set \
  RESEND_API_KEY=<resend-key> \
  RESEND_FROM='PremiumPilot <alerts@premiumpilot.app>'
```

## 7. Deploy Edge Functions

```bash
supabase functions deploy schwab-oauth
supabase functions deploy schwab-sync
supabase functions deploy evaluate
supabase functions deploy daily-summary
```

## 8. Store Cron Secrets In Vault

Run this in Supabase SQL Editor:

```sql
select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'project_url');
select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
```

The `0004_cron.sql` migration uses those Vault values when scheduled jobs call
Edge Functions.

## 9. Create Schwab Developer App

Create a new Schwab app for PremiumPilot. Use a production callback of:

```txt
https://<PROJECT_REF>.supabase.co/functions/v1/schwab-oauth
```

For local callback testing, add a separate Schwab development app if Schwab does
not allow multiple redirect URIs cleanly.

Request the minimum read-only brokerage/account scopes needed for:

- accounts
- balances
- positions
- option positions

Avoid trading/order scopes until the product intentionally places trades.

## 10. Local Development

Create `.env.local`:

```txt
NEXT_PUBLIC_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-public-key>
APP_URL=http://localhost:3000
```

Then run:

```bash
pnpm install
pnpm dev
```

Without `NEXT_PUBLIC_SUPABASE_URL`, the app stays in demo mode.

## Security Notes

- Store Schwab access and refresh tokens only through Edge Functions.
- Keep token columns encrypted; never expose them through client queries.
- Do not log auth codes, access tokens, refresh tokens, service-role keys, or
  full Schwab account numbers.
- Rotate `TOKEN_ENCRYPTION_KEY` with a planned migration; changing it immediately
  makes existing encrypted tokens unreadable.
- Before public beta, replace the current OAuth `state=user_id` MVP flow with a
  signed/nonce-backed state value to harden CSRF and account-linking protection.
