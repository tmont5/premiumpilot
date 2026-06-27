import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { BadgeProps } from "@/components/ui/badge";
import type { Trade, TradeOutcome } from "@/lib/types";
import { fmtCurrency0, fmtDate, fmtSignedCurrency0 } from "@/lib/format";
import { cn } from "@/lib/utils";

const STRATEGY_LABEL: Record<Trade["strategy"], string> = {
  cash_secured_put: "Short Put",
  covered_call: "Cov. Call",
};

const OUTCOME: Record<TradeOutcome, { label: string; variant: BadgeProps["variant"] }> = {
  expired: { label: "Expired", variant: "success" },
  closed: { label: "Closed", variant: "secondary" },
  assigned: { label: "Assigned", variant: "warning" },
  rolled: { label: "Rolled", variant: "outline" },
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function heldDays(t: Trade): string {
  if (!t.opened_at) return "—";
  const days = Math.round((new Date(t.closed_at).getTime() - new Date(t.opened_at).getTime()) / MS_PER_DAY);
  return `${days}d`;
}

const dash = (n: number | null) => (n == null ? "—" : fmtCurrency0(n));

export function TradesTable({ trades }: { trades: Trade[] }) {
  const sorted = [...trades].sort((a, b) => b.closed_at.localeCompare(a.closed_at));
  const totalPremium = trades.reduce((s, t) => s + (t.premium_collected ?? 0), 0);
  const totalCost = trades.reduce((s, t) => s + (t.cost_to_close ?? 0), 0);
  const totalRealized = trades.reduce((s, t) => s + t.realized_pnl, 0);

  if (sorted.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        No closed trades yet. Trades appear here once positions are closed, expire, or are assigned.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Ticker</TableHead>
          <TableHead>Strategy</TableHead>
          <TableHead className="text-right">Strike</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead>Closed</TableHead>
          <TableHead className="text-right">Held</TableHead>
          <TableHead className="text-right">Premium</TableHead>
          <TableHead className="text-right">Cost to Close</TableHead>
          <TableHead className="text-right">Realized P/L</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((t) => (
          <TableRow key={t.id}>
            <TableCell className="font-semibold">{t.ticker}</TableCell>
            <TableCell className="text-muted-foreground">{STRATEGY_LABEL[t.strategy]}</TableCell>
            <TableCell className="text-right tabular-nums">{t.strike ? `$${t.strike}` : "—"}</TableCell>
            <TableCell>
              <Badge variant={OUTCOME[t.outcome].variant}>{OUTCOME[t.outcome].label}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">{fmtDate(t.closed_at.slice(0, 10))}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">{heldDays(t)}</TableCell>
            <TableCell className="text-right tabular-nums">{dash(t.premium_collected)}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {dash(t.cost_to_close)}
            </TableCell>
            <TableCell
              className={cn(
                "text-right font-medium tabular-nums",
                t.realized_pnl > 0 ? "text-success" : t.realized_pnl < 0 ? "text-danger" : ""
              )}
            >
              {fmtSignedCurrency0(t.realized_pnl)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={6}>Total</TableCell>
          <TableCell className="text-right tabular-nums">{fmtCurrency0(totalPremium)}</TableCell>
          <TableCell className="text-right tabular-nums">{fmtCurrency0(totalCost)}</TableCell>
          <TableCell
            className={cn(
              "text-right tabular-nums",
              totalRealized > 0 ? "text-success" : totalRealized < 0 ? "text-danger" : ""
            )}
          >
            {fmtSignedCurrency0(totalRealized)}
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
