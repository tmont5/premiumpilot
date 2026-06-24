import { buildPortfolio, type PortfolioView } from "./portfolio";
import {
  seedAccounts,
  seedBalances,
  seedPositions,
  seedPremiumHistory,
  seedProfile,
} from "./seed";
import { createClient } from "./supabase/server";
import type {
  AccountBalance,
  ConnectedAccount,
  Position,
  PremiumHistoryEntry,
  Profile,
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
  });
}

async function getLivePortfolio(): Promise<PortfolioView | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [profileResult, accountsResult, premiumResult] = await Promise.all([
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
  ]);

  if (profileResult.error) throw profileResult.error;
  if (accountsResult.error) throw accountsResult.error;
  if (premiumResult.error) throw premiumResult.error;

  const accountIds = (accountsResult.data ?? []).map((account) => account.id);
  const [balancesResult, positionsResult] = await Promise.all([
    accountIds.length
      ? supabase
          .from("account_balances")
          .select(
            "id, connected_account_id, net_liquidation_value, cash_balance, buying_power, synced_at"
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

  return buildPortfolio({
    profile: normalizeProfile(profileResult.data, user.id),
    accounts: (accountsResult.data ?? []) as ConnectedAccount[],
    balances: latestBalances(balancesResult.data ?? []),
    positions: (positionsResult.data ?? []).map(normalizePosition),
    premiumHistory: (premiumResult.data ?? []).map(normalizePremium),
  });
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

function number(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return number(value);
}
