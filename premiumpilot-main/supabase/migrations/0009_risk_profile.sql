-- Portfolio Risk Recommendation Engine (PRD §4.1): the risk engine sizes its
-- target allocation bands off the user's chosen risk profile, and treats margin
-- vs. cash/IRA accounts differently (leverage warnings, forced-liquidation risk).
-- Persist both on the profile so Settings can drive the Risk page.

alter table profiles
  add column if not exists risk_profile text not null default 'balanced',
  add column if not exists account_type text not null default 'cash';

-- Guard against typos writing nonsense the engine can't band.
alter table profiles
  drop constraint if exists profiles_risk_profile_check;
alter table profiles
  add constraint profiles_risk_profile_check
  check (risk_profile in ('conservative', 'balanced', 'aggressive'));

alter table profiles
  drop constraint if exists profiles_account_type_check;
alter table profiles
  add constraint profiles_account_type_check
  check (account_type in ('cash', 'margin', 'ira'));
