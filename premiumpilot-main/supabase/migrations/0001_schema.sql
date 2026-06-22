-- PremiumPilot core schema (PRD §4).
-- Postgres / Supabase. Money stored as numeric(14,2); deltas/prices as numeric.

-- ---------- enums ----------
create type broker as enum ('schwab');
create type account_type as enum ('individual', 'ira', 'joint');
create type strategy as enum ('cash_secured_put', 'covered_call');
create type alert_type as enum ('close', 'roll', 'assignment_risk', 'cash_deployment');
create type position_status as enum ('high_risk', 'risk', 'close_candidate', 'monitor', 'hold');

-- ---------- profiles (extends auth.users) ----------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  income_goal_annual numeric(14, 2),
  notify_email boolean not null default true,
  notify_discord boolean not null default false,
  notify_web_push boolean not null default false,
  discord_webhook_url text,
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user is created.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- connected_accounts ----------
-- Token columns hold ciphertext only (encrypted in the Edge Function before
-- insert). They are never exposed to the client (see 0002_rls.sql revokes).
create table connected_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  broker broker not null default 'schwab',
  account_label text not null,
  account_type account_type not null,
  schwab_account_id text,
  encrypted_access_token text,
  encrypted_refresh_token text,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  needs_reauth boolean not null default false,
  created_at timestamptz not null default now()
);
create index connected_accounts_user_id_idx on connected_accounts (user_id);

-- ---------- account_balances (snapshot per sync) ----------
create table account_balances (
  id uuid primary key default gen_random_uuid(),
  connected_account_id uuid not null references connected_accounts (id) on delete cascade,
  net_liquidation_value numeric(14, 2) not null default 0,
  cash_balance numeric(14, 2) not null default 0,
  buying_power numeric(14, 2) not null default 0,
  synced_at timestamptz not null default now()
);
create index account_balances_account_idx on account_balances (connected_account_id, synced_at desc);

-- ---------- positions ----------
create table positions (
  id uuid primary key default gen_random_uuid(),
  connected_account_id uuid not null references connected_accounts (id) on delete cascade,
  ticker text not null,
  strategy strategy not null,
  strike numeric(12, 2) not null,
  expiration date not null,
  contracts integer not null,
  premium_collected numeric(14, 2) not null,
  current_option_value numeric(14, 2) not null default 0,
  current_underlying_price numeric(12, 2) not null default 0,
  delta numeric(6, 4) not null default 0,
  capital_requirement numeric(14, 2) not null default 0,
  opened_at timestamptz not null default now(),
  status position_status,
  synced_at timestamptz not null default now()
);
create index positions_account_idx on positions (connected_account_id);
create index positions_ticker_idx on positions (ticker);

-- ---------- alerts ----------
create table alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  position_id uuid references positions (id) on delete cascade,
  type alert_type not null,
  message text not null,
  recommendation text not null,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);
create index alerts_user_idx on alerts (user_id, created_at desc);

-- ---------- premium_history ----------
create table premium_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connected_account_id uuid references connected_accounts (id) on delete set null,
  ticker text not null,
  premium_amount numeric(14, 2) not null,
  realized_at timestamptz not null default now()
);
create index premium_history_user_idx on premium_history (user_id, realized_at desc);
