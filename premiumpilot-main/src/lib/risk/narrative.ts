import { bandsFor } from "./bands";
import { fmtCurrency0 } from "../format";
import type { RiskDerived, RiskInput } from "./types";

const money = (n: number) => fmtCurrency0(n);
const pct = (n: number) => `${Math.round(n * 100)}%`;

// Plain-language portfolio summary (PRD §13). Carefully distinguishes current
// market value, maximum contractual obligation, and required liquidity — and
// never blends them without labels.
export function buildNarrative(input: RiskInput, d: RiskDerived): string {
  const bands = bandsFor(input.profile);
  const nlv = d.nlv || 1;
  const expRatio = d.potentialExposure / nlv;
  const liqMin = bands.uncommittedLiquidity.targetLow * nlv;
  const putMax = bands.potentialExposure.targetHigh;
  const putMin = bands.potentialExposure.targetLow;

  const parts: string[] = [];
  parts.push(
    `Your ${money(nlv)} account currently owns ${money(d.ownedStockValue)} of stock (market value) and ` +
      `has ${money(d.putObligation)} of additional short-put assignment obligations (maximum contractual amount).`
  );
  parts.push(
    `If every put were assigned, potential stock exposure would reach approximately ${money(d.potentialExposure)}, ` +
      `or ${pct(expRatio)} of account value. The ${input.profile} target is ${pct(putMin)}–${pct(putMax)}.`
  );

  if (d.uncommittedLiquidity < 0) {
    parts.push(
      `Uncommitted liquidity is ${money(d.uncommittedLiquidity)} — cash of ${money(d.cash)} does not cover the ` +
        `open obligations, so full assignment would require borrowing or forced selling.`
    );
  } else {
    parts.push(
      `Uncommitted liquidity (cash less open obligations) is ${money(d.uncommittedLiquidity)}; broker buying power is ` +
        `${money(d.marginBuyingPower)}.`
    );
  }

  const overExposure = expRatio > putMax;
  if (overExposure || d.uncommittedLiquidity < liqMin) {
    const reduceExposure = Math.max(0, d.potentialExposure - putMax * nlv);
    const bits: string[] = [];
    if (reduceExposure > 0) bits.push(`reduce put obligations by approximately ${money(reduceExposure)}`);
    if (d.uncommittedLiquidity < liqMin) bits.push(`retain at least ${money(liqMin)} of uncommitted liquidity`);
    parts.push(`To return to the target range, ${bits.join(" and ")}.`);
  } else {
    parts.push(`All primary allocation metrics are within the ${input.profile} target ranges.`);
  }

  return parts.join(" ");
}
