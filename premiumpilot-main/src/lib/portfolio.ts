import type {
  AccountBalance,
  AccountTransaction,
  AssignedHolding,
  ConnectedAccount,
  EnrichedAssignedHolding,
  EnrichedPosition,
  PnlSummary,
  PremiumHistoryEntry,
  Position,
  Profile,
  ScoreBreakdown,
  Trade,
} from "./types";
import { enrich, probabilityItm } from "./calc";
import { computeScore } from "./score";
import { generateAlerts, type GeneratedAlert } from "./alerts";
import { enrichAssignedHoldings, buildPnl } from "./pnl";
import { ENGINE_CONFIG } from "./config";

export interface PortfolioInput {
  profile: Profile;
  accounts: ConnectedAccount[];
  balances: AccountBalance[];
  positions: Position[];
  premiumHistory: PremiumHistoryEntry[];
  transactions: AccountTransaction[];
  trades: Trade[];
  assignedHoldings: AssignedHolding[];
}

export interface PortfolioView {
  profile: Profile;
  accounts: ConnectedAccount[];
  balances: AccountBalance[];
  positions: EnrichedPosition[];
  premiumHistory: PremiumHistoryEntry[];
  incomeHistory: PremiumHistoryEntry[];
  transactions: AccountTransaction[];
  trades: Trade[];
  assignedHoldings: EnrichedAssignedHolding[];
  pnl: PnlSummary;
  score: ScoreBreakdown;
  alerts: GeneratedAlert[];
  totals: {
    netLiquidationValue: number;
    cashAvailable: number;
    cashAvailableForTrading: number;
    availableFunds: number;
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
    cashAvailableForTrading: number;
    availableFunds: number;
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
    realizedPnlYtd: number;
    goal: number | null;
    goalProgressPct: number;
  };
}

export function buildPortfolio(input: PortfolioInput, now: Date = new Date()): PortfolioView {
  const { profile, accounts, balances, positions, premiumHistory, transactions, trades, assignedHoldings } =
    input;
  const enriched = enrich(positions, now);
  const holdings = enrichAssignedHoldings(assignedHoldings);
  const pnl = buildPnl(trades, holdings, enriched, now);

  const cashAvailable = sum(balances, (b) => b.cash_balance);
  const cashAvailableForTrading = sum(balances, (b) => b.cash_available_for_trading);
  const availableFunds = sum(balances, (b) => b.available_funds);
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

  const incomeHistory = realizedIncomeEntries(premiumHistory, transactions);
  const income = buildIncome(incomeHistory, profile.income_goal_annual, now);
  const score = computeScore({ positions: enriched, cashAvailable });
  const alerts = generateAlerts(enriched, { buyingPower, cashAvailable });

  const suggestedNewTrades = Math.floor(buyingPower / ENGINE_CONFIG.cash.typicalCapitalPerTrade);

  return {
    profile,
    accounts,
    balances,
    positions: enriched,
    premiumHistory,
    incomeHistory,
    transactions,
    trades,
    assignedHoldings: holdings,
    pnl,
    score,
    alerts,
    totals: {
      netLiquidationValue: netLiq,
      cashAvailable,
      cashAvailableForTrading,
      availableFunds,
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
      cashAvailableForTrading,
      availableFunds,
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
  return { thisMonth, ytd, rolling12, projectedAnnual, realizedPnlYtd: ytd, goal, goalProgressPct };
}

function realizedIncomeEntries(
  history: PremiumHistoryEntry[],
  transactions: AccountTransaction[]
): PremiumHistoryEntry[] {
  const realized = transactions
    .filter((tx) => tx.realized_gain_loss != null)
    .map((tx) => ({
      id: tx.id,
      user_id: tx.user_id,
      connected_account_id: tx.connected_account_id,
      ticker: parseUnderlying(tx.symbol) ?? tx.symbol ?? "OPTION",
      premium_amount: tx.realized_gain_loss ?? 0,
      realized_at: tx.transaction_time,
    }));

  return realized.length ? realized : history;
}

function parseUnderlying(symbol: string | null): string | null {
  if (!symbol) return null;
  const match = symbol.match(/^([A-Z.]+)\s+\d{6}[CP]\d{8}$/);
  return match?.[1] ?? symbol;
}

function sum<T>(items: T[], pick: (t: T) => number): number {
  return items.reduce((s, i) => s + pick(i), 0);
}
