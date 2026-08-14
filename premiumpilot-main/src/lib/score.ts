import type { EnrichedAssignedHolding, EnrichedPosition, PnlSummary, ScoreBreakdown } from "./types";
import { ENGINE_CONFIG } from "./config";
import { sectorFor } from "./risk/sectors";

const W = ENGINE_CONFIG.scoreWeights;

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));

export interface ScoreInputs {
  positions: EnrichedPosition[];
  holdings: EnrichedAssignedHolding[];
  pnl: PnlSummary;
  netLiquidationValue: number;
  cashAvailable: number; // total cash across accounts
}

// Dashboard "Portfolio Score" — a 0..100 quality score. It answers "is this a
// healthy, well-run income book?" not "am I about to lose money" (that's the
// Risk Manager score). Crucially it is computed from actual holdings + realized
// /unrealized P&L, NOT from option mark-to-market: a covered call going in the
// money is the underlying appreciating (a gain), never a loss.
export function computeScore({
  positions,
  holdings,
  pnl,
  netLiquidationValue,
  cashAvailable,
}: ScoreInputs): ScoreBreakdown {
  const nlv = netLiquidationValue || cashAvailable || 1;

  if (positions.length === 0 && holdings.length === 0) {
    // Empty book: nothing at risk, capital idle.
    const empty = { profitability: 100, capitalEfficiency: 0, diversification: 100, timeRisk: 100, assignmentRisk: 100 };
    return { total: weightedTotal(empty), ...empty };
  }

  const ownedStockValue = holdings.reduce((s, h) => s + h.metrics.marketValue, 0);
  const putObligation = positions
    .filter((p) => p.strategy === "cash_secured_put")
    .reduce((s, p) => s + p.strike * 100 * p.contracts, 0);

  // Profitability: is the book actually making money? Realized + unrealized P&L
  // as a fraction of account value. Neutral (~55) at break-even, rising with
  // gains, falling when genuinely underwater. Deep-ITM covered calls no longer
  // read as losses because stock gains and option marks net out in pnl.total.
  const returnPct = pnl.total / nlv;
  const profitability = clamp(55 + returnPct * 120);

  // Capital Efficiency: how much capital is productively deployed (owned stock +
  // put obligations) vs. NLV — rewarding being invested, penalizing only
  // leverage (deployment beyond NLV, i.e. on margin).
  const utilization = (ownedStockValue + putObligation) / nlv;
  const capitalEfficiency =
    utilization <= 1 ? clamp((utilization / 0.6) * 100) : clamp(100 - (utilization - 1) * 200);

  // Diversification: dispersion of exposure (owned stock + put obligation) across
  // tickers and sectors. Sector weighted more — several names in one sector is
  // still concentrated. This is the main lever that docks a concentrated book.
  const diversification = diversificationScore(positions, holdings);

  // Time Risk: fraction of open option positions expiring within the near-dated
  // window — clustered near-term expirations concentrate event risk.
  const near = positions.filter((p) => p.metrics.dte < ENGINE_CONFIG.timeRisk.nearDteThreshold).length;
  const timeRisk = positions.length === 0 ? 100 : clamp((1 - near / positions.length) * 100);

  // Assignment Risk: risk of an ADVERSE assignment — short puts that are in the
  // money (forced to buy a falling stock) or uncovered calls. A covered call
  // being ITM is not adverse (premium kept, stock called away at a gain).
  const assignmentRisk = assignmentRiskScore(positions, holdings, nlv);

  const parts = { profitability, capitalEfficiency, diversification, timeRisk, assignmentRisk };
  return { total: weightedTotal(parts), ...parts };
}

// Blend of ticker and sector concentration (0 = fully concentrated, 100 = evenly
// spread). Sector is weighted more heavily than single-name.
function diversificationScore(positions: EnrichedPosition[], holdings: EnrichedAssignedHolding[]): number {
  const byTicker = new Map<string, number>();
  const bySector = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, v: number) =>
    map.set(key, (map.get(key) ?? 0) + v);

  for (const h of holdings) {
    if (h.metrics.marketValue <= 0) continue;
    add(byTicker, h.ticker, h.metrics.marketValue);
    add(bySector, sectorFor(h.ticker) ?? `__${h.ticker}`, h.metrics.marketValue);
  }
  for (const p of positions) {
    if (p.strategy !== "cash_secured_put") continue;
    const obligation = p.strike * 100 * p.contracts;
    if (obligation <= 0) continue;
    add(byTicker, p.ticker, obligation);
    add(bySector, sectorFor(p.ticker) ?? `__${p.ticker}`, obligation);
  }

  const tickerDiv = evennessScore([...byTicker.values()]);
  const sectorDiv = evennessScore([...bySector.values()]);
  return clamp(0.4 * tickerDiv + 0.6 * sectorDiv);
}

// Normalized inverse-Herfindahl: 100 when weight is spread evenly across the
// buckets, 0 when it is all in one bucket. Empty/single bucket => 0.
function evennessScore(values: number[]): number {
  const total = values.reduce((s, v) => s + v, 0);
  const n = values.length;
  if (total <= 0 || n <= 1) return 0;
  const hhi = values.reduce((s, v) => s + (v / total) ** 2, 0);
  return clamp(((1 - hhi) / (1 - 1 / n)) * 100);
}

function assignmentRiskScore(
  positions: EnrichedPosition[],
  holdings: EnrichedAssignedHolding[],
  nlv: number
): number {
  const sharesByTicker = new Map<string, number>();
  for (const h of holdings) sharesByTicker.set(h.ticker, (sharesByTicker.get(h.ticker) ?? 0) + h.shares);
  const callContractsByTicker = new Map<string, number>();
  for (const p of positions) {
    if (p.strategy === "covered_call") {
      callContractsByTicker.set(p.ticker, (callContractsByTicker.get(p.ticker) ?? 0) + p.contracts);
    }
  }

  // In-the-money short puts: would force buying a stock that's already falling.
  const itmPutObligation = positions
    .filter((p) => p.strategy === "cash_secured_put" && p.current_underlying_price < p.strike)
    .reduce((s, p) => s + p.strike * 100 * p.contracts, 0);

  // Uncovered calls: a distinct, higher-risk exposure.
  let nakedCallTickers = 0;
  for (const [ticker, contracts] of callContractsByTicker) {
    if ((sharesByTicker.get(ticker) ?? 0) < contracts * 100) nakedCallTickers += 1;
  }

  return clamp(100 - (itmPutObligation / nlv) * 150 - nakedCallTickers * 30);
}

function weightedTotal(s: Omit<ScoreBreakdown, "total">): number {
  return Math.round(
    s.profitability * W.profitability +
      s.capitalEfficiency * W.capitalEfficiency +
      s.diversification * W.diversification +
      s.timeRisk * W.timeRisk +
      s.assignmentRisk * W.assignmentRisk
  );
}
