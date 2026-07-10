import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getPortfolio, isDemoMode } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { ADVISOR_CHAT_SYSTEM_PROMPT, buildAdvisorSnapshot } from "@/lib/advisor";

export const maxDuration = 60;

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o";

type ChatRole = "user" | "assistant";
interface ChatMessage {
  role: ChatRole;
  content: string;
}

export async function POST(req: Request) {
  if (!isDemoMode()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "The advisor isn't configured yet. Add an OPENAI_API_KEY to enable it." },
      { status: 503 }
    );
  }

  // Only accept user/assistant turns from the client — the system prompt is
  // server-controlled so the user can't override the guardrails.
  const body = (await req.json().catch(() => null)) as { messages?: unknown } | null;
  const history: ChatMessage[] = (Array.isArray(body?.messages) ? body!.messages : [])
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        typeof (m as ChatMessage).content === "string" &&
        ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant")
    )
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  if (!history.length || history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "No question provided." }, { status: 400 });
  }

  const pf = await getPortfolio();
  const snapshot = buildAdvisorSnapshot(pf);
  const system = `${ADVISOR_CHAT_SYSTEM_PROMPT}\n\nCurrent portfolio snapshot (JSON):\n${JSON.stringify(snapshot)}`;

  const client = new OpenAI();
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 1000,
      messages: [{ role: "system", content: system }, ...history],
    });

    const choice = completion.choices[0]?.message;
    if (choice?.refusal) {
      return NextResponse.json({ error: "The advisor couldn't answer that one." }, { status: 422 });
    }
    if (!choice?.content) {
      return NextResponse.json({ error: "The advisor returned no answer." }, { status: 502 });
    }

    return NextResponse.json({ ok: true, reply: choice.content });
  } catch (e) {
    console.error("[api/advisor/chat] failed", e);
    return NextResponse.json({ error: "The request failed. Try again in a moment." }, { status: 502 });
  }
}
