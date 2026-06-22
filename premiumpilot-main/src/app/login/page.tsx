"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Compass } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Disclaimer } from "@/components/disclaimer";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();
  const demo = supabase === null;

  async function oauth(provider: "google" | "apple") {
    if (!supabase) return router.push("/dashboard");
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
  }

  async function emailSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!supabase) return router.push("/dashboard");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    else router.push("/dashboard");
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

            <form className="space-y-3" onSubmit={emailSignIn}>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              {error && <p className="text-sm text-danger">{error}</p>}
              <Button type="submit" className="w-full">
                Sign in with email
              </Button>
            </form>

            {demo && (
              <Button variant="ghost" className="w-full" onClick={() => router.push("/dashboard")}>
                Explore in demo mode →
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
