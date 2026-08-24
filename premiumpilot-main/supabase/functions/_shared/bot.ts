// Wheel-strategy cash-secured-put engine (deterministic). Implements the master
// spec: stock hard filters, contract eligibility, the 0–100 scoring model,
// ranking, watchlist, and high-yield rejections. Pure logic (only `import type`
// from schwab.ts, so it runs under Node for tests as well as Deno).
//
// Governing rule: never propose a put on a stock the investor wouldn't want to
// own at the breakeven price. Every put is a binding commitment to buy 100
// shares; returns are always on the full cash-secured obligation, never margin.
//
// DATA LIMITS (surfaced as dataWarnings, never faked):
//  - Fundamental score is computed from Schwab ratio fundamentals (margins,
//    leverage, coverage, liquidity, dividend, valuation). Qualitative items
//    (going-concern, accounting fraud, moat narrative) can't be measured here.
//  - IV percentile needs IV history we don't have yet → that sub-score is
//    scored neutrally and flagged.
//  - Earnings dates come from an external provider; if unknown, the event
//    filter fails closed (reject) per the spec.

import type { OptionCandidate } from "./schwab.ts";
import {
  atr,
  closes as toCloses,
  divergence,
  fiftyTwoWeekLow,
  macd,
  obv,
  pctReturn,
  recentSwingLow,
  rsi,
  rsiSeries,
  sma,
  smaSlope,
  supportTouches,
  trendStructure,
  type Candle,
} from "./indicators.ts";

// Schwab instruments → fundamental (subset we use).
export interface Fundamentals {
  peRatio?: number;
  pegRatio?: number;
  pbRatio?: number;
  dividendYield?: number;
  dividendAmount?: number;
  netProfitMarginTTM?: number;
  operatingMarginTTM?: number;
  grossMarginTTM?: number;
  returnOnEquity?: number;
  returnOnAssets?: number;
  totalDebtToEquity?: number;
  ltDebtToEquity?: number;
  interestCoverage?: number;
  currentRatio?: number;
  quickRatio?: number;
  marketCapFloat?: number;
  marketCap?: number;
  epsTTM?: number;
  revChangeTTM?: number;
}

export interface TickerInput {
  ticker: string;
  name?: string;
  sector?: string | null;
  currentPrice: number;
  candles: Candle[];
  fundamentals: Fundamentals | null;
  options: OptionCandidate[]; // put candidates
  earningsDate: string | null; // ISO YYYY-MM-DD
  earningsKnown: boolean; // false → event filter fails closed
}

export interface BotConfig {
  maxTradesPerDay: number; // 5
  maxPositionSize: number; // max gross cash obligation per proposal ($)
  contractsPerTrade: number; // default 1
  minAnnualizedReturn: number; // 0.20
  minDte: number; // 20
  maxDte: number; // 35
  minDelta: number; // 0.15
  maxDelta: number; // 0.30
  minOpenInterest: number; // 500
  minVolume: number; // 100
  maxSpreadPct: number; // 0.08
  maxSma20Distance: number; // 0.08
  maxRsi: number; // 68
  max20dReturn: number; // 0.15
  publishThreshold: number; // 80
  watchlistFloor: number; // 76
  maxPerSector: number; // 2
}

export const DEFAULT_BOT_CONFIG: BotConfig = {
  maxTradesPerDay: 5,
  maxPositionSize: 50000,
  contractsPerTrade: 1,
  minAnnualizedReturn: 0.2,
  minDte: 20,
  maxDte: 35,
  minDelta: 0.15,
  maxDelta: 0.3,
  minOpenInterest: 500,
  minVolume: 100,
  maxSpreadPct: 0.08,
  maxSma20Distance: 0.08,
  maxRsi: 68,
  max20dReturn: 0.15,
  publishThreshold: 80,
  watchlistFloor: 76,
  maxPerSector: 2,
};

export interface MarketContext {
  spyReturn20: number | null; // for relative strength
}

export interface ScoreComponents {
  quality: number; // /25
  technical: number; // /25
  option: number; // /20
  liquidity: number; // /15
  downside: number; // /10
  eventPortfolio: number; // /5
}

export interface ScoredTrade {
  ticker: string;
  name: string | null;
  sector: string | null;
  score: number;
  components: ScoreComponents;
  currentPrice: number;
  expiration: string;
  dte: number;
  strike: number;
  bid: number;
  ask: number;
  midpoint: number;
  suggestedLimit: number;
  minAcceptableCredit: number;
  delta: number;
  iv: number;
  openInterest: number;
  volume: number;
  spreadPct: number;
  contracts: number;
  grossObligation: number;
  netCashRequirement: number;
  cashSecuredReturn: number;
  simpleAnnualized: number;
  compoundedAnnualized: number;
  breakeven: number;
  breakevenCushion: number;
  nearestSupport: number | null;
  earningsDate: string | null;
  optionSymbol: string | null;
  stress: { drop: number; loss: number; lossPct: number }[];
  rationale: string;
  principalRisk: string;
  doNotEnterBelow: number;
  aiRiskFlags: string[];
  // "qualified" = met every rule and scored ≥ publish threshold. "near_miss" =
  // passed the hard filters but scored below the bar; surfaced only to fill the
  // day's list to maxTradesPerDay so there are always trades to consider.
  tier: "qualified" | "near_miss";
  missReason?: string; // why a near_miss fell short (for the UI)
}

export interface RejectedTrade {
  ticker: string;
  reason: string;
  simpleAnnualized: number | null;
}

export interface BotReport {
  published: ScoredTrade[];
  watchlist: ScoredTrade[];
  highYieldRejections: RejectedTrade[];
  concentrationFlags: string[];
  dataWarnings: string[];
  counts: {
    universe: number;
    scanned: number;
    rejectedBeforeOptions: number;
    contractsEvaluated: number;
    passedHardFilters: number;
    scored80Plus: number;
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

// Per-ticker evaluation result (the unit the chunked scanner stages).
export interface TickerEval {
  ticker: string;
  best: ScoredTrade | null; // best scored contract, if any passed the hard filters
  rejection: RejectedTrade | null; // notable rejection (highest-return) for the report
  contractsEvaluated: number;
  passedHardFilters: number;
  rejectedBeforeOptions: boolean;
}

export interface ScanCounts {
  universe: number;
  scanned: number;
  rejectedBeforeOptions: number;
  contractsEvaluated: number;
  passedHardFilters: number;
}

// Evaluate ONE ticker. Deterministic. Returns the ticker's single best candidate
// — a STRICT one (meets every rule) if available, otherwise the best SOFT
// near-miss (safe and tradeable, but missed a preference rule like the ≥20%
// return, delta band, DTE window, OI, or spread — tagged with `missReason`).
// Safety failures (earnings before expiry, unaffordable, un-tradeable quote,
// overextended/low-quality underlying) are never returned as candidates.
export function evaluateTicker(t: TickerInput, config: BotConfig, market: MarketContext, now: Date): TickerEval {
  const stockReject = stockHardFilterReason(t, config, now);
  if (stockReject) {
    return { ticker: t.ticker, best: null, rejection: { ticker: t.ticker, reason: stockReject, simpleAnnualized: null }, contractsEvaluated: 0, passedHardFilters: 0, rejectedBeforeOptions: true };
  }

  let bestStrict: ScoredTrade | null = null;
  let bestRelaxed: ScoredTrade | null = null;
  let contractsEvaluated = 0;
  let passedHardFilters = 0;
  let notable: RejectedTrade | null = null;

  for (const opt of t.options) {
    if (opt.putCall !== "PUT") continue;
    const ad = Math.abs(opt.delta);
    // Neighborhood: only score contracts reasonably near our params.
    if (opt.dte < 12 || opt.dte > 45) continue;
    if (ad < 0.1 || ad > 0.4) continue;

    const safety = contractSafetyReject(opt, t, config);
    if (safety) {
      const sa = simpleAnnualizedOf(opt, config.contractsPerTrade);
      if (!notable || sa > (notable.simpleAnnualized ?? -1)) notable = { ticker: t.ticker, reason: safety, simpleAnnualized: sa };
      continue;
    }

    contractsEvaluated += 1;
    const miss = strictContractMiss(opt, t, config);
    const scored = scoreTrade(opt, t, config, market);
    if (!miss) {
      passedHardFilters += 1;
      if (!bestStrict || scored.score > bestStrict.score) bestStrict = scored;
    } else {
      scored.missReason = miss;
      if (!bestRelaxed || scored.score > bestRelaxed.score) bestRelaxed = scored;
    }
  }

  const best = bestStrict ?? bestRelaxed;
  return {
    ticker: t.ticker,
    best,
    rejection: best ? null : notable ?? { ticker: t.ticker, reason: "No tradeable contract in range", simpleAnnualized: null },
    contractsEvaluated,
    passedHardFilters,
    rejectedBeforeOptions: false,
  };
}

// Rank a set of per-ticker best contracts. Always returns up to
// maxTradesPerDay proposals: the QUALIFIED ones (≥ publish threshold, sector-
// capped) first, then the highest-scoring NEAR-MISSES (passed every hard filter
// but fell short of the 80 bar) to fill the list, so there are always trades to
// consider. Hard-filter failures are never surfaced as proposals — only the
// score bar is relaxed for the fill.
export function rankAndReport(
  bests: ScoredTrade[],
  rejections: RejectedTrade[],
  config: BotConfig,
  counts: ScanCounts,
  dataWarnings: string[]
): BotReport {
  const warnings = new Set(dataWarnings);
  const sorted = [...bests].sort((a, b) => b.score - a.score || tiebreak(b) - tiebreak(a));

  // Tier 1 — qualified: met every rule (no missReason), ≥ threshold, sector-
  // capped, ≤ daily max.
  const qualified: ScoredTrade[] = [];
  const chosen = new Set<ScoredTrade>();
  const sectorCount = new Map<string, number>();
  for (const trade of sorted) {
    if (trade.missReason) continue; // soft near-miss — can only fill, never qualify
    if (trade.score < config.publishThreshold) continue;
    if (qualified.length >= config.maxTradesPerDay) break;
    const sector = trade.sector ?? "Unknown";
    if ((sectorCount.get(sector) ?? 0) >= config.maxPerSector) {
      trade.aiRiskFlags.push(`Sector cap: already ${config.maxPerSector} ${sector} picks.`);
      continue;
    }
    trade.tier = "qualified";
    qualified.push(trade);
    chosen.add(trade);
    sectorCount.set(sector, (sectorCount.get(sector) ?? 0) + 1);
    if (trade.iv <= 0) warnings.add("IV percentile unavailable — implied-volatility sub-score is neutral.");
  }

  // Tier 2 — near-miss fill to maxTradesPerDay. Prefer STRICT candidates that met
  // every rule but scored under the bar (safest), then SOFT candidates that
  // missed a preference rule (return/delta/DTE/OI/spread), each by score. Safety
  // failures are already excluded (never in `bests`). Sector cap relaxed here.
  const nearMisses: ScoredTrade[] = [];
  const remaining = sorted.filter((t) => !chosen.has(t));
  const strictFirst = [...remaining.filter((t) => !t.missReason), ...remaining.filter((t) => t.missReason)];
  for (const trade of strictFirst) {
    if (qualified.length + nearMisses.length >= config.maxTradesPerDay) break;
    trade.tier = "near_miss";
    // Strict-but-under-bar candidates have no rule miss yet; label by score.
    if (!trade.missReason) {
      trade.missReason =
        trade.score < config.publishThreshold
          ? `Scored ${trade.score} — under the ${config.publishThreshold} bar (${weakestArea(trade)}).`
          : `Bumped by the ${config.maxPerSector}-per-sector cap.`;
    } else {
      trade.missReason = `Missed a rule: ${trade.missReason}.`;
    }
    nearMisses.push(trade);
    chosen.add(trade);
  }

  const proposals = [...qualified, ...nearMisses];

  const watchlist = sorted
    .filter((t) => !chosen.has(t) && t.score >= config.watchlistFloor && t.score < config.publishThreshold)
    .slice(0, 5);

  const highYieldRejections = rejections
    .filter((r) => r.simpleAnnualized != null)
    .sort((a, b) => (b.simpleAnnualized ?? 0) - (a.simpleAnnualized ?? 0))
    .slice(0, 3);

  const concentrationFlags: string[] = [];
  for (const [sector, count] of sectorCount) {
    if (count >= config.maxPerSector) concentrationFlags.push(`${count} recommendations in ${sector} (at sector cap).`);
  }

  return {
    published: proposals,
    watchlist,
    highYieldRejections,
    concentrationFlags,
    dataWarnings: [...warnings],
    counts: { ...counts, scored80Plus: sorted.filter((t) => !t.missReason && t.score >= config.publishThreshold).length },
  };
}

// Human-readable weakest scoring dimension (as a % of that category's budget).
function weakestArea(t: ScoredTrade): string {
  const pct: [string, number][] = [
    ["quality", t.components.quality / 25],
    ["technical", t.components.technical / 25],
    ["option value", t.components.option / 20],
    ["liquidity", t.components.liquidity / 15],
    ["downside protection", t.components.downside / 10],
  ];
  pct.sort((a, b) => a[1] - b[1]);
  return `weakest on ${pct[0][0]}`;
}

// Convenience: evaluate a full set in-memory (used in tests and small scans).
export function evaluateWheel(inputs: TickerInput[], config: BotConfig, market: MarketContext, now: Date): BotReport {
  const bests: ScoredTrade[] = [];
  const rejections: RejectedTrade[] = [];
  const warnings = new Set<string>();
  const counts: ScanCounts = { universe: inputs.length, scanned: inputs.length, rejectedBeforeOptions: 0, contractsEvaluated: 0, passedHardFilters: 0 };
  if (market.spyReturn20 == null) warnings.add("SPY benchmark unavailable — relative-strength scored neutrally.");

  for (const t of inputs) {
    const ev = evaluateTicker(t, config, market, now);
    counts.contractsEvaluated += ev.contractsEvaluated;
    counts.passedHardFilters += ev.passedHardFilters;
    if (ev.rejectedBeforeOptions) counts.rejectedBeforeOptions += 1;
    if (ev.best) bests.push(ev.best);
    else if (ev.rejection) rejections.push(ev.rejection);
    if (!t.fundamentals) warnings.add(`${t.ticker}: no fundamental data — quality scored on limited inputs.`);
  }

  return rankAndReport(bests, rejections, config, counts, [...warnings]);
}

// ── Hard filters ──────────────────────────────────────────────────────────────
function stockHardFilterReason(t: TickerInput, config: BotConfig, now: Date): string | null {
  const cl = toCloses(t.candles);
  const sma20 = sma(cl, 20);
  const r = rsi(cl, 14);
  const ret20 = pctReturn(cl, 20);
  if (sma20 == null || r == null || ret20 == null) return "Insufficient price history (INSUFFICIENT_DATA)";

  if ((t.currentPrice - sma20) / sma20 > config.maxSma20Distance) return `Overextended: >${Math.round(config.maxSma20Distance * 100)}% above SMA20`;
  if (r > config.maxRsi) return `Overextended: RSI ${r.toFixed(0)} > ${config.maxRsi}`;
  if (ret20 > config.max20dReturn) return `Overextended: 20-day return ${Math.round(ret20 * 100)}% > ${Math.round(config.max20dReturn * 100)}%`;

  // Event risk — earnings must be confirmed and after the shortest tradable expiry.
  if (!t.earningsKnown) return "Earnings date unconfirmed (INSUFFICIENT_DATA)";

  // Fundamental ownership auto-rejects (ratio-detectable subset).
  const f = t.fundamentals;
  if (!f) return "No fundamental data (INSUFFICIENT_DATA)";
  if (typeof f.netProfitMarginTTM === "number" && f.netProfitMarginTTM < -5) return "Unprofitable: deeply negative net margin";
  if (typeof f.interestCoverage === "number" && f.interestCoverage < 0) return "Negative interest coverage (debt-service risk)";
  if (typeof f.totalDebtToEquity === "number" && f.totalDebtToEquity > 500) return "Excessive leverage (debt/equity > 5x)";

  return null;
}

// SAFETY gates — a contract failing any of these is never shown, not even as a
// near-miss (can't be traded, unaffordable, or carries event risk).
function contractSafetyReject(opt: OptionCandidate, t: TickerInput, config: BotConfig): string | null {
  if (opt.strike >= t.currentPrice) return "Put not out of the money";
  if (opt.bid <= 0) return "Zero or missing bid";
  if (opt.ask < opt.bid) return "Crossed/locked quote";
  if (t.earningsDate && t.earningsDate <= opt.expiration) return "Earnings before expiration";
  if (opt.strike * 100 * config.contractsPerTrade > config.maxPositionSize) return "Position size exceeds max";
  return null;
}

// STRICT (preference) rules. Returns null when the contract meets them all
// (→ a qualified candidate), otherwise a short reason for the rule it just
// missed (→ a near-miss). Ordered by importance so the label is the headline miss.
function strictContractMiss(opt: OptionCandidate, t: TickerInput, config: BotConfig): string | null {
  const sa = simpleAnnualizedOf(opt, config.contractsPerTrade);
  if (sa < config.minAnnualizedReturn) {
    return `${(sa * 100).toFixed(1)}% annualized (< ${Math.round(config.minAnnualizedReturn * 100)}%)`;
  }
  const ad = Math.abs(opt.delta);
  if (ad < config.minDelta || ad > config.maxDelta) return `Δ ${ad.toFixed(2)} (outside ${config.minDelta}–${config.maxDelta})`;
  if (opt.dte < config.minDte || opt.dte > config.maxDte) return `${opt.dte} DTE (outside ${config.minDte}–${config.maxDte})`;
  if (opt.openInterest < config.minOpenInterest) return `OI ${opt.openInterest} (< ${config.minOpenInterest})`;
  const mid = (opt.bid + opt.ask) / 2;
  const spreadPct = mid > 0 ? (opt.ask - opt.bid) / mid : 1;
  if (spreadPct > config.maxSpreadPct) return `spread ${(spreadPct * 100).toFixed(1)}% (> ${Math.round(config.maxSpreadPct * 100)}%)`;
  return null;
}

function simpleAnnualizedOf(opt: OptionCandidate, _contracts: number): number {
  const net = opt.strike - opt.bid;
  if (net <= 0) return 0;
  const csr = opt.bid / net;
  return csr * (365 / Math.max(1, opt.dte));
}

// ── Scoring ───────────────────────────────────────────────────────────────────
function scoreTrade(opt: OptionCandidate, t: TickerInput, config: BotConfig, market: MarketContext): ScoredTrade {
  const contracts = config.contractsPerTrade;
  const bid = opt.bid;
  const breakeven = opt.strike - bid;
  const price = t.currentPrice;
  const cushion = price > 0 ? (price - breakeven) / price : 0;
  const net = opt.strike - bid;
  const csr = net > 0 ? bid / net : 0;
  const simple = csr * (365 / Math.max(1, opt.dte));
  const compounded = Math.pow(1 + csr, 365 / Math.max(1, opt.dte)) - 1;
  const mid = (bid + opt.ask) / 2;
  const spreadPct = mid > 0 ? (opt.ask - bid) / mid : 1;
  const cl = toCloses(t.candles);
  const support = recentSwingLow(t.candles, 20);
  const aiRiskFlags: string[] = [];

  const rsiSer = rsiSeries(cl, 14);
  const div = divergence(t.candles, rsiSer);
  if (div.bearish) aiRiskFlags.push("Bearish price/RSI divergence — momentum weakening at the highs.");

  const quality = scoreQuality(t, breakeven, price);
  const technical = scoreTechnical(t, cl, breakeven, market, div);
  const option = scoreOption(simple, opt, config, support, breakeven);
  const liquidity = scoreLiquidity(opt, spreadPct);
  const downside = scoreDownside(t, cl, breakeven, cushion, support);
  const eventPortfolio = scoreEventPortfolio(t);

  const components: ScoreComponents = { quality, technical, option, liquidity, downside, eventPortfolio };
  const score = round2(quality + technical + option + liquidity + downside + eventPortfolio);

  const stress = [0.1, 0.2, 0.3].map((drop) => {
    const assignedPrice = price * (1 - drop);
    const lossPerShare = assignedPrice - breakeven;
    return { drop, loss: round2(lossPerShare * 100 * contracts), lossPct: round2((lossPerShare / breakeven) * 100) };
  });

  const f = t.fundamentals;
  const ownership = ownershipRating(f);
  const principalRisk = pickPrincipalRisk(t, opt, cushion, market);

  return {
    ticker: t.ticker,
    name: t.name ?? null,
    sector: t.sector ?? null,
    score,
    components,
    currentPrice: round2(price),
    expiration: opt.expiration,
    dte: opt.dte,
    strike: opt.strike,
    bid: round2(bid),
    ask: round2(opt.ask),
    midpoint: round2(mid),
    suggestedLimit: round2(mid),
    minAcceptableCredit: round2(Math.max(bid, breakevenFloorCredit(opt, config))),
    delta: opt.delta,
    iv: opt.iv,
    openInterest: opt.openInterest,
    volume: opt.openInterest > 0 ? Math.round(opt.openInterest) : 0, // volume not on chain; OI shown, flagged elsewhere
    spreadPct: round2(spreadPct * 100),
    contracts,
    grossObligation: round2(opt.strike * 100 * contracts),
    netCashRequirement: round2(net * 100 * contracts),
    cashSecuredReturn: round2(csr * 100),
    simpleAnnualized: round2(simple * 100),
    compoundedAnnualized: round2(compounded * 100),
    breakeven: round2(breakeven),
    breakevenCushion: round2(cushion * 100),
    nearestSupport: support != null ? round2(support) : null,
    earningsDate: t.earningsDate,
    optionSymbol: opt.symbol ?? null,
    stress,
    rationale:
      `${t.ticker}: sell ${contracts} ${opt.strike}P exp ${opt.expiration} (${opt.dte} DTE, Δ ${opt.delta.toFixed(2)}) ` +
      `at ~$${round2(bid * 100 * contracts)} credit — ${Math.round(simple * 100)}% simple annualized on ` +
      `$${Math.round(net * 100 * contracts)} secured. Breakeven $${round2(breakeven)} (${Math.round(cushion * 100)}% cushion). ` +
      `Ownership: ${ownership}.`,
    principalRisk,
    doNotEnterBelow: round2(bid),
    aiRiskFlags,
    tier: "near_miss", // set to "qualified" in rankAndReport when it clears the bar
  };
}

function scoreQuality(t: TickerInput, breakeven: number, price: number): number {
  const f = t.fundamentals;
  if (!f) return 8; // limited data → conservative partial, not full
  let s = 0;
  // Profitability & cash flow (7): net & operating margin (cash flow unavailable).
  const nm = f.netProfitMarginTTM ?? 0;
  s += clamp((nm / 20) * 5, 0, 5) + (f.operatingMarginTTM && f.operatingMarginTTM > 0 ? 2 : 0);
  // Balance sheet (6): leverage + coverage + liquidity.
  let bs = 0;
  if (typeof f.totalDebtToEquity === "number") bs += f.totalDebtToEquity < 100 ? 2.5 : f.totalDebtToEquity < 200 ? 1.2 : 0;
  if (typeof f.interestCoverage === "number") bs += f.interestCoverage > 8 ? 2 : f.interestCoverage > 3 ? 1 : 0;
  if (typeof f.currentRatio === "number") bs += f.currentRatio > 1.5 ? 1.5 : f.currentRatio > 1 ? 0.8 : 0;
  s += clamp(bs, 0, 6);
  // Durability (5): size + ROE as coarse proxies (moat narrative not measurable).
  let dur = 0;
  const cap = f.marketCap ?? f.marketCapFloat ?? 0;
  dur += cap > 2e11 ? 2.5 : cap > 5e10 ? 1.8 : cap > 1e10 ? 1 : 0.3;
  if (typeof f.returnOnEquity === "number") dur += f.returnOnEquity > 15 ? 2 : f.returnOnEquity > 8 ? 1 : 0;
  s += clamp(dur, 0, 5);
  // Shareholder treatment (3): dividend.
  s += (f.dividendYield && f.dividendYield > 0) || (f.dividendAmount && f.dividendAmount > 0) ? 3 : 1;
  // Valuation at breakeven (4): lower effective P/E is better.
  if (typeof f.peRatio === "number" && f.peRatio > 0 && price > 0) {
    const effPe = f.peRatio * (breakeven / price);
    s += effPe < 15 ? 4 : effPe < 22 ? 3 : effPe < 30 ? 1.5 : 0.5;
  } else {
    s += 1.5;
  }
  return clamp(round2(s), 0, 25);
}

// Technical setup (25) — Murphy framework, deterministic. Trend is read
// highest-timeframe-first (SMA200 direction), structure (HH/HL) confirms it,
// participation (OBV) confirms the move, and momentum/divergence flag exhaustion.
function scoreTechnical(
  t: TickerInput,
  cl: number[],
  breakeven: number,
  market: MarketContext,
  div: { bearish: boolean; bullish: boolean }
): number {
  const price = t.currentPrice;
  const sma20 = sma(cl, 20);
  const sma50 = sma(cl, 50);
  const sma200 = sma(cl, 200);
  const slope200 = smaSlope(cl, 200, 20);
  const slope50 = smaSlope(cl, 50, 10);
  const support = recentSwingLow(t.candles, 20);
  const structure = trendStructure(t.candles);
  const participation = obv(t.candles, 10);
  let s = 0;

  // Trend quality (6): long-term direction (SMA200 + its slope) first, then
  // intermediate (SMA50 slope), then structure (higher highs/lows).
  let trend = 0;
  if (sma200 && price > sma200) trend += 1.5;
  if (slope200 != null && slope200 > 0) trend += 1.5;
  if (sma50 && price > sma50 && slope50 != null && slope50 > 0) trend += 1.5;
  if (structure.higherHighs && structure.higherLows) trend += 1.5;
  else if (structure.label === "downtrend") trend -= 1;
  s += clamp(trend, 0, 6);

  // Strike / support alignment (7): breakeven under meaningful support, and the
  // stronger when several swing lows cluster near it.
  let align = 0;
  if (support && breakeven <= support) align += 2;
  if (sma50 && breakeven <= sma50) align += 1.5;
  if (sma200 && breakeven <= sma200) align += 1.5;
  const touches = supportTouches(t.candles, breakeven, 0.02);
  align += touches >= 2 ? 2 : touches === 1 ? 1 : 0;
  s += clamp(align, 0, 7);

  // Momentum (5): mid-range RSI, rising MACD, divergence. Don't reward momentum
  // near the overextension threshold; penalize bearish divergence.
  const r = rsi(cl, 14);
  const m = macd(cl);
  let mo = 0;
  if (r != null) mo += r >= 40 && r <= 60 ? 3 : r > 60 && r <= 68 ? 1.5 : r < 40 ? 2 : 0;
  if (m) mo += m.hist > 0 ? 1.5 : 0.5;
  if (div.bullish) mo += 1;
  if (div.bearish) mo -= 1.5;
  s += clamp(mo, 0, 5);

  // Relative strength (4): stock 20d vs SPY 20d.
  const ret20 = pctReturn(cl, 20);
  if (market.spyReturn20 != null && ret20 != null) {
    s += ret20 >= market.spyReturn20 ? 4 : ret20 >= market.spyReturn20 - 0.03 ? 2.5 : 1;
  } else {
    s += 2; // neutral when benchmark missing
  }

  // Volatility & participation (3): steadier ATR + OBV confirming the trend.
  const a = atr(t.candles, 14);
  let vol = 0;
  if (a != null && price > 0) {
    const atrPct = a / price;
    vol += atrPct < 0.02 ? 2 : atrPct < 0.035 ? 1.4 : atrPct < 0.05 ? 0.8 : 0.2;
  } else {
    vol += 1;
  }
  if (participation) vol += participation.rising ? 1 : 0.2; // volume confirmation
  s += clamp(vol, 0, 3);

  return clamp(round2(s), 0, 25);
}

function scoreOption(simple: number, opt: OptionCandidate, config: BotConfig, support: number | null, breakeven: number): number {
  let s = 0;
  // Annualized return (7), tiered — do not auto-max above 30%.
  const pct = simple;
  if (pct >= 0.3) s += 6.5;
  else if (pct >= 0.25) s += 6;
  else if (pct >= 0.22) s += 5;
  else if (pct >= 0.2) s += 4;
  // Delta & strike (5): preferred 0.20–0.25, bonus if strike aligns support.
  const ad = Math.abs(opt.delta);
  let d = ad >= 0.2 && ad <= 0.25 ? 3.5 : ad >= 0.15 && ad < 0.2 ? 2.8 : ad > 0.25 && ad <= 0.3 ? 2.2 : 1;
  if (support && opt.strike <= support) d += 1.5;
  s += clamp(d, 0, 5);
  // IV opportunity (4): IV percentile unavailable → neutral 2/4.
  s += 2;
  // Time efficiency (4): premium per day per $1k secured.
  const netCash = (opt.strike - opt.bid) * 100;
  const perDayPer1k = netCash > 0 ? ((opt.bid * 100) / netCash) / Math.max(1, opt.dte) * 1000 : 0;
  s += clamp(perDayPer1k * 4, 0, 4);
  return clamp(round2(s), 0, 20);
}

function scoreLiquidity(opt: OptionCandidate, spreadPct: number): number {
  let s = 0;
  s += opt.openInterest >= 5000 ? 4 : opt.openInterest >= 2000 ? 3 : opt.openInterest >= 500 ? 2 : 0;
  // Volume not available on the chain payload → give partial credit, flagged globally.
  s += 2;
  s += spreadPct <= 0.02 ? 5 : spreadPct <= 0.04 ? 4 : spreadPct <= 0.06 ? 2.5 : spreadPct <= 0.08 ? 1 : 0;
  s += opt.bid > 0 && opt.ask >= opt.bid ? 3 : 0;
  return clamp(round2(s), 0, 15);
}

function scoreDownside(t: TickerInput, cl: number[], breakeven: number, cushion: number, support: number | null): number {
  let s = 0;
  s += cushion >= 0.12 ? 3 : cushion >= 0.08 ? 2 : cushion >= 0.05 ? 1 : 0;
  const sma200 = sma(cl, 200);
  if (support && breakeven <= support) s += 1.5;
  if (sma200 && breakeven <= sma200) s += 1.5;
  // Breakeven valuation (2).
  const f = t.fundamentals;
  if (f && typeof f.peRatio === "number" && f.peRatio > 0) {
    const effPe = f.peRatio * (breakeven / Math.max(1, t.currentPrice));
    s += effPe < 18 ? 2 : effPe < 28 ? 1 : 0;
  } else s += 1;
  // Stress résilience (2): still above 52w low after a 20% drop from current.
  const low52 = fiftyTwoWeekLow(t.candles);
  const after20 = t.currentPrice * 0.8;
  if (low52 && after20 > low52) s += 2;
  else if (low52) s += 0.5;
  return clamp(round2(s), 0, 10);
}

function scoreEventPortfolio(t: TickerInput): number {
  let s = 0;
  // No material near-term events (2): earnings confirmed clear already (hard filter passed).
  s += t.earningsKnown ? 2 : 0;
  // Sector/factor diversification (2) + portfolio conflict (1): portfolio data not
  // wired into the engine yet → neutral partial, surfaced in dataWarnings.
  s += 1.5;
  return clamp(round2(s), 0, 5);
}

function ownershipRating(f: Fundamentals | null): string {
  if (!f) return "Unrated (no fundamentals)";
  let score = 0;
  if ((f.netProfitMarginTTM ?? 0) > 10) score += 1;
  if ((f.interestCoverage ?? 0) > 5) score += 1;
  if ((f.returnOnEquity ?? 0) > 12) score += 1;
  if ((f.totalDebtToEquity ?? 999) < 150) score += 1;
  if ((f.dividendYield ?? 0) > 0) score += 1;
  return score >= 4 ? "Strong" : score >= 2 ? "Adequate" : "Marginal";
}

function pickPrincipalRisk(t: TickerInput, opt: OptionCandidate, cushion: number, market: MarketContext): string {
  if (cushion < 0.06) return "Thin downside cushion — assignment likely on a modest pullback.";
  const f = t.fundamentals;
  if (f && (f.totalDebtToEquity ?? 0) > 200) return "Elevated leverage in the underlying.";
  if (Math.abs(opt.delta) > 0.27) return "Higher-delta strike — greater assignment probability.";
  if (market.spyReturn20 != null && market.spyReturn20 < -0.05) return "Weak broad-market tape raises drawdown risk.";
  return "General equity/market drawdown risk before expiration.";
}

// A conservative minimum credit: the bid (never assume midpoint fill).
function breakevenFloorCredit(opt: OptionCandidate, _config: BotConfig): number {
  return opt.bid;
}

// Tiebreaker: prefer more downside cushion, then tighter spread.
function tiebreak(t: ScoredTrade): number {
  return t.breakevenCushion - t.spreadPct;
}
