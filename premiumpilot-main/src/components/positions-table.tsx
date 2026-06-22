import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import type { EnrichedPosition, PositionStatus } from "@/lib/types";
import {
  fmtCurrency0,
  fmtDate,
  fmtPct,
  fmtPctFromFraction,
  fmtSignedPctFromFraction,
} from "@/lib/format";
import { cn } from "@/lib/utils";

const STRATEGY_LABEL: Record<EnrichedPosition["strategy"], string> = {
  cash_secured_put: "CSP",
  covered_call: "Cov. Call",
};

// Actions column surfaces the relevant action for the position's status (PRD §9.2).
function action(status: PositionStatus): { label: string; show: boolean } {
  switch (status) {
    case "close_candidate":
      return { label: "Close", show: true };
    case "high_risk":
      return { label: "Roll", show: true };
    case "risk":
      return { label: "Manage", show: true };
    default:
      return { label: "—", show: false };
  }
}

export function PositionsTable({ positions }: { positions: EnrichedPosition[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Ticker</TableHead>
          <TableHead>Strategy</TableHead>
          <TableHead className="text-right">Strike</TableHead>
          <TableHead>Expiration</TableHead>
          <TableHead className="text-right">DTE</TableHead>
          <TableHead className="text-right">Premium</TableHead>
          <TableHead className="text-right">Current Val.</TableHead>
          <TableHead className="text-right">Profit Capt.</TableHead>
          <TableHead className="text-right">ROC</TableHead>
          <TableHead className="text-right">Annual. Ret.</TableHead>
          <TableHead className="text-right">Prob. ITM</TableHead>
          <TableHead className="text-right">Dist. Strike</TableHead>
          <TableHead className="text-right">Capital</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((p) => {
          const m = p.metrics;
          const act = action(m.status);
          return (
            <TableRow key={p.id}>
              <TableCell className="font-semibold">{p.ticker}</TableCell>
              <TableCell className="text-muted-foreground">{STRATEGY_LABEL[p.strategy]}</TableCell>
              <TableCell className="text-right tabular-nums">${p.strike}</TableCell>
              <TableCell className="text-muted-foreground">{fmtDate(p.expiration)}</TableCell>
              <TableCell className="text-right tabular-nums">{m.dte}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtCurrency0(p.premium_collected)}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {fmtCurrency0(p.current_option_value)}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right font-medium tabular-nums",
                  m.profitCapturePct >= 75 ? "text-success" : m.profitCapturePct < 0 ? "text-danger" : ""
                )}
              >
                {fmtPct(m.profitCapturePct, 0)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{fmtPctFromFraction(m.returnOnCapital)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtPctFromFraction(m.annualizedReturn)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtPctFromFraction(m.probabilityItm, 0)}</TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums",
                  m.status === "risk" || m.status === "high_risk" ? "text-danger" : "text-muted-foreground"
                )}
              >
                {fmtSignedPctFromFraction(m.distanceFromStrikePct)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{fmtCurrency0(p.capital_requirement)}</TableCell>
              <TableCell>
                <StatusBadge status={m.status} />
              </TableCell>
              <TableCell>
                {act.show ? (
                  <Button variant="outline" size="sm">
                    {act.label}
                  </Button>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
