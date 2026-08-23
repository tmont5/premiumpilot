-- Options trading bot (propose → approve model). The bot evaluates once per
-- trading day (pg_cron) — or on a manual "Run now" — and writes up to
-- max_trades_per_day PROPOSALS. It never places orders; the user approves or
-- rejects each proposal on the Bot page. (Live order placement is a separate,
-- gated feature that would require a Schwab trading OAuth scope + per-trade
-- confirmation; this schema is forward-compatible with it via the 'executed'
-- status and 'auto' mode, but neither is wired yet.)

-- Per-user bot configuration.
create table if not exists bot_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  max_trades_per_day int not null default 5 check (max_trades_per_day between 0 and 20),
  mode text not null default 'proposal' check (mode in ('proposal', 'paper', 'auto')),
  universe text[] not null default '{}',      -- tickers the bot may trade
  config jsonb not null default '{}'::jsonb,   -- rule parameters (criteria TBD)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per evaluation run (cron or manual), for observability.
create table if not exists bot_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trigger text not null default 'cron' check (trigger in ('cron', 'manual')),
  status text not null default 'ok' check (status in ('ok', 'error', 'skipped')),
  candidates_evaluated int not null default 0,
  proposals_created int not null default 0,
  message text,
  ran_at timestamptz not null default now()
);
create index if not exists bot_runs_user_idx on bot_runs (user_id, ran_at desc);

-- The trade proposals themselves.
create table if not exists bot_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid references bot_runs (id) on delete set null,
  ticker text not null,
  strategy text not null check (strategy in ('cash_secured_put', 'covered_call')),
  strike numeric(14, 2) not null,
  expiration date not null,
  contracts int not null default 1 check (contracts > 0),
  option_symbol text,
  limit_price numeric(14, 4),        -- proposed premium per share
  est_premium numeric(14, 2),        -- total $ credit (limit_price * 100 * contracts)
  capital_required numeric(14, 2),
  score numeric(8, 2),
  rationale text,
  criteria jsonb not null default '{}'::jsonb,   -- snapshot of why it was chosen
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'rejected', 'expired', 'executed')),
  decided_at timestamptz,
  trade_date date not null default ((now() at time zone 'utc')::date),
  created_at timestamptz not null default now()
);
create index if not exists bot_proposals_user_idx on bot_proposals (user_id, created_at desc);
create index if not exists bot_proposals_status_idx on bot_proposals (user_id, status);

alter table bot_settings enable row level security;
alter table bot_runs enable row level security;
alter table bot_proposals enable row level security;

-- The edge function writes via the service role (bypasses RLS). Users read their
-- own rows and manage their own settings + proposal decisions.
create policy bot_settings_select_own on bot_settings for select using (user_id = auth.uid());
create policy bot_settings_insert_own on bot_settings for insert with check (user_id = auth.uid());
create policy bot_settings_update_own on bot_settings for update using (user_id = auth.uid());

create policy bot_runs_select_own on bot_runs for select using (user_id = auth.uid());

create policy bot_proposals_select_own on bot_proposals for select using (user_id = auth.uid());
create policy bot_proposals_update_own on bot_proposals for update using (user_id = auth.uid());

-- Daily evaluation, weekdays at 15:00 UTC (~10–11am ET, after the open).
-- invoke_edge + the vault secrets are defined in 0004_cron.sql.
select cron.schedule('bot-run', '0 15 * * 1-5', $$ select invoke_edge('bot-run'); $$);
