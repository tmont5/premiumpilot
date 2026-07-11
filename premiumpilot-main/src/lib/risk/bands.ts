import type { RiskProfile } from "../types";
import type { RiskStatus } from "./types";

// Target bands as fractions of NLV (PRD §6). Bands scale automatically with
// account size because everything downstream multiplies by NLV. Each band is
// one-directional: `upper` metrics get riskier as they grow (obligations,
// exposure, concentration), `lower` metrics get riskier as they shrink
// (uncommitted liquidity). `criticalStart` is where the red zone begins.
export interface Band {
  targetLow: number;
  targetHigh: number;
  criticalStart: number;
  direction: "upper" | "lower";
}

export type BandKey =
  | "ownedStock"
  | "putObligations"
  | "uncommittedLiquidity"
  | "potentialExposure"
  | "singleTicker"
  | "singleSector"
  | "near7d";

type ProfileBands = Record<BandKey, Band>;

const BALANCED: ProfileBands = {
  ownedStock: { targetLow: 0.5, targetHigh: 0.65, criticalStart: 0.8, direction: "upper" },
  putObligations: { targetLow: 0.2, targetHigh: 0.3, criticalStart: 0.45, direction: "upper" },
  uncommittedLiquidity: { targetLow: 0.15, targetHigh: 0.25, criticalStart: 0.08, direction: "lower" },
  potentialExposure: { targetLow: 0.75, targetHigh: 0.95, criticalStart: 1.15, direction: "upper" },
  singleTicker: { targetLow: 0, targetHigh: 0.15, criticalStart: 0.2, direction: "upper" },
  singleSector: { targetLow: 0, targetHigh: 0.3, criticalStart: 0.4, direction: "upper" },
  near7d: { targetLow: 0, targetHigh: 0.15, criticalStart: 0.25, direction: "upper" },
};

const CONSERVATIVE: ProfileBands = {
  ownedStock: { targetLow: 0.4, targetHigh: 0.55, criticalStart: 0.7, direction: "upper" },
  putObligations: { targetLow: 0.1, targetHigh: 0.2, criticalStart: 0.3, direction: "upper" },
  uncommittedLiquidity: { targetLow: 0.25, targetHigh: 0.4, criticalStart: 0.15, direction: "lower" },
  potentialExposure: { targetLow: 0.6, targetHigh: 0.8, criticalStart: 0.9, direction: "upper" },
  singleTicker: { targetLow: 0, targetHigh: 0.1, criticalStart: 0.15, direction: "upper" },
  singleSector: { targetLow: 0, targetHigh: 0.25, criticalStart: 0.35, direction: "upper" },
  near7d: { targetLow: 0, targetHigh: 0.1, criticalStart: 0.2, direction: "upper" },
};

const AGGRESSIVE: ProfileBands = {
  ownedStock: { targetLow: 0.6, targetHigh: 0.75, criticalStart: 0.9, direction: "upper" },
  putObligations: { targetLow: 0.25, targetHigh: 0.4, criticalStart: 0.55, direction: "upper" },
  uncommittedLiquidity: { targetLow: 0.1, targetHigh: 0.15, criticalStart: 0.05, direction: "lower" },
  potentialExposure: { targetLow: 0.9, targetHigh: 1.1, criticalStart: 1.3, direction: "upper" },
  singleTicker: { targetLow: 0, targetHigh: 0.2, criticalStart: 0.28, direction: "upper" },
  singleSector: { targetLow: 0, targetHigh: 0.4, criticalStart: 0.5, direction: "upper" },
  near7d: { targetLow: 0, targetHigh: 0.2, criticalStart: 0.3, direction: "upper" },
};

const BANDS: Record<RiskProfile, ProfileBands> = {
  conservative: CONSERVATIVE,
  balanced: BALANCED,
  aggressive: AGGRESSIVE,
};

export function bandsFor(profile: RiskProfile): ProfileBands {
  return BANDS[profile];
}

// Classify a ratio against a band into a four-level status. "watch" (yellow) is
// the approaching-boundary zone just inside the target edge; "elevated" (orange)
// is the warning band just outside target; "critical" (red) is past criticalStart.
export function classify(ratio: number, band: Band): RiskStatus {
  if (band.direction === "upper") {
    if (ratio > band.criticalStart) return "critical";
    if (ratio > band.targetHigh) return "elevated";
    if (ratio > band.targetHigh * 0.9) return "watch";
    return "healthy";
  }
  // lower: smaller is riskier
  if (ratio < band.criticalStart) return "critical";
  if (ratio < band.targetLow) return "elevated";
  if (ratio < band.targetLow * 1.1) return "watch";
  return "healthy";
}

// Signed distance (in ratio units) from the nearest breached target edge.
// Positive = needs to come down (upper) / go up (lower); 0 when in band.
export function ratioDeltaToTarget(ratio: number, band: Band): number {
  if (band.direction === "upper") return Math.max(0, ratio - band.targetHigh);
  return Math.max(0, band.targetLow - ratio);
}

// Concentration status uses the fixed table in PRD §7.1 (profile-independent),
// but we honor a tighter single-ticker cap for conservative/aggressive via the
// ticker band. This helper classifies a raw concentration ratio with the §7.1
// thresholds and is used for per-position/sector coloring.
export function concentrationStatus(ratio: number, band: Band): RiskStatus {
  return classify(ratio, band);
}
