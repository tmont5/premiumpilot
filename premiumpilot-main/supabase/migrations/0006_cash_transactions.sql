-- Store more precise Schwab cash fields and transaction history for income/P&L pages.

alter table connected_accounts
  add column if not exists schwab_account_hash text;

alter table account_balances
  add column if not exists cash_available_for_trading numeric(14, 2) not null default 0,
  add column if not exists available_funds numeric(14, 2) not null default 0;

create table if not exists account_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connected_account_id uuid not null references connected_accounts (id) on delete cascade,
  schwab_activity_id text not null,
  type text,
  status text,
  description text,
  symbol text,
  asset_type text,
  transaction_time timestamptz not null,
  net_amount numeric(14, 2) not null default 0,
  realized_gain_loss numeric(14, 2),
  fees numeric(14, 2),
  price numeric(14, 4),
  quantity numeric(14, 4),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists account_transactions_account_activity_uidx
  on account_transactions (connected_account_id, schwab_activity_id);
create index if not exists account_transactions_user_time_idx
  on account_transactions (user_id, transaction_time desc);

alter table account_transactions enable row level security;

create policy "transactions_select_own" on account_transactions
  for select using (user_id = auth.uid());
