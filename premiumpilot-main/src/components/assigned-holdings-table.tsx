import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EnrichedAssignedHolding } from "@/lib/types";
import {
  fmtCurrency,
  fmtCurrency0,
  fmtNumber,
  fmtSignedCurrency0,
  fmtSignedPctFromFraction,
} from "@/lib/format";
import { cn } from "@/lib/utils";

export function AssignedHoldingsTable({ holdings }: { holdings: EnrichedAssignedHolding[] }) {
  if (holdings.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        No assigned stock. When a put is assigned, the resulting shares show here with their
        cost basis, breakeven, and live profit or loss.
      </p>
    );
  }

  const totalMarketValue = holdings.reduce((s, h) => s + h.metrics.marketValue, 0);
  const totalUnrealized = holdings.reduce((s, h) => s + h.metrics.unrealizedPnl, 0);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Ticker</TableHead>
          <TableHead className="text-right">Shares</TableHead>
          <TableHead className="text-right">Cost Basis</TableHead>
          <TableHead className="text-right">Premium Credit</TableHead>
          <TableHead className="text-right">Breakeven</TableHead>
          <TableHead className="text-right">Current</TableHead>
          <TableHead className="text-right">Market Value</TableHead>
          <TableHead className="text-right">Unrealized P/L</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {holdings.map((h) => {
          const m = h.metrics;
          const up = m.unrealizedPnl >= 0;
          return (
            <TableRow key={h.id}>
              <TableCell className="font-semibold">{h.ticker}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtNumber(h.shares)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtCurrency(h.cost_basis_per_share)}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {fmtCurrency0(h.premium_credit)}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {fmtCurrency(m.breakevenPerShare)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{fmtCurrency(h.current_price)}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {fmtCurrency0(m.marketValue)}
              </TableCell>
              <TableCell
                className={cn("text-right font-medium tabular-nums", up ? "text-success" : "text-danger")}
              >
                {fmtSignedCurrency0(m.unrealizedPnl)}{" "}
                <span className="text-xs font-normal">({fmtSignedPctFromFraction(m.unrealizedPnlPct, 1)})</span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={6}>Total</TableCell>
          <TableCell className="text-right tabular-nums">{fmtCurrency0(totalMarketValue)}</TableCell>
          <TableCell
            className={cn(
              "text-right tabular-nums",
              totalUnrealized >= 0 ? "text-success" : "text-danger"
            )}
          >
            {fmtSignedCurrency0(totalUnrealized)}
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
