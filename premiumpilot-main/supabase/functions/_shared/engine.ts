// Server-side calculation + status + alert engine for Edge Functions (PRD §6/§7/§10).
// Source of truth for the formulas is the app's src/lib/{calc,status,score,alerts}.ts.
// Kept in sync manually; thresholds mirror src/lib/config.ts.

export const CFG = {
  closeCapturePct: 75,
  closeMinDte: 14,
  monitorLowPct: 40,
  riskBandPct: 5,
  rollMaxDte: 7,
  rollMaxCapturePct: 75,
  cashMinUnusedAbsolute: 2000,
  typicalCapitalPerTrade: 10000,
};

export type Strategy = "cash_secured_put" | "covered_call";
export type Status = "high_risk" | "risk" | "close_candidate" | "monitor" | "hold";

export interface Pos {
  id?: string;
  ticker: string;
  strategy: Strategy;
  strike: number;
  expiration: string;
  premium_collected: number;
  current_option_value: number;
  current_underlying_price: number;
  delta: number;
  capital_requirement: number;
}

export function dte(expiration: string, now = new Date()): number {
  const exp = new Date(expiration + "T00:00:00Z").getTime();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.round((exp - today) / 86400000));
}

export const profitCapturePct = (p: Pos) =>
  p.premium_collected === 0 ? 0 : ((p.premium_collected - p.current_option_value) / p.premium_collected) * 100;

export const itmFraction = (p: Pos) => {
  if (p.current_underlying_price === 0) return 0;
  const d = (p.current_underlying_price - p.strike) / p.current_underlying_price;
  return p.strategy === "covered_call" ? d : -d;
};

export function resolveStatus(p: Pos, now = new Date()): Status {
  const itm = itmFraction(p);
  const band = CFG.riskBandPct / 100;
  const capture = profitCapturePct(p);
  const d = dte(p.expiration, now);
  if (itm > 0) return "high_risk";
  if (itm >= -band) return "risk";
  if (capture > CFG.closeCapturePct && d > CFG.closeMinDte) return "close_candidate";
  if (capture >= CFG.monitorLowPct) return "monitor";
  return "hold";
}

export interface AlertRow {
  position_id: string | null;
  type: "close" | "roll" | "assignment_risk" | "cash_deployment";
  message: string;
  recommendation: string;
}

export function alertsForPositions(positions: Pos[], now = new Date()): AlertRow[] {
  const out: AlertRow[] = [];
  for (const p of positions) {
    const status = resolveStatus(p, now);
    const capture = profitCapturePct(p);
    const d = dte(p.expiration, now);
    const name = `${p.ticker} ${p.strategy === "cash_secured_put" ? "Put" : "Call"}`;
    if (status === "risk" || status === "high_risk") {
      out.push({
        position_id: p.id ?? null,
        type: "assignment_risk",
        message: itmFraction(p) > 0 ? `${name} — Underlying past strike` : `${name} — Stock near strike`,
        recommendation: itmFraction(p) > 0 ? "Roll or Close — assignment likely" : "Monitor",
      });
    } else if (status === "close_candidate") {
      out.push({
        position_id: p.id ?? null,
        type: "close",
        message: `${name} — Profit Capture: ${capture.toFixed(0)}%`,
        recommendation: "Close Position",
      });
    } else if (d <= CFG.rollMaxDte && capture < CFG.rollMaxCapturePct) {
      out.push({
        position_id: p.id ?? null,
        type: "roll",
        message: `${name} — ${d} DTE, ${capture.toFixed(0)}% captured`,
        recommendation: "Roll to a later expiration",
      });
    }
  }
  return out;
}

export function cashDeploymentAlert(buyingPower: number): AlertRow | null {
  if (buyingPower < CFG.cashMinUnusedAbsolute) return null;
  const trades = Math.floor(buyingPower / CFG.typicalCapitalPerTrade);
  if (trades < 1) return null;
  return {
    position_id: null,
    type: "cash_deployment",
    message: `Unused buying power available`,
    recommendation: `Deploy capital — room for ~${trades} new position${trades > 1 ? "s" : ""}`,
  };
}
