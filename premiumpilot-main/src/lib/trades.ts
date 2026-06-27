import type { AccountTransaction, PremiumHistoryEntry, Trade, TradeOutcome } from "./types";

// Schwab's transaction feed doesn't return a per-trade realized gain/loss, so we
// reconstruct it from option cash flows. Every option transaction is grouped by
// its contract symbol; once a contract has a closing leg (a buy-to-close debit,
// or an expiration/assignment record) its realized P/L is the net cash across
// all of that contract's legs — premiums received minus buybacks, with an
// expired contract simply keeping its opening credit. Contracts with no closing
// leg are still open and live in `positions`, not here.
export function deriveClosedOptionTrades(transactions: AccountTransaction[]): Trade[] {
  const groups = new Map<string, AccountTransaction[]>();
  for (const tx of transactions) {
    if (tx.asset_type !== "OPTION" || !tx.symbol) continue;
    const list = groups.get(tx.symbol) ?? [];
    list.push(tx);
    groups.set(tx.symbol, list);
  }

  const trades: Trade[] = [];
  for (const [symbol, legs] of groups) {
    legs.sort((a, b) => a.transaction_time.localeCompare(b.transaction_time));
    const closing = legs.filter(isClosingLeg);
    if (closing.length === 0) continue; // still open

    const premium = legs.filter((l) => l.net_amount > 0).reduce((s, l) => s + l.net_amount, 0);
    const cost = legs.filter((l) => l.net_amount < 0).reduce((s, l) => s - l.net_amount, 0);
    const opened = legs.find((l) => l.net_amount > 0) ?? legs[0];
    const last = closing[closing.length - 1];

    trades.push({
      id: last.id,
      connected_account_id: last.connected_account_id,
      ticker: parseUnderlying(symbol) ?? symbol,
      strategy: isPutSymbol(symbol) ? "cash_secured_put" : "covered_call",
      strike: parseStrike(symbol),
      contracts: Math.max(0, ...legs.map((l) => Math.abs(l.quantity ?? 0))),
      opened_at: opened?.transaction_time ?? null,
      closed_at: last.transaction_time,
      premium_collected: premium,
      cost_to_close: cost,
      realized_pnl: premium - cost,
      outcome: outcomeFor(closing),
    });
  }

  return trades.sort((a, b) => b.closed_at.localeCompare(a.closed_at));
}

// Maps closed trades into realized-income entries for the Income page rollups.
export function realizedIncomeFromTrades(trades: Trade[]): PremiumHistoryEntry[] {
  return trades.map((t) => ({
    id: t.id,
    user_id: "",
    connected_account_id: t.connected_account_id,
    ticker: t.ticker,
    premium_amount: t.realized_pnl,
    realized_at: t.closed_at,
  }));
}

function isClosingLeg(tx: AccountTransaction): boolean {
  // A buy-to-close (cash debit) or an expiration/assignment record closes a short option.
  return tx.net_amount < 0 || isReceiveDeliver(tx);
}

function isReceiveDeliver(tx: AccountTransaction): boolean {
  const text = `${tx.type ?? ""} ${tx.description ?? ""}`.toUpperCase();
  return /RECEIVE|DELIVER|EXPIR|ASSIGN/.test(text);
}

function outcomeFor(closing: AccountTransaction[]): TradeOutcome {
  const text = closing.map((c) => `${c.type ?? ""} ${c.description ?? ""}`).join(" ").toUpperCase();
  if (/ASSIGN/.test(text)) return "assigned";
  if (/EXPIR/.test(text)) return "expired";
  return "closed";
}

// OCC-style symbol, e.g. "AAPL  260116C00185000": last 8 digits are strike * 1000.
function isPutSymbol(symbol: string): boolean {
  return /\d{6}P\d{8}$/.test(symbol);
}

function parseStrike(symbol: string): number {
  const match = symbol.match(/[CP](\d{8})$/);
  return match ? Number(match[1]) / 1000 : 0;
}

function parseUnderlying(symbol: string): string | null {
  const match = symbol.match(/^([A-Z.]+)\s+\d{6}[CP]\d{8}$/);
  return match?.[1] ?? null;
}
