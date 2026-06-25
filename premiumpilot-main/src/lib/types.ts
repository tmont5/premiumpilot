// Domain types for PremiumPilot. Mirrors the Postgres schema in /supabase/migrations.

export type Broker = "schwab";
export type AccountType = "individual" | "ira" | "joint";
export type Strategy = "cash_secured_put" | "covered_call";

// Computed position status (PRD §7). Ordered loosely worst -> best.
export type PositionStatus =
  | "high_risk"
  | "risk"
  | "close_candidate"
  | "monitor"
  | "hold";

export type AlertType = "close" | "roll" | "assignment_risk" | "cash_deployment";

export interface Profile {
  id: string; // == auth user id
  income_goal_annual: number | null;
  notify_email: boolean;
  notify_discord: boolean;
  notify_web_push: boolean;
  discord_webhook_url: string | null;
  timezone: string;
}

export interface ConnectedAccount {
  id: string;
  user_id: string;
  broker: Broker;
  account_label: string;
  account_type: AccountType;
  schwab_account_id: string | null;
  schwab_account_hash?: string | null;
  token_expires_at: string | null;
  last_synced_at: string | null;
  needs_reauth: boolean;
  created_at: string;
}

export interface AccountBalance {
  id: string;
  connected_account_id: string;
  net_liquidation_value: number;
  cash_balance: number;
  cash_available_for_trading: number;
  available_funds: number;
  buying_power: number;
  synced_at: string;
}

export interface AccountTransaction {
  id: string;
  user_id: string;
  connected_account_id: string;
  schwab_activity_id: string;
  type: string | null;
  status: string | null;
  description: string | null;
  symbol: string | null;
  asset_type: string | null;
  transaction_time: string;
  net_amount: number;
  realized_gain_loss: number | null;
  fees: number | null;
  price: number | null;
  quantity: number | null;
}

// Raw position as imported/stored. Derived metrics computed at read time.
export interface Position {
  id: string;
  connected_account_id: string;
  ticker: string;
  strategy: Strategy;
  strike: number;
  expiration: string; // ISO date
  contracts: number;
  premium_collected: number; // total $ collected to open
  current_option_value: number; // total $ cost to close now
  current_underlying_price: number;
  delta: number; // option delta (absolute-ish, see calc)
  capital_requirement: number;
  opened_at: string;
  synced_at: string;
}

// Position enriched with all computed metrics (PRD §6/§7).
export interface PositionMetrics {
  dte: number;
  currentProfit: number;
  profitCapturePct: number;
  returnOnCapital: number;
  annualizedReturn: number;
  distanceFromStrikePct: number;
  probabilityItm: number;
  assignmentRisk: number;
  status: PositionStatus;
}

export type EnrichedPosition = Position & { metrics: PositionMetrics };

export interface Alert {
  id: string;
  user_id: string;
  position_id: string | null;
  type: AlertType;
  message: string;
  recommendation: string;
  created_at: string;
  acknowledged_at: string | null;
}

export interface PremiumHistoryEntry {
  id: string;
  user_id: string;
  connected_account_id: string;
  ticker: string;
  premium_amount: number;
  realized_at: string;
}

export interface ScoreBreakdown {
  total: number;
  profitability: number;
  capitalEfficiency: number;
  diversification: number;
  timeRisk: number;
  assignmentRisk: number;
}
