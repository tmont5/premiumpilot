-- Let a user exclude specific stock holdings from the analysis (Accounts page).
-- Keyed by (connected_account_id, ticker) rather than the equity_holdings row id,
-- because the sync replaces equity_holdings (delete-then-insert) on every run, so
-- a row-id or per-row flag would be wiped. Ticker+account is stable across syncs.

create table if not exists excluded_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connected_account_id uuid not null references connected_accounts (id) on delete cascade,
  ticker text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists excluded_holdings_account_ticker_uidx
  on excluded_holdings (connected_account_id, ticker);
create index if not exists excluded_holdings_user_idx on excluded_holdings (user_id);

alter table excluded_holdings enable row level security;

-- A user manages exactly their own exclusions (the app writes with the user's
-- session, so RLS is the enforcement — no service role needed here).
create policy "excluded_holdings_select_own" on excluded_holdings
  for select using (user_id = auth.uid());
create policy "excluded_holdings_insert_own" on excluded_holdings
  for insert with check (user_id = auth.uid());
create policy "excluded_holdings_delete_own" on excluded_holdings
  for delete using (user_id = auth.uid());
