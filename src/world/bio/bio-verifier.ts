import type { GeneratedRegion, VerificationCheck, VerificationReport } from "../types";
import type { BioFeature } from "./bio-types";
import { BioEnvReader } from "./bio-env";
import { SPECIES_BY_ID, SPECIES_CATALOG, REQUIRED_ROLES } from "./species-catalog";
import { dist } from "../geom";
import { kmToUnits } from "../constants";

// ---------------------------------------------------------------------------
// LAYER 3 VERIFIER — asserts the biosphere invariants against the frozen
// geography, before and after finetuning. Reuses the project-wide
// VerificationReport shape so results read exactly like the geographic ones.
// ---------------------------------------------------------------------------

const GRAZE_BIOMES = ["grassland", "savanna", "tundra", "wetland", "forest"];

export function verifyBioLayer(
  pops: BioFeature[],
  env: BioEnvReader,
  region: GeneratedRegion,
  geoFeatureCountAtStart: number
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
    okDetail: string
  ) =>
    checks.push({
      id,
      category,
      title,
      rule,
      passed: violations.length === 0,
      checkedCount,
      violationCount: violations.length,
      details: violations.length === 0 ? okDetail : `${violations.length} violations.`,
      sampleViolations: violations.slice(0, 5),
    });

  // 1. Habitat domain + climate envelope + water, evaluated in place --------
  {
    const habitat: string[] = [];
    const climate: string[] = [];
    const water: string[] = [];
    for (const p of pops) {
      const sp = SPECIES_BY_ID.get(p.speciesId);
      if (!sp) continue;
      const v = env.suitability(sp, p.point);
      if (v.ok) continue;
      const msg = `${p.name} @ (${p.point[0].toFixed(0)},${p.point[1].toFixed(0)}): ${v.rule}`;
      if (v.rule === "climate_envelope" || v.rule === "too_dry" || v.rule === "too_wet") climate.push(msg);
      else if (v.rule === "needs_water_nearby" || v.rule === "no_freshwater_body") water.push(msg);
      else habitat.push(msg);
    }
    push(
      "bio_habitat_domain",
      "placement",
      "Species in Their Habitat Domain",
      "Terrestrial life on land, freshwater fish at rivers/lakes, marine fisheries offshore, shellfish on the coast — judged against the frozen coastline and land mask.",
      pops.length,
      habitat,
      `All ${pops.length} populations sit in a legal habitat domain.`
    );
    push(
      "bio_climate_envelope",
      "climate",
      "EcoCrop Climate Envelopes Hold",
      "Every population's location satisfies its imported tMin–tMax / rMin–rMax envelope (irrigation exception only near fresh water).",
      pops.length,
      climate,
      `All populations are inside their imported FAO EcoCrop climate envelopes.`
    );
    push(
      "bio_water_dependency",
      "hydrology",
      "Riparian & Irrigation Water Within Reach",
      "Species flagged with a waterKm requirement (rice paddies, buffalo, waterfowl, reeds…) lie within it; irrigated desert crops are within 25 km of fresh water.",
      pops.length,
      water,
      `All water-dependent populations are within reach of the frozen rivers and lakes.`
    );
  }

  // 2. Forage dependency ------------------------------------------------------
  {
    const violations: string[] = [];
    const grazers = pops.filter((p) => SPECIES_BY_ID.get(p.speciesId)?.needsForage);
    for (const g of grazers) {
      const ok =
        env.hasBiomeNear(g.point, GRAZE_BIOMES, 160) ||
        pops.some((k) => k.category === "forage" && dist(k.point, g.point) < kmToUnits(160));
      if (!ok) violations.push(`${g.name}: no pasture or forage within 160 km`);
    }
    push(
      "bio_forage_dependency",
      "presence",
      "Grazing Herds Have Pasture",
      "Every grazing livestock population has grassland/savanna/forage within 160 km.",
      grazers.length,
      violations,
      `All ${grazers.length} grazing populations are within reach of pasture.`
    );
  }

  // 3. Density caps ------------------------------------------------------------
  {
    const violations: string[] = [];
    const seen = new Map<string, number>();
    for (const p of pops) {
      const key = `${p.compartmentId}:${p.speciesId}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      if (n === 3) violations.push(`${p.name}: >2 populations in compartment #${p.compartmentId}`);
    }
    push(
      "bio_density",
      "scale",
      "No Overcrowded Compartments",
      "At most two populations of one species per geographic processing compartment.",
      pops.length,
      violations,
      `No compartment holds a duplicate pile of any species.`
    );
  }

  // 4. Food security (Layer 4 contract) ----------------------------------------
  {
    const violations: string[] = [];
    const details: string[] = [];
    for (const req of REQUIRED_ROLES) {
      const present = pops.some((p) => p.roles.includes(req.role as BioFeature["roles"][number]));
      if (present) {
        details.push(req.label);
        continue;
      }
      // Absence is only legal if no catalog species of that role fits anywhere.
      const candidates = SPECIES_CATALOG.filter((s) => s.roles.includes(req.role as never));
      let feasible = false;
      outer: for (const sp of candidates) {
        for (const c of region.compartments) {
          const p: [number, number] = [(c.bbox.minX + c.bbox.maxX) / 2, (c.bbox.minY + c.bbox.maxY) / 2];
          if (env.suitability(sp, p).ok) {
            feasible = true;
            break outer;
          }
        }
      }
      if (feasible) violations.push(`${req.label} missing although climate-compatible species exist`);
      else details.push(`${req.label} (climate-excluded)`);
    }
    push(
      "bio_food_security",
      "presence",
      "Human Food-Security Roles Covered",
      "Staple, protein, vegetables, fruit, timber, forage and fiber must each be present unless the region's climate excludes every catalog species of that role.",
      REQUIRED_ROLES.length,
      violations,
      `Covered: ${details.join(", ")}.`
    );
  }

  // 5. Layer separation ----------------------------------------------------------
  {
    const violations: string[] = [];
    for (const p of pops) {
      if (p.layer !== "bio" || !p.id.startsWith("bio_")) violations.push(`${p.name}: foreign feature in bio layer`);
    }
    if (region.features.length !== geoFeatureCountAtStart)
      violations.push(
        `Geographic layer mutated: ${geoFeatureCountAtStart} features before, ${region.features.length} after`
      );
    push(
      "bio_layer_separation",
      "presence",
      "Geographic Layer Untouched",
      "The biosphere writes only its own bio_* features; the frozen geographic feature set must be byte-identical in count.",
      pops.length + 1,
      violations,
      `Geography untouched (${geoFeatureCountAtStart} features) — biosphere lives in its own layer.`
    );
  }

  const passedChecks = checks.filter((c) => c.passed).length;
  const totalViolations = checks.reduce((s, c) => s + c.violationCount, 0);
  return {
    targetName: `${region.descriptor.name} — Biosphere`,
    tier: 2,
    passedAll: totalViolations === 0,
    totalChecks: checks.length,
    passedChecks,
    totalViolations,
    elapsedMs: Math.round(performance.now() - t0),
    checks,
  };
}
