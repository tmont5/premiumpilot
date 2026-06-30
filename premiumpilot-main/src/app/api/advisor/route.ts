import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getPortfolio, isDemoMode } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import {
  ADVISOR_OUTPUT_SCHEMA,
  ADVISOR_SYSTEM_PROMPT,
  buildAdvisorSnapshot,
  type AdvisorResult,
} from "@/lib/advisor";

export const maxDuration = 60;

export async function POST() {
  // In live mode require an authenticated user (the AI call costs money);
  // demo mode runs against the seed portfolio.
  if (!isDemoMode()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "The advisor isn't configured yet. Add an ANTHROPIC_API_KEY to enable it." },
      { status: 503 }
    );
  }

  const pf = await getPortfolio();
  const snapshot = buildAdvisorSnapshot(pf);

  const client = new Anthropic();
  try {
    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system: [{ type: "text", text: ADVISOR_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      // Constrain the response to the considerations schema so it's always parseable.
      output_config: { format: { type: "json_schema", schema: ADVISOR_OUTPUT_SCHEMA } },
      messages: [
        {
          role: "user",
          content: `Analyze this portfolio snapshot and return your considerations.\n\n${JSON.stringify(
            snapshot
          )}`,
        },
      ],
    } as Anthropic.MessageCreateParamsNonStreaming);

    if (message.stop_reason === "refusal") {
      return NextResponse.json({ error: "The advisor couldn't complete this analysis." }, { status: 422 });
    }

    const text = message.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      return NextResponse.json({ error: "The advisor returned no analysis." }, { status: 502 });
    }

    const result = JSON.parse(text.text) as AdvisorResult;
    return NextResponse.json({ ok: true, demo: isDemoMode(), result });
  } catch (e) {
    console.error("[api/advisor] failed", e);
    return NextResponse.json({ error: "The advisor request failed. Try again in a moment." }, { status: 502 });
  }
}
