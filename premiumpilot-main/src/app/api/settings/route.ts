import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Persist editable profile settings for the signed-in user (income goal,
// notification channels, and the risk-engine profile/account type). The user id
// comes from the authenticated session, never the request body, and RLS
// (profiles_update_own) is the backstop. In demo mode there is no backend, so we
// acknowledge without persisting.
const RISK_PROFILES = ["conservative", "balanced", "aggressive"] as const;
const ACCOUNT_TYPES = ["cash", "margin", "ira"] as const;

export async function POST(request: Request) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ ok: true, demo: true });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Whitelist columns; ignore anything else the client sends. Only include a
  // field when it is present and valid so a partial save never nulls a column.
  const update: Record<string, unknown> = {};
  if ("income_goal_annual" in body) {
    const goal = Number((body as Record<string, unknown>).income_goal_annual);
    update.income_goal_annual = Number.isFinite(goal) ? goal : null;
  }
  for (const key of ["notify_email", "notify_discord", "notify_web_push"] as const) {
    if (key in body) update[key] = Boolean((body as Record<string, unknown>)[key]);
  }
  if ("discord_webhook_url" in body) {
    const url = (body as Record<string, unknown>).discord_webhook_url;
    update.discord_webhook_url = typeof url === "string" && url.length ? url : null;
  }
  if (RISK_PROFILES.includes((body as Record<string, unknown>).risk_profile as never)) {
    update.risk_profile = (body as Record<string, unknown>).risk_profile;
  }
  if (ACCOUNT_TYPES.includes((body as Record<string, unknown>).account_type as never)) {
    update.account_type = (body as Record<string, unknown>).account_type;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await supabase.from("profiles").update(update).eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });

  return NextResponse.json({ ok: true });
}
