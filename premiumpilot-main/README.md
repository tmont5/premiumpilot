# PremiumPilot

An options-income portfolio management platform. It connects to a brokerage
account (Charles Schwab for the MVP), imports option positions, and turns raw
position data into **decisions** — close, roll, hold, or deploy cash. Core
philosophy: _users view decisions, not positions._

> ⚠️ Informational analytics only. PremiumPilot does not place trades and does
> not provide personalized investment advice.

## Status

This repo is the MVP build. It currently runs in **demo mode** against a built-in
dataset so every screen is fully usable without a live database or brokerage
connection. The Supabase schema, Edge Functions, and Schwab integration are all
written and ready to provision (see below).

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Next.js (App Router), Tailwind v4, shadcn-style UI, Recharts |
| Backend | Supabase (Postgres + Edge Functions) |
| Auth | Supabase Auth — Google, Apple, email |
| Brokerage | Schwab API (OAuth 2.0, AES-256-GCM token encryption, auto-refresh) |
| Notifications | Resend (email), Discord webhook, web push |
| Scheduling | Supabase cron (pg_cron + pg_net) |

## Local development

```bash
pnpm install
pnpm dev        # http://localhost:3000  (demo mode)
pnpm build      # production build
```

## Architecture

- `src/lib/` — storage-agnostic engine: `calc.ts`, `status.ts`, `score.ts`,
  `alerts.ts`, `portfolio.ts`. All tunable thresholds live in `config.ts`
  (PRD §14 "open decisions" are isolated and documented here).
- `src/lib/data.ts` — the data seam. `getPortfolio()` returns demo data until
  `NEXT_PUBLIC_SUPABASE_URL` is set, then swaps to live Supabase queries.
- `src/app/(app)/` — Dashboard, Positions, Heat Map, Cash, Income, Accounts,
  Settings. `src/app/login` — auth.
- `supabase/migrations/` — schema, RLS, token-encryption notes, cron.
- `supabase/functions/` — `schwab-oauth`, `schwab-sync` (15-min), `evaluate`
  (daily alerts), `daily-summary` (7AM email/Discord/push).

## Going live

1. Provision a Supabase project and run the migrations in `supabase/migrations`.
2. Set env vars (see `.env.example`) in Vercel and via `supabase secrets set`.
3. Configure Google/Apple/email providers in Supabase Auth.
4. Add Schwab API credentials once your developer app is approved.
5. Store `project_url` + `service_role_key` in Supabase Vault, then run
   `0004_cron.sql` to activate the scheduled jobs.

Detailed provisioning steps live in `docs/supabase-setup.md`.

## Engine formulas (PRD §6–§8)

Profit Capture %, Annualized Return, Distance From Strike, ROC, DTE,
Probability ITM (delta proxy) and the 5-component weighted Portfolio Score are
implemented in `src/lib`. Status rules (§7) are strategy-aware so covered calls
are evaluated symmetrically to cash-secured puts. See inline comments for the
documented defaults behind each tunable.
