"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { Profile, RiskAccountType, RiskProfile } from "@/lib/types";

const RISK_PROFILE_OPTIONS: { value: RiskProfile; label: string; desc: string }[] = [
  { value: "conservative", label: "Conservative", desc: "Lower put obligations, larger cash reserve." },
  { value: "balanced", label: "Balanced", desc: "Default target bands (owned stock 50–65% of NLV)." },
  { value: "aggressive", label: "Aggressive", desc: "Higher obligations and exposure, thinner reserve." },
];

const ACCOUNT_TYPE_OPTIONS: { value: RiskAccountType; label: string; desc: string }[] = [
  { value: "cash", label: "Cash", desc: "No margin borrowing; assignment needs settled cash." },
  { value: "margin", label: "Margin", desc: "Can borrow; exposure over 100% of NLV warns on leverage." },
  { value: "ira", label: "IRA", desc: "Retirement account; treated like cash (no margin)." },
];

export function SettingsForm({ profile }: { profile: Profile }) {
  const [goal, setGoal] = useState(profile.income_goal_annual ?? 0);
  const [discord, setDiscord] = useState(profile.discord_webhook_url ?? "");
  const [email, setEmail] = useState(profile.notify_email);
  const [discordOn, setDiscordOn] = useState(profile.notify_discord);
  const [push, setPush] = useState(profile.notify_web_push);
  const [riskProfile, setRiskProfile] = useState<RiskProfile>(profile.risk_profile);
  const [accountType, setAccountType] = useState<RiskAccountType>(profile.account_type);
  const [status, setStatus] = useState<null | "saving" | "saved" | "demo" | "error">(null);

  async function save() {
    setStatus("saving");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          income_goal_annual: goal,
          notify_email: email,
          notify_discord: discordOn,
          notify_web_push: push,
          discord_webhook_url: discord,
          risk_profile: riskProfile,
          account_type: accountType,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setStatus("error");
      else setStatus(data.demo ? "demo" : "saved");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Income Goal</CardTitle>
          <CardDescription>Your annual premium target drives goal-progress tracking.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs space-y-2">
            <Label htmlFor="goal">Annual income goal (USD)</Label>
            <Input
              id="goal"
              type="number"
              value={goal}
              onChange={(e) => setGoal(Number(e.target.value))}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Portfolio Risk</CardTitle>
          <CardDescription>
            Sets the target allocation bands and leverage warnings on the Risk page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Risk profile</Label>
            <OptionGroup options={RISK_PROFILE_OPTIONS} value={riskProfile} onChange={setRiskProfile} />
          </div>
          <div className="space-y-2">
            <Label>Account type</Label>
            <OptionGroup options={ACCOUNT_TYPE_OPTIONS} value={accountType} onChange={setAccountType} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daily Summary Notifications</CardTitle>
          <CardDescription>Delivered every day at 7:00 AM in your local time.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          <ToggleRow label="Email (Resend)" desc="Send the daily summary to your account email." checked={email} onChange={setEmail} />
          <Separator />
          <ToggleRow label="Discord" desc="Post the summary to a Discord channel via webhook." checked={discordOn} onChange={setDiscordOn} />
          <Separator />
          <ToggleRow label="Web Push" desc="Browser push notifications for alerts." checked={push} onChange={setPush} />
          {discordOn && (
            <div className="pt-4">
              <Label htmlFor="discord">Discord webhook URL</Label>
              <Input
                id="discord"
                className="mt-2"
                placeholder="https://discord.com/api/webhooks/…"
                value={discord}
                onChange={(e) => setDiscord(e.target.value)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={status === "saving"}>
          {status === "saving" ? "Saving…" : "Save changes"}
        </Button>
        {status === "saved" && <span className="text-sm text-success">Saved</span>}
        {status === "demo" && <span className="text-sm text-muted-foreground">Demo — not persisted</span>}
        {status === "error" && <span className="text-sm text-danger">Couldn&apos;t save — try again</span>}
      </div>
    </div>
  );
}

function OptionGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; desc: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-lg border p-3 text-left transition-colors",
              active
                ? "border-primary bg-secondary"
                : "border-border hover:border-primary/40 hover:bg-secondary/40"
            )}
          >
            <span className="text-sm font-medium">{opt.label}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{opt.desc}</span>
          </button>
        );
      })}
    </div>
  );
}

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
