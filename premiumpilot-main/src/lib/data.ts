import { buildPortfolio, type PortfolioView } from "./portfolio";
import {
  seedAccounts,
  seedAssignedHoldings,
  seedBalances,
  seedPositions,
  seedPremiumHistory,
  seedProfile,
  seedTrades,
} from "./seed";
import { createClient } from "./supabase/server";
import type {
  AccountBalance,
  AccountTransaction,
  ConnectedAccount,
  Position,
  PremiumHistoryEntry,
  Profile,
  Trade,
  TradeOutcome,
} from "./types";

// True when no live Supabase project is wired up yet. In that case the app runs
// against the in-repo demo dataset so every screen is fully usable.
export function isDemoMode(): boolean {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export async function getPortfolio(): Promise<PortfolioView> {
  if (!isDemoMode()) {
    const live = await getLivePortfolio();
    if (live) return live;
  }

  return buildPortfolio({
    profile: seedProfile,
    accounts: seedAccounts,
    balances: seedBalances,
    positions: seedPositions,
    premiumHistory: seedPremiumHistory,
    transactions: [],
    trades: seedTrades,
    assignedHoldings: seedAssignedHoldings,
  });
}

async function getLivePortfolio(): Promise<PortfolioView | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [profileResult, accountsResult, premiumResult, transactionsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, income_goal_annual, notify_email, notify_discord, notify_web_push, discord_webhook_url, timezone"
      )
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("connected_accounts")
      .select(
        "id, user_id, broker, account_label, account_type, schwab_account_id, token_expires_at, last_synced_at, needs_reauth, created_at"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("premium_history")
      .select("id, user_id, connected_account_id, ticker, premium_amount, realized_at")
      .eq("user_id", user.id)
      .order("realized_at", { ascending: false }),
    supabase
      .from("account_transactions")
      .select(
        "id, user_id, connected_account_id, schwab_activity_id, type, status, description, symbol, asset_type, transaction_time, net_amount, realized_gain_loss, fees, price, quantity"
      )
      .eq("user_id", user.id)
      .order("transaction_time", { ascending: false }),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (accountsResult.error) throw accountsResult.error;
  if (premiumResult.error) throw premiumResult.error;
  if (transactionsResult.error && transactionsResult.error.code !== "42P01") throw transactionsResult.error;

  const accountIds = (accountsResult.data ?? []).map((account) => account.id);
  const [balancesResult, positionsResult] = await Promise.all([
    accountIds.length
      ? supabase
          .from("account_balances")
          .select(
            "id, connected_account_id, net_liquidation_value, cash_balance, cash_available_for_trading, available_funds, buying_power, synced_at"
          )
          .in("connected_account_id", accountIds)
          .order("synced_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    accountIds.length
      ? supabase
          .from("positions")
          .select(
            "id, connected_account_id, ticker, strategy, strike, expiration, contracts, premium_collected, current_option_value, current_underlying_price, delta, capital_requirement, opened_at, synced_at"
          )
          .in("connected_account_id", accountIds)
          .order("expiration", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (balancesResult.error) throw balancesResult.error;
  if (positionsResult.error) throw positionsResult.error;

  const transactions = ((transactionsResult.data ?? []) as Record<string, unknown>[]).map(
    normalizeTransaction
  );

  return buildPortfolio({
    profile: normalizeProfile(profileResult.data, user.id),
    accounts: (accountsResult.data ?? []) as ConnectedAccount[],
    balances: latestBalances(balancesResult.data ?? []),
    positions: (positionsResult.data ?? []).map(normalizePosition),
    premiumHistory: (premiumResult.data ?? []).map(normalizePremium),
    transactions,
    // Closed option trades derive from realized-gain transactions. Assigned-stock
    // holdings need equity cost-basis data the sync doesn't pull yet (follow-up),
    // so live mode shows none for now.
    trades: deriveTrades(transactions),
    assignedHoldings: [],
  });
}

// Builds trade history from realized option transactions. We know each close's
// realized P/L but not its original premium/cost split, so those stay null.
function deriveTrades(transactions: AccountTransaction[]): Trade[] {
  return transactions
    .filter((tx) => tx.asset_type === "OPTION" && tx.realized_gain_loss != null)
    .map((tx) => ({
      id: tx.id,
      connected_account_id: tx.connected_account_id,
      ticker: parseOptionUnderlying(tx.symbol) ?? tx.symbol ?? "OPTION",
      strategy: isPutSymbol(tx.symbol) ? ("cash_secured_put" as const) : ("covered_call" as const),
      strike: parseOptionStrike(tx.symbol),
      contracts: Math.abs(tx.quantity ?? 0),
      opened_at: null,
      closed_at: tx.transaction_time,
      premium_collected: null,
      cost_to_close: null,
      realized_pnl: tx.realized_gain_loss ?? 0,
      outcome: "closed" as TradeOutcome,
    }));
}

// OCC-style symbol, e.g. "AAPL  260116C00185000": last 8 digits are strike * 1000.
function isPutSymbol(symbol: string | null): boolean {
  return /\d{6}P\d{8}$/.test(symbol ?? "");
}

function parseOptionStrike(symbol: string | null): number {
  const match = (symbol ?? "").match(/[CP](\d{8})$/);
  return match ? Number(match[1]) / 1000 : 0;
}

function parseOptionUnderlying(symbol: string | null): string | null {
  if (!symbol) return null;
  const match = symbol.match(/^([A-Z.]+)\s+\d{6}[CP]\d{8}$/);
  return match?.[1] ?? null;
}

function normalizeProfile(profile: Partial<Profile> | null, userId: string): Profile {
  return {
    id: userId,
    income_goal_annual: nullableNumber(profile?.income_goal_annual),
    notify_email: profile?.notify_email ?? true,
    notify_discord: profile?.notify_discord ?? false,
    notify_web_push: profile?.notify_web_push ?? false,
    discord_webhook_url: profile?.discord_webhook_url ?? null,
    timezone: profile?.timezone ?? "America/New_York",
  };
}

function latestBalances(rows: Record<string, unknown>[]): AccountBalance[] {
  const seen = new Set<string>();
  const latest: AccountBalance[] = [];

  for (const row of rows) {
    const accountId = String(row.connected_account_id);
    if (seen.has(accountId)) continue;
    seen.add(accountId);
    latest.push({
      id: String(row.id),
      connected_account_id: accountId,
      net_liquidation_value: number(row.net_liquidation_value),
      cash_balance: number(row.cash_balance),
      cash_available_for_trading: number(row.cash_available_for_trading ?? row.cash_balance),
      available_funds: number(row.available_funds ?? row.cash_available_for_trading ?? row.cash_balance),
      buying_power: number(row.buying_power),
      synced_at: String(row.synced_at),
    });
  }

  return latest;
}

function normalizePosition(row: Record<string, unknown>): Position {
  return {
    id: String(row.id),
    connected_account_id: String(row.connected_account_id),
    ticker: String(row.ticker),
    strategy: row.strategy as Position["strategy"],
    strike: number(row.strike),
    expiration: String(row.expiration),
    contracts: number(row.contracts),
    premium_collected: number(row.premium_collected),
    current_option_value: number(row.current_option_value),
    current_underlying_price: number(row.current_underlying_price),
    delta: number(row.delta),
    capital_requirement: number(row.capital_requirement),
    opened_at: String(row.opened_at),
    synced_at: String(row.synced_at),
  };
}

function normalizePremium(row: Record<string, unknown>): PremiumHistoryEntry {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    connected_account_id: row.connected_account_id ? String(row.connected_account_id) : "",
    ticker: String(row.ticker),
    premium_amount: number(row.premium_amount),
    realized_at: String(row.realized_at),
  };
}

function normalizeTransaction(row: Record<string, unknown>): AccountTransaction {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    connected_account_id: String(row.connected_account_id),
    schwab_activity_id: String(row.schwab_activity_id),
    type: nullableString(row.type),
    status: nullableString(row.status),
    description: nullableString(row.description),
    symbol: nullableString(row.symbol),
    asset_type: nullableString(row.asset_type),
    transaction_time: String(row.transaction_time),
    net_amount: number(row.net_amount),
    realized_gain_loss: row.realized_gain_loss == null ? null : number(row.realized_gain_loss),
    fees: row.fees == null ? null : number(row.fees),
    price: row.price == null ? null : number(row.price),
    quantity: row.quantity == null ? null : number(row.quantity),
  };
}

function number(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return number(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
