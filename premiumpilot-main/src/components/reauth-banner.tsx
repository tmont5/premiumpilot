import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { ConnectedAccount } from "@/lib/types";

// Shown when one or more brokerage connections have expired (Schwab refresh
// tokens lapse ~weekly). Until reconnected, positions and balances go stale.
export function ReauthBanner({ accounts }: { accounts: ConnectedAccount[] }) {
  const stale = accounts.filter((a) => a.needs_reauth);
  if (stale.length === 0) return null;

  const label =
    stale.length === 1
      ? `${stale[0].account_label} needs to be reconnected`
      : `${stale.length} accounts need to be reconnected`;

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3">
      <div className="flex items-center gap-2 text-sm">
        <AlertTriangle className="size-4 shrink-0 text-danger" />
        <span>
          <span className="font-medium text-danger">{label}.</span>{" "}
          <span className="text-muted-foreground">
            Your data may be stale until you reconnect.
          </span>
        </span>
      </div>
      <Link
        href="/accounts"
        className="shrink-0 rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
      >
        Reconnect
      </Link>
    </div>
  );
}
