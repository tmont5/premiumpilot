"use client";
import { createBrowserClient } from "@supabase/ssr";

// Browser Supabase client. Returns null in demo mode (no env configured) so the
// UI can fall back to the demo dataset without throwing.
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}
