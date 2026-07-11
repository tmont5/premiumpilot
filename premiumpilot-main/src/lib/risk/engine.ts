import type { PortfolioView } from "../portfolio";
import type { Profile } from "../types";
import { bandsFor, classify, ratioDeltaToTarget, concentrationStatus, type Band } from "./bands";
import { sectorFor } from "./sectors";
import { computeHealthScore } from "./health";
import { runStressTests } from "./stress";
import { buildRecommendations, rankPositions } from "./recommendations";
import { buildNarrative } from "./narrative";
import type {
  AssignmentWindow,
  MetricAssessment,
  RiskAnalysis,
  RiskCoveredCall,
  RiskDerived,
  RiskEquity,
  RiskInput,
  RiskShortPut,
  SectorConcentration,
  TickerConcentration,
} from "./types";

// ── Adapter: PortfolioView → PRD §4 data contracts ────────────────────────────
// The app stores richer position data than the PRD contract; this narrows it and
// pre-computes each short put's full assignment obligation (§5.2, §16.1).
export function buildRiskInput(pf: PortfolioView, profile: Profile): RiskInput {
  const equities: RiskEquity[] = pf.assignedHoldings.map((h) => ({
    ticker: h.ticker,
    sector: sectorFor(h.ticker),
    shares: h.shares,
    currentPrice: h.current_price,
    marketValue: h.metrics.marketValue,
  }));

  const shortPuts: RiskShortPut[] = pf.positions
    .filter((p) => p.strategy === "cash_secured_put")
    .map((p) => ({
      ticker: p.ticker,
      sector: sectorFor(p.ticker),
      contracts: p.contracts,
      strike: p.strike,
      expiration: p.expiration,
      dte: p.metrics.dte,
      underlyingPrice: p.current_underlying_price,
      optionMarketValue: p.current_option_value,
      premiumReceived: p.premium_collected,
      delta: p.delta ? p.delta : null,
      obligation: p.strike * 100 * p.contracts,
    }));

  // Shares owned per ticker back covered calls (§5.3). Sum required contracts per
  // ticker so multiple calls on one name can't each claim the same shares.
  const sharesByTicker = new Map<string, number>();
  for (const e of equities) sharesByTicker.set(e.ticker, (sharesByTicker.get(e.ticker) ?? 0) + e.shares);
  const callContractsByTicker = new Map<string, number>();
  for (const p of pf.positions) {
    if (p.strategy === "covered_call") {
      callContractsByTicker.set(p.ticker, (callContractsByTicker.get(p.ticker) ?? 0) + p.contracts);
    }
  }

  const coveredCalls: RiskCoveredCall[] = pf.positions
    .filter((p) => p.strategy === "covered_call")
    .map((p) => {
      const owned = sharesByTicker.get(p.ticker) ?? 0;
      const required = (callContractsByTicker.get(p.ticker) ?? 0) * 100;
      const isFullyCovered = owned >= required;
      return {
        ticker: p.ticker,
        contracts: p.contracts,
        strike: p.strike,
        expiration: p.expiration,
        sharesOwned: owned,
        sharesRequired: p.contracts * 100,
        isFullyCovered,
        isNaked: !isFullyCovered,
      };
    });

  const openPremium = pf.positions.reduce((s, p) => s + p.premium_collected, 0);

  return {
    profile: profile.risk_profile,
    accountType: profile.account_type,
    nlv: pf.totals.netLiquidationValue,
    cash: pf.totals.cashAvailable,
    marginBuyingPower: pf.totals.buyingPower,
    openPremium,
    equities,
    shortPuts,
    coveredCalls,
  };
}

// ── Full analysis ─────────────────────────────────────────────────────────────
export function analyzePortfolioRisk(pf: PortfolioView, profile: Profile): RiskAnalysis {
  const input = buildRiskInput(pf, profile);
  const bands = bandsFor(input.profile);
  const nlv = input.nlv || 1;

  // §5 core figures.
  const ownedStockValue = input.equities.reduce((s, e) => s + e.marketValue, 0);
  const putObligation = input.shortPuts.reduce((s, p) => s + p.obligation, 0);
  const uncommittedLiquidity = input.cash - putObligation; // pending settlement not modeled
  const potentialStockExposure = ownedStockValue + putObligation;

  // §7 concentration.
  const { tickerConcentration, sectorConcentration, untaggedTickers } = buildConcentration(
    input,
    nlv,
    bands.singleTicker,
    bands.singleSector
  );
  const largestTicker = tickerConcentration[0] ?? null;
  const largestSector = sectorConcentration[0] ?? null;

  // §8 timeline + near-term clustering.
  const timeline = buildTimeline(input.shortPuts, nlv);
  const near7dObligation = input.shortPuts
    .filter((p) => p.dte <= 7)
    .reduce((s, p) => s + p.obligation, 0);
  const deepItmObligation = input.shortPuts
    .filter((p) => p.underlyingPrice < p.strike)
    .reduce((s, p) => s + p.obligation, 0);

  const nakedCalls = input.coveredCalls.filter((c) => c.isNaked);

  const derived: RiskDerived = {
    nlv: input.nlv,
    ownedStockValue,
    putObligation,
    cash: input.cash,
    marginBuyingPower: input.marginBuyingPower,
    uncommittedLiquidity,
    potentialExposure: potentialStockExposure,
    tickerConcentration,
    sectorConcentration,
    largestTicker,
    largestSector,
    near7dObligation,
    deepItmObligation,
    nakedCalls,
  };

  // §12.1 headline metric cards (NLV shown separately as it has no target band).
  const metrics: MetricAssessment[] = [
    metric("ownedStock", "Owned Stock Value", "market_value", ownedStockValue, nlv, bands.ownedStock),
    metric("putObligations", "Short-Put Assignment Obligation", "obligation", putObligation, nlv, bands.putObligations),
    metric("uncommittedLiquidity", "Uncommitted Liquidity", "cash", uncommittedLiquidity, nlv, bands.uncommittedLiquidity),
    metric("potentialExposure", "Potential Stock Exposure", "obligation", potentialStockExposure, nlv, bands.potentialExposure),
    metric(
      "singleTicker",
      largestTicker ? `Largest Ticker — ${largestTicker.ticker}` : "Largest Ticker Exposure",
      "obligation",
      largestTicker ? largestTicker.exposure : 0,
      nlv,
      bands.singleTicker
    ),
    metric(
      "singleSector",
      largestSector ? `Largest Sector — ${largestSector.sector}` : "Largest Sector Exposure",
      "obligation",
      largestSector ? largestSector.exposure : 0,
      nlv,
      bands.singleSector
    ),
    metric("near7d", "Next 7-Day Assignment Exposure", "obligation", near7dObligation, nlv, bands.near7d),
  ];

  const marginLeverageWarning = input.accountType === "margin" && potentialStockExposure / nlv > 1;

  const dataQuality: string[] = [];
  if (untaggedTickers.length) {
    dataQuality.push(
      `${untaggedTickers.length} ticker(s) lack a sector tag (${untaggedTickers.join(", ")}); excluded from sector concentration.`
    );
  }
  if (input.shortPuts.length && input.shortPuts.every((p) => p.delta == null)) {
    dataQuality.push("Option deltas unavailable — probability-weighted assignment estimates are omitted.");
  }

  return {
    profile: input.profile,
    accountType: input.accountType,
    nlv: input.nlv,
    ownedStockValue,
    putAssignmentObligation: putObligation,
    cash: input.cash,
    uncommittedLiquidity,
    potentialStockExposure,
    marginBuyingPower: input.marginBuyingPower,
    metrics,
    tickerConcentration,
    sectorConcentration,
    untaggedTickers,
    timeline,
    stressTests: runStressTests(input, derived),
    recommendations: buildRecommendations(input, derived),
    positionActions: rankPositions(input, derived),
    health: computeHealthScore(input, derived),
    premium: {
      openPremiumAtRisk: input.openPremium,
      premiumYieldPctOfNlv: (input.openPremium / nlv) * 100,
    },
    narrative: buildNarrative(input, derived),
    marginLeverageWarning,
    dataQuality,
  };
}

function metric(
  key: string,
  label: string,
  kind: MetricAssessment["kind"],
  value: number,
  nlv: number,
  band: Band
): MetricAssessment {
  const ratio = value / nlv;
  return {
    key,
    label,
    kind,
    value,
    ratio,
    targetLow: band.targetLow * nlv,
    targetHigh: band.targetHigh * nlv,
    targetLowRatio: band.targetLow,
    targetHighRatio: band.targetHigh,
    direction: band.direction,
    status: classify(ratio, band),
    deltaToTarget: ratioDeltaToTarget(ratio, band) * nlv,
  };
}

function buildConcentration(input: RiskInput, nlv: number, tickerBand: Band, sectorBand: Band) {
  const stockByTicker = new Map<string, number>();
  const putByTicker = new Map<string, number>();
  const sectorOf = new Map<string, string | null>();

  for (const e of input.equities) {
    stockByTicker.set(e.ticker, (stockByTicker.get(e.ticker) ?? 0) + e.marketValue);
    sectorOf.set(e.ticker, e.sector);
  }
  for (const p of input.shortPuts) {
    putByTicker.set(p.ticker, (putByTicker.get(p.ticker) ?? 0) + p.obligation);
    if (!sectorOf.has(p.ticker)) sectorOf.set(p.ticker, p.sector);
  }

  const tickers = new Set<string>([...stockByTicker.keys(), ...putByTicker.keys()]);
  const tickerConcentration: TickerConcentration[] = [...tickers].map((ticker) => {
    const stockValue = stockByTicker.get(ticker) ?? 0;
    const putObligation = putByTicker.get(ticker) ?? 0;
    const exposure = stockValue + putObligation;
    const ratio = exposure / nlv;
    return {
      ticker,
      sector: sectorOf.get(ticker) ?? null,
      stockValue,
      putObligation,
      exposure,
      ratio,
      status: concentrationStatus(ratio, tickerBand),
    };
  });
  tickerConcentration.sort((a, b) => b.exposure - a.exposure);

  // §7.2 — sector aggregation; untagged tickers are excluded and reported.
  const sectorTotals = new Map<string, number>();
  const untaggedTickers: string[] = [];
  for (const t of tickerConcentration) {
    if (!t.sector) {
      if (t.exposure > 0) untaggedTickers.push(t.ticker);
      continue;
    }
    sectorTotals.set(t.sector, (sectorTotals.get(t.sector) ?? 0) + t.exposure);
  }
  const sectorConcentration: SectorConcentration[] = [...sectorTotals.entries()].map(([sector, exposure]) => ({
    sector,
    exposure,
    ratio: exposure / nlv,
    status: concentrationStatus(exposure / nlv, sectorBand),
  }));
  sectorConcentration.sort((a, b) => b.exposure - a.exposure);

  return { tickerConcentration, sectorConcentration, untaggedTickers };
}

// §8 assignment timeline — short-put obligations grouped by days-to-expiration.
function buildTimeline(puts: RiskShortPut[], nlv: number): AssignmentWindow[] {
  const buckets: { label: string; maxDays: number }[] = [
    { label: "0–7 days", maxDays: 7 },
    { label: "8–14 days", maxDays: 14 },
    { label: "15–30 days", maxDays: 30 },
    { label: "31–60 days", maxDays: 60 },
    { label: "61+ days", maxDays: Infinity },
  ];

  return buckets.map((bucket, i) => {
    const lo = i === 0 ? 0 : buckets[i - 1].maxDays;
    const inWindow = puts.filter((p) => p.dte > (i === 0 ? -1 : lo) && p.dte <= bucket.maxDays);
    const obligation = inWindow.reduce((s, p) => s + p.obligation, 0);
    const contracts = inWindow.reduce((s, p) => s + p.contracts, 0);
    const tickers = new Set(inWindow.map((p) => p.ticker)).size;
    const withDelta = inWindow.filter((p) => p.delta != null);
    const estimatedAssignments = withDelta.reduce((s, p) => s + p.contracts * Math.abs(p.delta as number), 0);
    const probabilityWeighted = withDelta.reduce(
      (s, p) => s + p.strike * 100 * p.contracts * Math.abs(p.delta as number),
      0
    );
    return {
      label: bucket.label,
      maxDays: bucket.maxDays,
      obligation,
      ratio: obligation / nlv,
      contracts,
      tickers,
      estimatedAssignments,
      probabilityWeighted,
      hasDelta: withDelta.length > 0,
    };
  });
}
