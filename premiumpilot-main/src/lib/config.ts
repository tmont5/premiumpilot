// Tunable constants. Every "Open Decision" in PRD §14 is isolated here so the
// product team can adjust behavior without touching engine logic.

export const ENGINE_CONFIG = {
  // --- Position status thresholds (PRD §7) ---
  status: {
    // "Close Candidate": profit capture above this AND DTE above closeMinDte.
    closeCapturePct: 75,
    closeMinDte: 14,
    // "Monitor": profit capture in [monitorLowPct, closeCapturePct].
    monitorLowPct: 40,
    // "Risk": underlying within this percent band of the strike.
    riskBandPct: 5,
  },

  // --- Roll alert heuristic (PRD §10 / §14.2; not numerically specified) ---
  // Default: near expiration but capture too low to simply close.
  roll: {
    maxDte: 7,
    maxCapturePct: 75,
  },

  // --- Cash deployment alert (PRD §10) ---
  cash: {
    // Fire a deployment alert when unused capital exceeds this fraction of buying power.
    minUnusedFraction: 0.1,
    // ...and at least this many dollars, to avoid noise on small accounts.
    minUnusedAbsolute: 2000,
    // "Suggested New Trades" heuristic (PRD §9.4 / §14.3): assumed capital per trade.
    typicalCapitalPerTrade: 10000,
    // Capital utilization target band used by the Capital Efficiency score (PRD §8).
    targetUtilizationLow: 0.5,
    targetUtilizationHigh: 0.8,
  },

  // --- Portfolio score weights (PRD §8) ---
  scoreWeights: {
    profitability: 0.3,
    capitalEfficiency: 0.25,
    diversification: 0.15,
    timeRisk: 0.15,
    assignmentRisk: 0.15,
  },

  // Time-risk score: positions with DTE below this are considered "near-dated"
  // and contribute to time-concentration risk (PRD §8 Time Risk).
  timeRisk: {
    nearDteThreshold: 7,
  },

  // Color bands for the portfolio score (PRD §8).
  scoreBands: {
    greenMin: 80,
    yellowMin: 60,
  },
} as const;

export type ScoreBand = "green" | "yellow" | "red";

export function scoreBand(score: number): ScoreBand {
  if (score >= ENGINE_CONFIG.scoreBands.greenMin) return "green";
  if (score >= ENGINE_CONFIG.scoreBands.yellowMin) return "yellow";
  return "red";
}
