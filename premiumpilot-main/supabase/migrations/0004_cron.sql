-- Scheduled Edge Functions (PRD §5 / §11) via pg_cron + pg_net.
--
-- Before running this on a live project, store two secrets in Supabase Vault:
--   select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'project_url');
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
-- The cron jobs read them so no secret is hardcoded in SQL.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function invoke_edge(fn text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare
  base text;
  key text;
begin
  select decrypted_secret into base from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into key from vault.decrypted_secrets where name = 'service_role_key';
  perform net.http_post(
    url := base || '/functions/v1/' || fn,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key),
    body := '{}'::jsonb
  );
end;
$$;

-- Poll Schwab balances + positions every 15 minutes (PRD §5).
select cron.schedule('schwab-sync', '*/15 * * * *', $$ select invoke_edge('schwab-sync'); $$);

-- Daily alert evaluation just before the morning summary window.
select cron.schedule('evaluate', '50 * * * *', $$ select invoke_edge('evaluate'); $$);

-- Hourly trigger for the 7AM-local summary; the function filters by user tz.
select cron.schedule('daily-summary', '0 * * * *', $$ select invoke_edge('daily-summary'); $$);
