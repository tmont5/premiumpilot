-- Row Level Security (PRD §15). Every table is user-scoped. Edge Functions use
-- the service-role key, which bypasses RLS, to write synced data.

alter table profiles enable row level security;
alter table connected_accounts enable row level security;
alter table account_balances enable row level security;
alter table positions enable row level security;
alter table alerts enable row level security;
alter table premium_history enable row level security;

-- profiles: a user owns exactly their row.
create policy "profiles_select_own" on profiles
  for select using (id = auth.uid());
create policy "profiles_update_own" on profiles
  for update using (id = auth.uid());

-- connected_accounts: owned via user_id.
create policy "accounts_select_own" on connected_accounts
  for select using (user_id = auth.uid());
create policy "accounts_modify_own" on connected_accounts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- account_balances + positions: owned transitively through connected_accounts.
create policy "balances_select_own" on account_balances
  for select using (
    exists (
      select 1 from connected_accounts ca
      where ca.id = account_balances.connected_account_id and ca.user_id = auth.uid()
    )
  );

create policy "positions_select_own" on positions
  for select using (
    exists (
      select 1 from connected_accounts ca
      where ca.id = positions.connected_account_id and ca.user_id = auth.uid()
    )
  );

-- alerts: users can read and acknowledge their own alerts.
create policy "alerts_select_own" on alerts
  for select using (user_id = auth.uid());
create policy "alerts_update_own" on alerts
  for update using (user_id = auth.uid());

-- premium_history: read-only for the owner.
create policy "premium_select_own" on premium_history
  for select using (user_id = auth.uid());

-- Defense in depth: encrypted token columns must never reach the client even
-- if a future policy is too permissive. Revoke column privileges from the
-- client roles; only the service role (used by Edge Functions) can touch them.
revoke select (encrypted_access_token, encrypted_refresh_token) on connected_accounts from anon, authenticated;
revoke insert (encrypted_access_token, encrypted_refresh_token) on connected_accounts from anon, authenticated;
revoke update (encrypted_access_token, encrypted_refresh_token) on connected_accounts from anon, authenticated;
