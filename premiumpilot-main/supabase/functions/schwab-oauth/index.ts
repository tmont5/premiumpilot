/* eslint-disable @typescript-eslint/no-explicit-any */
// Schwab OAuth (PRD §5). Two modes:
//   GET ?action=authorize&user_id=...   -> redirects the user to Schwab consent
//   GET ?code=...&state=<payload>       -> Schwab callback; exchanges + stores tokens
//
// Tokens are encrypted with AES-256-GCM before they touch the database.
import { adminClient } from "../_shared/db.ts";
import {
  accountHashByNumber,
  authorizeUrl,
  exchangeCode,
  getAccountNumbers,
  getAccounts,
  getTransactions,
  mapPositions,
  mapTransactions,
} from "../_shared/schwab.ts";
import { encryptToken } from "../_shared/crypto.ts";
import { resolveStatus } from "../_shared/engine.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // Begin the auth-code flow.
  if (action === "authorize") {
    const userId = url.searchParams.get("user_id");
    if (!userId) return new Response("missing user_id", { status: 400 });
    const state = encodeState({
      user_id: userId,
      return_to: safeReturnTo(url.searchParams.get("return_to")),
    });
    return Response.redirect(authorizeUrl(state), 302);
  }

  // Callback from Schwab.
  const code = url.searchParams.get("code");
  const state = parseState(url.searchParams.get("state"));
  if (!code || !state) return new Response("missing code/state", { status: 400 });

  try {
    const tokens = await exchangeCode(code);
    const accounts = await getAccounts(tokens.access_token);
    const accountHashes = accountHashByNumber(await getAccountNumbers(tokens.access_token));
    const db = adminClient();

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    const encAccess = await encryptToken(tokens.access_token);
    const encRefresh = await encryptToken(tokens.refresh_token);

    // One connected_accounts row per Schwab account returned. Also take an
    // initial balance/position snapshot so the app has live data immediately
    // after the OAuth redirect, before the next scheduled sync runs.
    // deno-lint-ignore no-explicit-any
    for (const a of accounts as any[]) {
      const sa = a.securitiesAccount ?? {};
      const connected = await saveConnectedAccount(db, {
        user_id: state.user_id,
        broker: "schwab",
        account_label: `Schwab ${sa.type ?? "Account"}`,
        account_type: (sa.type ?? "individual").toLowerCase().includes("ira") ? "ira" : "individual",
        schwab_account_id: sa.accountNumber ?? null,
        schwab_account_hash: accountHashes[String(sa.accountNumber)] ?? null,
        encrypted_access_token: encAccess,
        encrypted_refresh_token: encRefresh,
        token_expires_at: expiresAt,
        needs_reauth: false,
      });

      const bal = sa.currentBalances ?? {};
      const { error: balanceError } = await db.from("account_balances").insert({
        connected_account_id: connected.id,
        net_liquidation_value: bal.liquidationValue ?? 0,
        cash_balance: bal.cashBalance ?? 0,
        cash_available_for_trading: bal.cashAvailableForTrading ?? bal.cashBalance ?? 0,
        available_funds: bal.availableFunds ?? bal.cashAvailableForTrading ?? bal.cashBalance ?? 0,
        buying_power: bal.buyingPower ?? bal.cashAvailableForTrading ?? 0,
      });
      if (balanceError) console.error("schwab-oauth balance insert failed", balanceError);

      const mapped = mapPositions(a, {});
      const { error: deleteError } = await db.from("positions").delete().eq("connected_account_id", connected.id);
      if (deleteError) console.error("schwab-oauth position delete failed", deleteError);
      if (mapped.length) {
        const { error: positionError } = await db.from("positions").insert(
          mapped.map((m) => ({
            connected_account_id: connected.id,
            ...m,
            status: resolveStatus(m),
          }))
        );
        if (positionError) console.error("schwab-oauth position insert failed", positionError);
      }

      const accountHash = accountHashes[String(sa.accountNumber)];
      if (accountHash) {
        await syncTransactions(db, tokens.access_token, connected.id, state.user_id, accountHash);
      }
    }

    const redirectUrl = new URL(state.return_to ?? defaultReturnTo());
    redirectUrl.searchParams.set("connected", "1");
    return Response.redirect(redirectUrl.toString(), 302);
  } catch (e) {
    console.error("schwab-oauth error", e);
    return new Response("oauth failed", { status: 500 });
  }
});

interface ConnectedAccountPayload {
  user_id: string;
  broker: "schwab";
  account_label: string;
  account_type: "individual" | "ira";
  schwab_account_id: string | null;
  schwab_account_hash: string | null;
  encrypted_access_token: string;
  encrypted_refresh_token: string;
  token_expires_at: string;
  needs_reauth: boolean;
}

async function saveConnectedAccount(db: ReturnType<typeof adminClient>, payload: ConnectedAccountPayload) {
  let query = db
    .from("connected_accounts")
    .select("id")
    .eq("user_id", payload.user_id)
    .eq("broker", "schwab")
    .limit(1);

  if (payload.schwab_account_id) {
    query = query.eq("schwab_account_id", payload.schwab_account_id);
  } else {
    query = query.is("schwab_account_id", null);
  }

  const { data: existing, error: findError } = await query.maybeSingle();
  if (findError) throw findError;

  if (existing?.id) {
    const { data, error } = await db
      .from("connected_accounts")
      .update(payload)
      .eq("id", existing.id)
      .select("id")
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await db.from("connected_accounts").insert(payload).select("id").single();
  if (error) throw error;
  return data;
}

async function syncTransactions(
  db: ReturnType<typeof adminClient>,
  accessToken: string,
  connectedAccountId: string,
  userId: string,
  accountHash: string
) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString();
  const end = now.toISOString();

  try {
    const raw = await getTransactions(accessToken, accountHash, start, end);
    const mapped = mapTransactions(raw as any[]);
    if (!mapped.length) return;

    const { error } = await db.from("account_transactions").upsert(
      mapped.map((tx) => ({
        connected_account_id: connectedAccountId,
        user_id: userId,
        ...tx,
      })),
      { onConflict: "connected_account_id,schwab_activity_id" }
    );
    if (error) console.error("schwab-oauth transaction upsert failed", error);
  } catch (error) {
    console.error("schwab-oauth transaction sync failed", error);
  }
}

interface SchwabOAuthState {
  user_id: string;
  return_to: string | null;
}

function encodeState(state: SchwabOAuthState): string {
  return btoa(JSON.stringify(state))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function parseState(raw: string | null): SchwabOAuthState | null {
  if (!raw) return null;

  // Backward compatibility for older links where state was just the user id.
  if (/^[0-9a-f-]{36}$/i.test(raw)) {
    return { user_id: raw, return_to: defaultReturnTo() };
  }

  try {
    const padded = raw.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(raw.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded));
    if (!parsed?.user_id || typeof parsed.user_id !== "string") return null;

    return {
      user_id: parsed.user_id,
      return_to: safeReturnTo(parsed.return_to),
    };
  } catch {
    return null;
  }
}

function safeReturnTo(value: unknown): string | null {
  if (typeof value !== "string") return null;

  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.hostname !== "localhost") return null;
    if (u.pathname !== "/accounts") u.pathname = "/accounts";
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function defaultReturnTo(): string {
  const appUrl = Deno.env.get("APP_URL");
  if (!appUrl) return "http://localhost:3000/accounts";

  try {
    const u = new URL(appUrl);
    u.pathname = "/accounts";
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return "http://localhost:3000/accounts";
  }
}
