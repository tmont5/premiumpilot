import type { EnrichedPosition, ScoreBreakdown } from "./types";
import { ENGINE_CONFIG } from "./config";

const W = ENGINE_CONFIG.scoreWeights;

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));

export interface ScoreInputs {
  positions: EnrichedPosition[];
  cashAvailable: number; // total cash across accounts
}

// Portfolio Score (PRD §8). Each component is a normalized 0..100 sub-score,
// then the §8 weights are applied. Sub-formulas are the documented defaults
// from the PRD note (§8) and are intentionally simple so they can be tuned.
export function computeScore({ positions, cashAvailable }: ScoreInputs): ScoreBreakdown {
  if (positions.length === 0) {
    // Empty book: nothing at risk, but capital is idle.
    const empty = { profitability: 100, diversification: 100, timeRisk: 100, assignmentRisk: 100 };
    const capitalEfficiency = capitalEfficiencyScore(0);
    const total = weightedTotal({ ...empty, capitalEfficiency });
    return { total, ...empty, capitalEfficiency };
  }

  const totalCapital = positions.reduce((s, p) => s + p.capital_requirement, 0) || 1;

  // Profitability: average profit-capture across positions (clamped to 0..100).
  const profitability = clamp(
    positions.reduce((s, p) => s + p.metrics.profitCapturePct, 0) / positions.length
  );

  // Capital Efficiency: utilization vs. the target band (PRD §9.4 band).
  const utilization = totalCapital / (totalCapital + cashAvailable);
  const capitalEfficiency = capitalEfficiencyScore(utilization);

  // Diversification: inverse Herfindahl concentration across tickers (by capital).
  const byTicker = new Map<string, number>();
  for (const p of positions) {
    byTicker.set(p.ticker, (byTicker.get(p.ticker) ?? 0) + p.capital_requirement);
  }
  const hhi = [...byTicker.values()].reduce((s, c) => s + (c / totalCapital) ** 2, 0);
  const n = byTicker.size;
  // Normalize: even split => HHI = 1/n => score 100; all in one name => HHI = 1 => score 0.
  const diversification = n <= 1 ? 0 : clamp(((1 - hhi) / (1 - 1 / n)) * 100);

  // Time Risk: penalty for capital concentrated in near-dated positions.
  const nearCapital = positions
    .filter((p) => p.metrics.dte < ENGINE_CONFIG.timeRisk.nearDteThreshold)
    .reduce((s, p) => s + p.capital_requirement, 0);
  const timeRisk = clamp((1 - nearCapital / totalCapital) * 100);

  // Assignment Risk: capital-weighted average delta exposure, inverse-scaled.
  const weightedAssignment =
    positions.reduce((s, p) => s + p.metrics.assignmentRisk * p.capital_requirement, 0) / totalCapital;
  const assignmentRisk = clamp((1 - weightedAssignment) * 100);

  const total = weightedTotal({ profitability, capitalEfficiency, diversification, timeRisk, assignmentRisk });
  return { total, profitability, capitalEfficiency, diversification, timeRisk, assignmentRisk };
}

// 100 inside the target band; linear falloff toward 0 at 0% and 100% utilization.
function capitalEfficiencyScore(utilization: number): number {
  const { targetUtilizationLow: lo, targetUtilizationHigh: hi } = ENGINE_CONFIG.cash;
  if (utilization >= lo && utilization <= hi) return 100;
  if (utilization < lo) return clamp((utilization / lo) * 100);
  return clamp(((1 - utilization) / (1 - hi)) * 100);
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
