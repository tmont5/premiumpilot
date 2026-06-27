import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { PnlChart } from "@/components/pnl-chart";
import { TradesTable } from "@/components/trades-table";
import { AssignedHoldingsTable } from "@/components/assigned-holdings-table";
import { Disclaimer } from "@/components/disclaimer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPortfolio } from "@/lib/data";
import { fmtSignedCurrency0 } from "@/lib/format";

const tone = (n: number) => (n >= 0 ? "success" : "danger");

export default async function TradesPage() {
  const pf = await getPortfolio();
  const p = pf.pnl;

  return (
    <>
      <PageHeader
        title="Trades & P/L"
        description="Closed-trade history, assigned-stock breakeven, and cumulative profit or loss."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Total P/L" value={fmtSignedCurrency0(p.total)} tone={tone(p.total)} />
        <StatCard
          label="Realized P/L"
          value={fmtSignedCurrency0(p.realized)}
          tone={tone(p.realized)}
          hint="Closed option trades"
        />
        <StatCard
          label="Unrealized P/L"
          value={fmtSignedCurrency0(p.unrealized)}
          tone={tone(p.unrealized)}
          hint={`Open options ${fmtSignedCurrency0(p.unrealizedOptions)} · stock ${fmtSignedCurrency0(
            p.unrealizedStock
          )}`}
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Cumulative Realized P/L — Trailing 12 Months</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <PnlChart series={p.cumulative} />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Assigned Holdings</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <AssignedHoldingsTable holdings={pf.assignedHoldings} />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Trade History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <TradesTable trades={pf.trades} />
        </CardContent>
      </Card>

      <Disclaimer className="mt-4 text-xs leading-relaxed text-muted-foreground" />
    </>
  );
}
