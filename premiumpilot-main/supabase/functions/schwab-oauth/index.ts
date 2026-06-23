// Schwab OAuth (PRD §5). Two modes:
//   GET ?action=authorize&user_id=...   -> redirects the user to Schwab consent
//   GET ?code=...&state=<user_id>       -> Schwab callback; exchanges + stores tokens
//
// Tokens are encrypted with AES-256-GCM before they touch the database.
import { adminClient } from "../_shared/db.ts";
import { authorizeUrl, exchangeCode, getAccounts, mapPositions } from "../_shared/schwab.ts";
import { encryptToken } from "../_shared/crypto.ts";
import { resolveStatus } from "../_shared/engine.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // Begin the auth-code flow.
  if (action === "authorize") {
    const userId = url.searchParams.get("user_id");
    if (!userId) return new Response("missing user_id", { status: 400 });
    return Response.redirect(authorizeUrl(userId), 302);
  }

  // Callback from Schwab.
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // == user_id
  if (!code || !state) return new Response("missing code/state", { status: 400 });

  try {
    const tokens = await exchangeCode(code);
    const accounts = await getAccounts(tokens.access_token);
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
      const { data: connected, error: accountError } = await db
        .from("connected_accounts")
        .upsert(
          {
            user_id: state,
            broker: "schwab",
            account_label: `Schwab ${sa.type ?? "Account"}`,
            account_type: (sa.type ?? "individual").toLowerCase().includes("ira") ? "ira" : "individual",
            schwab_account_id: sa.accountNumber ?? null,
            encrypted_access_token: encAccess,
            encrypted_refresh_token: encRefresh,
            token_expires_at: expiresAt,
            needs_reauth: false,
          },
          { onConflict: "user_id,schwab_account_id" }
        )
        .select("id")
        .single();

      if (accountError) throw accountError;

      const bal = sa.currentBalances ?? {};
      await db.from("account_balances").insert({
        connected_account_id: connected.id,
        net_liquidation_value: bal.liquidationValue ?? 0,
        cash_balance: bal.cashBalance ?? 0,
        buying_power: bal.buyingPower ?? bal.cashAvailableForTrading ?? 0,
      });

      const mapped = mapPositions(a, {});
      await db.from("positions").delete().eq("connected_account_id", connected.id);
      if (mapped.length) {
        await db.from("positions").insert(
          mapped.map((m) => ({
            connected_account_id: connected.id,
            ...m,
            status: resolveStatus(m),
          }))
        );
      }
    }

    const appUrl = Deno.env.get("APP_URL") ?? "/";
    return Response.redirect(`${appUrl}/accounts?connected=1`, 302);
  } catch (e) {
    console.error("schwab-oauth error", e);
    return new Response("oauth failed", { status: 500 });
  }
});
