import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// User-triggered refresh: runs the Schwab sync for the signed-in user's own
// accounts (balances, positions, transactions). The userId is taken from the
// authenticated session — never the request — so a user can only sync their own.
export async function POST() {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ ok: true, demo: true });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase.functions.invoke("schwab-sync", {
    body: { userId: user.id },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });

  return NextResponse.json({ ok: true, result: data });
}
