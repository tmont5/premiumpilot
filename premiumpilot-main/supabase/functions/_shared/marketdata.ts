// External market-data provider for data Schwab doesn't supply — earnings dates
// (a hard event filter). Provider + key come from env:
//   MARKET_DATA_PROVIDER  (default "alphavantage")
//   MARKET_DATA_API_KEY   (required; without it earnings are "unavailable" and
//                          the bot fails closed on the event filter, per spec)
// Set these as Supabase Edge Function secrets.
//
// Alpha Vantage's EARNINGS_CALENDAR returns the WHOLE market's upcoming earnings
// as CSV in a single request (free tier ~25 req/day), so we fetch it ONCE per
// scan, filter to the approved universe, and reuse the map across chunks.

export interface EarningsCalendar {
  available: boolean; // false → provider failed/unset → event filter rejects
  map: Record<string, string>; // TICKER → next earnings date (ISO), upcoming only
}

const UNAVAILABLE: EarningsCalendar = { available: false, map: {} };

export async function fetchEarningsCalendar(symbols: string[]): Promise<EarningsCalendar> {
  const key = Deno.env.get("MARKET_DATA_API_KEY");
  if (!key) return UNAVAILABLE;
  const provider = (Deno.env.get("MARKET_DATA_PROVIDER") ?? "alphavantage").toLowerCase();
  try {
    if (provider === "alphavantage") return await alphaVantageCalendar(symbols, key);
    console.error("unsupported MARKET_DATA_PROVIDER for bulk earnings", provider);
    return UNAVAILABLE;
  } catch (e) {
    console.error("earnings calendar fetch failed", e);
    return UNAVAILABLE;
  }
}

async function alphaVantageCalendar(symbols: string[], key: string): Promise<EarningsCalendar> {
  const wanted = new Set(symbols.map((s) => s.toUpperCase()));
  const url = `https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey=${key}`;
  const res = await fetch(url);
  if (!res.ok) return UNAVAILABLE;
  const text = await res.text();
  // On rate-limit / error Alpha Vantage returns a JSON note instead of CSV.
  if (text.trimStart().startsWith("{")) {
    console.error("alphavantage note:", text.slice(0, 200));
    return UNAVAILABLE;
  }

  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { available: true, map: {} };
  const header = lines[0].split(",").map((h) => h.trim());
  const symIdx = header.indexOf("symbol");
  const dateIdx = header.indexOf("reportDate");
  if (symIdx < 0 || dateIdx < 0) return UNAVAILABLE;

  const today = new Date().toISOString().slice(0, 10);
  const map: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const sym = (cols[symIdx] ?? "").toUpperCase().trim();
    const date = (cols[dateIdx] ?? "").trim();
    if (!wanted.has(sym)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today) continue;
    if (!map[sym] || date < map[sym]) map[sym] = date; // earliest upcoming
  }
  return { available: true, map };
}
