"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Play, ShieldCheck, Check, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtCurrency0, fmtDate, fmtRelativeTime } from "@/lib/format";
import type { BotProposal, BotState, ProposalStatus } from "@/lib/bot/types";

const STATUS_BADGE: Record<ProposalStatus, { label: string; variant: "success" | "warning" | "danger" | "secondary" | "outline" }> = {
  proposed: { label: "Proposed", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  rejected: { label: "Rejected", variant: "danger" },
  expired: { label: "Expired", variant: "secondary" },
  executed: { label: "Executed", variant: "success" },
};

export function BotView({ state }: { state: BotState }) {
  const router = useRouter();
  const { demo } = state;

  const [enabled, setEnabled] = useState(state.settings.enabled);
  const [maxTrades, setMaxTrades] = useState(state.settings.max_trades_per_day);
  const [universe, setUniverse] = useState(state.settings.universe.join(", "));
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runNote, setRunNote] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const proposed = state.proposals.filter((p) => p.status === "proposed");
  const history = state.proposals.filter((p) => p.status !== "proposed");

  async function post(url: string, body: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? "Request failed");
    return data;
  }

  async function saveSettings() {
    setSaving(true);
    setSavedNote(null);
    setError(null);
    try {
      const tickers = universe.split(/[\s,]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
      const data = await post("/api/bot/settings", { enabled, max_trades_per_day: maxTrades, universe: tickers });
      setSavedNote(data.demo ? "Demo — not persisted" : "Saved");
      if (!data.demo) router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setRunNote(null);
    setError(null);
    try {
      const data = await post("/api/bot/run", {});
      setRunNote(data.demo ? "Demo — the bot runs against live Schwab data only" : "Run complete");
      if (!data.demo) router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not run");
    } finally {
      setRunning(false);
    }
  }

  async function decide(p: BotProposal, action: "approve" | "reject") {
    setPendingId(p.id);
    setError(null);
    try {
      const data = await post("/api/bot/proposals", { id: p.id, action });
      if (!data.demo) router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update proposal");
    } finally {
      setPendingId(null);
    }
  }

  const lastRun = state.runs[0];

  return (
    <div className="space-y-6">
      {/* Safety banner */}
      <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-secondary/40 px-4 py-3 text-sm">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <span>
          <span className="font-medium">Proposals only.</span> The bot suggests up to {state.settings.max_trades_per_day} trades
          per trading day; nothing is sent to your brokerage. You approve or reject each one below. Live order placement is a
          separate feature that would require reconnecting Schwab with trading permission.
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-5 text-primary" /> Bot Configuration
          </CardTitle>
          <CardDescription>
            Wheel-strategy cash-secured-put screener over the approved S&P 500 universe: hard filters (quality, technicals,
            20-DTE–35-DTE, |Δ| 0.15–0.30, ≥20% annualized, liquidity, no earnings before expiry), 0–100 scoring, publishes only 80+.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Bot enabled</p>
              <p className="text-xs text-muted-foreground">Include this account in the daily evaluation.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="max">Max trades per day</Label>
              <Input
                id="max"
                type="number"
                min={0}
                max={20}
                value={maxTrades}
                onChange={(e) => setMaxTrades(Number(e.target.value))}
                className="max-w-32"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="universe">Ticker universe (optional narrowing)</Label>
              <Input
                id="universe"
                placeholder="Blank = full approved S&P 500 list"
                value={universe}
                onChange={(e) => setUniverse(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to scan the full approved universe (~236 names). Enter tickers to narrow to a subset.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={saveSettings} disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </Button>
            <Button variant="outline" onClick={runNow} disabled={running}>
              <Play className="size-4" /> {running ? "Running…" : "Run now"}
            </Button>
            {savedNote && <span className="text-sm text-muted-foreground">{savedNote}</span>}
            {runNote && <span className="text-sm text-muted-foreground">{runNote}</span>}
            {lastRun && (
              <span className="ml-auto text-xs text-muted-foreground">
                Last run {fmtRelativeTime(lastRun.ran_at)} · {lastRun.candidates_evaluated} candidates · {lastRun.proposals_created} proposed
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Today's proposals */}
      <Card>
        <CardHeader>
          <CardTitle>Today&apos;s Proposals {proposed.length > 0 && <Badge variant="warning" className="ml-1">{proposed.length}</Badge>}</CardTitle>
          <CardDescription>Review each suggestion. Approving records your decision; it does not place an order.</CardDescription>
        </CardHeader>
        <CardContent>
          {proposed.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No open proposals. {enabled ? "The bot will post its next set on the daily run, or click Run now." : "Enable the bot and set a ticker universe to get started."}
            </p>
          ) : (
            <div className="space-y-3">
              {proposed.map((p) => (
                <div key={p.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{p.ticker}</span>
                      <span className="text-sm text-muted-foreground">
                        {p.strategy === "cash_secured_put" ? "Sell Put" : "Sell Call"} · {fmtCurrency0(p.strike)} · {fmtDate(p.expiration)} · {p.contracts}x
                      </span>
                      {p.score != null && <Badge variant="secondary">{p.score.toFixed(0)} score</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{p.rationale}</p>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                      {p.est_premium != null && <span>Credit {fmtCurrency0(p.est_premium)}</span>}
                      {p.capital_required != null && <span>Secured {fmtCurrency0(p.capital_required)}</span>}
                      {p.details?.simpleAnnualized != null && <span>{p.details.simpleAnnualized}% ann.</span>}
                      {p.details?.breakevenCushion != null && <span>{p.details.breakevenCushion}% cushion</span>}
                      {p.details?.delta != null && <span>Δ {p.details.delta.toFixed(2)}</span>}
                      {p.details?.openInterest != null && <span>OI {p.details.openInterest.toLocaleString()}</span>}
                    </div>
                    {p.details?.components && (
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span>Quality {p.details.components.quality}/25</span>
                        <span>Technical {p.details.components.technical}/25</span>
                        <span>Option {p.details.components.option}/20</span>
                        <span>Liquidity {p.details.components.liquidity}/15</span>
                        <span>Downside {p.details.components.downside}/10</span>
                        <span>Event {p.details.components.eventPortfolio}/5</span>
                      </div>
                    )}
                    {p.details?.principalRisk && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        <span className="font-medium">Principal risk:</span> {p.details.principalRisk}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={pendingId === p.id} onClick={() => decide(p, "approve")}>
                      <Check className="size-4" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" disabled={pendingId === p.id} onClick={() => decide(p, "reject")}>
                      <X className="size-4" /> Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* History */}
      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Decision History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Trade</TableHead>
                    <TableHead className="text-right">Est. credit</TableHead>
                    <TableHead className="text-right">Capital</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((p) => {
                    const b = STATUS_BADGE[p.status];
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="text-muted-foreground">{fmtDate(p.created_at.slice(0, 10))}</TableCell>
                        <TableCell>
                          <span className="font-medium">{p.ticker}</span>{" "}
                          <span className="text-muted-foreground">
                            {p.strategy === "cash_secured_put" ? "Put" : "Call"} {fmtCurrency0(p.strike)} {fmtDate(p.expiration)} {p.contracts}x
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{p.est_premium != null ? fmtCurrency0(p.est_premium) : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.capital_required != null ? fmtCurrency0(p.capital_required) : "—"}</TableCell>
                        <TableCell><Badge variant={b.variant}>{b.label}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Scan report */}
      {(state.report || state.scan) && (
        <Card>
          <CardHeader>
            <CardTitle>Latest Scan Report</CardTitle>
            <CardDescription>
              How the approved universe was filtered. Only trades scoring 80+ are published; never more than 5.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {state.scan && state.scan.cursor < state.scan.universe_size && (
              <p className="text-sm text-warning">
                Scan in progress — {state.scan.cursor}/{state.scan.universe_size} tickers evaluated. Proposals publish when the
                full universe is scanned.
              </p>
            )}

            {state.report?.counts && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label="Universe" value={String(state.report.counts.universe)} />
                <Stat label="Scanned" value={String(state.report.counts.scanned)} />
                <Stat label="Rejected pre-option" value={String(state.report.counts.rejectedBeforeOptions)} />
                <Stat label="Contracts eval." value={String(state.report.counts.contractsEvaluated)} />
                <Stat label="Passed filters" value={String(state.report.counts.passedHardFilters)} />
                <Stat label="Scored 80+" value={String(state.report.counts.scored80Plus)} />
              </div>
            )}

            {state.report?.watchlist && state.report.watchlist.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Watchlist (76–79) — not published
                </p>
                <div className="flex flex-wrap gap-2">
                  {state.report.watchlist.map((w) => (
                    <span key={w.ticker} className="rounded-md border px-2 py-1 text-xs">
                      <span className="font-medium">{w.ticker}</span> {w.score} · {w.strike}P · {w.simpleAnnualized}%
                    </span>
                  ))}
                </div>
              </div>
            )}

            {state.report?.highYieldRejections && state.report.highYieldRejections.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Highest-yield rejections (chasing check)
                </p>
                <div className="space-y-1">
                  {state.report.highYieldRejections.map((r, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      <span className="font-medium">{r.ticker}</span>
                      {r.simpleAnnualized != null && <span className="text-danger"> {r.simpleAnnualized}%</span>} — {r.reason}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {state.report?.concentrationFlags?.map((f, i) => (
              <p key={i} className="text-xs text-warning">⚠ {f}</p>
            ))}
            {state.report?.dataWarnings?.map((w, i) => (
              <p key={i} className="text-xs text-muted-foreground">• {w}</p>
            ))}
          </CardContent>
        </Card>
      )}

      {demo && (
        <p className="text-center text-xs text-muted-foreground">
          Showing sample bot data. Live scanning runs against the approved S&P 500 universe once Schwab is connected and the
          earnings-data API key is set.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-2.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
