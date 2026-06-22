// Daily evaluation engine (PRD §10). Runs once daily ahead of the 7AM summary.
// Generates close / roll / assignment_risk / cash_deployment alerts for every
// user from their persisted positions + latest balances.
import { adminClient } from "../_shared/db.ts";
import { alertsForPositions, cashDeploymentAlert, type Pos } from "../_shared/engine.ts";

Deno.serve(async () => {
  const db = adminClient();

  const { data: accounts } = await db.from("connected_accounts").select("id, user_id");
  if (!accounts?.length) return json({ users: 0 });

  // Group accounts by user.
  const byUser = new Map<string, string[]>();
  for (const a of accounts) {
    byUser.set(a.user_id, [...(byUser.get(a.user_id) ?? []), a.id]);
  }

  let inserted = 0;
  for (const [userId, accountIds] of byUser) {
    const { data: positions } = await db
      .from("positions")
      .select("id, ticker, strategy, strike, expiration, premium_collected, current_option_value, current_underlying_price, delta, capital_requirement")
      .in("connected_account_id", accountIds);

    const { data: balances } = await db
      .from("account_balances")
      .select("connected_account_id, buying_power, synced_at")
      .in("connected_account_id", accountIds)
      .order("synced_at", { ascending: false });

    // latest buying power per account, summed
    const seen = new Set<string>();
    let buyingPower = 0;
    for (const b of balances ?? []) {
      if (seen.has(b.connected_account_id)) continue;
      seen.add(b.connected_account_id);
      buyingPower += Number(b.buying_power);
    }

    const rows = alertsForPositions((positions ?? []) as Pos[]);
    const cash = cashDeploymentAlert(buyingPower);
    if (cash) rows.push(cash);

    if (rows.length) {
      // Clear unacknowledged auto-alerts from the prior run, then insert fresh.
      await db.from("alerts").delete().eq("user_id", userId).is("acknowledged_at", null);
      await db.from("alerts").insert(rows.map((r) => ({ ...r, user_id: userId })));
      inserted += rows.length;
    }
  }

  return json({ users: byUser.size, alerts: inserted });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
