-- Always surface a full slate of trades to consider: the bot now publishes up
-- to maxTradesPerDay proposals per run — the QUALIFIED ones (met every rule,
-- score ≥ threshold) plus the best NEAR-MISSES (passed the hard filters but fell
-- short of the score bar) to fill the list. `tier` distinguishes them.
alter table bot_proposals
  add column if not exists tier text not null default 'qualified'
  check (tier in ('qualified', 'near_miss'));
