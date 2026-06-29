/* eslint-disable @typescript-eslint/no-explicit-any */
// Charles Schwab API client (PRD §5). OAuth 2.0 authorization-code flow with
// automatic refresh. All calls run server-side in Edge Functions.
//
// Required Edge Function secrets:
//   SCHWAB_CLIENT_ID, SCHWAB_CLIENT_SECRET, SCHWAB_REDIRECT_URI
//
// Endpoints follow Schwab's Trader API (api.schwabapi.com). Field mapping into
// our `positions` shape is centralized in mapPositions().

const AUTH_BASE = "https://api.schwabapi.com/v1/oauth";
const TRADER_BASE = "https://api.schwabapi.com/trader/v1";
const MARKETDATA_BASE = "https://api.schwabapi.com/marketdata/v1";

function clientCreds() {
  const id = Deno.env.get("SCHWAB_CLIENT_ID");
  const secret = Deno.env.get("SCHWAB_CLIENT_SECRET");
  const redirect = Deno.env.get("SCHWAB_REDIRECT_URI");
  if (!id || !secret || !redirect) throw new Error("Schwab credentials are not configured");
  return { id, secret, redirect, basic: btoa(`${id}:${secret}`) };
}

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
}

// Step 1 of the auth-code flow: the URL we send the user to.
export function authorizeUrl(state: string): string {
  const { id, redirect } = clientCreds();
  const u = new URL(`${AUTH_BASE}/authorize`);
  u.searchParams.set("client_id", id);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "readonly");
  u.searchParams.set("state", state);
  return u.toString();
}

// Step 2: exchange the authorization code for tokens.
export async function exchangeCode(code: string): Promise<TokenSet> {
  const { basic, redirect } = clientCreds();
  const res = await fetch(`${AUTH_BASE}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
    }),
  });
  if (!res.ok) throw new Error(`Schwab token exchange failed: ${res.status}`);
  return res.json();
}

// Refresh an access token using a stored refresh token.
export async function refreshTokens(refreshToken: string): Promise<TokenSet> {
  const { basic } = clientCreds();
  const res = await fetch(`${AUTH_BASE}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error(`Schwab token refresh failed: ${res.status}`);
  return res.json();
}

async function authedGet(path: string, accessToken: string) {
  const res = await fetch(`${TRADER_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Schwab GET ${path} failed: ${res.status}`);
  return res.json();
}

// Accounts + positions with balances (PRD §5 data import).
export async function getAccounts(accessToken: string) {
  try {
    return await authedGet(`/accounts?fields=positions`, accessToken);
  } catch (error) {
    console.error("Schwab accounts-with-positions fetch failed; retrying accounts only", error);
    return authedGet(`/accounts`, accessToken);
  }
}

export function getOrders(accessToken: string, accountHash: string) {
  return authedGet(`/accounts/${accountHash}/orders`, accessToken);
}

export async function getAccountNumbers(accessToken: string) {
  try {
    return await authedGet("/accounts/accountNumbers", accessToken);
  } catch (error) {
    console.error("Schwab accountNumbers fetch failed", error);
    return [];
  }
}

// Fetch transactions in a date window. Schwab caps each request at ~1 year and
// takes a single `types` value, so callers page by window and activity type.
// Omitting `type` returns all activity types.
export function getTransactions(
  accessToken: string,
  accountHash: string,
  startDate: string,
  endDate: string,
  type?: string
) {
  const params = new URLSearchParams({ startDate, endDate });
  if (type) params.set("types", type);
  return authedGet(`/accounts/${accountHash}/transactions?${params.toString()}`, accessToken);
}

async function authedGetMarket(path: string, accessToken: string) {
  const res = await fetch(`${MARKETDATA_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Schwab market GET ${path} failed: ${res.status}`);
  return res.json();
}

// Market Data API quotes (PRD §5). Returns an object keyed by symbol. Equity
// quotes carry a price; option quotes additionally carry greeks (delta) and the
// underlying price. Symbols are batched to stay within request limits.
export async function getQuotes(accessToken: string, symbols: string[]): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  const unique = [...new Set(symbols.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const params = new URLSearchParams({ symbols: chunk.join(","), fields: "quote" });
    try {
      const data = await authedGetMarket(`/quotes?${params.toString()}`, accessToken);
      if (data && typeof data === "object") Object.assign(out, data);
    } catch (e) {
      console.error("Schwab quotes fetch failed", e);
    }
  }
  return out;
}

// The symbols we need quotes for: option contracts (for greeks/delta) and the
// underlying + equity tickers (for prices).
// deno-lint-ignore no-explicit-any
export function symbolsForQuotes(account: any): { equity: string[]; option: string[] } {
  // deno-lint-ignore no-explicit-any
  const positions: any[] = account?.securitiesAccount?.positions ?? [];
  const equity = new Set<string>();
  const option = new Set<string>();
  for (const pos of positions) {
    const inst = pos.instrument ?? {};
    if (inst.assetType === "OPTION") {
      if (inst.symbol) option.add(inst.symbol);
      const u = inst.underlyingSymbol ?? parseUnderlyingFromOptionSymbol(inst.symbol);
      if (u) equity.add(u);
    } else if (inst.assetType === "EQUITY" || inst.assetType === "COLLECTIVE_INVESTMENT") {
      if (inst.symbol) equity.add(inst.symbol);
    }
  }
  return { equity: [...equity], option: [...option] };
}

// symbol -> best available price (mark, then last, then prior close).
export function buildPriceMap(quotes: Record<string, any>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [symbol, entry] of Object.entries(quotes)) {
    const q = (entry as any)?.quote ?? {};
    const price = number(q.mark) || number(q.lastPrice) || number(q.closePrice);
    if (price) out[symbol] = price;
  }
  return out;
}

// option symbol -> delta (greeks are returned on option quotes).
export function buildDeltaMap(quotes: Record<string, any>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [symbol, entry] of Object.entries(quotes)) {
    if ((entry as any)?.assetMainType !== "OPTION") continue;
    const d = (entry as any)?.quote?.delta;
    if (typeof d === "number" && Number.isFinite(d)) out[symbol] = d;
  }
  return out;
}

export function accountHashByNumber(accountNumbers: any[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of accountNumbers ?? []) {
    const accountNumber = row.accountNumber ?? row.account_number;
    const hash = row.hashValue ?? row.hash_value;
    if (accountNumber && hash) out[String(accountNumber)] = String(hash);
  }
  return out;
}

// Map a Schwab account's option positions into our `positions` insert shape.
// Schwab returns securitiesAccount.positions[]; option instruments carry
// putCall, strikePrice, and underlyingSymbol on the instrument.
export interface MappedPosition {
  ticker: string;
  strategy: "cash_secured_put" | "covered_call";
  strike: number;
  expiration: string;
  contracts: number;
  premium_collected: number;
  current_option_value: number;
  current_underlying_price: number;
  delta: number;
  capital_requirement: number;
}

// deno-lint-ignore no-explicit-any
export function mapPositions(
  account: any,
  underlyingPrices: Record<string, number>,
  optionDeltas: Record<string, number> = {}
): MappedPosition[] {
  // deno-lint-ignore no-explicit-any
  const positions: any[] = account?.securitiesAccount?.positions ?? [];
  const out: MappedPosition[] = [];
  for (const pos of positions) {
    const inst = pos.instrument ?? {};
    if (inst.assetType !== "OPTION") continue;
    const isPut = inst.putCall === "PUT";
    const ticker: string = inst.underlyingSymbol ?? parseUnderlyingFromOptionSymbol(inst.symbol) ?? inst.symbol;
    const strike = Number(inst.strikePrice ?? 0);
    const contracts = Math.abs(Number(pos.shortQuantity ?? pos.longQuantity ?? 0));
    const expiration = optionExpiration(inst);
    if (!ticker || !strike || !contracts || !expiration) continue;
    const underlying = underlyingPrices[ticker] ?? 0;
    const premium = Math.abs(Number(pos.averagePrice ?? 0)) * contracts * 100;
    const marketVal = Math.abs(Number(pos.marketValue ?? 0));
    // Greeks come from the Market Data quote; fall back to anything on the
    // position payload (usually absent), then 0.
    const delta = optionDeltas[inst.symbol] ?? Number(inst.optionDeltas?.delta ?? pos.delta ?? 0);
    out.push({
      ticker,
      strategy: isPut ? "cash_secured_put" : "covered_call",
      strike,
      expiration,
      contracts,
      premium_collected: premium,
      current_option_value: marketVal,
      current_underlying_price: underlying,
      delta,
      capital_requirement: isPut ? strike * 100 * contracts : underlying * 100 * contracts,
    });
  }
  return out;
}

// Map a Schwab account's long equity/ETF lots. We can't distinguish shares that
// arrived via put assignment from shares simply bought, so every long stock lot
// is treated as a holding backing the income strategy. Current price is derived
// from market value; cost basis is Schwab's averagePrice.
export interface MappedEquity {
  ticker: string;
  shares: number;
  cost_basis_per_share: number;
  current_price: number;
}

// deno-lint-ignore no-explicit-any
export function mapEquityPositions(account: any, prices: Record<string, number> = {}): MappedEquity[] {
  // deno-lint-ignore no-explicit-any
  const positions: any[] = account?.securitiesAccount?.positions ?? [];
  const out: MappedEquity[] = [];
  for (const pos of positions) {
    const inst = pos.instrument ?? {};
    if (inst.assetType !== "EQUITY" && inst.assetType !== "COLLECTIVE_INVESTMENT") continue;
    const ticker: string = inst.symbol ?? "";
    const shares = Number(pos.longQuantity ?? 0);
    if (!ticker || shares <= 0) continue;
    const costBasis = Math.abs(Number(pos.averagePrice ?? 0));
    const marketValue = Math.abs(Number(pos.marketValue ?? 0));
    // Prefer the live quote; fall back to the position's market value, then basis.
    const current = prices[ticker] || (marketValue > 0 ? marketValue / shares : costBasis);
    out.push({
      ticker,
      shares,
      cost_basis_per_share: costBasis,
      current_price: current,
    });
  }
  return out;
}

export interface MappedTransaction {
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
  raw: any;
}

export function mapTransactions(transactions: any[]): MappedTransaction[] {
  const out: MappedTransaction[] = [];
  for (const tx of transactions ?? []) {
    const items = Array.isArray(tx.transferItems) ? tx.transferItems : [];
    // Prefer the option leg: expirations/assignments (RECEIVE_AND_DELIVER) carry
    // both an OPTION and an EQUITY transferItem, and we key realized P/L off the
    // option contract.
    const item = items.find((i: any) => i?.instrument?.assetType === "OPTION") ?? items[0] ?? null;
    const instrument = item?.instrument ?? tx.instrument ?? {};
    const time = tx.time ?? tx.transactionDate ?? tx.settlementDate ?? tx.orderDate;
    if (!time) continue;

    out.push({
      schwab_activity_id: transactionId(tx),
      type: nullableString(tx.type),
      status: nullableString(tx.status),
      description: nullableString(tx.description),
      symbol: nullableString(instrument.symbol),
      asset_type: nullableString(instrument.assetType),
      transaction_time: new Date(time).toISOString(),
      net_amount: number(tx.netAmount ?? tx.net_amount),
      realized_gain_loss: nullableNumber(
        tx.realizedGainLoss ?? tx.realized_gain_loss ?? tx.realizedGainLossAmount
      ),
      fees: nullableNumber(tx.fees ?? tx.fee),
      price: nullableNumber(item?.price ?? tx.price),
      quantity: nullableNumber(item?.amount ?? item?.quantity ?? tx.quantity),
      raw: tx,
    });
  }
  return out;
}

export function optionPremiumEvents(transactions: MappedTransaction[]) {
  return transactions
    .filter((tx) => tx.asset_type === "OPTION" && tx.net_amount > 0)
    .map((tx) => ({
      ticker: parseUnderlyingFromOptionSymbol(tx.symbol) ?? tx.symbol ?? "OPTION",
      premium_amount: tx.net_amount,
      realized_at: tx.transaction_time,
    }));
}

function optionExpiration(inst: any): string | null {
  const direct = inst.optionExpirationDate ?? inst.expirationDate ?? inst.maturityDate;
  if (typeof direct === "string" && /^\d{4}-\d{2}-\d{2}/.test(direct)) return direct.slice(0, 10);

  const symbol = String(inst.symbol ?? "");
  const match = symbol.match(/\s(\d{6})[CP]\d{8}$/);
  if (!match) return null;

  const yy = Number(match[1].slice(0, 2));
  const mm = match[1].slice(2, 4);
  const dd = match[1].slice(4, 6);
  return `${yy >= 70 ? "19" : "20"}${match[1].slice(0, 2)}-${mm}-${dd}`;
}

function parseUnderlyingFromOptionSymbol(symbol: unknown): string | null {
  if (typeof symbol !== "string") return null;
  const match = symbol.match(/^([A-Z.]+)\s+\d{6}[CP]\d{8}$/);
  return match?.[1] ?? null;
}

function transactionId(tx: any): string {
  return String(
    tx.activityId ??
      tx.activity_id ??
      tx.transactionId ??
      tx.transaction_id ??
      tx.orderId ??
      [tx.time, tx.type, tx.description, tx.netAmount].filter(Boolean).join(":")
  );
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function number(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return number(value);
}
