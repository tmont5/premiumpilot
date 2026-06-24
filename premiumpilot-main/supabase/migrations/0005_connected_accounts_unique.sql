-- Required by schwab-oauth upsert(..., { onConflict: "user_id,schwab_account_id" }).
-- Postgres unique indexes still allow multiple null schwab_account_id values,
-- while Schwab account reconnects become idempotent for real account numbers.
create unique index if not exists connected_accounts_user_schwab_account_uidx
  on connected_accounts (user_id, schwab_account_id);
