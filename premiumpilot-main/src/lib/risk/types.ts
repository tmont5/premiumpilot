import type { RiskAccountType, RiskProfile, Strategy } from "../types";

// ── Risk Recommendation Engine domain types (PRD: Portfolio Risk Engine) ──────
// Everything the /risk page renders. Monetary values are account base currency;
// `ratio` fields are fractions of NLV (0.30 = 30%). The governing figure for a
// short put is always its full assignment obligation (strike × 100 × contracts),
// never margin requirement or option market value (PRD §16.1).

// Four band levels plus a distinct leverage state for margin/forced-liquidation
// risk. Maps to the §12.2 color system: healthy→green, watch→yellow,
// elevated→orange, critical→red, leverage→purple.
export type RiskStatus = "healthy" | "watch" | "elevated" | "critical" | "leverage";

// A single headline metric assessed against its target band (PRD §3, §12.1).
// "Where am I / where should I be / how far away."
export interface MetricAssessment {
  key: string;
  label: string;
  kind: "obligation" | "market_value" | "cash" | "probability_weighted";
  value: number; // dollars
  ratio: number; // fraction of NLV
  targetLow: number; // dollars
  targetHigh: number; // dollars
  targetLowRatio: number;
  targetHighRatio: number;
  direction: "upper" | "lower"; // which side is risky
  status: RiskStatus;
  // Signed dollars away from the nearest breached target edge. Positive = over
  // the max (upper metrics) or under the min (lower metrics); 0 when in band.
  deltaToTarget: number;
  hint?: string;
}

export interface TickerConcentration {
  ticker: string;
  sector: string | null;
  stockValue: number;
  putObligation: number;
  exposure: number; // stock + put obligation
  ratio: number;
  status: RiskStatus;
}

export interface SectorConcentration {
  sector: string;
  exposure: number;
  ratio: number;
  status: RiskStatus;
}

export interface AssignmentWindow {
  label: string;
  maxDays: number; // upper bound of the bucket (Infinity for the last)
  obligation: number;
  ratio: number;
  contracts: number;
  tickers: number;
  estimatedAssignments: number; // Σ contracts × assignmentProbability (delta)
  probabilityWeighted: number; // Σ strike × 100 × contracts × probability
  hasDelta: boolean; // false → estimates omitted, obligation still governs
}

export interface StressTestResult {
  scenarioName: string;
  description: string;
  projectedNLV: number;
  assignmentCashRequired: number;
  projectedCashBalance: number; // negative = deficit
  marginRequired: number;
  largestTickerPercent: number;
  largestSectorPercent: number;
  liquidationRisk: boolean;
  severity: "normal" | "warning" | "critical";
}

export type PositionActionLabel =
  | "Keep"
  | "Monitor"
  | "Reduce"
  | "Roll"
  | "Close"
  | "Take Assignment";

export interface PositionAction {
  ticker: string;
  strategy: Strategy;
  isNakedCall: boolean;
  strike: number;
  contracts: number;
  expiration: string;
  dte: number;
  obligation: number;
  itmPct: number; // how far in-the-money the short option is (negative = OTM)
  rankScore: number;
  action: PositionActionLabel;
  reasons: string[];
}

export interface Recommendation {
  id: string;
  severity: RiskStatus;
  title: string;
  detail: string; // numeric, actionable (PRD §10)
}

export interface HealthCategory {
  key: string;
  label: string;
  weight: number; // 0..1
  score: number; // 0..100
  note: string;
}

export interface HealthScore {
  total: number; // 0..100
  label: string; // Excellent / Healthy / Moderate risk / Aggressive / Critical
  categories: HealthCategory[];
}

// Premium return is reported separately and never offsets capital risk (§11.3).
export interface PremiumSummary {
  openPremiumAtRisk: number; // premium collected on still-open short options
  premiumYieldPctOfNlv: number;
}

export interface RiskAnalysis {
  profile: RiskProfile;
  accountType: RiskAccountType;

  // Core figures (PRD §5).
  nlv: number;
  ownedStockValue: number;
  putAssignmentObligation: number;
  cash: number;
  uncommittedLiquidity: number; // may be negative — a first-order risk signal
  potentialStockExposure: number;
  marginBuyingPower: number;

  metrics: MetricAssessment[]; // headline cards, §12.1
  tickerConcentration: TickerConcentration[];
  sectorConcentration: SectorConcentration[];
  untaggedTickers: string[];
  timeline: AssignmentWindow[];
  stressTests: StressTestResult[];
  recommendations: Recommendation[];
  positionActions: PositionAction[];
  health: HealthScore;
  premium: PremiumSummary;
  narrative: string;

  marginLeverageWarning: boolean; // PRD §6.4
  dataQuality: string[]; // missing delta/sector notes (PRD §4.3)
}

// ── Internal adapter shapes (PRD §4 data contracts, sourced from PortfolioView) ─

export interface RiskEquity {
  ticker: string;
  sector: string | null;
  shares: number;
  currentPrice: number;
  marketValue: number;
}

export interface RiskShortPut {
  ticker: string;
  sector: string | null;
  contracts: number; // positive count
  strike: number;
  expiration: string;
  dte: number;
  underlyingPrice: number;
  optionMarketValue: number;
  premiumReceived: number;
  delta: number | null; // null when unknown
  obligation: number; // strike × 100 × contracts
}

export interface RiskCoveredCall {
  ticker: string;
  contracts: number;
  strike: number;
  expiration: string;
  sharesOwned: number;
  sharesRequired: number;
  isFullyCovered: boolean;
  isNaked: boolean;
}

export interface RiskInput {
  profile: RiskProfile;
  accountType: RiskAccountType;
  nlv: number;
  cash: number;
  marginBuyingPower: number;
  openPremium: number; // premium collected on still-open short options (§11.3)
  equities: RiskEquity[];
  shortPuts: RiskShortPut[];
  coveredCalls: RiskCoveredCall[];
}

// Shared figures computed once in the engine and threaded into the stress,
// recommendation, health, and narrative modules so each doesn't re-derive them.
export interface RiskDerived {
  nlv: number;
  ownedStockValue: number;
  putObligation: number;
  cash: number;
  marginBuyingPower: number;
  uncommittedLiquidity: number;
  potentialExposure: number;
  tickerConcentration: TickerConcentration[];
  sectorConcentration: SectorConcentration[];
  largestTicker: TickerConcentration | null;
  largestSector: SectorConcentration | null;
  near7dObligation: number; // short-put obligation expiring within 7 days
  deepItmObligation: number; // obligation of short puts currently in the money
  nakedCalls: RiskCoveredCall[];
}
