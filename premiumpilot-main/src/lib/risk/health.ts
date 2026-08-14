import { bandsFor, classify, type Band } from "./bands";
import type { RiskInput, RiskDerived, HealthScore, HealthCategory, RiskStatus } from "./types";

// Risk Manager health score (0–100). This answers ONE question: how close is this
// account to losing money — a drawdown it can't absorb, a forced sale, or a
// margin call? It is deliberately dominated by SOLVENCY (liquidity, leverage,
// adverse assignment). Concentration is a real risk but not proximity-to-loss,
// so it only nudges the score. A profitable, fully-covered, unleveraged, liquid
// book scores in the 90s even if concentrated; premium income never raises it.
//
// Each solvency/exposure category is scored off the SAME profile target bands the
// metric cards use, so the score and the cards always agree.
const WEIGHTS = {
  liquidity: 0.3,
  leverage: 0.25,
  moneyness: 0.2,
  clustering: 0.1,
  tickerConcentration: 0.1,
  sectorConcentration: 0.05,
} as const;

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));

// Map a banded status to a sub-score. "Within target" is near-perfect; the score
// only falls off as a metric leaves its band. Concentration criticals are capped
// at 35 (not 0) so a single risky dimension can't crater an otherwise-safe book.
function statusScore(status: RiskStatus): number {
  switch (status) {
    case "healthy":
      return 100;
    case "watch":
      return 82;
    case "elevated":
      return 60;
    default:
      return 35; // critical / leverage
  }
}

function bandScore(ratio: number, band: Band): number {
  return statusScore(classify(ratio, band));
}

export function computeHealthScore(input: RiskInput, d: RiskDerived): HealthScore {
  const bands = bandsFor(input.profile);
  const nlv = d.nlv || 1;
  const liquidityRatio = d.uncommittedLiquidity / nlv;
  const exposureRatio = d.potentialExposure / nlv;
  const tickerRatio = d.largestTicker ? d.largestTicker.ratio : 0;
  const sectorRatio = d.largestSector ? d.largestSector.ratio : 0;
  const near7dRatio = d.near7dObligation / nlv;
  const deepItmRatio = d.deepItmObligation / nlv;

  const liquidity = bandScore(liquidityRatio, bands.uncommittedLiquidity);
  const leverage = bandScore(exposureRatio, bands.potentialExposure);
  const clustering = bandScore(near7dRatio, bands.near7d);
  const tickerConc = d.largestTicker ? bandScore(tickerRatio, bands.singleTicker) : 100;
  const sectorConc = d.largestSector ? bandScore(sectorRatio, bands.singleSector) : 100;

  // Moneyness / coverage: adverse assignment. Deep-ITM short puts (forced to buy
  // a falling stock) and uncovered calls (unbounded risk) pull this down.
  const moneyness = clamp(100 - (deepItmRatio / 0.4) * 100 - d.nakedCalls.length * 25);

  const categories: HealthCategory[] = [
    {
      key: "liquidity",
      label: "Liquidity coverage",
      weight: WEIGHTS.liquidity,
      score: Math.round(liquidity),
      note:
        d.uncommittedLiquidity < 0
          ? "Uncommitted liquidity is negative — obligations exceed cash."
          : "Cash covers open put obligations.",
    },
    {
      key: "leverage",
      label: "Leverage / potential exposure",
      weight: WEIGHTS.leverage,
      score: Math.round(leverage),
      note:
        exposureRatio > 1
          ? `${Math.round(exposureRatio * 100)}% of NLV if every put were assigned — above account value.`
          : `${Math.round(exposureRatio * 100)}% of NLV if every put were assigned — within account value.`,
    },
    {
      key: "moneyness",
      label: "Adverse assignment / coverage",
      weight: WEIGHTS.moneyness,
      score: Math.round(moneyness),
      note: d.nakedCalls.length
        ? `${d.nakedCalls.length} uncovered call position(s) flagged.`
        : `${Math.round(deepItmRatio * 100)}% of NLV in in-the-money short puts.`,
    },
    {
      key: "clustering",
      label: "Expiration clustering",
      weight: WEIGHTS.clustering,
      score: Math.round(clustering),
      note: `${Math.round(near7dRatio * 100)}% of NLV in obligations expiring within 7 days.`,
    },
    {
      key: "tickerConcentration",
      label: "Ticker concentration",
      weight: WEIGHTS.tickerConcentration,
      score: Math.round(tickerConc),
      note: d.largestTicker
        ? `Largest name ${d.largestTicker.ticker} at ${Math.round(tickerRatio * 100)}% of NLV.`
        : "No single-name concentration.",
    },
    {
      key: "sectorConcentration",
      label: "Sector concentration",
      weight: WEIGHTS.sectorConcentration,
      score: Math.round(sectorConc),
      note: d.largestSector
        ? `Largest sector ${d.largestSector.sector} at ${Math.round(sectorRatio * 100)}% of NLV.`
        : "Sector data unavailable.",
    },
  ];

  let total = categories.reduce((s, c) => s + c.score * c.weight, 0);

  // Solvency haircuts — the situations that actually threaten capital. Negative
  // uncommitted liquidity means full assignment forces borrowing or selling;
  // running a margin account above 100% of NLV is genuine leverage. These push a
  // truly at-risk book well below the concentration floor.
  if (d.uncommittedLiquidity < 0) total *= 0.6;
  if (input.accountType === "margin" && exposureRatio > 1) total *= 0.8;

  const rounded = Math.round(clamp(total));
  return { total: rounded, label: labelFor(rounded), categories };
}

function labelFor(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Healthy";
  if (score >= 70) return "Moderate risk";
  if (score >= 60) return "Aggressive";
  return "Critical";
}
