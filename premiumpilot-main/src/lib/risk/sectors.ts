// Static ticker → sector lookup (PRD §7.2). The Schwab position payload doesn't
// carry sector, and the data model has no column for it, so the risk engine
// resolves sector from this table. Unknown tickers are intentionally left
// untagged: the engine excludes them from sector aggregation and surfaces a
// data-quality note rather than assuming a bucket (PRD §4.3 graceful degradation).
//
// Covers the demo book plus common large caps. Extend as the live book grows.
const TICKER_SECTORS: Record<string, string> = {
  // Demo portfolio
  ADBE: "Technology",
  ORCL: "Technology",
  PLTR: "Technology",
  CRM: "Technology",
  NOW: "Technology",
  ARES: "Financials",
  SOFI: "Financials",
  HOOD: "Financials",
  KHC: "Consumer Staples",
  ASST: "Communication Services",
  // Common large caps
  AAPL: "Technology",
  MSFT: "Technology",
  NVDA: "Technology",
  AMD: "Technology",
  AVGO: "Technology",
  INTC: "Technology",
  INTU: "Technology",
  CSCO: "Technology",
  GOOGL: "Communication Services",
  GOOG: "Communication Services",
  META: "Communication Services",
  NFLX: "Communication Services",
  DIS: "Communication Services",
  T: "Communication Services",
  VZ: "Communication Services",
  AMZN: "Consumer Discretionary",
  TSLA: "Consumer Discretionary",
  HD: "Consumer Discretionary",
  NKE: "Consumer Discretionary",
  MCD: "Consumer Discretionary",
  SBUX: "Consumer Discretionary",
  WMT: "Consumer Staples",
  COST: "Consumer Staples",
  PG: "Consumer Staples",
  KO: "Consumer Staples",
  PEP: "Consumer Staples",
  JPM: "Financials",
  BAC: "Financials",
  WFC: "Financials",
  GS: "Financials",
  MS: "Financials",
  V: "Financials",
  MA: "Financials",
  PYPL: "Financials",
  COIN: "Financials",
  BRK: "Financials",
  UNH: "Health Care",
  JNJ: "Health Care",
  LLY: "Health Care",
  PFE: "Health Care",
  MRK: "Health Care",
  ABBV: "Health Care",
  XOM: "Energy",
  CVX: "Energy",
  COP: "Energy",
  BA: "Industrials",
  CAT: "Industrials",
  GE: "Industrials",
  UPS: "Industrials",
  LMT: "Industrials",
  NEE: "Utilities",
  DUK: "Utilities",
  LIN: "Materials",
  FCX: "Materials",
  PLD: "Real Estate",
  AMT: "Real Estate",
};

// Sector for a ticker, or null when we can't classify it (caller must degrade
// gracefully — see PRD §7.2).
export function sectorFor(ticker: string, override?: string | null): string | null {
  if (override && override.trim().length) return override;
  return TICKER_SECTORS[ticker.toUpperCase()] ?? null;
}
