import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { fmtCurrency0, fmtPct } from "@/lib/format";
import type {
  AssignmentWindow,
  PositionAction,
  Recommendation,
  RiskAnalysis,
  SectorConcentration,
  StressTestResult,
  TickerConcentration,
} from "@/lib/risk/types";
import { STATUS_META, stressMeta } from "./status";

const pctNlv = (ratio: number) => fmtPct(ratio * 100, 1);

// ── Recommendations (PRD §10) ────────────────────────────────────────────────
export function RiskRecommendations({ recommendations }: { recommendations: Recommendation[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What To Do Next</CardTitle>
        <CardDescription>Specific, numeric adjustments to move toward your target ranges.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {recommendations.map((r) => {
          const meta = STATUS_META[r.severity];
          return (
            <div key={r.id} className={cn("rounded-lg border p-4", meta.border, meta.bg)}>
              <div className="flex items-center gap-2">
                <span className={cn("size-2 rounded-full", meta.dot)} />
                <p className={cn("text-sm font-semibold", meta.text)}>{r.title}</p>
                <span className={cn("ml-auto text-xs font-medium", meta.text)}>{meta.label}</span>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">{r.detail}</p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ── Concentration (PRD §7) ───────────────────────────────────────────────────
export function RiskConcentration({
  tickers,
  sectors,
  untagged,
}: {
  tickers: TickerConcentration[];
  sectors: SectorConcentration[];
  untagged: string[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Concentration</CardTitle>
        <CardDescription>Post-assignment exposure by name and sector (stock value + put obligation).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">By ticker</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Put obligation</TableHead>
                <TableHead className="text-right">Exposure</TableHead>
                <TableHead className="text-right">% NLV</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickers.map((t) => {
                const meta = STATUS_META[t.status];
                return (
                  <TableRow key={t.ticker}>
                    <TableCell className="font-medium">{t.ticker}</TableCell>
                    <TableCell className="text-muted-foreground">{t.sector ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtCurrency0(t.stockValue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtCurrency0(t.putObligation)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{fmtCurrency0(t.exposure)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums font-medium", meta.text)}>{pctNlv(t.ratio)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">By sector</p>
          {sectors.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sector</TableHead>
                  <TableHead className="text-right">Exposure</TableHead>
                  <TableHead className="text-right">% NLV</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sectors.map((s) => {
                  const meta = STATUS_META[s.status];
                  return (
                    <TableRow key={s.sector}>
                      <TableCell className="font-medium">{s.sector}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtCurrency0(s.exposure)}</TableCell>
                      <TableCell className={cn("text-right tabular-nums font-medium", meta.text)}>{pctNlv(s.ratio)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No sector-tagged positions.</p>
          )}
          {untagged.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Untagged (excluded from sector totals): {untagged.join(", ")}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Assignment timeline (PRD §8) ─────────────────────────────────────────────
export function RiskTimeline({ timeline, hasAnyDelta }: { timeline: AssignmentWindow[]; hasAnyDelta: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Assignment Timeline</CardTitle>
        <CardDescription>Full put-assignment obligation by expiration window. Estimates use delta and are not the cash requirement.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Window</TableHead>
                <TableHead className="text-right">Obligation</TableHead>
                <TableHead className="text-right">% NLV</TableHead>
                <TableHead className="text-right">Contracts</TableHead>
                <TableHead className="text-right">Tickers</TableHead>
                <TableHead className="text-right">Est. assigned</TableHead>
                <TableHead className="text-right">Prob-weighted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {timeline.map((w) => (
                <TableRow key={w.label}>
                  <TableCell className="font-medium">{w.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtCurrency0(w.obligation)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pctNlv(w.ratio)}</TableCell>
                  <TableCell className="text-right tabular-nums">{w.contracts}</TableCell>
                  <TableCell className="text-right tabular-nums">{w.tickers}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {w.hasDelta ? w.estimatedAssignments.toFixed(1) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {w.hasDelta ? fmtCurrency0(w.probabilityWeighted) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {!hasAnyDelta && (
          <p className="mt-2 text-xs text-muted-foreground">
            Deltas unavailable — estimated-assignment columns omitted. Full obligation still governs.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Stress tests (PRD §9) ────────────────────────────────────────────────────
export function RiskStressTests({ tests }: { tests: StressTestResult[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stress Tests</CardTitle>
        <CardDescription>Estimated outcomes under adverse scenarios. Severity follows liquidity and exposure, not the NLV estimate.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scenario</TableHead>
                <TableHead className="text-right">Proj. NLV</TableHead>
                <TableHead className="text-right">Assign. cash</TableHead>
                <TableHead className="text-right">Proj. cash</TableHead>
                <TableHead className="text-right">Margin req.</TableHead>
                <TableHead className="text-right">Top ticker</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tests.map((t) => {
                const meta = stressMeta(t.severity);
                return (
                  <TableRow key={t.scenarioName}>
                    <TableCell>
                      <span className="font-medium">{t.scenarioName}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{t.description}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtCurrency0(t.projectedNLV)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtCurrency0(t.assignmentCashRequired)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", t.projectedCashBalance < 0 && "text-danger font-medium")}>
                      {fmtCurrency0(t.projectedCashBalance)}
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums", t.marginRequired > 0 && "text-caution font-medium")}>
                      {fmtCurrency0(t.marginRequired)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t.largestTickerPercent.toFixed(0)}%</TableCell>
                    <TableCell>
                      <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium", meta.bg, meta.text)}>
                        <span className={cn("size-1.5 rounded-full", meta.dot)} />
                        {t.severity === "normal" ? "OK" : meta.label}
                        {t.liquidationRisk && " · liquidation risk"}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Per-position actions (PRD §10.5) ─────────────────────────────────────────
const ACTION_META: Record<PositionAction["action"], { bg: string; text: string }> = {
  Keep: { bg: "bg-success/10", text: "text-success" },
  Monitor: { bg: "bg-warning/10", text: "text-warning" },
  Reduce: { bg: "bg-caution/10", text: "text-caution" },
  Roll: { bg: "bg-warning/10", text: "text-warning" },
  Close: { bg: "bg-danger/10", text: "text-danger" },
  "Take Assignment": { bg: "bg-leverage/10", text: "text-leverage" },
};

export function RiskPositionActions({ actions }: { actions: PositionAction[] }) {
  if (!actions.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Position Actions</CardTitle>
        <CardDescription>Ranked by reduction priority. A roll closes one obligation and opens another — it does not remove risk.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Position</TableHead>
                <TableHead className="text-right">DTE</TableHead>
                <TableHead className="text-right">Obligation</TableHead>
                <TableHead className="text-right">Moneyness</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Why</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {actions.map((a, i) => {
                const meta = ACTION_META[a.action];
                return (
                  <TableRow key={`${a.ticker}-${a.strike}-${i}`}>
                    <TableCell className="font-medium">
                      {a.ticker} {a.isNakedCall ? "Call" : `${a.strike}P`}
                      {a.isNakedCall && <span className="ml-1 text-xs text-danger">uncovered</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{a.isNakedCall ? "—" : a.dte}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.obligation ? fmtCurrency0(a.obligation) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.isNakedCall ? "—" : `${a.itmPct >= 0 ? "+" : ""}${(a.itmPct * 100).toFixed(1)}%`}
                    </TableCell>
                    <TableCell>
                      <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", meta.bg, meta.text)}>{a.action}</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.reasons.join(" · ")}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Narrative + premium (PRD §13, §11.3) ─────────────────────────────────────
export function RiskNarrative({ analysis }: { analysis: RiskAnalysis }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Portfolio Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed">{analysis.narrative}</p>
        <div className="rounded-lg border bg-secondary/40 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Premium return (informational)</p>
          <p className="mt-1 text-sm">
            Open premium collected {fmtCurrency0(analysis.premium.openPremiumAtRisk)} ·{" "}
            {fmtPct(analysis.premium.premiumYieldPctOfNlv, 2)} of NLV.
            <span className="block text-xs text-muted-foreground">
              Premium is capped and reported separately — it does not offset capital risk or raise the health score.
            </span>
          </p>
        </div>
        {analysis.dataQuality.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {analysis.dataQuality.map((n, i) => (
              <p key={i}>• {n}</p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
