"use client";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import type { AccountBalance, ConnectedAccount } from "@/lib/types";
import { fmtCurrency0, fmtRelativeTime } from "@/lib/format";
import { CheckCircle2, AlertTriangle, Plus } from "lucide-react";

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
  const [combined, setCombined] = useState(true);
  const balanceFor = (id: string) => balances.find((b) => b.connected_account_id === id);
  const totalNetLiq = balances.reduce((s, b) => s + b.net_liquidation_value, 0);

  return (
    <div className="space-y-6">
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
                  <Metric label="Cash" value={bal ? fmtCurrency0(bal.cash_balance) : "—"} />
                  <Metric label="Buying Pwr" value={bal ? fmtCurrency0(bal.buying_power) : "—"} />
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Last sync {fmtRelativeTime(a.last_synced_at)}
                  </p>
                  <Button variant="outline" size="sm">
                    Remove
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
