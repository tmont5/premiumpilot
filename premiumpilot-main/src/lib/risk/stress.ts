import type { RiskInput, RiskDerived, RiskShortPut, StressTestResult } from "./types";

// Automated stress tests (PRD §9). Every figure here is an ESTIMATE (§13) — a
// deterministic mark-to-market under the scenario's assumptions, not a
// prediction. Severity keys off liquidity and exposure (a negative projected
// cash balance, forced margin borrowing in a cash/IRA account, or breaching the
// potential-exposure cap), never off the NLV estimate, which for out-of-the-
// money assignments can even show a paper gain while liquidity is exhausted.

interface ScenarioSpec {
  name: string;
  description: string;
  priceMultiplier: number; // applied to all underlyings/owned stock
  assign: "all" | "itm" | "none";
}

const SCENARIOS: ScenarioSpec[] = [
  { name: "All puts assigned", description: "Every open short put is assigned at its strike.", priceMultiplier: 1, assign: "all" },
  { name: "Market −10%", description: "Underlyings fall 10%; positions held (not assigned).", priceMultiplier: 0.9, assign: "none" },
  { name: "Market −20%", description: "Underlyings fall 20%; positions held (not assigned).", priceMultiplier: 0.8, assign: "none" },
  { name: "ITM puts assigned, −10% more", description: "In-the-money puts assigned, then underlyings fall a further 10%.", priceMultiplier: 0.9, assign: "itm" },
];

// Potential-exposure caps by profile (PRD §6.2–§6.4), used only to escalate
// severity, not to size bands here.
const EXPOSURE_CAP: Record<RiskInput["profile"], number> = {
  conservative: 0.8,
  balanced: 1.15,
  aggressive: 1.3,
};

export function runStressTests(input: RiskInput, d: RiskDerived): StressTestResult[] {
  return SCENARIOS.map((s) => computeScenario(s, input, d));
}

function isAssigned(put: RiskShortPut, spec: ScenarioSpec): boolean {
  if (spec.assign === "all") return true;
  if (spec.assign === "none") return false;
  return put.underlyingPrice < put.strike; // itm
}

function computeScenario(spec: ScenarioSpec, input: RiskInput, d: RiskDerived): StressTestResult {
  const m = spec.priceMultiplier;
  const nlv = d.nlv || 1;

  let assignmentCashRequired = 0;
  let nlvDelta = d.ownedStockValue * (m - 1); // owned stock re-marked

  // Exposure by ticker/sector after the scenario: owned stock (re-marked) +
  // assigned stock (re-marked) + still-open put obligations.
  const byTicker = new Map<string, number>();
  const bySector = new Map<string, number>();
  const add = (map: Map<string, number>, key: string | null, v: number) => {
    if (!key) return;
    map.set(key, (map.get(key) ?? 0) + v);
  };

  for (const eq of input.equities) {
    add(byTicker, eq.ticker, eq.marketValue * m);
    add(bySector, eq.sector, eq.marketValue * m);
  }

  for (const put of input.shortPuts) {
    if (isAssigned(put, spec)) {
      assignmentCashRequired += put.obligation;
      const stockValue = put.underlyingPrice * m * 100 * put.contracts;
      add(byTicker, put.ticker, stockValue);
      add(bySector, put.sector, stockValue);
      // Swap cash (strike) for stock (re-marked) and extinguish the put liability.
      nlvDelta += stockValue - put.obligation + put.optionMarketValue;
    } else {
      // Unassigned: still an obligation, and its liability re-marks to post-move
      // intrinsic (a conservative estimate — ignores remaining extrinsic).
      add(byTicker, put.ticker, put.obligation);
      add(bySector, put.sector, put.obligation);
      const newIntrinsic = Math.max(0, put.strike - put.underlyingPrice * m) * 100 * put.contracts;
      nlvDelta += put.optionMarketValue - newIntrinsic;
    }
  }

  const projectedNLV = nlv + nlvDelta;
  const projectedCashBalance = input.cash - assignmentCashRequired;
  const marginRequired = Math.max(0, assignmentCashRequired - input.cash);
  const largestTicker = Math.max(0, ...byTicker.values());
  const largestSector = Math.max(0, ...bySector.values());
  const denom = projectedNLV > 0 ? projectedNLV : nlv;
  const largestTickerPercent = (largestTicker / denom) * 100;
  const largestSectorPercent = (largestSector / denom) * 100;

  // Exposure ratio for the cap check: total contingent stock over projected NLV.
  const totalExposure = [...byTicker.values()].reduce((s, v) => s + v, 0);
  const exposureRatio = totalExposure / denom;
  const cannotBorrow = input.accountType !== "margin";
  const liquidationRisk = projectedCashBalance < 0 && cannotBorrow;

  let severity: StressTestResult["severity"] = "normal";
  if (projectedCashBalance < 0 && marginRequired > 0) severity = "warning";
  if (
    (projectedCashBalance < 0 && cannotBorrow) ||
    exposureRatio > EXPOSURE_CAP[input.profile] ||
    projectedNLV <= 0
  ) {
    severity = "critical";
  }

  return {
    scenarioName: spec.name,
    description: spec.description,
    projectedNLV,
    assignmentCashRequired,
    projectedCashBalance,
    marginRequired,
    largestTickerPercent,
    largestSectorPercent,
    liquidationRisk,
    severity,
  };
}
