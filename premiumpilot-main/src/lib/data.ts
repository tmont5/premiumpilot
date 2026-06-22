import { buildPortfolio, type PortfolioView } from "./portfolio";
import {
  seedAccounts,
  seedBalances,
  seedPositions,
  seedPremiumHistory,
  seedProfile,
} from "./seed";

// True when no live Supabase project is wired up yet. In that case the app runs
// against the in-repo demo dataset so every screen is fully usable. Once the
// Supabase env vars are present, swap the demo branch in getPortfolio() for a
// real query (schema lives in /supabase/migrations).
export function isDemoMode(): boolean {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL;
}

export async function getPortfolio(): Promise<PortfolioView> {
  // TODO(live): when isDemoMode() is false, fetch the authenticated user's
  // accounts/balances/positions/premium_history from Supabase and pass them to
  // buildPortfolio(). The engine layer is storage-agnostic.
  return buildPortfolio({
    profile: seedProfile,
    accounts: seedAccounts,
    balances: seedBalances,
    positions: seedPositions,
    premiumHistory: seedPremiumHistory,
  });
}
