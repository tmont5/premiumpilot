import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getPortfolio, isDemoMode } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import {
  ADVISOR_OUTPUT_SCHEMA,
  ADVISOR_SYSTEM_PROMPT,
  buildAdvisorSnapshot,
  type AdvisorResult,
} from "@/lib/advisor";

export const maxDuration = 60;

// Override with OPENAI_MODEL if you want a different model (any current
// structured-output-capable chat model works).
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o";

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

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "The advisor isn't configured yet. Add an OPENAI_API_KEY to enable it." },
      { status: 503 }
    );
  }

  const pf = await getPortfolio();
  const snapshot = buildAdvisorSnapshot(pf);

  const client = new OpenAI();
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: ADVISOR_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Analyze this portfolio snapshot and return your considerations.\n\n${JSON.stringify(
            snapshot
          )}`,
        },
      ],
      // Constrain the response to the considerations schema so it's always parseable.
      response_format: {
        type: "json_schema",
        json_schema: { name: "advisor_analysis", strict: true, schema: ADVISOR_OUTPUT_SCHEMA },
      },
    });

    const choice = completion.choices[0]?.message;
    if (choice?.refusal) {
      return NextResponse.json({ error: "The advisor couldn't complete this analysis." }, { status: 422 });
    }
    if (!choice?.content) {
      return NextResponse.json({ error: "The advisor returned no analysis." }, { status: 502 });
    }

    const result = JSON.parse(choice.content) as AdvisorResult;
    return NextResponse.json({ ok: true, demo: isDemoMode(), result });
  } catch (e) {
    console.error("[api/advisor] failed", e);
    return NextResponse.json({ error: "The advisor request failed. Try again in a moment." }, { status: 502 });
  }
}
