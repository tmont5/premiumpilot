import { bandsFor } from "./bands";
import { fmtCurrency0 } from "../format";
import type {
  PositionAction,
  PositionActionLabel,
  Recommendation,
  RiskDerived,
  RiskInput,
} from "./types";

const money = (n: number) => fmtCurrency0(n);

// Actionable, numeric recommendations (PRD §10). Ordered most-severe first.
export function buildRecommendations(input: RiskInput, d: RiskDerived): Recommendation[] {
  const bands = bandsFor(input.profile);
  const nlv = d.nlv || 1;
  const recs: Recommendation[] = [];

  // §10.1 — excessive put exposure.
  const putMax = bands.putObligations.targetHigh * nlv;
  if (d.putObligation > putMax) {
    const reduce = d.putObligation - putMax;
    recs.push({
      id: "put-exposure",
      severity: d.putObligation / nlv > bands.putObligations.criticalStart ? "critical" : "elevated",
      title: "Reduce short-put assignment obligations",
      detail:
        `Current put obligation ${money(d.putObligation)} vs. recommended maximum ${money(putMax)}. ` +
        `Reduce assignment obligations by at least ${money(reduce)} to return to the ${input.profile} target range.`,
    });
  }

  // §10.3 — insufficient liquidity.
  const liqMin = bands.uncommittedLiquidity.targetLow * nlv;
  if (d.uncommittedLiquidity < liqMin) {
    const gap = liqMin - d.uncommittedLiquidity;
    recs.push({
      id: "liquidity",
      severity: d.uncommittedLiquidity < 0 ? "critical" : "elevated",
      title: "Restore uncommitted liquidity",
      detail:
        `Current uncommitted liquidity ${money(d.uncommittedLiquidity)} vs. target minimum ${money(liqMin)} ` +
        `(gap ${money(gap)}). Closing or rolling approximately ${money(gap)} of assignment exposure is required ` +
        `to restore the minimum liquidity reserve. Note: rolling closes one obligation and opens another — it does not remove the exposure.`,
    });
  }

  // §6.4 — potential exposure over cap.
  const expRatio = d.potentialExposure / nlv;
  if (expRatio > bands.potentialExposure.targetHigh) {
    recs.push({
      id: "potential-exposure",
      severity: expRatio > bands.potentialExposure.criticalStart ? "critical" : "elevated",
      title: "Potential stock exposure above target",
      detail:
        `If every put were assigned, contingent stock exposure would reach ${money(d.potentialExposure)} ` +
        `(${Math.round(expRatio * 100)}% of NLV). The ${input.profile} target tops out at ` +
        `${Math.round(bands.potentialExposure.targetHigh * 100)}%.`,
    });
  }

  // §7 — single-ticker concentration.
  if (d.largestTicker && d.largestTicker.ratio > bands.singleTicker.targetHigh) {
    const t = d.largestTicker;
    const trimTo = bands.singleTicker.targetHigh * nlv;
    recs.push({
      id: "ticker-concentration",
      severity: t.ratio > bands.singleTicker.criticalStart ? "critical" : "elevated",
      title: `Concentration in ${t.ticker}`,
      detail:
        `${t.ticker} post-assignment exposure is ${money(t.exposure)} (${Math.round(t.ratio * 100)}% of NLV). ` +
        `Trim toward ${money(trimTo)} to stay under the ${Math.round(bands.singleTicker.targetHigh * 100)}% single-name cap.`,
    });
  }

  // §7.2 — single-sector concentration.
  if (d.largestSector && d.largestSector.ratio > bands.singleSector.targetHigh) {
    const s = d.largestSector;
    recs.push({
      id: "sector-concentration",
      severity: s.ratio > bands.singleSector.criticalStart ? "critical" : "elevated",
      title: `Concentration in ${s.sector}`,
      detail:
        `${s.sector} exposure is ${money(s.exposure)} (${Math.round(s.ratio * 100)}% of NLV), above the ` +
        `${Math.round(bands.singleSector.targetHigh * 100)}% sector guideline. Diversify across sectors — ` +
        `several correlated names do not reduce concentration risk.`,
    });
  }

  // §5.3 / §16.6 — uncovered calls.
  if (d.nakedCalls.length) {
    const names = d.nakedCalls.map((c) => c.ticker).join(", ");
    recs.push({
      id: "naked-calls",
      severity: "critical",
      title: "Uncovered call exposure",
      detail:
        `${d.nakedCalls.length} call position(s) are not fully share-backed (${names}). An uncovered short call ` +
        `carries theoretically unlimited risk — buy the backing shares or close the call.`,
    });
  }

  // §8 — near-term assignment clustering.
  const near7dRatio = d.near7dObligation / nlv;
  if (near7dRatio > bands.near7d.targetHigh) {
    recs.push({
      id: "clustering",
      severity: near7dRatio > bands.near7d.criticalStart ? "critical" : "elevated",
      title: "Assignment clustering within 7 days",
      detail:
        `${money(d.near7dObligation)} of put obligations (${Math.round(near7dRatio * 100)}% of NLV) expire within ` +
        `7 days. Stagger expirations to avoid a single-week assignment spike.`,
    });
  }

  if (!recs.length) {
    recs.push({
      id: "healthy",
      severity: "healthy",
      title: "Portfolio within target ranges",
      detail: "All monitored allocation, concentration, and liquidity metrics are inside the target bands for your risk profile.",
    });
  }

  const order = { critical: 0, leverage: 1, elevated: 2, watch: 3, healthy: 4 } as const;
  return recs.sort((a, b) => order[a.severity] - order[b.severity]);
}

// Rank short puts as reduction candidates and assign a per-position action label
// (PRD §10.2, §10.5). Covered calls get Keep/Monitor; uncovered calls are flagged.
export function rankPositions(input: RiskInput, d: RiskDerived): PositionAction[] {
  const bands = bandsFor(input.profile);
  const nlv = d.nlv || 1;
  const tickerRatioOf = new Map(d.tickerConcentration.map((t) => [t.ticker, t.ratio]));
  const sectorRatioOf = new Map(d.sectorConcentration.map((s) => [s.sector, s.ratio]));

  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

  const scored = input.shortPuts.map((put) => {
    const itmPct = put.strike > 0 ? (put.strike - put.underlyingPrice) / put.strike : 0;
    const tickerRatio = tickerRatioOf.get(put.ticker) ?? 0;
    const sectorRatio = put.sector ? sectorRatioOf.get(put.sector) ?? 0 : 0;
    // Composite of the §10.2 factors we can measure. Higher = closer to the top
    // of the reduce list. Conviction/volatility (factors 6–7) are not tracked.
    const rankScore =
      clamp01(itmPct / 0.1) * 0.3 +
      clamp01((30 - put.dte) / 30) * 0.2 +
      clamp01(tickerRatio / bands.singleTicker.criticalStart) * 0.2 +
      clamp01(sectorRatio / bands.singleSector.criticalStart) * 0.1 +
      clamp01(put.obligation / (d.putObligation || 1)) * 0.15 +
      clamp01(1 - put.premiumReceived / (put.obligation || 1) / 0.05) * 0.05;
    return { put, itmPct, rankScore };
  });

  scored.sort((a, b) => b.rankScore - a.rankScore);

  // How much obligation must be shed to clear the worst breach: whichever is
  // larger of the put-obligation overage and the liquidity gap.
  const putOverage = Math.max(0, d.putObligation - bands.putObligations.targetHigh * nlv);
  const liqGap = Math.max(0, bands.uncommittedLiquidity.targetLow * nlv - d.uncommittedLiquidity);
  let reductionNeeded = Math.max(putOverage, liqGap);

  const actions: PositionAction[] = scored.map(({ put, itmPct, rankScore }) => {
    let action: PositionActionLabel;
    const reasons: string[] = [];
    const near = put.dte <= 7;
    const itm = itmPct > 0;

    if (reductionNeeded > 0) {
      // Still shedding: this position is a reduce/close/roll candidate.
      reductionNeeded -= put.obligation;
      if (itm && near) {
        action = d.uncommittedLiquidity >= put.obligation ? "Take Assignment" : "Roll";
        reasons.push(itm ? `${(itmPct * 100).toFixed(1)}% in the money` : "");
        reasons.push(near ? `${put.dte} DTE` : "");
      } else if (near) {
        action = "Roll";
        reasons.push(`${put.dte} DTE`);
      } else {
        action = "Close";
      }
      reasons.push("reduces a breached metric");
    } else if ((tickerRatioOf.get(put.ticker) ?? 0) > bands.singleTicker.targetHigh) {
      action = "Reduce";
      reasons.push(`concentration in ${put.ticker}`);
    } else if (near) {
      action = itm ? "Roll" : "Monitor";
      reasons.push(`${put.dte} DTE`);
    } else {
      action = "Keep";
      reasons.push("within targets");
    }

    return {
      ticker: put.ticker,
      strategy: "cash_secured_put" as const,
      isNakedCall: false,
      strike: put.strike,
      contracts: put.contracts,
      expiration: put.expiration,
      dte: put.dte,
      obligation: put.obligation,
      itmPct,
      rankScore,
      action,
      reasons: reasons.filter(Boolean),
    };
  });

  // Uncovered calls surface as their own high-priority reduce rows.
  for (const c of d.nakedCalls) {
    actions.unshift({
      ticker: c.ticker,
      strategy: "covered_call",
      isNakedCall: true,
      strike: c.strike,
      contracts: c.contracts,
      expiration: c.expiration,
      dte: 0,
      obligation: 0,
      itmPct: 0,
      rankScore: 1,
      action: "Reduce",
      reasons: ["uncovered call — buy backing shares or close"],
    });
  }

  return actions;
}
