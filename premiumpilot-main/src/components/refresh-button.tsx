"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Triggers a Schwab sync for the signed-in user, then re-pulls the server-
// rendered data so every screen reflects the fresh balances/positions.
export function RefreshButton() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = syncing || isPending;

  async function refresh() {
    setSyncing(true);
    setError(false);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (!res.ok) throw new Error(`sync failed: ${res.status}`);
      startTransition(() => router.refresh());
    } catch {
      setError(true);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={refresh}
      disabled={busy}
      title={error ? "Refresh failed — try again" : "Refresh account & positions"}
    >
      <RefreshCw className={cn("size-4", busy && "animate-spin")} />
      {busy ? "Refreshing…" : error ? "Retry" : "Refresh"}
    </Button>
  );
}
