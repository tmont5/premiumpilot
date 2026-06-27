/* eslint-disable @typescript-eslint/no-explicit-any */
// Scheduled sync (PRD §5): runs every 15 minutes. For each connected account:
//   1. refresh the access token if it is near expiry (flag re-auth on failure)
//   2. pull balances + option positions
//   3. persist a balance snapshot and replace the position set (status computed)
//   4. re-evaluate risk alerts (assignment risk) on each sync
//
// Dashboard reads persisted snapshots, so it stays fast between syncs.
import { adminClient } from "../_shared/db.ts";
import { decryptToken, encryptToken } from "../_shared/crypto.ts";
import {
  accountHashByNumber,
  getAccountNumbers,
  getAccounts,
  getTransactions,
  mapPositions,
  mapTransactions,
  refreshTokens,
} from "../_shared/schwab.ts";
import { alertsForPositions, resolveStatus } from "../_shared/engine.ts";

const REFRESH_SKEW_MS = 5 * 60 * 1000; // refresh if expiring within 5 min

Deno.serve(async () => {
  const db = adminClient();
  const { data: accounts, error } = await db
    .from("connected_accounts")
    .select("id, user_id, schwab_account_id, schwab_account_hash, encrypted_access_token, encrypted_refresh_token, token_expires_at, needs_reauth");
  if (error) return json({ error: error.message }, 500);

  const results: Record<string, string> = {};

  for (const acct of accounts ?? []) {
    try {
      let accessToken = await decryptToken(acct.encrypted_access_token);

      // Refresh if expiring soon.
      const expMs = acct.token_expires_at ? new Date(acct.token_expires_at).getTime() : 0;
      if (expMs - Date.now() < REFRESH_SKEW_MS) {
        const refresh = await decryptToken(acct.encrypted_refresh_token);
        const tokens = await refreshTokens(refresh);
        accessToken = tokens.access_token;
        await db
          .from("connected_accounts")
          .update({
            encrypted_access_token: await encryptToken(tokens.access_token),
            encrypted_refresh_token: await encryptToken(tokens.refresh_token),
            token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
            needs_reauth: false,
          })
          .eq("id", acct.id);
      }

      const raw = await getAccounts(accessToken);
      const accountHashes = accountHashByNumber(await getAccountNumbers(accessToken));
      // deno-lint-ignore no-explicit-any
      const account = (raw as any[]).find(
        (a) => a.securitiesAccount?.accountNumber === acct.schwab_account_id
      ) ?? (raw as unknown[])[0];
      // deno-lint-ignore no-explicit-any
      const sa: any = (account as any)?.securitiesAccount ?? {};
      const bal = sa.currentBalances ?? {};
      const accountHash = accountHashes[String(sa.accountNumber)] ?? acct.schwab_account_hash;
      if (accountHash && accountHash !== acct.schwab_account_hash) {
        await db.from("connected_accounts").update({ schwab_account_hash: accountHash }).eq("id", acct.id);
      }

      // Balance snapshot.
      await db.from("account_balances").insert({
        connected_account_id: acct.id,
        net_liquidation_value: bal.liquidationValue ?? 0,
        cash_balance: bal.cashBalance ?? 0,
        cash_available_for_trading: bal.cashAvailableForTrading ?? bal.cashBalance ?? 0,
        available_funds: bal.availableFunds ?? bal.cashAvailableForTrading ?? bal.cashBalance ?? 0,
        buying_power: bal.buyingPower ?? bal.cashAvailableForTrading ?? 0,
      });

      // Positions: map, compute status, replace set.
      const mapped = mapPositions(account, {}); // underlying prices resolved upstream in production
      await db.from("positions").delete().eq("connected_account_id", acct.id);
      if (mapped.length) {
        await db.from("positions").insert(
          mapped.map((m) => ({
            connected_account_id: acct.id,
            ...m,
            status: resolveStatus(m),
          }))
        );
      }

      // Re-evaluate risk alerts each sync.
      const risk = alertsForPositions(mapped).filter((a) => a.type === "assignment_risk");
      if (risk.length) {
        await db.from("alerts").insert(
          risk.map((a) => ({ ...a, user_id: acct.user_id }))
        );
      }

      if (accountHash) {
        await syncTransactions(db, accessToken, acct.id, acct.user_id, accountHash);
      }

      await db.from("connected_accounts").update({ last_synced_at: new Date().toISOString() }).eq("id", acct.id);
      results[acct.id] = "ok";
    } catch (e) {
      console.error("sync failed", acct.id, e);
      await db.from("connected_accounts").update({ needs_reauth: true }).eq("id", acct.id);
      results[acct.id] = "needs_reauth";
    }
  }

  return json({ synced: results });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const TX_LOOKBACK_DAYS = 400; // > 12 months so rolling-12 income is fully covered
const TX_SLICE_DAYS = 360; // Schwab caps each request at ~1 year
// Realized option income needs both executed trades and the expiration/assignment
// records (where a sold option's premium is finally realized).
const TX_TYPES = ["TRADE", "RECEIVE_AND_DELIVER"];

async function syncTransactions(
  db: ReturnType<typeof adminClient>,
  accessToken: string,
  connectedAccountId: string,
  userId: string,
  accountHash: string
) {
  const raw: any[] = [];
  for (const w of transactionWindows(new Date(), TX_LOOKBACK_DAYS, TX_SLICE_DAYS)) {
    for (const type of TX_TYPES) {
      try {
        const page = await getTransactions(accessToken, accountHash, w.start, w.end, type);
        if (Array.isArray(page)) raw.push(...page);
      } catch (e) {
        console.error("transaction fetch failed", type, w.start, e);
      }
    }
  }

  // Overlapping windows/types can repeat an activity; dedupe before upserting.
  const seen = new Set<string>();
  const rows = [];
  for (const tx of mapTransactions(raw)) {
    if (seen.has(tx.schwab_activity_id)) continue;
    seen.add(tx.schwab_activity_id);
    rows.push({ connected_account_id: connectedAccountId, user_id: userId, ...tx });
  }
  if (!rows.length) return;

  const { error } = await db
    .from("account_transactions")
    .upsert(rows, { onConflict: "connected_account_id,schwab_activity_id" });
  if (error) throw error;
}

// Trailing date windows (newest last), each within Schwab's per-request range cap.
function transactionWindows(now: Date, lookbackDays: number, sliceDays: number) {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const windows: { start: string; end: string }[] = [];
  let cursor = now.getTime() - lookbackDays * MS_PER_DAY;
  while (cursor < now.getTime()) {
    const end = Math.min(cursor + sliceDays * MS_PER_DAY, now.getTime());
    windows.push({ start: new Date(cursor).toISOString(), end: new Date(end).toISOString() });
    cursor = end;
  }
  return windows;
}
