import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { ScoreGauge, ScoreBreakdownBars } from "@/components/score-gauge";
import { AlertsPanel } from "@/components/alerts-panel";
import { HeatmapChart } from "@/components/heatmap-chart";
import { Disclaimer } from "@/components/disclaimer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPortfolio } from "@/lib/data";
import { fmtCurrency0, fmtPct, fmtSignedCurrency0 } from "@/lib/format";

export default async function DashboardPage() {
  const pf = await getPortfolio();
  const t = pf.totals;

  return (
    <>
      <PageHeader
        title="Portfolio Summary"
        description="Decisions, not positions — your income book at a glance."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Net Liquidation Value" value={fmtCurrency0(t.netLiquidationValue)} />
        <StatCard label="Cash Available" value={fmtCurrency0(t.cashAvailable)} />
        <StatCard label="Cash to Invest" value={fmtCurrency0(t.cashAvailableForTrading)} />
        <StatCard label="Capital Utilized" value={fmtPct(t.capitalUtilizationPct, 0)} />
        <StatCard label="Open Positions" value={String(t.openPositions)} />
        <StatCard label="Monthly Premium" value={fmtCurrency0(t.monthlyPremium)} tone="success" />
        <StatCard label="Annualized Premium" value={fmtCurrency0(t.annualizedPremium)} tone="success" />
        <StatCard
          label="Total P/L"
          value={fmtSignedCurrency0(pf.pnl.total)}
          tone={pf.pnl.total >= 0 ? "success" : "danger"}
          hint="Realized + unrealized"
        />
        <StatCard
          label="Expected Assignment Exposure"
          value={fmtCurrency0(t.expectedAssignmentExposure)}
          hint="Capital at risk weighted by probability ITM"
        />
        <StatCard label="Active Alerts" value={String(pf.alerts.length)} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Portfolio Score</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <ScoreGauge score={pf.score.total} />
            <ScoreBreakdownBars score={pf.score} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Today&apos;s Decisions</CardTitle>
          </CardHeader>
          <CardContent>
            <AlertsPanel alerts={pf.alerts} />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Portfolio Heat Map</CardTitle>
        </CardHeader>
        <CardContent>
          <HeatmapChart positions={pf.positions} />
          <Disclaimer className="mt-4 text-xs leading-relaxed text-muted-foreground" />
        </CardContent>
      </Card>
    </>
  );
}
