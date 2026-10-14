import type { SettlementDef } from "./human-types";
import { TIER_RANK } from "./settlement-catalog";

/** Equal-tier peers must satisfy both radii; otherwise the smaller tier yields. */
export function settlementSpacingKm(a: SettlementDef, b: SettlementDef): number {
  const ar = TIER_RANK[a.tier];
  const br = TIER_RANK[b.tier];
  return ar === br ? Math.max(a.spacingKm, b.spacingKm) : ar < br ? a.spacingKm : b.spacingKm;
}