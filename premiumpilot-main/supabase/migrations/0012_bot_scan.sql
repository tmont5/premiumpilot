-- Chunked scanning for the wheel bot. A full ~236-name scan (price history +
-- fundamentals + option chain + earnings per ticker) far exceeds one edge
-- invocation and Schwab's rate limits, so bot-run advances a cursor across the
-- approved universe over several invocations, stages the best contract per
-- ticker, and finalizes (ranks + publishes) once the universe is covered.

alter table bot_proposals add column if not exists details jsonb not null default '{}'::jsonb;
alter table bot_runs add column if not exists report jsonb;

-- Allow a 'partial' run status (a chunk that advanced but didn't finalize).
alter table bot_runs drop constraint if exists bot_runs_status_check;
alter table bot_runs add constraint bot_runs_status_check
  check (status in ('ok', 'error', 'skipped', 'partial'));

create table if not exists bot_scan_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  scan_date date not null,
  cursor int not null default 0,
  universe_size int not null default 0,
  spy_return20 numeric(10, 6),
  earnings jsonb not null default '{}'::jsonb,       -- TICKER → next earnings date, per scan
  earnings_available boolean not null default false, -- false → event filter fails closed
  contracts_evaluated int not null default 0,
  rejected_before_options int not null default 0,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bot_scan_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  scan_date date not null,
  ticker text not null,
  score numeric(8, 2) not null default 0,
  best jsonb,       -- ScoredTrade, when a contract qualified
  rejection jsonb,  -- RejectedTrade, otherwise
  created_at timestamptz not null default now()
);
create unique index if not exists bot_scan_candidates_uidx
  on bot_scan_candidates (user_id, scan_date, ticker);

alter table bot_scan_state enable row level security;
alter table bot_scan_candidates enable row level security;
create policy bot_scan_state_select_own on bot_scan_state for select using (user_id = auth.uid());
create policy bot_scan_candidates_select_own on bot_scan_candidates for select using (user_id = auth.uid());

-- Advance the chunked scan through the pre-close window (weekdays). Each call
-- processes a batch; the scan finalizes when the cursor covers the universe.
select cron.unschedule('bot-run');
select cron.schedule('bot-run', '*/5 18-20 * * 1-5', $$ select invoke_edge('bot-run'); $$);
