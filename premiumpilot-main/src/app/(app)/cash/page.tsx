import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getPortfolio } from "@/lib/data";
import { fmtCurrency0, fmtPct } from "@/lib/format";
import { ENGINE_CONFIG } from "@/lib/config";

export default async function CashPage() {
  const pf = await getPortfolio();
  const c = pf.cash;
  return (
    <>
      <PageHeader
        title="Cash Management"
        description="Available capital, utilization, and deployment headroom."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Current Cash" value={fmtCurrency0(c.currentCash)} />
        <StatCard label="Buying Power" value={fmtCurrency0(c.buyingPower)} />
        <StatCard label="Capital Reserved" value={fmtCurrency0(c.capitalReserved)} />
        <StatCard label="Capital Utilization" value={fmtPct(c.utilizationPct, 0)} />
        <StatCard label="Unused Capital" value={fmtCurrency0(c.unusedCapital)} />
        <StatCard
          label="Recommended New Trades"
          value={String(c.suggestedNewTrades)}
          tone="success"
          hint={`At ~${fmtCurrency0(ENGINE_CONFIG.cash.typicalCapitalPerTrade)}/trade`}
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Capital Utilization</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Progress
            value={c.utilizationPct}
            indicatorClassName={
              c.utilizationPct >= ENGINE_CONFIG.cash.targetUtilizationLow * 100 &&
              c.utilizationPct <= ENGINE_CONFIG.cash.targetUtilizationHigh * 100
                ? "bg-success"
                : "bg-warning"
            }
          />
          <p className="text-sm text-muted-foreground">
            {fmtPct(c.utilizationPct, 0)} of investable capital is deployed. Target band is{" "}
            {fmtPct(ENGINE_CONFIG.cash.targetUtilizationLow * 100, 0)}–
            {fmtPct(ENGINE_CONFIG.cash.targetUtilizationHigh * 100, 0)} for efficient income generation
            while keeping reserve for assignments and new trades.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
