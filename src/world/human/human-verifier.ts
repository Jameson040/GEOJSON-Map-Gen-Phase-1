import type { GeneratedRegion, VerificationCheck, VerificationReport } from "../types";
import type { BioLayerResult } from "../bio/bio-types";
import type { Settlement } from "./human-types";
import { HumanEnvReader } from "./human-env";
import { SETTLEMENT_BY_TYPE, TIER_RANK } from "./settlement-catalog";
import { dist } from "../geom";
import { kmToUnits } from "../constants";

// ---------------------------------------------------------------------------
// LAYER 4 VERIFIER — HABITABLE-SITE invariants against both frozen layers.
// Population-free: rules judge livability, capacity and structure only.
// ---------------------------------------------------------------------------

export function verifyHumanLayer(
  s: Settlement[],
  env: HumanEnvReader,
  region: GeneratedRegion,
  bio: BioLayerResult,
  geoCountAtStart: number,
  bioCountAtStart: number
): VerificationReport {
  const t0 = performance.now();
  const checks: VerificationCheck[] = [];
  const push = (
    id: string,
    category: VerificationCheck["category"],
    title: string,
    rule: string,
    checkedCount: number,
    violations: string[],
    ok: string
  ) =>
    checks.push({
      id,
      category,
      title,
      rule,
      passed: violations.length === 0,
      checkedCount,
      violationCount: violations.length,
      details: violations.length === 0 ? ok : `${violations.length} violations.`,
      sampleViolations: violations.slice(0, 5),
    });

  // 1–3. livable site / water / resource access
  {
    const site: string[] = [];
    const water: string[] = [];
    const resources: string[] = [];
    for (const x of s) {
      const def = SETTLEMENT_BY_TYPE.get(x.type)!;
      const rep = env.evaluate(def, x.point);
      if (rep.ok) continue;
      const msg = `${x.name} (${def.name}): ${rep.rule}`;
      if (rep.rule === "no_water") water.push(msg);
      else if (rep.rule?.startsWith("no_food")) resources.push(msg);
      else site.push(msg);
    }
    push("human_site", "placement", "Sites on Livable Ground",
      "On land, off glaciers and forbidden biomes, with every hard site need (coast, river, farmland, pasture, mountain, oasis…) met against the frozen geography.",
      s.length, site, `All ${s.length} habitable zones stand on livable ground.`);
    push("human_water", "hydrology", "Fresh Water Within Reach",
      "Every zone lies within its type's distance of a frozen river, lake or (for sea settlements) the coast.",
      s.length, water, `Every zone has water within reach.`);
    push("human_food", "presence", "Resources Reachable",
      "Every required food role for the zone type is reachable from frozen Layer-3 populations inside its supply radius.",
      s.length, resources, `Every zone is within reach of its required resources.`);
  }

  // 4. structural capacity within its type band (no people, only capacity)
  {
    const v: string[] = [];
    for (const x of s) {
      const def = SETTLEMENT_BY_TYPE.get(x.type)!;
      if (x.popCap > def.popCap[1] * 1.001) v.push(`${x.name}: capacity ${x.popCap.toLocaleString()} exceeds the ${def.name} band`);
      if (x.capacity > 1 || x.capacity < 0) v.push(`${x.name}: capacity score ${x.capacity} outside 0..1`);
    }
    push("human_capacity_band", "scale", "Capacity Within Type Band",
      "No zone exceeds the structural capacity band of its type; no occupied headcount is stored anywhere.",
      s.length, v, `All capacities stay structural and inside their type's band.`);
  }

  // 5. spacing
  {
    const v: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const a = s[i];
      const da = SETTLEMENT_BY_TYPE.get(a.type)!;
      for (let j = 0; j < s.length; j++) {
        if (i === j) continue;
        const b = s[j];
        const db = SETTLEMENT_BY_TYPE.get(b.type)!;
        const minKm = TIER_RANK[db.tier] >= TIER_RANK[da.tier] ? da.spacingKm : db.spacingKm;
        if (dist(a.point, b.point) < kmToUnits(minKm) * 0.98) {
          v.push(`${a.name} is within ${minKm} km of ${b.name}`);
          break;
        }
      }
    }
    push("human_spacing", "scale", "Zone Spacing Respected",
      "Same- or higher-tier habitable zones keep the minimum distance of the smaller one's type.",
      s.length, v, `No zone crowds a peer or a larger neighbour.`);
  }

  // 6. hierarchy
  {
    const v: string[] = [];
    const has = (t: Settlement["tier"]) => s.some((x) => x.tier === t);
    if ((has("city") || has("metropolis")) && !has("town")) v.push("city sites without any town site");
    if (has("town") && !has("village")) v.push("town sites without any village site");
    const capitals = s.filter((x) => x.type === "capital_city").length;
    if (capitals > 1) v.push(`${capitals} capital sites (max 1)`);
    push("human_hierarchy", "presence", "Zone Hierarchy Coherent",
      "City sites imply town sites, town sites imply village sites, at most one capital site per region.",
      s.length, v, `Hierarchy coherent (${capitals} capital site).`);
  }

  // 7. layer separation + population-free contract
  {
    const v: string[] = [];
    for (const x of s) {
      if (x.layer !== "human" || !x.id.startsWith("set_")) v.push(`${x.name}: foreign feature in human layer`);
      if ((x as unknown as Record<string, unknown>).population !== undefined) v.push(`${x.name}: a population field leaked into the site layer`);
    }
    if (region.features.length !== geoCountAtStart) v.push(`Geography mutated: ${geoCountAtStart} → ${region.features.length}`);
    if (bio.populations.length !== bioCountAtStart) v.push(`Biosphere mutated: ${bioCountAtStart} → ${bio.populations.length}`);
    push("human_layer_separation", "presence", "Lower Layers & Pop-Free Contract",
      "Zone records hold structure only (no occupied headcount — that is Layer 5), and geography/biosphere counts are unchanged.",
      s.length + 2, v, `Structure-only zones verified; L1 (${geoCountAtStart}) & L2 (${bioCountAtStart}) untouched.`);
  }

  const passedChecks = checks.filter((c) => c.passed).length;
  const totalViolations = checks.reduce((a, c) => a + c.violationCount, 0);
  return {
    targetName: `${region.descriptor.name} — Habitable Zones`,
    tier: 2,
    passedAll: totalViolations === 0,
    totalChecks: checks.length,
    passedChecks,
    totalViolations,
    elapsedMs: Math.round(performance.now() - t0),
    checks,
  };
}
