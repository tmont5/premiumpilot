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
  StockHolding,
  Trade,
} from "./types";
import { enrich, probabilityItm } from "./calc";
import { computeScore } from "./score";
import { generateAlerts, type GeneratedAlert } from "./alerts";
import { enrichAssignedHoldings, buildPnl } from "./pnl";
import { realizedIncomeFromTrades } from "./trades";
import { ENGINE_CONFIG } from "./config";

// Schwab activity types that represent external cash entering or leaving the
// account (deposits/withdrawals). Deposits carry a positive net_amount, with-
// drawals a negative one, so summing net_amount over these rows yields net cash
// contributed. Keep this list in sync with CASH_FLOW_TYPES in
// supabase/functions/schwab-sync/index.ts (which decides what the sync pulls).
export const CASH_FLOW_TYPES = new Set<string>([
  "ACH_RECEIPT",
  "ACH_DISBURSEMENT",
  "CASH_RECEIPT",
  "CASH_DISBURSEMENT",
  "ELECTRONIC_FUND",
  "WIRE_IN",
  "WIRE_OUT",
]);

export interface PortfolioInput {
  profile: Profile;
  accounts: ConnectedAccount[];
  balances: AccountBalance[];
  positions: Position[];
  premiumHistory: PremiumHistoryEntry[];
  transactions: AccountTransaction[];
  trades: Trade[];
  assignedHoldings: AssignedHolding[];
  stockHoldings?: StockHolding[];
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
  stockHoldings: StockHolding[];
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
    putAssignmentExposure: number;
    netCapitalInvested: number;
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
  const stockHoldings = input.stockHoldings ?? [];
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

  // Total put-assignment exposure: the full dollar amount of stock we'd have to
  // buy if every open short put were assigned = Σ(strike × 100 × contracts) over
  // cash-secured puts. Computed straight from strike/contracts (not
  // capital_requirement) so it's exact even if that field is ever derived
  // differently.
  const putAssignmentExposure = positions
    .filter((p) => p.strategy === "cash_secured_put")
    .reduce((s, p) => s + p.strike * 100 * p.contracts, 0);

  // Net capital invested: net external cash the user has contributed (deposits
  // less withdrawals) since tracking began. Summed from the synced cash-movement
  // transactions; 0 when none are present (e.g. demo has seed deposits, a fresh
  // live account has none yet).
  const netCapitalInvested = transactions
    .filter((tx) => tx.type != null && CASH_FLOW_TYPES.has(tx.type))
    .reduce((s, tx) => s + tx.net_amount, 0);

  const incomeHistory = realizedIncomeEntries(premiumHistory, trades);
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
    stockHoldings,
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
      putAssignmentExposure,
      netCapitalInvested,
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

// Realized income for the rollups. Pre-populated premium_history (demo, or any
// stored rows) wins; otherwise income is reconstructed from closed trades, which
// are themselves derived from synced transactions.
function realizedIncomeEntries(
  history: PremiumHistoryEntry[],
  trades: Trade[]
): PremiumHistoryEntry[] {
  if (history.length) return history;
  return realizedIncomeFromTrades(trades);
}

function sum<T>(items: T[], pick: (t: T) => number): number {
  return items.reduce((s, i) => s + pick(i), 0);
}
