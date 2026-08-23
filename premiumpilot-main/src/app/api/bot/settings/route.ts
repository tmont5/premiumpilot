import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Save the user's bot configuration (enable/disable, daily cap, ticker universe,
// rule parameters). Mode is pinned to 'proposal' — auto-execution is not wired.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ ok: true, demo: true });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const b = body as Record<string, unknown>;
  const update: Record<string, unknown> = { user_id: user.id, updated_at: new Date().toISOString() };
  if ("enabled" in b) update.enabled = Boolean(b.enabled);
  if ("max_trades_per_day" in b) {
    const n = Number(b.max_trades_per_day);
    if (Number.isFinite(n)) update.max_trades_per_day = Math.min(20, Math.max(0, Math.round(n)));
  }
  if (Array.isArray(b.universe)) {
    update.universe = [
      ...new Set(
        (b.universe as unknown[])
          .map((t) => String(t).trim().toUpperCase())
          .filter((t) => /^[A-Z.]{1,6}$/.test(t))
      ),
    ].slice(0, 50);
  }
  if (b.config && typeof b.config === "object" && !Array.isArray(b.config)) {
    update.config = b.config;
  }

  const { error } = await supabase.from("bot_settings").upsert(update, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });

  return NextResponse.json({ ok: true });
}
