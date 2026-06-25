import type {
  AccountBalance,
  ConnectedAccount,
  PremiumHistoryEntry,
  Position,
  Profile,
} from "./types";

// Demo dataset reflecting the user's live Charles Schwab "Individual" account as
// of 2026-06-10 (captured from the Schwab app while API access is pending).
//
// Positions, quantities, strikes, expirations and current option prices are taken
// directly from the account. Opening premiums, underlying prices and deltas are
// best-effort estimates (not shown on the positions screen) used to drive the
// engine. Equity holdings backing the covered calls: 1000 KHC, 200 HOOD, 345 ASST.

export const DEMO_USER_ID = "demo-user";
const now = new Date();
const recentSync = new Date(now.getTime() - 7 * 60 * 1000).toISOString();

export const seedProfile: Profile = {
  id: DEMO_USER_ID,
  income_goal_annual: 36000,
  notify_email: true,
  notify_discord: true,
  notify_web_push: false,
  discord_webhook_url: "https://discord.com/api/webhooks/demo/xxxx",
  timezone: "America/Denver",
};

export const seedAccounts: ConnectedAccount[] = [
  {
    id: "acct-individual",
    user_id: DEMO_USER_ID,
    broker: "schwab",
    account_label: "Schwab Individual",
    account_type: "individual",
    schwab_account_id: "****4821",
    token_expires_at: new Date(now.getTime() + 25 * 60 * 1000).toISOString(),
    last_synced_at: recentSync,
    needs_reauth: false,
    created_at: "2026-01-04T00:00:00Z",
  },
];

export const seedBalances: AccountBalance[] = [
  {
    id: "bal-individual",
    connected_account_id: "acct-individual",
    // Equity (1000 KHC @ 23.675 + 200 HOOD @ 90.07 + 345 ASST @ 14.435 = 46,669)
    // + cash 27,461.53 - short option liabilities 8,742.50.
    net_liquidation_value: 65388,
    cash_balance: 27461.53,
    cash_available_for_trading: 27461.53,
    available_funds: 27461.53,
    buying_power: 27000,
    synced_at: recentSync,
  },
];

// Live Schwab "Individual" positions. Expirations relative to "today" 2026-06-10.
// current_option_value / premium_collected are TOTAL dollars (price/share * 100 * |contracts|).
export const seedPositions: Position[] = [
  // ADBE 6/12/26 230 P  — qty -1 @ $8.225  (deep ITM, 2 DTE -> high risk)
  mk("p1", "acct-individual", "ADBE", "cash_secured_put", 230, "2026-06-12", 1, 650, 822.5, 222.5, 0.62, 23000, "2026-05-12"),
  // ARES 6/18/26 113 P  — qty -1 @ $0.55   (far OTM, decaying)
  mk("p2", "acct-individual", "ARES", "cash_secured_put", 113, "2026-06-18", 1, 110, 55, 122, 0.1, 11300, "2026-05-20"),
  // KHC 6/26/26 23.5 P  — qty -5 @ $0.54   (right at the money)
  mk("p3", "acct-individual", "KHC", "cash_secured_put", 23.5, "2026-06-26", 5, 375, 270, 23.675, 0.47, 11750, "2026-05-28"),
  // KHC 7/10/26 24 C    — qty -10 @ $0.65  (covered by 1000 KHC shares)
  mk("p4", "acct-individual", "KHC", "covered_call", 24, "2026-07-10", 10, 850, 650, 23.675, 0.42, 23675, "2026-06-05"),
  // ORCL 7/10/26 197.5 P — qty -1 @ $14.40
  mk("p5", "acct-individual", "ORCL", "cash_secured_put", 197.5, "2026-07-10", 1, 1650, 1440, 211, 0.31, 19750, "2026-06-08"),
  // PLTR 7/10/26 135 P  — qty -1 @ $10.075
  mk("p6", "acct-individual", "PLTR", "cash_secured_put", 135, "2026-07-10", 1, 1150, 1007.5, 148, 0.26, 13500, "2026-06-08"),
  // HOOD 7/2/26 87 C    — qty -2 @ $8.175  (ITM, covered by 200 HOOD shares -> high risk)
  mk("p7", "acct-individual", "HOOD", "covered_call", 87, "2026-07-02", 2, 1300, 1635, 90.07, 0.66, 18014, "2026-06-02"),
  // CRM 7/2/26 185 P    — qty -1 @ $16.025
  mk("p8", "acct-individual", "CRM", "cash_secured_put", 185, "2026-07-02", 1, 1750, 1602.5, 192, 0.4, 18500, "2026-06-02"),
  // NOW 7/2/26 108 P    — qty -1 @ $7.65   (near the money)
  mk("p9", "acct-individual", "NOW", "cash_secured_put", 108, "2026-07-02", 1, 700, 765, 109, 0.48, 10800, "2026-06-02"),
  // SOFI 7/10/26 15 P   — qty -10 @ $0.495
  mk("p10", "acct-individual", "SOFI", "cash_secured_put", 15, "2026-07-10", 10, 850, 495, 17, 0.13, 15000, "2026-06-09"),
];

function mk(
  id: string,
  account: string,
  ticker: string,
  strategy: Position["strategy"],
  strike: number,
  expiration: string,
  contracts: number,
  premium_collected: number,
  current_option_value: number,
  current_underlying_price: number,
  delta: number,
  capital_requirement: number,
  opened_at: string
): Position {
  return {
    id,
    connected_account_id: account,
    ticker,
    strategy,
    strike,
    expiration,
    contracts,
    premium_collected,
    current_option_value,
    current_underlying_price,
    delta,
    capital_requirement,
    opened_at: opened_at + "T00:00:00Z",
    synced_at: recentSync,
  };
}

// Realized premium across the trailing ~13 months for income rollups (PRD §9.5).
export const seedPremiumHistory: PremiumHistoryEntry[] = buildPremiumHistory();

function buildPremiumHistory(): PremiumHistoryEntry[] {
  const tickers = ["KHC", "HOOD", "ADBE", "ARES", "ORCL", "PLTR", "CRM", "NOW", "SOFI"];
  const entries: PremiumHistoryEntry[] = [];
  let n = 0;
  // 13 months back through current month.
  for (let monthsAgo = 13; monthsAgo >= 0; monthsAgo--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 14));
    const perMonth = 3 + (monthsAgo % 3); // 3-5 realizations/month
    for (let i = 0; i < perMonth; i++) {
      const amount = 250 + ((monthsAgo * 7 + i * 53) % 9) * 90; // ~250-970
      entries.push({
        id: `prem-${n}`,
        user_id: DEMO_USER_ID,
        connected_account_id: "acct-individual",
        ticker: tickers[n % tickers.length],
        premium_amount: amount,
        realized_at: new Date(d.getTime() + i * 36 * 60 * 60 * 1000).toISOString(),
      });
      n++;
    }
  }
  return entries;
}
