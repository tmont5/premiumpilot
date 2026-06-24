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
export function getAccounts(accessToken: string) {
  return authedGet(`/accounts?fields=positions`, accessToken);
}

export function getOrders(accessToken: string, accountHash: string) {
  return authedGet(`/accounts/${accountHash}/orders`, accessToken);
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
export function mapPositions(account: any, underlyingPrices: Record<string, number>): MappedPosition[] {
  // deno-lint-ignore no-explicit-any
  const positions: any[] = account?.securitiesAccount?.positions ?? [];
  const out: MappedPosition[] = [];
  for (const pos of positions) {
    const inst = pos.instrument ?? {};
    if (inst.assetType !== "OPTION") continue;
    const isPut = inst.putCall === "PUT";
    const ticker: string = inst.underlyingSymbol ?? inst.symbol;
    const strike = Number(inst.strikePrice ?? 0);
    const contracts = Math.abs(Number(pos.shortQuantity ?? pos.longQuantity ?? 0));
    const underlying = underlyingPrices[ticker] ?? 0;
    const premium = Math.abs(Number(pos.averagePrice ?? 0)) * contracts * 100;
    const marketVal = Math.abs(Number(pos.marketValue ?? 0));
    out.push({
      ticker,
      strategy: isPut ? "cash_secured_put" : "covered_call",
      strike,
      expiration: (inst.optionExpirationDate ?? "").slice(0, 10),
      contracts,
      premium_collected: premium,
      current_option_value: marketVal,
      current_underlying_price: underlying,
      delta: Number(inst.optionDeltas?.delta ?? pos.delta ?? 0),
      capital_requirement: isPut ? strike * 100 * contracts : underlying * 100 * contracts,
    });
  }
  return out;
}
