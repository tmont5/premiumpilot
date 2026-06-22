import type { Position, PositionMetrics } from "./types";
import { resolveStatus } from "./status";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Days To Expiration (PRD §6): expiration - today, floored to whole days, never < 0.
export function daysToExpiration(expiration: string, now: Date = new Date()): number {
  const exp = new Date(expiration + "T00:00:00Z").getTime();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.round((exp - today) / MS_PER_DAY));
}

// Current profit if the position were closed now: premium kept minus cost to buy back.
export function currentProfit(p: Position): number {
  return p.premium_collected - p.current_option_value;
}

// Profit Capture % (PRD §6): ((premium - current value) / premium) * 100
export function profitCapturePct(p: Position): number {
  if (p.premium_collected === 0) return 0;
  return ((p.premium_collected - p.current_option_value) / p.premium_collected) * 100;
}

// Return On Capital (PRD §6): current_profit / capital_required
export function returnOnCapital(p: Position): number {
  if (p.capital_requirement === 0) return 0;
  return currentProfit(p) / p.capital_requirement;
}

// Annualized Return (PRD §6): (current_profit / capital_required) * (365 / DTE)
// DTE is floored to 1 to avoid divide-by-zero at/after expiration.
export function annualizedReturn(p: Position, now: Date = new Date()): number {
  const dte = Math.max(1, daysToExpiration(p.expiration, now));
  return returnOnCapital(p) * (365 / dte);
}

// Distance From Strike % (PRD §6): (underlying - strike) / underlying
// Positive => underlying above strike. Sign is meaningful per strategy.
export function distanceFromStrikePct(p: Position): number {
  if (p.current_underlying_price === 0) return 0;
  return (p.current_underlying_price - p.strike) / p.current_underlying_price;
}

// Probability ITM (PRD §6 / §14.5): delta-as-proxy. Uses |delta| clamped to [0,1].
export function probabilityItm(p: Position): number {
  return Math.min(1, Math.max(0, Math.abs(p.delta)));
}

// Assignment Risk (PRD §6): derived from delta. We use |delta| as a 0..1 risk proxy.
export function assignmentRisk(p: Position): number {
  return probabilityItm(p);
}

export function computeMetrics(p: Position, now: Date = new Date()): PositionMetrics {
  const dte = daysToExpiration(p.expiration, now);
  const capture = profitCapturePct(p);
  const distance = distanceFromStrikePct(p);
  return {
    dte,
    currentProfit: currentProfit(p),
    profitCapturePct: capture,
    returnOnCapital: returnOnCapital(p),
    annualizedReturn: annualizedReturn(p, now),
    distanceFromStrikePct: distance,
    probabilityItm: probabilityItm(p),
    assignmentRisk: assignmentRisk(p),
    status: resolveStatus({ p, dte, capture, distance }),
  };
}

export function enrich<T extends Position>(positions: T[], now: Date = new Date()) {
  return positions.map((p) => ({ ...p, metrics: computeMetrics(p, now) }));
}
