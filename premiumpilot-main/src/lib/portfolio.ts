import type {
  AccountBalance,
  ConnectedAccount,
  EnrichedPosition,
  PremiumHistoryEntry,
  Position,
  Profile,
  ScoreBreakdown,
} from "./types";
import { enrich, probabilityItm } from "./calc";
import { computeScore } from "./score";
import { generateAlerts, type GeneratedAlert } from "./alerts";
import { ENGINE_CONFIG } from "./config";

export interface PortfolioInput {
  profile: Profile;
  accounts: ConnectedAccount[];
  balances: AccountBalance[];
  positions: Position[];
  premiumHistory: PremiumHistoryEntry[];
}

export interface PortfolioView {
  profile: Profile;
  accounts: ConnectedAccount[];
  balances: AccountBalance[];
  positions: EnrichedPosition[];
  score: ScoreBreakdown;
  alerts: GeneratedAlert[];
  totals: {
    netLiquidationValue: number;
    cashAvailable: number;
    buyingPower: number;
    capitalReserved: number;
    capitalUtilizationPct: number;
    openPositions: number;
    monthlyPremium: number;
    annualizedPremium: number;
    expectedAssignmentExposure: number;
  };
  cash: {
    currentCash: number;
    buyingPower: number;
    capitalReserved: number;
    utilizationPct: number;
    suggestedNewTrades: number;
    unusedCapital: number;
  };
  income: {
    thisMonth: number;
    ytd: number;
    rolling12: number;
    projectedAnnual: number;
    goal: number | null;
    goalProgressPct: number;
  };
}

export function buildPortfolio(input: PortfolioInput, now: Date = new Date()): PortfolioView {
  const { profile, accounts, balances, positions, premiumHistory } = input;
  const enriched = enrich(positions, now);

  const cashAvailable = sum(balances, (b) => b.cash_balance);
  const buyingPower = sum(balances, (b) => b.buying_power);
  const netLiq = sum(balances, (b) => b.net_liquidation_value);
  const capitalReserved = sum(positions, (p) => p.capital_requirement);
  const capitalUtilizationPct =
    capitalReserved + cashAvailable === 0 ? 0 : (capitalReserved / (capitalReserved + cashAvailable)) * 100;

  // Expected assignment exposure: capital at risk weighted by probability ITM.
  const expectedAssignmentExposure = enriched.reduce(
    (s, p) => s + p.capital_requirement * probabilityItm(p),
    0
  );

  const income = buildIncome(premiumHistory, profile.income_goal_annual, now);
  const score = computeScore({ positions: enriched, cashAvailable });
  const alerts = generateAlerts(enriched, { buyingPower, cashAvailable });

  const suggestedNewTrades = Math.floor(buyingPower / ENGINE_CONFIG.cash.typicalCapitalPerTrade);

  return {
    profile,
    accounts,
    balances,
    positions: enriched,
    score,
    alerts,
    totals: {
      netLiquidationValue: netLiq,
      cashAvailable,
      buyingPower,
      capitalReserved,
      capitalUtilizationPct,
      openPositions: positions.length,
      monthlyPremium: income.thisMonth,
      annualizedPremium: income.rolling12,
      expectedAssignmentExposure,
    },
    cash: {
      currentCash: cashAvailable,
      buyingPower,
      capitalReserved,
      utilizationPct: capitalUtilizationPct,
      suggestedNewTrades,
      unusedCapital: buyingPower,
    },
    income,
  };
}

function buildIncome(history: PremiumHistoryEntry[], goal: number | null, now: Date) {
  const startOfMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 1);
  const yearAgo = now.getTime() - 365 * 24 * 60 * 60 * 1000;

  let thisMonth = 0;
  let ytd = 0;
  let rolling12 = 0;
  for (const e of history) {
    const t = new Date(e.realized_at).getTime();
    if (t >= startOfMonth) thisMonth += e.premium_amount;
    if (t >= startOfYear) ytd += e.premium_amount;
    if (t >= yearAgo) rolling12 += e.premium_amount;
  }
  // Projected annual income = trailing-12-month run rate (PRD §9.5 default).
  const projectedAnnual = rolling12;
  const goalProgressPct = goal && goal > 0 ? (ytd / goal) * 100 : 0;
  return { thisMonth, ytd, rolling12, projectedAnnual, goal, goalProgressPct };
}

function sum<T>(items: T[], pick: (t: T) => number): number {
  return items.reduce((s, i) => s + pick(i), 0);
}
