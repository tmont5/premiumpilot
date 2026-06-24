import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { IncomeChart } from "@/components/income-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getPortfolio } from "@/lib/data";
import { fmtCurrency0, fmtPct } from "@/lib/format";

export default async function IncomePage() {
  const pf = await getPortfolio();
  const inc = pf.income;
  const progress = Math.min(100, inc.goalProgressPct);

  return (
    <>
      <PageHeader title="Income" description="Premium collected and progress toward your annual goal." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="This Month" value={fmtCurrency0(inc.thisMonth)} tone="success" />
        <StatCard label="Year To Date" value={fmtCurrency0(inc.ytd)} />
        <StatCard label="Rolling 12-Month" value={fmtCurrency0(inc.rolling12)} />
        <StatCard label="Projected Annual" value={fmtCurrency0(inc.projectedAnnual)} />
      </div>

      {inc.goal != null && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Income Goal Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={progress} indicatorClassName="bg-success" />
            <p className="text-sm text-muted-foreground">
              {fmtCurrency0(inc.ytd)} of {fmtCurrency0(inc.goal)} annual goal ·{" "}
              <span className="font-medium text-foreground">{fmtPct(inc.goalProgressPct, 0)}</span> complete
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Premium Collected — Trailing 12 Months</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <IncomeChart history={pf.premiumHistory} />
        </CardContent>
      </Card>
    </>
  );
}
