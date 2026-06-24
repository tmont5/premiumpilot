"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Compass } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Disclaimer } from "@/components/disclaimer";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginShell />}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const supabase = createClient();
  const demo = supabase === null;

  async function oauth(provider: "google" | "apple") {
    if (!supabase) return router.push(next);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) setError(error.message);
  }

  async function emailAuth(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!supabase) return router.push(next);

    setPending(true);
    const result =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
            },
          });
    setPending(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    if (mode === "signup" && !result.data.session) {
      setMessage("Check your email to confirm your account, then sign in.");
      return;
    }

    router.push(next);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/30 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex items-center gap-2">
            <Compass className="size-6 text-primary" />
            <span className="text-xl font-semibold tracking-tight">PremiumPilot</span>
          </div>
          <p className="text-sm text-muted-foreground">See decisions, not positions.</p>
        </div>

        <Card>
          <CardContent className="space-y-4 p-6">
            <Button variant="outline" className="w-full" onClick={() => oauth("google")}>
              Continue with Google
            </Button>
            <Button variant="outline" className="w-full" onClick={() => oauth("apple")}>
              Continue with Apple
            </Button>

            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">or</span>
              <Separator className="flex-1" />
            </div>

            <form className="space-y-3" onSubmit={emailAuth}>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              {error && <p className="text-sm text-danger">{error}</p>}
              {message && <p className="text-sm text-success">{message}</p>}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? "Working..." : mode === "signin" ? "Sign in with email" : "Create account"}
              </Button>
            </form>

            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                setError(null);
                setMessage(null);
                setMode(mode === "signin" ? "signup" : "signin");
              }}
            >
              {mode === "signin" ? "Create an email account" : "Already have an account? Sign in"}
            </Button>

            {demo && (
              <Button variant="ghost" className="w-full" onClick={() => router.push(next)}>
                Explore in demo mode
              </Button>
            )}
          </CardContent>
        </Card>

        <div className="mt-6">
          <Disclaimer />
        </div>
      </div>
    </div>
  );
}

function LoginShell() {
  return <div className="min-h-screen bg-secondary/30" />;
}

function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/dashboard";
  return next;
}
