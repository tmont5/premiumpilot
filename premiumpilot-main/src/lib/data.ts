import { cookies } from "next/headers";
import { buildPortfolio, type PortfolioView } from "./portfolio";
import {
  seedAccounts,
  seedAssignedHoldings,
  seedBalances,
  seedPositions,
  seedPremiumHistory,
  seedProfile,
  seedTrades,
  seedTransactions,
} from "./seed";
import { createClient } from "./supabase/server";
import { deriveClosedOptionTrades } from "./trades";
import type {
  AccountBalance,
  AccountTransaction,
  AssignedHolding,
  ConnectedAccount,
  Position,
  PremiumHistoryEntry,
  Profile,
  StockHolding,
  Trade,
} from "./types";

// Cookie that holds excluded-holding keys in demo mode (no DB). Each key is
// `${connected_account_id}::${ticker}`. Shared with /api/holdings/exclusions.
export const EXCLUSIONS_COOKIE = "pp_excluded_holdings";

export function holdingKey(connectedAccountId: string, ticker: string): string {
  return `${connectedAccountId}::${ticker}`;
}

async function readExcludedKeysFromCookie(): Promise<Set<string>> {
  try {
    const raw = (await cookies()).get(EXCLUSIONS_COOKIE)?.value;
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

// Builds the Accounts-page holdings list (every lot, with an `excluded` flag)
// from raw {connected_account_id, ticker, shares, current_price} rows.
function toStockHoldings(
  rows: { connected_account_id: string; ticker: string; shares: number; current_price: number }[],
  excluded: Set<string>
): StockHolding[] {
  return rows.map((r) => ({
    connected_account_id: r.connected_account_id,
    ticker: r.ticker,
    shares: r.shares,
    current_price: r.current_price,
    market_value: r.shares * r.current_price,
    excluded: excluded.has(holdingKey(r.connected_account_id, r.ticker)),
  }));
}

// Subtracts each account's excluded-holding market value from its NLV so the
// analysis reconciles (user chose to remove excluded holdings everywhere).
function adjustBalancesForExclusions(
  balances: AccountBalance[],
  excludedValueByAccount: Map<string, number>
): AccountBalance[] {
  return balances.map((b) => {
    const drop = excludedValueByAccount.get(b.connected_account_id) ?? 0;
    return drop ? { ...b, net_liquidation_value: b.net_liquidation_value - drop } : b;
  });
}

function excludedValueByAccount(holdings: StockHolding[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const h of holdings) {
    if (h.excluded) out.set(h.connected_account_id, (out.get(h.connected_account_id) ?? 0) + h.market_value);
  }
  return out;
}

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

  // Demo has no DB, so exclusions live in a cookie the Accounts page toggles.
  const excludedKeys = await readExcludedKeysFromCookie();
  const stockHoldings = toStockHoldings(seedAssignedHoldings, excludedKeys);
  const includedHoldings = seedAssignedHoldings.filter(
    (h) => !excludedKeys.has(holdingKey(h.connected_account_id, h.ticker))
  );
  const balances = adjustBalancesForExclusions(seedBalances, excludedValueByAccount(stockHoldings));

  return buildPortfolio({
    profile: seedProfile,
    accounts: seedAccounts,
    balances,
    positions: seedPositions,
    premiumHistory: seedPremiumHistory,
    transactions: seedTransactions,
    trades: seedTrades,
    assignedHoldings: includedHoldings,
    stockHoldings,
  });
}

async function getLivePortfolio(): Promise<PortfolioView | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [profileResult, accountsResult, premiumResult, transactionsResult, exclusionsResult] =
    await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, income_goal_annual, notify_email, notify_discord, notify_web_push, discord_webhook_url, timezone, risk_profile, account_type"
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
    supabase.from("excluded_holdings").select("connected_account_id, ticker").eq("user_id", user.id),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (accountsResult.error) throw accountsResult.error;
  if (premiumResult.error) throw premiumResult.error;
  if (transactionsResult.error && transactionsResult.error.code !== "42P01") throw transactionsResult.error;
  // excluded_holdings may not be provisioned yet — treat a missing table as "no
  // exclusions" (missing-table codes: 42P01 / PGRST205) rather than failing.
  if (
    exclusionsResult.error &&
    exclusionsResult.error.code !== "42P01" &&
    exclusionsResult.error.code !== "PGRST205"
  ) {
    console.warn("excluded_holdings unavailable; treating as none:", exclusionsResult.error.message);
  }
  const excludedKeys = new Set(
    ((exclusionsResult.error ? [] : exclusionsResult.data ?? []) as Record<string, unknown>[]).map((r) =>
      holdingKey(String(r.connected_account_id), String(r.ticker))
    )
  );

  const accountIds = (accountsResult.data ?? []).map((account) => account.id);
  const [balancesResult, positionsResult, equityResult] = await Promise.all([
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
    accountIds.length
      ? supabase
          .from("equity_holdings")
          .select("id, connected_account_id, ticker, shares, cost_basis_per_share, current_price, synced_at")
          .in("connected_account_id", accountIds)
          .order("synced_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (balancesResult.error) throw balancesResult.error;
  if (positionsResult.error) throw positionsResult.error;
  // Assigned Holdings is an optional enhancement; the equity_holdings table may
  // not be provisioned yet (missing-table errors vary: 42P01 / PGRST205). Never
  // let it fail the whole portfolio load — just skip the holdings.
  if (equityResult.error) {
    console.warn("equity_holdings unavailable; skipping assigned holdings:", equityResult.error.message);
  }
  const equityRows = (equityResult.error ? [] : equityResult.data ?? []) as Record<string, unknown>[];

  const transactions = ((transactionsResult.data ?? []) as Record<string, unknown>[]).map(
    normalizeTransaction
  );

  // Closed option trades (and the realized income the Income page rolls up) are
  // reconstructed from the synced transactions.
  const trades = deriveClosedOptionTrades(transactions);

  // Holdings manager: list every synced lot with its excluded flag, then drop
  // excluded lots from the analysis and subtract their value from NLV so every
  // figure reconciles.
  const stockHoldings = toStockHoldings(
    equityRows.map((row) => ({
      connected_account_id: String(row.connected_account_id),
      ticker: String(row.ticker),
      shares: number(row.shares),
      current_price: number(row.current_price),
    })),
    excludedKeys
  );
  const includedEquityRows = equityRows.filter(
    (row) => !excludedKeys.has(holdingKey(String(row.connected_account_id), String(row.ticker)))
  );
  const balances = adjustBalancesForExclusions(
    latestBalances(balancesResult.data ?? []),
    excludedValueByAccount(stockHoldings)
  );

  return buildPortfolio({
    profile: normalizeProfile(profileResult.data, user.id),
    accounts: (accountsResult.data ?? []) as ConnectedAccount[],
    balances,
    positions: (positionsResult.data ?? []).map(normalizePosition),
    premiumHistory: (premiumResult.data ?? []).map(normalizePremium),
    transactions,
    trades,
    assignedHoldings: buildAssignedHoldings(includedEquityRows, trades),
    stockHoldings,
  });
}

// Turns synced equity lots into Assigned Holdings. premium_credit is the net
// realized option premium for the underlying (from closed trades), which lowers
// the effective breakeven. This attributes all of the underlying's option income
// to the lot — an approximation, since assigned vs. bought shares are
// indistinguishable in Schwab's data.
function buildAssignedHoldings(rows: Record<string, unknown>[], trades: Trade[]): AssignedHolding[] {
  const creditByTicker = new Map<string, number>();
  for (const t of trades) {
    creditByTicker.set(t.ticker, (creditByTicker.get(t.ticker) ?? 0) + t.realized_pnl);
  }
  return rows
    .map((row) => ({
      id: String(row.id),
      connected_account_id: String(row.connected_account_id),
      ticker: String(row.ticker),
      shares: number(row.shares),
      cost_basis_per_share: number(row.cost_basis_per_share),
      premium_credit: Math.max(0, creditByTicker.get(String(row.ticker)) ?? 0),
      acquired_at: String(row.synced_at),
      current_price: number(row.current_price),
    }))
    .filter((h) => h.shares > 0);
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
    risk_profile: isRiskProfile(profile?.risk_profile) ? profile.risk_profile : "balanced",
    account_type: isRiskAccountType(profile?.account_type) ? profile.account_type : "cash",
  };
}

function isRiskProfile(value: unknown): value is Profile["risk_profile"] {
  return value === "conservative" || value === "balanced" || value === "aggressive";
}

function isRiskAccountType(value: unknown): value is Profile["account_type"] {
  return value === "cash" || value === "margin" || value === "ira";
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
