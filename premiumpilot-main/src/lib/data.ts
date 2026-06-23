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
// against the in-repo demo dataset so every screen is fully usable. Once the
// Supabase env vars are present, swap the demo branch in getPortfolio() for a
// real query (schema lives in /supabase/migrations).
export function isDemoMode(): boolean {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL;
}

export async function getPortfolio(): Promise<PortfolioView> {
  if (!isDemoMode()) {
    const supabase = await createClient();
    const { data: auth } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
    const user = auth.user;

    if (supabase && user) {
      const [profileRes, accountsRes, balancesRes, positionsRes, premiumRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id,income_goal_annual,notify_email,notify_discord,notify_web_push,discord_webhook_url,timezone")
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("connected_accounts")
          .select("id,user_id,broker,account_label,account_type,schwab_account_id,token_expires_at,last_synced_at,needs_reauth,created_at")
          .order("created_at", { ascending: true }),
        supabase
          .from("account_balances")
          .select("id,connected_account_id,net_liquidation_value,cash_balance,buying_power,synced_at")
          .order("synced_at", { ascending: false }),
        supabase
          .from("positions")
          .select("id,connected_account_id,ticker,strategy,strike,expiration,contracts,premium_collected,current_option_value,current_underlying_price,delta,capital_requirement,opened_at,synced_at")
          .order("expiration", { ascending: true }),
        supabase
          .from("premium_history")
          .select("id,user_id,connected_account_id,ticker,premium_amount,realized_at")
          .order("realized_at", { ascending: false }),
      ]);

      if (profileRes.error) throw new Error(profileRes.error.message);
      if (accountsRes.error) throw new Error(accountsRes.error.message);
      if (balancesRes.error) throw new Error(balancesRes.error.message);
      if (positionsRes.error) throw new Error(positionsRes.error.message);
      if (premiumRes.error) throw new Error(premiumRes.error.message);

      return buildPortfolio({
        profile: profileRes.data ?? defaultProfile(user.id),
        accounts: (accountsRes.data ?? []) as ConnectedAccount[],
        balances: latestBalancePerAccount((balancesRes.data ?? []) as AccountBalance[]),
        positions: (positionsRes.data ?? []) as Position[],
        premiumHistory: (premiumRes.data ?? []) as PremiumHistoryEntry[],
      });
    }
  }

  return buildPortfolio({
    profile: seedProfile,
    accounts: seedAccounts,
    balances: seedBalances,
    positions: seedPositions,
    premiumHistory: seedPremiumHistory,
  });
}

function defaultProfile(userId: string): Profile {
  return {
    id: userId,
    income_goal_annual: null,
    notify_email: true,
    notify_discord: false,
    notify_web_push: false,
    discord_webhook_url: null,
    timezone: "America/New_York",
  };
}

function latestBalancePerAccount(balances: AccountBalance[]): AccountBalance[] {
  const seen = new Set<string>();
  const latest: AccountBalance[] = [];
  for (const balance of balances) {
    if (seen.has(balance.connected_account_id)) continue;
    seen.add(balance.connected_account_id);
    latest.push(balance);
  }
  return latest;
}
