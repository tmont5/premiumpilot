import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const supabase = await createClient();

  if (!supabase) {
    return NextResponse.redirect(`${origin}/login?next=/accounts`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login?next=/accounts`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    return NextResponse.redirect(`${origin}/accounts?error=supabase_not_configured`);
  }

  const authorizeUrl = new URL("/functions/v1/schwab-oauth", supabaseUrl);
  authorizeUrl.searchParams.set("action", "authorize");
  authorizeUrl.searchParams.set("user_id", user.id);
  authorizeUrl.searchParams.set("return_to", `${origin}/accounts`);

  return NextResponse.redirect(authorizeUrl);
}
