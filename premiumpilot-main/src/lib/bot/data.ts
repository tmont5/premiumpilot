import { isDemoMode } from "../data";
import { createClient } from "../supabase/server";
import {
  DEFAULT_BOT_SETTINGS,
  type BotProposal,
  type BotReportView,
  type BotRun,
  type BotScanProgress,
  type BotSettings,
  type BotState,
  type ProposalDetails,
} from "./types";

const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

// Loads the current user's bot configuration, proposals, and run history. In
// demo mode (or before the bot tables are provisioned) it returns an in-repo
// sample so the page is fully usable.
export async function getBotState(): Promise<BotState> {
  if (isDemoMode()) return demoBotState();

  const supabase = await createClient();
  if (!supabase) return demoBotState();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { settings: DEFAULT_BOT_SETTINGS, proposals: [], runs: [], report: null, scan: null, demo: false };

  const [settingsRes, proposalsRes, runsRes, scanRes] = await Promise.all([
    supabase
      .from("bot_settings")
      .select("enabled, max_trades_per_day, mode, universe, config")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("bot_proposals")
      .select(
        "id, ticker, strategy, strike, expiration, contracts, option_symbol, limit_price, est_premium, capital_required, score, rationale, status, created_at, decided_at, details"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("bot_runs")
      .select("id, trigger, status, candidates_evaluated, proposals_created, message, ran_at, report")
      .eq("user_id", user.id)
      .order("ran_at", { ascending: false })
      .limit(20),
    supabase
      .from("bot_scan_state")
      .select("scan_date, cursor, universe_size")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  // The bot tables may not be deployed yet — degrade gracefully rather than 500.
  if (settingsRes.error && !MISSING_TABLE.has(settingsRes.error.code)) throw settingsRes.error;
  if (proposalsRes.error && !MISSING_TABLE.has(proposalsRes.error.code)) throw proposalsRes.error;
  if (runsRes.error && !MISSING_TABLE.has(runsRes.error.code)) throw runsRes.error;

  const runs = (runsRes.error ? [] : runsRes.data ?? []) as Record<string, unknown>[];
  const latestWithReport = runs.find((r) => r.report && typeof r.report === "object");
  const scanRow = scanRes.error ? null : scanRes.data;

  return {
    settings: normalizeSettings(settingsRes.data),
    proposals: (proposalsRes.error ? [] : proposalsRes.data ?? []).map(normalizeProposal),
    runs: runs.map(normalizeRun),
    report: (latestWithReport?.report as BotReportView) ?? null,
    scan: scanRow ? ({ scan_date: String(scanRow.scan_date), cursor: Number(scanRow.cursor), universe_size: Number(scanRow.universe_size) } as BotScanProgress) : null,
    demo: false,
  };
}

function normalizeSettings(row: Partial<BotSettings> | null): BotSettings {
  if (!row) return DEFAULT_BOT_SETTINGS;
  return {
    enabled: Boolean(row.enabled),
    max_trades_per_day: typeof row.max_trades_per_day === "number" ? row.max_trades_per_day : 5,
    mode: row.mode ?? "proposal",
    universe: Array.isArray(row.universe) ? row.universe : [],
    config: (row.config as Record<string, unknown>) ?? {},
  };
}

function normalizeProposal(row: Record<string, unknown>): BotProposal {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    id: String(row.id),
    ticker: String(row.ticker),
    strategy: row.strategy as BotProposal["strategy"],
    strike: Number(row.strike),
    expiration: String(row.expiration),
    contracts: Number(row.contracts),
    option_symbol: row.option_symbol ? String(row.option_symbol) : null,
    limit_price: num(row.limit_price),
    est_premium: num(row.est_premium),
    capital_required: num(row.capital_required),
    score: num(row.score),
    rationale: row.rationale ? String(row.rationale) : null,
    status: row.status as BotProposal["status"],
    created_at: String(row.created_at),
    decided_at: row.decided_at ? String(row.decided_at) : null,
    details: (row.details as ProposalDetails) ?? null,
  };
}

function normalizeRun(row: Record<string, unknown>): BotRun {
  return {
    id: String(row.id),
    trigger: String(row.trigger),
    status: String(row.status),
    candidates_evaluated: Number(row.candidates_evaluated ?? 0),
    proposals_created: Number(row.proposals_created ?? 0),
    message: row.message ? String(row.message) : null,
    ran_at: String(row.ran_at),
  };
}

// ── Demo sample ───────────────────────────────────────────────────────────────
function demoBotState(): BotState {
  const now = new Date();
  const iso = (daysFromNow: number) =>
    new Date(now.getTime() + daysFromNow * 86400000).toISOString();
  const expDate = (daysFromNow: number) => iso(daysFromNow).slice(0, 10);

  const exp = expDate(30);
  const proposals: BotProposal[] = [
    mkProposal("d1", "PG", 158, exp, 1.9, 156.1, 87, "proposed",
      { quality: 24, technical: 21, option: 14.5, liquidity: 13, downside: 8.5, eventPortfolio: 4 },
      { simpleAnnualized: 22.1, breakevenCushion: 6.7, delta: -0.22, openInterest: 8200, spreadPct: 2.1, dte: 30, principalRisk: "General market drawdown risk before expiration." }, iso(0)),
    mkProposal("d2", "JNJ", 150, exp, 1.75, 148.25, 85, "proposed",
      { quality: 24, technical: 20, option: 14, liquidity: 12.5, downside: 8, eventPortfolio: 4 },
      { simpleAnnualized: 21.5, breakevenCushion: 7.4, delta: -0.21, openInterest: 5100, spreadPct: 2.8, dte: 30, principalRisk: "General market drawdown risk before expiration." }, iso(0)),
    mkProposal("d3", "KO", 60, exp, 0.72, 59.28, 82, "proposed",
      { quality: 23, technical: 19, option: 13.5, liquidity: 12, downside: 8, eventPortfolio: 4 },
      { simpleAnnualized: 20.6, breakevenCushion: 6.1, delta: -0.23, openInterest: 6400, spreadPct: 3.4, dte: 30, principalRisk: "Thin downside cushion — watch technical support." }, iso(0)),
    mkProposal("d4", "PEP", 168, exp, 2.1, 165.9, 84, "approved",
      { quality: 24, technical: 20, option: 14, liquidity: 12, downside: 8, eventPortfolio: 4 },
      { simpleAnnualized: 21.3, breakevenCushion: 6.9, delta: -0.22, openInterest: 3900, spreadPct: 3.0, dte: 30, principalRisk: "General market drawdown risk before expiration." }, iso(-1)),
  ];

  const runs: BotRun[] = [
    { id: "r1", trigger: "cron", status: "ok", candidates_evaluated: 1180, proposals_created: 3, message: null, ran_at: iso(0) },
    { id: "r2", trigger: "cron", status: "partial", candidates_evaluated: 540, proposals_created: 0, message: "scanned 120/236", ran_at: iso(0) },
  ];

  const report: BotReportView = {
    counts: { universe: 236, scanned: 236, rejectedBeforeOptions: 141, contractsEvaluated: 1180, passedHardFilters: 22, scored80Plus: 3 },
    watchlist: [
      { ticker: "MDLZ", score: 79, strike: 62, expiration: exp, simpleAnnualized: 20.2 },
      { ticker: "CL", score: 78, strike: 88, expiration: exp, simpleAnnualized: 20.8 },
    ],
    highYieldRejections: [
      { ticker: "CVNA", reason: "Overextended: RSI 74 > 68", simpleAnnualized: 61.4 },
      { ticker: "PLTR", reason: "Earnings before expiration", simpleAnnualized: 44.9 },
      { ticker: "MU", reason: "Overextended: >8% above SMA20", simpleAnnualized: 38.2 },
    ],
    concentrationFlags: ["3 recommendations in Consumer Staples (at sector cap)."],
    dataWarnings: ["IV percentile unavailable — implied-volatility sub-score is neutral."],
  };

  return {
    settings: {
      enabled: true,
      max_trades_per_day: 5,
      mode: "proposal",
      universe: [],
      config: { minDte: 20, maxDte: 35, minDelta: 0.15, maxDelta: 0.3, minAnnualizedReturn: 0.2, maxPositionSize: 50000 },
    },
    proposals,
    runs,
    report,
    scan: { scan_date: exp, cursor: 236, universe_size: 236 },
    demo: true,
  };
}

function mkProposal(
  id: string,
  ticker: string,
  strike: number,
  expiration: string,
  limit: number,
  breakeven: number,
  score: number,
  status: BotProposal["status"],
  components: NonNullable<ProposalDetails["components"]>,
  extra: Partial<ProposalDetails>,
  created: string
): BotProposal {
  const contracts = 1;
  const capital = Math.round(breakeven * 100 * contracts);
  return {
    id,
    ticker,
    strategy: "cash_secured_put",
    strike,
    expiration,
    contracts,
    option_symbol: null,
    limit_price: limit,
    est_premium: Math.round(limit * 100 * contracts),
    capital_required: capital,
    score,
    rationale:
      `${ticker}: sell ${contracts} ${strike}P exp ${expiration} (Δ ${(extra.delta ?? -0.22).toFixed(2)}) at ~$${Math.round(limit * 100 * contracts)} ` +
      `credit — ${extra.simpleAnnualized}% simple annualized on $${capital.toLocaleString()} secured. Breakeven $${breakeven} (${extra.breakevenCushion}% cushion).`,
    status,
    created_at: created,
    decided_at: status === "proposed" ? null : created,
    details: { components, breakeven, currentPrice: Math.round(breakeven * 1.07 * 100) / 100, ...extra },
  };
}
