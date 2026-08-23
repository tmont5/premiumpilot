import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Manual "Run now": invoke the bot-run edge function for the signed-in user only
// (userId comes from the session, never the request). Proposes trades; places no
// orders. Demo mode has no backend, so it acknowledges without running.
export async function POST() {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ ok: true, demo: true });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase.functions.invoke("bot-run", {
    body: { userId: user.id, trigger: "manual" },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });

  console.log("[api/bot/run] result", JSON.stringify(data));
  return NextResponse.json({ ok: true, result: data });
}
