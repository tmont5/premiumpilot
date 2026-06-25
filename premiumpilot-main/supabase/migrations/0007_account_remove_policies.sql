-- Allow authenticated users to remove their own synced account data through
-- the server-side account deletion route. Policies stay scoped to rows owned
-- by the current auth user.

create policy "balances_delete_own" on account_balances
  for delete using (
    exists (
      select 1 from connected_accounts ca
      where ca.id = account_balances.connected_account_id and ca.user_id = auth.uid()
    )
  );

create policy "positions_delete_own" on positions
  for delete using (
    exists (
      select 1 from connected_accounts ca
      where ca.id = positions.connected_account_id and ca.user_id = auth.uid()
    )
  );

create policy "transactions_delete_own" on account_transactions
  for delete using (user_id = auth.uid());

create policy "alerts_delete_own" on alerts
  for delete using (user_id = auth.uid());

create policy "premium_update_own" on premium_history
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
