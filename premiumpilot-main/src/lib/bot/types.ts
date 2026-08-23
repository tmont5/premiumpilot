// App-side bot types. Mirror the bot_* tables (migration 0011). The decision
// engine that writes these rows lives in supabase/functions/_shared/bot.ts; the
// app only reads proposals and lets the user configure settings + approve/reject.

export type BotMode = "proposal" | "paper" | "auto";
export type ProposalStatus = "proposed" | "approved" | "rejected" | "expired" | "executed";
export type BotStrategy = "cash_secured_put" | "covered_call";

export interface BotSettings {
  enabled: boolean;
  max_trades_per_day: number;
  mode: BotMode;
  universe: string[];
  config: Record<string, unknown>;
}

export interface ScoreComponents {
  quality: number;
  technical: number;
  option: number;
  liquidity: number;
  downside: number;
  eventPortfolio: number;
}

// The full ScoredTrade blob persisted on bot_proposals.details.
export interface ProposalDetails {
  components?: ScoreComponents;
  currentPrice?: number;
  simpleAnnualized?: number;
  compoundedAnnualized?: number;
  cashSecuredReturn?: number;
  breakeven?: number;
  breakevenCushion?: number;
  delta?: number;
  iv?: number;
  openInterest?: number;
  spreadPct?: number;
  bid?: number;
  ask?: number;
  midpoint?: number;
  dte?: number;
  grossObligation?: number;
  netCashRequirement?: number;
  nearestSupport?: number | null;
  earningsDate?: string | null;
  principalRisk?: string;
  doNotEnterBelow?: number;
  stress?: { drop: number; loss: number; lossPct: number }[];
  aiRiskFlags?: string[];
}

export interface BotProposal {
  id: string;
  ticker: string;
  strategy: BotStrategy;
  strike: number;
  expiration: string;
  contracts: number;
  option_symbol: string | null;
  limit_price: number | null;
  est_premium: number | null;
  capital_required: number | null;
  score: number | null;
  rationale: string | null;
  status: ProposalStatus;
  created_at: string;
  decided_at: string | null;
  details: ProposalDetails | null;
}

export interface BotReportView {
  counts?: {
    universe: number;
    scanned: number;
    rejectedBeforeOptions: number;
    contractsEvaluated: number;
    passedHardFilters: number;
    scored80Plus: number;
  };
  watchlist?: { ticker: string; score: number; strike: number; expiration: string; simpleAnnualized: number }[];
  highYieldRejections?: { ticker: string; reason: string; simpleAnnualized: number | null }[];
  concentrationFlags?: string[];
  dataWarnings?: string[];
}

export interface BotScanProgress {
  scan_date: string;
  cursor: number;
  universe_size: number;
}

export interface BotRun {
  id: string;
  trigger: string;
  status: string;
  candidates_evaluated: number;
  proposals_created: number;
  message: string | null;
  ran_at: string;
}

export interface BotState {
  settings: BotSettings;
  proposals: BotProposal[];
  runs: BotRun[];
  report: BotReportView | null; // latest run's scan report
  scan: BotScanProgress | null; // in-progress chunked scan, if any
  demo: boolean;
}

export const DEFAULT_BOT_SETTINGS: BotSettings = {
  enabled: false,
  max_trades_per_day: 5,
  mode: "proposal",
  universe: [],
  config: {},
};
