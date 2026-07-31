import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { EXCLUSIONS_COOKIE, holdingKey } from "@/lib/data";

// Toggle whether a stock holding is excluded from the analysis (Accounts page).
// Body: { connected_account_id, ticker, excluded }. Live mode persists to the
// excluded_holdings table (RLS-scoped to the user); demo mode has no DB, so the
// exclusion set is stored in a cookie that getPortfolio() reads.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const accountId = typeof body?.connected_account_id === "string" ? body.connected_account_id : "";
  const ticker = typeof body?.ticker === "string" ? body.ticker.trim() : "";
  const excluded = Boolean(body?.excluded);
  if (!accountId || !ticker) {
    return NextResponse.json({ error: "connected_account_id and ticker are required" }, { status: 400 });
  }

  const supabase = await createClient();

  // Demo mode (no backend): persist the exclusion set in a cookie.
  if (!supabase) {
    const store = await cookies();
    const current = readCookieKeys(store.get(EXCLUSIONS_COOKIE)?.value);
    const key = holdingKey(accountId, ticker);
    if (excluded) current.add(key);
    else current.delete(key);
    const res = NextResponse.json({ ok: true, demo: true });
    res.cookies.set(EXCLUSIONS_COOKIE, JSON.stringify([...current]), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return res;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!UUID_RE.test(accountId)) {
    return NextResponse.json({ error: "Invalid account id" }, { status: 400 });
  }

  // Confirm the account belongs to this user before writing an exclusion for it.
  const { data: account, error: lookupError } = await supabase
    .from("connected_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Could not verify account" }, { status: 500 });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  if (excluded) {
    const { error } = await supabase
      .from("excluded_holdings")
      .upsert(
        { user_id: user.id, connected_account_id: accountId, ticker },
        { onConflict: "connected_account_id,ticker" }
      );
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  } else {
    const { error } = await supabase
      .from("excluded_holdings")
      .delete()
      .eq("user_id", user.id)
      .eq("connected_account_id", accountId)
      .eq("ticker", ticker);
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}

function readCookieKeys(value: string | undefined): Set<string> {
  if (!value) return new Set();
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}
