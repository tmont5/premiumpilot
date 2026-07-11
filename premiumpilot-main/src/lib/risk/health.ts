import type { RiskInput, RiskDerived, HealthScore, HealthCategory } from "./types";

// Portfolio health score (PRD §11). One 0–100 number that MUST NOT rise because
// premium is profitable (§11.3, §16.5). It heavily penalizes negative
// uncommitted liquidity, potential exposure over NLV, near-term assignment
// clustering, single-stock and sector concentration, uncovered calls, margin
// dependence, and deep-ITM short puts. Category weights are fixed by §11.1.
const WEIGHTS = {
  liquidity: 0.3,
  potentialExposure: 0.25,
  tickerConcentration: 0.15,
  sectorConcentration: 0.1,
  clustering: 0.1,
  moneyness: 0.1,
} as const;

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));

export function computeHealthScore(input: RiskInput, d: RiskDerived): HealthScore {
  const nlv = d.nlv || 1;
  const liquidityRatio = d.uncommittedLiquidity / nlv;
  const exposureRatio = d.potentialExposure / nlv;
  const tickerRatio = d.largestTicker ? d.largestTicker.ratio : 0;
  const sectorRatio = d.largestSector ? d.largestSector.ratio : 0;
  const near7dRatio = d.near7dObligation / nlv;
  const deepItmRatio = d.deepItmObligation / nlv;

  // Liquidity coverage: full marks at/above a 20% reserve, 0 once liquidity is
  // meaningfully negative. Negative liquidity is the single worst signal.
  const liquidity = clamp(((liquidityRatio + 0.2) / 0.4) * 100);

  // Potential exposure: full marks at/under 80% of NLV, 0 by ~160% (deeply
  // over-committed if every put were assigned).
  const potentialExposure = clamp(100 - ((exposureRatio - 0.8) / 0.8) * 100);

  // Single-ticker concentration: full at 0%, 0 by ~25% of NLV in one name.
  const tickerConcentration = clamp(100 - (tickerRatio / 0.25) * 100);

  // Single-sector concentration: full at 0%, 0 by ~50% of NLV in one sector.
  const sectorConcentration = clamp(100 - (sectorRatio / 0.5) * 100);

  // Expiration clustering: full when little expires this week, 0 by ~30% of NLV
  // of obligations due within 7 days.
  const clustering = clamp(100 - (near7dRatio / 0.3) * 100);

  // Option moneyness + coverage: penalize deep-ITM short puts and uncovered
  // calls (each naked call is a distinct, higher-risk exposure).
  const nakedPenalty = d.nakedCalls.length * 25;
  const moneyness = clamp(100 - (deepItmRatio / 0.4) * 100 - nakedPenalty);

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
      key: "potentialExposure",
      label: "Potential assignment exposure",
      weight: WEIGHTS.potentialExposure,
      score: Math.round(potentialExposure),
      note: `${Math.round(exposureRatio * 100)}% of NLV if every put were assigned.`,
    },
    {
      key: "tickerConcentration",
      label: "Ticker concentration",
      weight: WEIGHTS.tickerConcentration,
      score: Math.round(tickerConcentration),
      note: d.largestTicker
        ? `Largest name ${d.largestTicker.ticker} at ${Math.round(tickerRatio * 100)}% of NLV.`
        : "No single-name concentration.",
    },
    {
      key: "sectorConcentration",
      label: "Sector concentration",
      weight: WEIGHTS.sectorConcentration,
      score: Math.round(sectorConcentration),
      note: d.largestSector
        ? `Largest sector ${d.largestSector.sector} at ${Math.round(sectorRatio * 100)}% of NLV.`
        : "Sector data unavailable.",
    },
    {
      key: "clustering",
      label: "Expiration clustering",
      weight: WEIGHTS.clustering,
      score: Math.round(clustering),
      note: `${Math.round(near7dRatio * 100)}% of NLV in obligations expiring within 7 days.`,
    },
    {
      key: "moneyness",
      label: "Option moneyness / assignment",
      weight: WEIGHTS.moneyness,
      score: Math.round(moneyness),
      note: d.nakedCalls.length
        ? `${d.nakedCalls.length} uncovered call position(s) flagged.`
        : `${Math.round(deepItmRatio * 100)}% of NLV in in-the-money short puts.`,
    },
  ];

  // Margin dependence: an extra haircut when a cash/IRA account would be forced
  // to borrow (exposure over cash) or a margin account runs above 100% of NLV.
  let total = categories.reduce((s, c) => s + c.score * c.weight, 0);
  const marginDependent =
    (input.accountType !== "margin" && d.uncommittedLiquidity < 0) ||
    (input.accountType === "margin" && exposureRatio > 1);
  if (marginDependent) total *= 0.85;

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
