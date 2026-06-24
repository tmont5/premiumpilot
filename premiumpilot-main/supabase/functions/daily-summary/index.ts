/* eslint-disable @typescript-eslint/no-explicit-any */
// Daily 7AM summary (PRD §11). Sends each user a digest via their enabled
// channels: email (Resend), Discord (webhook), web push.
//
// Scheduling note: cron fires hourly (see 0004_cron.sql); we send to users
// whose local time is currently 07:00, so "7AM local" is honored per timezone.
import { adminClient } from "../_shared/db.ts";

interface Summary {
  score: number;
  closeCandidates: string[];
  riskAlerts: string[];
  topOpportunities: string[];
  cashAvailable: number;
}

Deno.serve(async (req) => {
  const db = adminClient();
  const force = new URL(req.url).searchParams.get("force") === "1";

  const { data: profiles } = await db
    .from("profiles")
    .select("id, timezone, notify_email, notify_discord, notify_web_push, discord_webhook_url");

  let sent = 0;
  for (const p of profiles ?? []) {
    if (!force && !isLocal7am(p.timezone)) continue;

    const summary = await buildSummary(db, p.id);
    const text = renderText(summary);

    if (p.notify_email) await sendEmail(db, p.id, summary);
    if (p.notify_discord && p.discord_webhook_url) await sendDiscord(p.discord_webhook_url, text);
    if (p.notify_web_push) await sendWebPush(p.id, text); // requires push_subscriptions + VAPID
    sent++;
  }

  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});

// True when it is ~07:00 in the given IANA timezone.
function isLocal7am(tz: string): boolean {
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date())
    );
    return hour === 7;
  } catch {
    return false;
  }
}

// deno-lint-ignore no-explicit-any
async function buildSummary(db: any, userId: string): Promise<Summary> {
  const { data: alerts } = await db
    .from("alerts")
    .select("type, message, recommendation")
    .eq("user_id", userId)
    .is("acknowledged_at", null);

  const { data: accounts } = await db.from("connected_accounts").select("id").eq("user_id", userId);
  const ids = (accounts ?? []).map((a: { id: string }) => a.id);

  let cashAvailable = 0;
  if (ids.length) {
    const { data: balances } = await db
      .from("account_balances")
      .select("connected_account_id, cash_balance, synced_at")
      .in("connected_account_id", ids)
      .order("synced_at", { ascending: false });
    const seen = new Set<string>();
    for (const b of balances ?? []) {
      if (seen.has(b.connected_account_id)) continue;
      seen.add(b.connected_account_id);
      cashAvailable += Number(b.cash_balance);
    }
  }

  // deno-lint-ignore no-explicit-any
  const rows: any[] = alerts ?? [];
  const closeCandidates = rows.filter((a) => a.type === "close").map((a) => a.message);
  const riskAlerts = rows.filter((a) => a.type === "assignment_risk").map((a) => a.message);

  return {
    score: 0, // populated by evaluate-derived score in production; omitted here
    closeCandidates,
    riskAlerts,
    topOpportunities: closeCandidates.slice(0, 3),
    cashAvailable,
  };
}

function renderText(s: Summary): string {
  const lines = ["*PremiumPilot — Daily Summary*", ""];
  if (s.topOpportunities.length) {
    lines.push("Top Opportunities:");
    s.topOpportunities.forEach((o) => lines.push(`• ${o}`));
    lines.push("");
  }
  if (s.riskAlerts.length) {
    lines.push("Risk Alerts:");
    s.riskAlerts.forEach((r) => lines.push(`• ${r}`));
    lines.push("");
  }
  lines.push(`Cash Available: $${s.cashAvailable.toLocaleString()}`);
  lines.push(`Close Candidates: ${s.closeCandidates.length}`);
  return lines.join("\n");
}

// deno-lint-ignore no-explicit-any
async function sendEmail(db: any, userId: string, s: Summary) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return;
  const { data: u } = await db.auth.admin.getUserById(userId);
  const to = u?.user?.email;
  if (!to) return;

  const html = `
    <h2>PremiumPilot — Daily Summary</h2>
    <p><b>Cash Available:</b> $${s.cashAvailable.toLocaleString()}</p>
    <h3>Top Opportunities</h3>
    <ul>${s.topOpportunities.map((o) => `<li>${o}</li>`).join("") || "<li>None</li>"}</ul>
    <h3>Risk Alerts</h3>
    <ul>${s.riskAlerts.map((r) => `<li>${r}</li>`).join("") || "<li>None</li>"}</ul>
    <p style="color:#888;font-size:12px">Informational only. Not investment advice.</p>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("RESEND_FROM") ?? "PremiumPilot <alerts@premiumpilot.app>",
      to,
      subject: "Your PremiumPilot daily summary",
      html,
    }),
  });
}

async function sendDiscord(webhookUrl: string, content: string) {
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

async function sendWebPush(_userId: string, _text: string) {
  // Requires a push_subscriptions table + VAPID keys (web-push). Left as a
  // documented extension point for the MVP.
}
