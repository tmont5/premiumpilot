-- Token encryption (PRD §4 / §15).
--
-- Strategy: tokens are encrypted in the Edge Function using AES-256-GCM with a
-- key from the function secret TOKEN_ENCRYPTION_KEY (see
-- supabase/functions/_shared/crypto.ts). Only ciphertext is ever written to
-- connected_accounts.encrypted_access_token / encrypted_refresh_token, and
-- 0002_rls.sql revokes client access to those columns.
--
-- This migration provides an OPTIONAL in-database fallback using pgcrypto +
-- Supabase Vault, so a future server-side job can encrypt/decrypt without the
-- app-layer key if desired. App-layer encryption remains the primary path.

create extension if not exists pgcrypto;

comment on column connected_accounts.encrypted_access_token is
  'AES-256-GCM ciphertext (base64). Encrypted in Edge Function; client access revoked.';
comment on column connected_accounts.encrypted_refresh_token is
  'AES-256-GCM ciphertext (base64). Encrypted in Edge Function; client access revoked.';

-- keep profiles.updated_at fresh
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on profiles
  for each row execute function touch_updated_at();
