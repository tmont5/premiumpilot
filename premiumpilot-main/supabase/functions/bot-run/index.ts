/* eslint-disable @typescript-eslint/no-explicit-any */
// Wheel-strategy bot runner. Chunked: each invocation advances a cursor through
// the approved universe, staging the best contract per ticker, and finalizes
// (ranks + publishes ≤5) once the whole universe is scanned for the day. Runs on
// a pre-close cron (every 5 min, weekdays) and on the app's manual "Run now"
// (POST { userId, trigger: "manual" }, which restarts a fresh scan).
//
// PROPOSES only — no orders are placed.
import { adminClient } from "../_shared/db.ts";
import { decryptToken, encryptToken } from "../_shared/crypto.ts";
import {
  getInstrumentFundamentals,
  getOptionChain,
  getPriceHistory,
  optionCandidatesFromChain,
  refreshTokens,
} from "../_shared/schwab.ts";
import { fetchEarningsCalendar } from "../_shared/marketdata.ts";
import { APPROVED_SECTORS, APPROVED_UNIVERSE, toSchwabSymbol } from "../_shared/universe.ts";
import { pctReturn, type Candle } from "../_shared/indicators.ts";
import {
  DEFAULT_BOT_CONFIG,
  evaluateTicker,
  rankAndReport,
  type BotConfig,
  type RejectedTrade,
  type ScoredTrade,
  type TickerInput,
} from "../_shared/bot.ts";

const REFRESH_SKEW_MS = 5 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BUDGET_MS = 40_000; // per-invocation time budget
const MAX_BATCH = 25; // ticker cap per invocation

Deno.serve(async (req) => {
  const db = adminClient();
  let userId: string | null = null;
  let trigger = "cron";
  if (req.method === "POST") {
    const body = await req.json().catch(() => null);
    if (body && typeof body.userId === "string") userId = body.userId;
    if (body && body.trigger === "manual") trigger = "manual";
  }

  let q = db.from("bot_settings").select("user_id, enabled, max_trades_per_day, universe, config").eq("enabled", true);
  if (userId) q = q.eq("user_id", userId);
  const { data: settingsRows, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const results: Record<string, unknown> = {};
  for (const s of settingsRows ?? []) {
    try {
      results[s.user_id] = await runForUser(db, s, trigger);
    } catch (e) {
      console.error("bot run failed", s.user_id, e);
      await db.from("bot_runs").insert({ user_id: s.user_id, trigger, status: "error", message: String(e) });
      results[s.user_id] = { error: String(e) };
    }
  }
  return json({ runs: results });
});

async function runForUser(db: ReturnType<typeof adminClient>, s: any, trigger: string) {
  const { data: accounts } = await db
    .from("connected_accounts")
    .select("id, encrypted_access_token, encrypted_refresh_token, token_expires_at")
    .eq("user_id", s.user_id);
  if (!accounts?.length) {
    await db.from("bot_runs").insert({ user_id: s.user_id, trigger, status: "skipped", message: "no connected accounts" });
    return { skipped: "no accounts" };
  }

  // Universe: the approved list, optionally narrowed by the user's settings.
  const narrow: string[] = Array.isArray(s.universe) ? s.universe : [];
  const universe = narrow.length ? APPROVED_UNIVERSE.filter((t) => narrow.includes(t)) : APPROVED_UNIVERSE;
  const config = buildConfig(s);
  const accessToken = await ensureToken(db, accounts[0]);
  const today = new Date().toISOString().slice(0, 10);

  // Load / initialize scan state. A new day always starts fresh; a manual run
  // restarts only when today's scan is already finished (otherwise it advances
  // the in-progress scan, so repeated "Run now" clicks make progress).
  const { data: existing } = await db.from("bot_scan_state").select("*").eq("user_id", s.user_id).maybeSingle();
  let state = existing;
  const stale = !state || state.scan_date !== today;
  const completeToday = state && state.scan_date === today && state.cursor >= (state.universe_size ?? universe.length);
  if (stale || (trigger === "manual" && completeToday)) {
    const spy = await computeSpyReturn20(accessToken);
    // One earnings-calendar fetch per scan, reused across all chunks.
    const earnings = await fetchEarningsCalendar(universe);
    await db.from("bot_scan_candidates").delete().eq("user_id", s.user_id);
    const init = {
      user_id: s.user_id, scan_date: today, cursor: 0, universe_size: universe.length,
      spy_return20: spy, earnings: earnings.map, earnings_available: earnings.available,
      contracts_evaluated: 0, rejected_before_options: 0, updated_at: new Date().toISOString(),
    };
    await db.from("bot_scan_state").upsert(init, { onConflict: "user_id" });
    state = init;
  }

  if (state.cursor >= universe.length) {
    return { complete: true, cursor: state.cursor };
  }

  const market = { spyReturn20: state.spy_return20 == null ? null : Number(state.spy_return20) };
  const earningsMap = (state.earnings ?? {}) as Record<string, string>;
  const earningsAvailable = Boolean(state.earnings_available);
  const now = new Date();
  const fromISO = today;
  const toISO = new Date(now.getTime() + (config.maxDte + 5) * MS_PER_DAY).toISOString().slice(0, 10);

  const start = Date.now();
  let cursor: number = state.cursor;
  let processed = 0;
  let contractsEvaluated = 0;
  let rejectedBeforeOptions = 0;

  while (cursor < universe.length && processed < MAX_BATCH && Date.now() - start < BUDGET_MS) {
    const ticker = universe[cursor];
    try {
      const input = await buildTickerInput(accessToken, ticker, config, fromISO, toISO, earningsMap, earningsAvailable);
      const ev = evaluateTicker(input, config, market, now);
      contractsEvaluated += ev.contractsEvaluated;
      if (ev.rejectedBeforeOptions) rejectedBeforeOptions += 1;
      await db.from("bot_scan_candidates").upsert(
        {
          user_id: s.user_id, scan_date: today, ticker,
          score: ev.best?.score ?? 0, best: ev.best ?? null, rejection: ev.rejection ?? null,
        },
        { onConflict: "user_id,scan_date,ticker" }
      );
    } catch (e) {
      console.error("ticker eval failed", ticker, e);
      await db.from("bot_scan_candidates").upsert(
        { user_id: s.user_id, scan_date: today, ticker, score: 0, best: null, rejection: { ticker, reason: "Data error (INSUFFICIENT_DATA)", simpleAnnualized: null } },
        { onConflict: "user_id,scan_date,ticker" }
      );
    }
    cursor += 1;
    processed += 1;
  }

  await db
    .from("bot_scan_state")
    .update({
      cursor,
      contracts_evaluated: (state.contracts_evaluated ?? 0) + contractsEvaluated,
      rejected_before_options: (state.rejected_before_options ?? 0) + rejectedBeforeOptions,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", s.user_id);

  if (cursor < universe.length) {
    await db.from("bot_runs").insert({
      user_id: s.user_id, trigger, status: "partial",
      candidates_evaluated: contractsEvaluated, proposals_created: 0,
      message: `scanned ${cursor}/${universe.length}`,
    });
    return { partial: true, cursor, universe: universe.length };
  }

  // ── Finalize: universe fully scanned → rank + publish. ──
  return await finalize(db, s, config, universe.length);
}

async function finalize(db: ReturnType<typeof adminClient>, s: any, config: BotConfig, universeSize: number) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: rows } = await db
    .from("bot_scan_candidates")
    .select("best, rejection")
    .eq("user_id", s.user_id)
    .eq("scan_date", today);

  const bests: ScoredTrade[] = [];
  const rejections: RejectedTrade[] = [];
  for (const r of rows ?? []) {
    if (r.best) bests.push(r.best as ScoredTrade);
    if (r.rejection) rejections.push(r.rejection as RejectedTrade);
  }

  const { data: st } = await db.from("bot_scan_state").select("*").eq("user_id", s.user_id).maybeSingle();
  const counts = {
    universe: universeSize, scanned: universeSize,
    rejectedBeforeOptions: st?.rejected_before_options ?? 0,
    contractsEvaluated: st?.contracts_evaluated ?? 0,
    passedHardFilters: bests.length,
  };
  const dataWarnings = st?.spy_return20 == null ? ["SPY benchmark unavailable — relative-strength scored neutrally."] : [];
  const report = rankAndReport(bests, rejections, config, counts, dataWarnings);

  // A fresh published set supersedes any still-undecided proposals.
  await db.from("bot_proposals").update({ status: "expired" }).eq("user_id", s.user_id).eq("status", "proposed");

  const { data: run } = await db
    .from("bot_runs")
    .insert({
      user_id: s.user_id, trigger: "cron", status: "ok",
      candidates_evaluated: counts.contractsEvaluated, proposals_created: report.published.length, report,
    })
    .select("id")
    .single();

  if (report.published.length) {
    const { error: insErr } = await db.from("bot_proposals").insert(
      report.published.map((p) => ({
        user_id: s.user_id, run_id: run?.id ?? null,
        ticker: p.ticker, strategy: "cash_secured_put", strike: p.strike, expiration: p.expiration,
        contracts: p.contracts, option_symbol: p.optionSymbol, limit_price: p.suggestedLimit,
        est_premium: Math.round(p.bid * 100 * p.contracts), capital_required: p.netCashRequirement,
        score: p.score, tier: p.tier, rationale: p.rationale,
        criteria: { components: p.components, principalRisk: p.principalRisk, missReason: p.missReason }, details: p,
      }))
    );
    if (insErr) throw insErr;
  }

  return { complete: true, published: report.published.length, universe: universeSize };
}

// Gather everything the engine needs for one ticker. Earnings come from the
// per-scan calendar map (fetched once), not a per-ticker call.
async function buildTickerInput(
  accessToken: string,
  ticker: string,
  config: BotConfig,
  fromISO: string,
  toISO: string,
  earningsMap: Record<string, string>,
  earningsAvailable: boolean
): Promise<TickerInput> {
  const schwabSym = toSchwabSymbol(ticker);
  const [rawCandles, fundamentals, chain] = await Promise.all([
    getPriceHistory(accessToken, schwabSym),
    getInstrumentFundamentals(accessToken, schwabSym),
    getOptionChain(accessToken, schwabSym, { contractType: "PUT", range: "OTM", strikeCount: 30, fromDate: fromISO, toDate: toISO }),
  ]);

  const candles: Candle[] = (rawCandles as any[]).map((c) => ({
    datetime: Number(c.datetime), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume),
  }));
  const options = optionCandidatesFromChain(chain);
  const currentPrice = candles.length ? candles[candles.length - 1].close : Number(chain?.underlyingPrice ?? 0);

  return {
    ticker,
    name: ticker,
    sector: APPROVED_SECTORS[ticker] ?? null,
    currentPrice,
    candles,
    fundamentals,
    options,
    earningsDate: earningsMap[ticker] ?? null,
    // If the calendar was fetched, a ticker absent from it simply has no upcoming
    // earnings in the window (safe); if the calendar is unavailable, fail closed.
    earningsKnown: earningsAvailable,
  };
}

async function computeSpyReturn20(accessToken: string): Promise<number | null> {
  try {
    const raw = await getPriceHistory(accessToken, "SPY");
    const cl = (raw as any[]).map((c) => Number(c.close));
    return pctReturn(cl, 20);
  } catch (e) {
    console.error("SPY history failed", e);
    return null;
  }
}

function buildConfig(s: any): BotConfig {
  const c = (s.config ?? {}) as Record<string, unknown>;
  const n = (key: string, fallback: number) => (typeof c[key] === "number" ? (c[key] as number) : fallback);
  return {
    ...DEFAULT_BOT_CONFIG,
    maxTradesPerDay: typeof s.max_trades_per_day === "number" ? s.max_trades_per_day : 5,
    maxPositionSize: n("maxPositionSize", DEFAULT_BOT_CONFIG.maxPositionSize),
    contractsPerTrade: n("contractsPerTrade", 1),
    minDte: n("minDte", DEFAULT_BOT_CONFIG.minDte),
    maxDte: n("maxDte", DEFAULT_BOT_CONFIG.maxDte),
    minDelta: n("minDelta", DEFAULT_BOT_CONFIG.minDelta),
    maxDelta: n("maxDelta", DEFAULT_BOT_CONFIG.maxDelta),
    minAnnualizedReturn: n("minAnnualizedReturn", DEFAULT_BOT_CONFIG.minAnnualizedReturn),
    publishThreshold: n("publishThreshold", DEFAULT_BOT_CONFIG.publishThreshold),
  };
}

async function ensureToken(db: ReturnType<typeof adminClient>, acct: any): Promise<string> {
  let accessToken = await decryptToken(acct.encrypted_access_token);
  const expMs = acct.token_expires_at ? new Date(acct.token_expires_at).getTime() : 0;
  if (expMs - Date.now() < REFRESH_SKEW_MS) {
    const refresh = await decryptToken(acct.encrypted_refresh_token);
    const tokens = await refreshTokens(refresh);
    accessToken = tokens.access_token;
    await db
      .from("connected_accounts")
      .update({
        encrypted_access_token: await encryptToken(tokens.access_token),
        encrypted_refresh_token: await encryptToken(tokens.refresh_token),
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        needs_reauth: false,
      })
      .eq("id", acct.id);
  }
  return accessToken;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
