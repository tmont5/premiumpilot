import type { Position, PositionStatus } from "./types";
import { ENGINE_CONFIG } from "./config";

const C = ENGINE_CONFIG.status;

// "Into-the-money" fraction toward the assignment side, as a fraction of the
// underlying price. Positive => underlying has crossed the strike on the
// dangerous side (assignment likely).
//
// PRD §7 frames the risk table for cash-secured puts ("underlying below
// strike"). We generalize so covered calls are evaluated symmetrically:
//   - CSP  (short put):  danger is underlying FALLING to/under the strike.
//   - CC   (short call): danger is underlying RISING to/over the strike.
export function itmFraction(p: Position): number {
  if (p.current_underlying_price === 0) return 0;
  const distance = (p.current_underlying_price - p.strike) / p.current_underlying_price;
  return p.strategy === "covered_call" ? distance : -distance;
}

// Apply the PRD §7 rules in priority order: risk rules win over profit rules.
export function resolveStatus(args: {
  p: Position;
  dte: number;
  capture: number;
  distance: number; // signed distance-from-strike %, kept for callers; unused here
}): PositionStatus {
  const { p, dte, capture } = args;
  const itm = itmFraction(p);
  const band = C.riskBandPct / 100;

  // 1. High Risk — underlying past the strike on the danger side.
  if (itm > 0) return "high_risk";
  // 2. Risk — underlying within the risk band of the strike (approaching it).
  if (itm >= -band) return "risk";
  // 3. Close Candidate — strong profit capture with comfortable time left.
  if (capture > C.closeCapturePct && dte > C.closeMinDte) return "close_candidate";
  // 4. Monitor — moderate profit capture.
  if (capture >= C.monitorLowPct) return "monitor";
  // 5. Hold — low profit capture, nothing actionable yet.
  return "hold";
}

export const STATUS_LABEL: Record<PositionStatus, string> = {
  high_risk: "High Risk",
  risk: "Risk",
  close_candidate: "Close Candidate",
  monitor: "Monitor",
  hold: "Hold",
};

// Color mapping per PRD §7: Green = Close Candidate, Yellow = Monitor, Red = Risk/High Risk.
export type StatusTone = "success" | "warning" | "danger" | "secondary";
export const STATUS_TONE: Record<PositionStatus, StatusTone> = {
  close_candidate: "success",
  monitor: "warning",
  risk: "danger",
  high_risk: "danger",
  hold: "secondary",
};
