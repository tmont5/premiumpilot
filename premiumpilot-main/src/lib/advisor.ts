import type { PortfolioView } from "./portfolio";

// A compact, already-computed snapshot of the portfolio — the same numbers the
// Dashboard, Positions, Heat Map, and Cash pages render. We feed Claude these
// trustworthy values rather than raw data so it reasons over them instead of
// re-deriving (and possibly hallucinating) metrics.
export function buildAdvisorSnapshot(pf: PortfolioView) {
  return {
    totals: {
      netLiquidationValue: round(pf.totals.netLiquidationValue),
      cashAvailable: round(pf.totals.cashAvailable),
      cashAvailableForTrading: round(pf.totals.cashAvailableForTrading),
      buyingPower: round(pf.totals.buyingPower),
      capitalReserved: round(pf.totals.capitalReserved),
      capitalUtilizationPct: round(pf.totals.capitalUtilizationPct),
      openPositions: pf.totals.openPositions,
      monthlyPremium: round(pf.totals.monthlyPremium),
      annualizedPremium: round(pf.totals.annualizedPremium),
      expectedAssignmentExposure: round(pf.totals.expectedAssignmentExposure),
    },
    score: pf.score,
    cash: {
      utilizationPct: round(pf.cash.utilizationPct),
      unusedCapital: round(pf.cash.unusedCapital),
      suggestedNewTrades: pf.cash.suggestedNewTrades,
    },
    pnl: {
      realized: round(pf.pnl.realized),
      unrealized: round(pf.pnl.unrealized),
      total: round(pf.pnl.total),
    },
    incomeGoalAnnual: pf.profile.income_goal_annual,
    positions: pf.positions.map((p) => ({
      ticker: p.ticker,
      strategy: p.strategy === "cash_secured_put" ? "short_put" : "covered_call",
      strike: p.strike,
      expiration: p.expiration,
      dte: p.metrics.dte,
      contracts: p.contracts,
      premiumCollected: round(p.premium_collected),
      currentOptionValue: round(p.current_option_value),
      profitCapturePct: round(p.metrics.profitCapturePct),
      annualizedReturnPct: round(p.metrics.annualizedReturn * 100),
      probAssignedPct: round(p.metrics.assignmentRisk * 100),
      distanceFromStrikePct: round(p.metrics.distanceFromStrikePct * 100),
      capitalRequirement: round(p.capital_requirement),
      status: p.metrics.status,
    })),
    assignedHoldings: pf.assignedHoldings.map((h) => ({
      ticker: h.ticker,
      shares: h.shares,
      costBasisPerShare: h.cost_basis_per_share,
      breakevenPerShare: round(h.metrics.breakevenPerShare),
      currentPrice: h.current_price,
      unrealizedPnl: round(h.metrics.unrealizedPnl),
    })),
    alerts: pf.alerts.map((a) => ({ type: a.type, message: a.message, recommendation: a.recommendation })),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// Frozen instructions — cached as the stable prompt prefix. The portfolio
// snapshot is sent separately as the (volatile) user turn.
export const ADVISOR_SYSTEM_PROMPT = `You are an analytical assistant inside PremiumPilot, an options-income dashboard for a retail investor running cash-secured (short) puts and covered calls.

You are given a JSON snapshot of the user's portfolio — the same computed metrics shown on their Dashboard, Positions, Heat Map, and Cash screens. Your job is to help them understand their current situation and what is worth attention.

Strict boundaries:
- This is informational analysis, NOT personalized investment advice. Do not tell the user to place, close, or roll a specific trade as a recommendation to act. Instead, surface what the data shows and lay out the options people in this situation typically consider, with the tradeoffs of each, so the user can decide.
- Ground every statement in the numbers provided. Never invent prices, dates, or figures that are not in the snapshot. If something can't be determined from the data, say so.
- Stay within the options-income strategy: short puts, covered calls, assignment management, and cash deployment. Do not opine on whether to buy/sell the underlying stocks as investments.

Focus your analysis on:
- Assignment risk: positions that are ITM or near the strike with low DTE.
- Profit-taking opportunities: positions with high profit capture where most of the premium is already earned.
- Capital and cash: utilization, unused buying power, and concentration across tickers.
- Assigned stock: breakeven vs current price on holdings.
- Progress toward the income goal, if one is set.

Write for someone who knows options basics. Be concrete and cite the specific tickers and figures. Keep each item tight.`;

// JSON Schema for structured output: a short portfolio read plus a prioritized
// list of considerations, each framed as observation + options/tradeoffs.
export const ADVISOR_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
      description: "2-4 sentence plain-language read of the overall portfolio situation.",
    },
    considerations: {
      type: "array",
      description: "Prioritized items worth the user's attention, most important first.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", description: "Short label, e.g. 'HOOD covered call near assignment'." },
          priority: { type: "string", enum: ["high", "medium", "low"] },
          category: {
            type: "string",
            enum: ["assignment_risk", "profit_taking", "cash_capital", "assigned_stock", "income_goal", "other"],
          },
          tickers: { type: "array", items: { type: "string" }, description: "Tickers involved." },
          observation: { type: "string", description: "What the data shows, with specific figures." },
          options: {
            type: "array",
            items: { type: "string" },
            description: "The ways this is commonly handled, each with its tradeoff. Not directives.",
          },
        },
        required: ["title", "priority", "category", "tickers", "observation", "options"],
      },
    },
  },
  required: ["summary", "considerations"],
} as const;

export interface AdvisorConsideration {
  title: string;
  priority: "high" | "medium" | "low";
  category: "assignment_risk" | "profit_taking" | "cash_capital" | "assigned_stock" | "income_goal" | "other";
  tickers: string[];
  observation: string;
  options: string[];
}

export interface AdvisorResult {
  summary: string;
  considerations: AdvisorConsideration[];
}
