// External market-data provider for data Schwab doesn't supply — currently
// earnings dates (a hard event filter). Provider + key come from env:
//   MARKET_DATA_PROVIDER  (default "finnhub")
//   MARKET_DATA_API_KEY   (required; without it earnings are "unknown" and the
//                          bot fails closed on the event filter, per the spec)
//
// Set these as Supabase Edge Function secrets. Add providers below as needed.

export interface EarningsInfo {
  known: boolean; // false → provider unavailable → event filter rejects
  date: string | null; // next earnings date (ISO) or null if none upcoming
}

const UNKNOWN: EarningsInfo = { known: false, date: null };

export async function getNextEarningsDate(symbol: string, fromISO: string, toISO: string): Promise<EarningsInfo> {
  const key = Deno.env.get("MARKET_DATA_API_KEY");
  if (!key) return UNKNOWN;
  const provider = (Deno.env.get("MARKET_DATA_PROVIDER") ?? "finnhub").toLowerCase();
  try {
    if (provider === "finnhub") return await finnhub(symbol, fromISO, toISO, key);
    if (provider === "fmp") return await fmp(symbol, key);
    console.error("unknown MARKET_DATA_PROVIDER", provider);
    return UNKNOWN;
  } catch (e) {
    console.error("earnings fetch failed", symbol, e);
    return UNKNOWN;
  }
}

async function finnhub(symbol: string, fromISO: string, toISO: string, key: string): Promise<EarningsInfo> {
  const url = `https://finnhub.io/api/v1/calendar/earnings?symbol=${encodeURIComponent(symbol)}&from=${fromISO}&to=${toISO}&token=${key}`;
  const res = await fetch(url);
  if (!res.ok) return UNKNOWN;
  const data = await res.json();
  const rows: any[] = Array.isArray(data?.earningsCalendar) ? data.earningsCalendar : [];
  const upcoming = rows
    .map((r) => String(r?.date ?? ""))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= fromISO)
    .sort();
  return { known: true, date: upcoming[0] ?? null };
}

async function fmp(symbol: string, key: string): Promise<EarningsInfo> {
  const url = `https://financialmodelingprep.com/api/v3/historical/earning_calendar/${encodeURIComponent(symbol)}?limit=8&apikey=${key}`;
  const res = await fetch(url);
  if (!res.ok) return UNKNOWN;
  const rows: any[] = await res.json();
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (Array.isArray(rows) ? rows : [])
    .map((r) => String(r?.date ?? ""))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today)
    .sort();
  return { known: true, date: upcoming[0] ?? null };
}
