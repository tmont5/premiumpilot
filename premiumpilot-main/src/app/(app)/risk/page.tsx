import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ReauthBanner } from "@/components/reauth-banner";
import { Disclaimer } from "@/components/disclaimer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { RiskMetricCard } from "@/components/risk/risk-metric-card";
import { RiskHealthScore } from "@/components/risk/risk-health-score";
import {
  RiskConcentration,
  RiskNarrative,
  RiskPositionActions,
  RiskRecommendations,
  RiskStressTests,
  RiskTimeline,
} from "@/components/risk/risk-panels";
import { getPortfolio } from "@/lib/data";
import { analyzePortfolioRisk } from "@/lib/risk/engine";
import { fmtCurrency0 } from "@/lib/format";

const PROFILE_LABEL = { conservative: "Conservative", balanced: "Balanced", aggressive: "Aggressive" } as const;
const ACCOUNT_LABEL = { cash: "Cash", margin: "Margin", ira: "IRA" } as const;

export default async function RiskPage() {
  const pf = await getPortfolio();
  const risk = analyzePortfolioRisk(pf, pf.profile);
  const hasAnyDelta = risk.timeline.some((w) => w.hasDelta);

  return (
    <>
      <PageHeader
        title="Risk Manager"
        description="Is my portfolio healthy, and what should I do next? Short puts are valued at full assignment obligation."
      >
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{PROFILE_LABEL[risk.profile]} profile</Badge>
          <Badge variant="outline">{ACCOUNT_LABEL[risk.accountType]}</Badge>
        </div>
      </PageHeader>

      <ReauthBanner accounts={pf.accounts} />

      {risk.marginLeverageWarning && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-leverage/40 bg-leverage/10 px-4 py-3 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-leverage" />
          <span>
            <span className="font-medium text-leverage">Leverage warning:</span> potential stock exposure exceeds 100% of
            account value on a margin account. You could lose more than invested and face forced liquidation.
          </span>
        </div>
      )}

      {/* Hero: health score + core figures */}
      <div className="grid gap-6 lg:grid-cols-3">
        <RiskHealthScore health={risk.health} />
        <div className="lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardContent className="p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Net Liquidation Value</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{fmtCurrency0(risk.nlv)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Actual account value</p>
              </CardContent>
            </Card>
            <RiskMetricCard metric={risk.metrics.find((m) => m.key === "uncommittedLiquidity")!} />
            <RiskMetricCard metric={risk.metrics.find((m) => m.key === "putObligations")!} />
            <RiskMetricCard metric={risk.metrics.find((m) => m.key === "potentialExposure")!} />
          </div>
        </div>
      </div>

      <div className="mt-6">
        <RiskNarrative analysis={risk} />
      </div>

      {/* All headline metric cards (PRD §12.1) */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {risk.metrics.map((m) => (
          <RiskMetricCard key={m.key} metric={m} />
        ))}
      </div>

      <div className="mt-6">
        <RiskRecommendations recommendations={risk.recommendations} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <RiskConcentration
          tickers={risk.tickerConcentration}
          sectors={risk.sectorConcentration}
          untagged={risk.untaggedTickers}
        />
        <RiskTimeline timeline={risk.timeline} hasAnyDelta={hasAnyDelta} />
      </div>

      <div className="mt-6">
        <RiskStressTests tests={risk.stressTests} />
      </div>

      <div className="mt-6">
        <RiskPositionActions actions={risk.positionActions} />
      </div>

      <Disclaimer className="mt-6 text-xs leading-relaxed text-muted-foreground" />
    </>
  );
}
