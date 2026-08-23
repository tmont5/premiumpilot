import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Approve or reject a bot proposal. Approving records the decision only — it does
// NOT place an order (live execution is a separate, gated feature). RLS scopes
// the update to the user's own proposals.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const action = body?.action;
  if (!id || (action !== "approve" && action !== "reject")) {
    return NextResponse.json({ error: "id and action ('approve'|'reject') are required" }, { status: 400 });
  }

  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ ok: true, demo: true });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const status = action === "approve" ? "approved" : "rejected";
  const { error } = await supabase
    .from("bot_proposals")
    .update({ status, decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("status", "proposed"); // only undecided proposals can be decided
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });

  return NextResponse.json({ ok: true });
}
