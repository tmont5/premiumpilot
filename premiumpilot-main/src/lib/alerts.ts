import type { AlertType, EnrichedPosition } from "./types";
import { ENGINE_CONFIG } from "./config";
import { itmFraction } from "./status";
import { fmtPct, fmtPctFromFraction } from "./format";

export interface GeneratedAlert {
  type: AlertType;
  position_id: string | null;
  ticker: string | null;
  message: string;
  recommendation: string;
}

const strategyLabel = (s: EnrichedPosition["strategy"]) =>
  s === "cash_secured_put" ? "Put" : "Call";

// Alerts engine (PRD §10). Pure function over the enriched book + cash context.
export function generateAlerts(
  positions: EnrichedPosition[],
  ctx: { buyingPower: number; cashAvailable: number }
): GeneratedAlert[] {
  const alerts: GeneratedAlert[] = [];
  const { roll, status, cash } = ENGINE_CONFIG;

  for (const p of positions) {
    const m = p.metrics;
    const name = `${p.ticker} ${strategyLabel(p.strategy)}`;

    // Assignment risk: underlying within the band of, or past, the strike.
    if (m.status === "risk" || m.status === "high_risk") {
      const within = Math.abs(m.distanceFromStrikePct);
      alerts.push({
        type: "assignment_risk",
        position_id: p.id,
        ticker: p.ticker,
        message:
          itmFraction(p) > 0
            ? `${name} — Underlying past strike (${fmtPct(within * 100, 1)} ITM)`
            : `${name} — Stock within ${fmtPct(within * 100, 1)} of strike`,
        recommendation: itmFraction(p) > 0 ? "Roll or Close — assignment likely" : "Monitor",
      });
      continue; // risk supersedes profit-based alerts for the same position
    }

    // Close: meets Close Candidate criteria.
    if (m.status === "close_candidate") {
      alerts.push({
        type: "close",
        position_id: p.id,
        ticker: p.ticker,
        message: `${name} — Profit Capture: ${fmtPct(m.profitCapturePct, 0)}`,
        recommendation: "Close Position",
      });
      continue;
    }

    // Roll: near expiration but capture too low to simply close.
    if (m.dte <= roll.maxDte && m.profitCapturePct < roll.maxCapturePct) {
      alerts.push({
        type: "roll",
        position_id: p.id,
        ticker: p.ticker,
        message: `${name} — ${m.dte} DTE, ${fmtPct(m.profitCapturePct, 0)} captured`,
        recommendation: "Roll to a later expiration",
      });
    }
  }

  // Cash deployment: meaningful unused capital available.
  const unused = ctx.buyingPower;
  if (
    unused >= cash.minUnusedAbsolute &&
    (ctx.cashAvailable === 0 || unused / Math.max(ctx.cashAvailable, 1) >= cash.minUnusedFraction)
  ) {
    const suggestedTrades = Math.floor(unused / cash.typicalCapitalPerTrade);
    if (suggestedTrades >= 1) {
      alerts.push({
        type: "cash_deployment",
        position_id: null,
        ticker: null,
        message: `Unused buying power: ${fmtPctFromFraction(unused / Math.max(ctx.cashAvailable, unused))} idle`,
        recommendation: `Deploy capital — room for ~${suggestedTrades} new position${suggestedTrades > 1 ? "s" : ""}`,
      });
    }
  }

  // Priority ordering for display: risk first, then close, roll, cash.
  const order: Record<AlertType, number> = { assignment_risk: 0, close: 1, roll: 2, cash_deployment: 3 };
  return alerts.sort((a, b) => order[a.type] - order[b.type]);
}
