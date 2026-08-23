// Approved wheel-strategy universe (spec §3). Authoritative curated list of
// S&P 500 constituents the bot may trade. Dated via git history; edit here to
// change membership. bot_settings.universe may NARROW this (empty = scan all).
export const APPROVED_UNIVERSE: string[] = [
  // Technology
  "AAPL", "MSFT", "NVDA", "AVGO", "AMD", "ORCL", "CRM", "CSCO",
  "IBM", "INTC", "QCOM", "TXN", "AMAT", "LRCX", "KLAC", "MU",
  "ADI", "NXPI", "MCHP", "MPWR", "CDNS", "SNPS", "ADSK", "ANET",
  "PANW", "CRWD", "FTNT", "NOW", "PLTR", "ACN", "ADP", "INTU",
  "PAYX", "FIS", "FI", "HPQ", "HPE", "DELL", "STX", "WDC",
  // Communication Services
  "GOOGL", "META", "NFLX", "DIS", "CMCSA", "T", "VZ", "TMUS",
  "CHTR", "EA", "TTWO", "OMC",
  // Consumer Discretionary
  "AMZN", "TSLA", "HD", "LOW", "MCD", "SBUX", "BKNG", "MAR",
  "HLT", "RCL", "CCL", "NKE", "TJX", "ROST", "ORLY", "AZO",
  "GM", "F", "ABNB", "DRI", "YUM", "LEN", "DHI", "CVNA",
  // Consumer Staples
  "WMT", "COST", "PG", "KO", "PEP", "PM", "MO", "MDLZ", "CL",
  "KMB", "KHC", "KR", "SYY", "STZ", "HSY", "EL", "TSN", "CAG",
  // Health Care
  "LLY", "JNJ", "ABBV", "UNH", "MRK", "TMO", "ABT", "AMGN",
  "GILD", "PFE", "DHR", "ISRG", "BSX", "SYK", "MDT", "VRTX",
  "REGN", "CI", "CVS", "ELV", "HCA", "ZTS", "BDX", "EW",
  "IDXX", "IQV", "GEHC", "DXCM", "BIIB", "ALGN",
  // Financials
  "JPM", "BRK.B", "V", "MA", "BAC", "WFC", "C", "GS", "MS",
  "AXP", "BLK", "SCHW", "COF", "USB", "PNC", "TFC", "BK", "STT",
  "SPGI", "MCO", "CME", "ICE", "CB", "PGR", "ALL", "AIG", "TRV",
  "MET", "PRU", "AFL", "MMC", "AON", "AJG", "ARES", "KKR",
  // Industrials
  "GE", "CAT", "RTX", "BA", "HON", "UNP", "UPS", "DE", "LMT",
  "ETN", "PH", "WM", "GD", "NOC", "MMM", "EMR", "ITW", "CSX",
  "NSC", "FDX", "CARR", "OTIS", "FAST", "PCAR", "ROK", "URI",
  "AME", "IR", "VRT", "FIX", "UBER",
  // Energy
  "XOM", "CVX", "COP", "EOG", "SLB", "MPC", "PSX", "VLO",
  "OXY", "WMB", "KMI", "HAL", "BKR",
  // Materials
  "LIN", "SHW", "APD", "ECL", "NEM", "FCX", "NUE", "STLD",
  "DOW", "DD", "PPG", "MLM",
  // Utilities
  "NEE", "SO", "DUK", "CEG", "AEP", "SRE", "D", "EXC", "XEL",
  "ED", "PEG",
  // Real Estate
  "PLD", "AMT", "EQIX", "WELL", "SPG", "O", "DLR", "PSA",
  "VICI", "CBRE",
];

// Sector lookup for the approved names (used for the ≤2-per-sector control and
// diversification). Kept in step with the groupings above.
export const APPROVED_SECTORS: Record<string, string> = Object.fromEntries([
  ...group("Technology", ["AAPL", "MSFT", "NVDA", "AVGO", "AMD", "ORCL", "CRM", "CSCO", "IBM", "INTC", "QCOM", "TXN", "AMAT", "LRCX", "KLAC", "MU", "ADI", "NXPI", "MCHP", "MPWR", "CDNS", "SNPS", "ADSK", "ANET", "PANW", "CRWD", "FTNT", "NOW", "PLTR", "ACN", "ADP", "INTU", "PAYX", "FIS", "FI", "HPQ", "HPE", "DELL", "STX", "WDC"]),
  ...group("Communication Services", ["GOOGL", "META", "NFLX", "DIS", "CMCSA", "T", "VZ", "TMUS", "CHTR", "EA", "TTWO", "OMC"]),
  ...group("Consumer Discretionary", ["AMZN", "TSLA", "HD", "LOW", "MCD", "SBUX", "BKNG", "MAR", "HLT", "RCL", "CCL", "NKE", "TJX", "ROST", "ORLY", "AZO", "GM", "F", "ABNB", "DRI", "YUM", "LEN", "DHI", "CVNA"]),
  ...group("Consumer Staples", ["WMT", "COST", "PG", "KO", "PEP", "PM", "MO", "MDLZ", "CL", "KMB", "KHC", "KR", "SYY", "STZ", "HSY", "EL", "TSN", "CAG"]),
  ...group("Health Care", ["LLY", "JNJ", "ABBV", "UNH", "MRK", "TMO", "ABT", "AMGN", "GILD", "PFE", "DHR", "ISRG", "BSX", "SYK", "MDT", "VRTX", "REGN", "CI", "CVS", "ELV", "HCA", "ZTS", "BDX", "EW", "IDXX", "IQV", "GEHC", "DXCM", "BIIB", "ALGN"]),
  ...group("Financials", ["JPM", "BRK.B", "V", "MA", "BAC", "WFC", "C", "GS", "MS", "AXP", "BLK", "SCHW", "COF", "USB", "PNC", "TFC", "BK", "STT", "SPGI", "MCO", "CME", "ICE", "CB", "PGR", "ALL", "AIG", "TRV", "MET", "PRU", "AFL", "MMC", "AON", "AJG", "ARES", "KKR"]),
  ...group("Industrials", ["GE", "CAT", "RTX", "BA", "HON", "UNP", "UPS", "DE", "LMT", "ETN", "PH", "WM", "GD", "NOC", "MMM", "EMR", "ITW", "CSX", "NSC", "FDX", "CARR", "OTIS", "FAST", "PCAR", "ROK", "URI", "AME", "IR", "VRT", "FIX", "UBER"]),
  ...group("Energy", ["XOM", "CVX", "COP", "EOG", "SLB", "MPC", "PSX", "VLO", "OXY", "WMB", "KMI", "HAL", "BKR"]),
  ...group("Materials", ["LIN", "SHW", "APD", "ECL", "NEM", "FCX", "NUE", "STLD", "DOW", "DD", "PPG", "MLM"]),
  ...group("Utilities", ["NEE", "SO", "DUK", "CEG", "AEP", "SRE", "D", "EXC", "XEL", "ED", "PEG"]),
  ...group("Real Estate", ["PLD", "AMT", "EQIX", "WELL", "SPG", "O", "DLR", "PSA", "VICI", "CBRE"]),
]);

function group(sector: string, tickers: string[]): [string, string][] {
  return tickers.map((t) => [t, sector]);
}

// Schwab uses a slash for class shares (BRK.B → BRK/B) on some endpoints.
export function toSchwabSymbol(ticker: string): string {
  return ticker.replace(".", "/");
}
