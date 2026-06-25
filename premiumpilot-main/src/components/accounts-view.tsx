"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import type { AccountBalance, ConnectedAccount } from "@/lib/types";
import { fmtCurrency0, fmtRelativeTime } from "@/lib/format";
import { CheckCircle2, AlertTriangle, Plus, Trash2 } from "lucide-react";

const TYPE_LABEL: Record<ConnectedAccount["account_type"], string> = {
  individual: "Individual",
  ira: "IRA",
  joint: "Joint",
};

export function AccountsView({
  accounts,
  balances,
  connectUrl,
}: {
  accounts: ConnectedAccount[];
  balances: AccountBalance[];
  connectUrl: string | null;
}) {
  const router = useRouter();
  const [combined, setCombined] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<ConnectedAccount | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const balanceFor = (id: string) => balances.find((b) => b.connected_account_id === id);
  const totalNetLiq = balances.reduce((s, b) => s + b.net_liquidation_value, 0);

  async function removeAccount(account: ConnectedAccount) {
    setRemoveError(null);
    setRemovingId(account.id);
    try {
      const response = await fetch(`/api/accounts/${encodeURIComponent(account.id)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Could not remove account");
      }

      setPendingRemoval(null);
      router.refresh();
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : "Could not remove account");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {removeError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {removeError}
        </div>
      )}

      <div className="flex items-center justify-between rounded-lg border bg-card p-4">
        <div>
          <p className="text-sm font-medium">Combined dashboard view</p>
          <p className="text-xs text-muted-foreground">
            Aggregate all Schwab accounts into one portfolio view.
          </p>
        </div>
        <Switch checked={combined} onCheckedChange={setCombined} />
      </div>

      {combined && (
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Combined Net Liquidation
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{fmtCurrency0(totalNetLiq)}</p>
            </div>
            <Badge variant="secondary">{accounts.length} accounts</Badge>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {accounts.map((a) => {
          const bal = balanceFor(a.id);
          return (
            <Card key={a.id}>
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{a.account_label}</p>
                    <p className="text-xs text-muted-foreground">
                      {TYPE_LABEL[a.account_type]} · {a.schwab_account_id}
                    </p>
                  </div>
                  {a.needs_reauth ? (
                    <Badge variant="danger">
                      <AlertTriangle className="mr-1 size-3" /> Re-auth needed
                    </Badge>
                  ) : (
                    <Badge variant="success">
                      <CheckCircle2 className="mr-1 size-3" /> Connected
                    </Badge>
                  )}
                </div>
                <Separator />
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <Metric label="Net Liq." value={bal ? fmtCurrency0(bal.net_liquidation_value) : "—"} />
                  <Metric label="Cash to Invest" value={bal ? fmtCurrency0(bal.cash_available_for_trading) : "—"} />
                  <Metric label="Buying Pwr" value={bal ? fmtCurrency0(bal.buying_power) : "—"} />
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Last sync {fmtRelativeTime(a.last_synced_at)}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={removingId === a.id}
                    onClick={() => setPendingRemoval(a)}
                  >
                    {removingId === a.id ? "Removing..." : "Remove"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}

        <Card className="border-dashed">
          <CardContent className="flex h-full min-h-40 flex-col items-center justify-center gap-3 p-5 text-center">
            <Plus className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">Connect a Schwab account</p>
            <p className="text-xs text-muted-foreground">Individual, IRA, or Joint via OAuth 2.0.</p>
            <Button
              size="sm"
              disabled={!connectUrl}
              onClick={() => {
                if (connectUrl) window.location.href = connectUrl;
              }}
            >
              Connect with Schwab
            </Button>
            {!connectUrl && (
              <p className="text-xs text-muted-foreground">Sign in before connecting a brokerage account.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {pendingRemoval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
          <Card className="w-full max-w-md shadow-lg">
            <CardContent className="space-y-5 p-6">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-destructive/10 p-2 text-destructive">
                  <Trash2 className="size-5" />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold">Remove Schwab account?</p>
                  <p className="text-sm text-muted-foreground">
                    This removes {pendingRemoval.account_label || "this Schwab account"} from PremiumPilot and
                    deletes synced balances, transactions, and positions.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  disabled={removingId === pendingRemoval.id}
                  onClick={() => setPendingRemoval(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={removingId === pendingRemoval.id}
                  onClick={() => removeAccount(pendingRemoval)}
                >
                  {removingId === pendingRemoval.id ? "Removing..." : "Remove"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium tabular-nums">{value}</p>
    </div>
  );
}
