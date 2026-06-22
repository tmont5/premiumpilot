"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { Profile } from "@/lib/types";

export function SettingsForm({ profile }: { profile: Profile }) {
  const [goal, setGoal] = useState(profile.income_goal_annual ?? 0);
  const [discord, setDiscord] = useState(profile.discord_webhook_url ?? "");
  const [email, setEmail] = useState(profile.notify_email);
  const [discordOn, setDiscordOn] = useState(profile.notify_discord);
  const [push, setPush] = useState(profile.notify_web_push);
  const [saved, setSaved] = useState(false);

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
        <Button
          onClick={() => {
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          }}
        >
          Save changes
        </Button>
        {saved && <span className="text-sm text-success">Saved (demo — not persisted)</span>}
      </div>
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
