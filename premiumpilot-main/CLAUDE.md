# PremiumPilot — Context for Claude Code

Handoff/context doc so a new chat can continue building without re-discovering everything. Keep it updated as the app evolves.

## What this is
An **options-income portfolio app** (cash-secured/short puts + covered calls). It imports brokerage positions and turns them into decisions (close / roll / hold / deploy cash). **Informational analytics only — NOT personalized investment advice.** That framing is load-bearing, especially for the Advisor feature — keep outputs to "considerations & tradeoffs," never trade directives.

## ⚠️ Repo layout quirk (read first)
- GitHub repo: **`tmont5/premiumpilot`** (public). This is canonical. There is a separate, unrelated `montigby/premiumpilot` (an older MVP) — do not confuse them.
- **The entire project is nested under `premiumpilot-main/`** at the repo root (a "Download ZIP" artifact). All app code, `package.json`, `supabase/`, etc. live in `premiumpilot-main/`. **Run all pnpm/tsc/eslint/build commands from `premiumpilot-main/`.**
- Because of the nesting, GitHub Actions workflows live at the **repo root** `.github/workflows/` but reference paths like `premiumpilot-main/supabase/**`.

## Tech stack
Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn-style UI · Recharts · Supabase (Postgres + Auth + **Deno** Edge Functions) · **pnpm**.

## Demo vs Live mode (critical mental model)
- `isDemoMode()` (`src/lib/data.ts`) is true when `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` are unset. **Demo mode runs entirely off in-repo seed data** (`src/lib/seed.ts`) so every screen works with no backend. This is how you verify UI locally.
- Production has Supabase env set → **live mode** → Supabase-auth-gated (unauthenticated pages redirect to `/login`).
- **`getPortfolio()` is the single data entry point.** Demo → seed; live → `getLivePortfolio()` (Supabase queries). Everything renders from the `PortfolioView` it returns (`src/lib/portfolio.ts`).

## The engine (`src/lib/`) — deterministic, storage-agnostic
`calc.ts` (per-position metrics: dte, profitCapture, ROC, annualized, distanceFromStrike, probabilityItm/assignmentRisk from |delta|) · `status.ts` · `score.ts` · `alerts.ts` · `pnl.ts` · `trades.ts` (reconstructs closed trades + realized income from transactions) · `config.ts` · `portfolio.ts` (`buildPortfolio()` assembles the view) · `advisor.ts` (AI snapshot + prompts + schema, model-agnostic) · `types.ts`. **The AI is a synthesis layer — feed it these already-computed numbers; don't let it re-derive math.**

## Integrations

### Schwab (brokerage) — Edge Functions in `supabase/functions/`
- `schwab-sync/index.ts` = the 15-min cron sync. `_shared/schwab.ts` = API client. Also `schwab-oauth`, `_shared/{crypto,db,engine}.ts`.
- Sync flow: refresh token → `getAccounts` (balances + positions) → **Market Data `getQuotes`** (underlying prices + option greeks/delta) → `mapPositions`/`mapEquityPositions` → replace `positions` & `equity_holdings` → `syncTransactions`.
- The **Market Data API** supplies underlying prices + option deltas (the account-positions payload lacks both). Without it, Prob. Assigned / Dist. Strike / covered-call capital / heatmap / score all compute from zeros.
- **Option symbol parsing:** OCC format `"AAPL  260117P00185000"`. Schwab account-position instruments do **not** reliably include `strikePrice`/`putCall` — parse them from the symbol (`strikeFromSymbol`, `putCallFromSymbol`, `optionExpiration` in `schwab.ts`). A missing INTU-style position is usually a filter/parse issue *or* an expired connection (below).
- **⚠️ Schwab refresh tokens expire every ~7 days** → the account is flagged `needs_reauth`, the sync fails at the token step (`token refresh failed: 400`), and positions silently go stale. **The only fix is re-running OAuth** (the app's **Reconnect** button — Accounts page or the Dashboard re-auth banner). An expired refresh token cannot be refreshed via the Schwab developer portal.
- Manual refresh: header **Refresh** button → `POST /api/sync` (Next route, auth-scoped to the user) → invokes `schwab-sync`. It logs `[api/sync] result {...}` to **Vercel** logs — a per-account diagnostic including `optionsSeen` (from `describeOptionPositions`). **`describeOptionPositions`/`optionsSeen` is a TEMPORARY diagnostic — remove it once the current position-sync issue is confirmed resolved.**

### OpenAI (Advisor) — uses OpenAI, NOT Claude
- The user chose OpenAI for the Advisor. Uses the `openai` SDK. Model default `gpt-4o`, overridable via `OPENAI_MODEL` env. **Do not "helpfully" switch it back to Anthropic.**
- Routes: `/api/advisor` (one-shot structured `json_schema` analysis) and `/api/advisor/chat` (grounded chat over the snapshot). Both need `OPENAI_API_KEY`; both degrade gracefully (503) without it.
- **⚠️ The env var must be named exactly `OPENAI_API_KEY`** (a var named `openai` is ignored).
- Guardrails live in `ADVISOR_SYSTEM_PROMPT` / `ADVISOR_CHAT_SYSTEM_PROMPT`.

## Deployment
- **Vercel** auto-deploys the Next app on push to `main` (project `prj_TuYktgq7t6VqShipWkeGhBr3u07M`, `premiumpilot.vercel.app`).
- **Supabase Edge Functions & migrations are NOT deployed by Vercel.** The GitHub Action `.github/workflows/deploy-supabase.yml` deploys them on push to `main` touching `premiumpilot-main/supabase/**` (or manual dispatch). Requires repo secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`. **So any `supabase/**` change ships automatically when merged to main.**
- Prod env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `OPENAI_API_KEY` (Vercel); Schwab creds + token-encryption key + Supabase service key (Supabase Edge Function secrets, not committed).
- Assistant access note: Claude can reach Vercel (MCP) and this GitHub repo (`gh`), but **not** the premiumpilot Supabase project directly — DB/function changes must go through the CI workflow, not an MCP.

## Workflow conventions (follow these)
- **Never commit to `main`.** Branch → PR → **squash** merge → delete branch. The repo does not auto-delete merged branches, so delete them explicitly.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Before shipping, from `premiumpilot-main/`: `npx tsc --noEmit`, `npx eslint <changed files>`, `pnpm build`. Verify UI in **demo mode** via the preview/dev-server tools.
- You **cannot** test live Schwab or OpenAI without keys. Verify the demo path, reason about the live path, and make live-data code degrade gracefully (never 500).

## Gotchas learned (don't repeat)
- Missing-table errors from PostgREST are **`PGRST205`**, not `42P01`. Guard for both / degrade gracefully (once cost us a full-site 500).
- Positions sync = delete-then-insert per account; a single bad row fails the whole array insert (drops ALL positions). Insert errors are now checked; only delete when there are replacements.
- Covered-call **capital shows $0 on the Positions table** (backing shares are counted in Assigned Holdings; including the notional double-counts). NOTE: Dashboard "Capital Reserved/Utilized" still include covered-call notional — not yet reconciled.
- Next.js treats **`_`-prefixed folders** under `app/` as private (non-routed) — don't put routes there.
- `positions.delta` is `numeric(6,4)`; option deltas are in [-1,1] so they fit.

## What's built so far
Positions (Short Put label, totals row, Prob. Assigned, Stock Price column, $0 covered-call capital, positive profit-capture in green) · Assigned Holdings section on Positions & Trades pages · Trades & P/L page (history, breakeven, cumulative P/L; live income/trades derived from transactions) · header Refresh button (per-user sync) · Market-data quotes (prices + greeks) · Advisor page (OpenAI): one-shot analysis + chat · Re-auth Reconnect button + Dashboard banner · CI Supabase-deploy Action.

## ⏳ Requested but NOT yet built (next up)
1. **Dashboard: net capital invested** — the amount the user initially put in for investing, net of all **deposits and withdrawals** (net cash contributed). Source: Schwab `account_transactions` cash-movement types. The sync currently fetches only `TRADE` + `RECEIVE_AND_DELIVER`; deposits/withdrawals are other types (e.g. `ACH_RECEIPT`, `CASH_RECEIPT`, `ELECTRONIC_FUND`, `WIRE_*`), so the sync must also pull those, store/sum net cash flow, and surface a Dashboard stat.
2. **Total put-assignment exposure** — the dollar amount of stock you'd have to take possession of if **all open short puts were assigned** = Σ(strike × 100 × contracts) over `cash_secured_put` positions. (This already equals the sum of short-put `capital_requirement`, and — since covered calls are now $0 — roughly the current Positions "Total" capital. The ask is to surface it explicitly, likely as a **Dashboard stat**.) Add it.
3. **Remove the temporary `describeOptionPositions` / `optionsSeen` diagnostic** from `schwab-sync` once the position-sync issue is confirmed resolved.

## Outstanding ops items (user-side)
- Reconnect Schwab (token expired — `needs_reauth`) so live data syncs again.
- Ensure `OPENAI_API_KEY` is set in Vercel with that exact name (was mistakenly added as `openai`).
