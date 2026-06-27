import type {
  AssignedHolding,
  AssignedHoldingMetrics,
  EnrichedAssignedHolding,
  EnrichedPosition,
  PnlSummary,
  Trade,
} from "./types";
import { currentProfit } from "./calc";

// Per-share breakeven and live P/L for an assigned stock lot (PRD §9.6).
// Breakeven = cost basis less the option premium credited against it. Unrealized
// P/L marks the remaining shares to the current price against that net basis.
export function assignedHoldingMetrics(h: AssignedHolding): AssignedHoldingMetrics {
  const costBasisTotal = h.cost_basis_per_share * h.shares;
  const netCostBasis = costBasisTotal - h.premium_credit;
  const breakevenPerShare = h.shares === 0 ? 0 : netCostBasis / h.shares;
  const marketValue = h.current_price * h.shares;
  const unrealizedPnl = marketValue - netCostBasis;
  const unrealizedPnlPct = netCostBasis === 0 ? 0 : unrealizedPnl / netCostBasis;
  return {
    breakevenPerShare,
    costBasisTotal,
    netCostBasis,
    marketValue,
    unrealizedPnl,
    unrealizedPnlPct,
  };
}

export function enrichAssignedHoldings(holdings: AssignedHolding[]): EnrichedAssignedHolding[] {
  return holdings.map((h) => ({ ...h, metrics: assignedHoldingMetrics(h) }));
}

// Portfolio-wide P/L: realized from closed trades, unrealized from open option
// positions (marked to market) plus assigned stock, and a trailing-12-month
// running cumulative of realized P/L for the chart.
export function buildPnl(
  trades: Trade[],
  holdings: EnrichedAssignedHolding[],
  positions: EnrichedPosition[],
  now: Date = new Date()
): PnlSummary {
  const realized = trades.reduce((s, t) => s + t.realized_pnl, 0);
  const unrealizedStock = holdings.reduce((s, h) => s + h.metrics.unrealizedPnl, 0);
  const unrealizedOptions = positions.reduce((s, p) => s + currentProfit(p), 0);
  const unrealized = unrealizedOptions + unrealizedStock;

  return {
    realized,
    unrealizedOptions,
    unrealizedStock,
    unrealized,
    total: realized + unrealized,
    cumulative: cumulativeRealized(trades, now),
  };
}

// Buckets realized P/L into the trailing 12 calendar months and accumulates it
// into a running total — the series the cumulative-P/L chart renders.
function cumulativeRealized(trades: Trade[], now: Date) {
  const buckets = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getUTCFullYear(), now.getUTCMonth() - i, 1);
    buckets.push({
      label: d.toLocaleDateString("en-US", { month: "short" }),
      key: `${d.getFullYear()}-${d.getMonth()}`,
      realized: 0,
      cumulative: 0,
    });
  }
  const index = new Map(buckets.map((b) => [b.key, b]));
  for (const t of trades) {
    const d = new Date(t.closed_at);
    const b = index.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (b) b.realized += t.realized_pnl;
  }
  // Seed the running total with realized P/L that predates the 12-month window so
  // the cumulative line starts from the true lifetime figure.
  const windowStart = new Date(now.getUTCFullYear(), now.getUTCMonth() - 11, 1).getTime();
  let running = trades
    .filter((t) => new Date(t.closed_at).getTime() < windowStart)
    .reduce((s, t) => s + t.realized_pnl, 0);
  for (const b of buckets) {
    running += b.realized;
    b.cumulative = running;
  }
  return buckets;
}
