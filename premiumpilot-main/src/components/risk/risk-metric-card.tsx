import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtCurrency0, fmtPct } from "@/lib/format";
import type { MetricAssessment } from "@/lib/risk/types";
import { STATUS_META } from "./status";

// A headline risk metric card (PRD §12.1): current value + % of NLV, the
// recommended band, a status color, and the signed distance to target. The kind
// label spells out what the figure represents (§16.8 — obligation vs. market
// value vs. cash) so contractual and market numbers are never conflated.
const KIND_LABEL: Record<MetricAssessment["kind"], string> = {
  obligation: "Contractual obligation",
  market_value: "Market value",
  cash: "Cash",
  probability_weighted: "Probability-weighted estimate",
};

export function RiskMetricCard({ metric }: { metric: MetricAssessment }) {
  const meta = STATUS_META[metric.status];
  const overMax = metric.direction === "upper";
  const deltaLabel =
    metric.deltaToTarget <= 0
      ? "Within target range"
      : overMax
        ? `${fmtCurrency0(metric.deltaToTarget)} above maximum`
        : `${fmtCurrency0(metric.deltaToTarget)} below minimum`;

  return (
    <Card className={cn("border", meta.border)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{metric.label}</p>
          <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium", meta.bg, meta.text)}>
            <span className={cn("size-1.5 rounded-full", meta.dot)} />
            {meta.label}
          </span>
        </div>
        <p className={cn("mt-2 text-2xl font-semibold tracking-tight tabular-nums", meta.text)}>
          {fmtCurrency0(metric.value)}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {fmtPct(metric.ratio * 100, 1)} of NLV · {KIND_LABEL[metric.kind]}
        </p>
        <div className="mt-3 border-t pt-2 text-xs">
          <p className="text-muted-foreground">
            Target {fmtCurrency0(metric.targetLow)}–{fmtCurrency0(metric.targetHigh)}
            <span className="text-muted-foreground/70">
              {" "}
              ({fmtPct(metric.targetLowRatio * 100, 0)}–{fmtPct(metric.targetHighRatio * 100, 0)})
            </span>
          </p>
          <p className={cn("mt-0.5 font-medium", metric.deltaToTarget > 0 ? meta.text : "text-muted-foreground")}>
            {deltaLabel}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
