import type { GeneratedRegion, Pt, RegionCompartment } from "../types";
import type { BioConfig, BioFeature, BioFinetuneReport, BioLogEntry, SpeciesDef } from "./bio-types";
import { BioEnvReader } from "./bio-env";
import { SPECIES_CATALOG, REQUIRED_ROLES } from "./species-catalog";
import { makePopulation } from "./bio-generate";
import { dist } from "../geom";
import { kmToUnits } from "../constants";
import type { RNG } from "../rng";

// ---------------------------------------------------------------------------
// LAYER 3 FINETUNE — the rule half of the adversarial pair.
//
// Takes the creative scatter and resolves every contradiction against the
// frozen geography by DROPPING, RELOCATING or ADDING populations:
//   R1 habitat domain   (land / freshwater / marine / coastal in place)
//   R2 climate envelope (EcoCrop tMin..tMax & rMin..rMax at the actual spot;
//                        irrigation exception near fresh water)
//   R3 water dependency (riparian species within their waterKm)
//   R4 highland/altitude constraints against the frozen relief
//   R5 forage dependency (grazing livestock need pasture/grass biomes)
//   R6 density caps per compartment (no species piles, no overcrowding)
//   R7 food security   (every climate-capable region ends with its required
//                        human-dependency roles present — Layer 4's contract)
// The geographic layer itself is never modified.
// ---------------------------------------------------------------------------

const GRAZE_BIOMES = ["grassland", "savanna", "tundra", "wetland", "forest"];

function compartmentAt(p: Pt, comps: RegionCompartment[]): number {
  for (const c of comps) {
    if (p[0] >= c.bbox.minX && p[0] <= c.bbox.maxX && p[1] >= c.bbox.minY && p[1] <= c.bbox.maxY) return c.id;
  }
  return -1;
}

/** Try to find a compliant spot for a species anywhere in the region. */
function findSpot(sp: SpeciesDef, env: BioEnvReader, rng: RNG, tries: number): { p: Pt; irrigated?: boolean } | null {
  for (let t = 0; t < tries; t++) {
    let cand: Pt | null = null;
    if (sp.habitat === "marine") cand = env.randomOffshorePoint(rng, 15, 260);
    else if (sp.habitat === "coastal") cand = env.randomOffshorePoint(rng, 1, 14) ?? env.mask.sampleLand(rng, 0, 6);
    else if (sp.habitat === "freshwater") {
      cand = env.randomRiverPoint(rng);
    } else if (sp.biomes && t < tries * 0.6) {
      // Bias terrestrial species toward their preferred frozen biome patches.
      const centres = env.biomeCentres(sp.biomes);
      if (centres.length) {
        const c = centres[Math.floor(rng() * centres.length)];
        cand = [c[0] + (rng() - 0.5) * kmToUnits(260), c[1] + (rng() - 0.5) * kmToUnits(260)];
      } else cand = env.mask.sampleLand(rng, 0.05);
    } else {
      cand = env.mask.sampleLand(rng, 0.05);
    }
    if (!cand) continue;
    const verdict = env.suitability(sp, cand);
    if (verdict.ok) return { p: cand, irrigated: verdict.irrigated };
  }
  return null;
}

export function runBioFinetune(
  raw: BioFeature[],
  env: BioEnvReader,
  region: GeneratedRegion,
  config: BioConfig,
  rng: RNG
): { populations: BioFeature[]; report: BioFinetuneReport; log: BioLogEntry[] } {
  const t0 = performance.now();
  const comps = region.compartments;
  const log: BioLogEntry[] = [];
  const droppedByRule: Record<string, number> = {};
  let keptAsIs = 0;
  let relocated = 0;
  let dropped = 0;

  const bySpecies = new Map<string, SpeciesDef>(SPECIES_CATALOG.map((s) => [s.id, s]));
  const kept: BioFeature[] = [];

  // --- R1–R4: evaluate every creative population in place; else relocate ----
  for (const rawPop of raw) {
    const sp = bySpecies.get(rawPop.speciesId)!;
    let pop = rawPop;
    // For freshwater species, snap directly onto nearest river or lake coordinate
    if (sp.habitat === "freshwater") {
      const snap = env.closestFreshPoint(pop.point);
      if (snap) pop = { ...pop, point: snap };
    }
    const verdict = env.suitability(sp, pop.point);
    if (verdict.ok) {
      kept.push({ ...pop, irrigated: verdict.irrigated, compartmentId: compartmentAt(pop.point, comps) });
      keptAsIs++;
      continue;
    }
    const spot = findSpot(sp, env, rng, 16);
    if (spot) {
      kept.push({
        ...pop,
        point: spot.p,
        irrigated: spot.irrigated,
        compartmentId: compartmentAt(spot.p, comps),
        origin: `relocated (${verdict.rule})`,
      });
      relocated++;
      if (log.length < 220)
        log.push({ action: "relocate", rule: verdict.rule!, text: `${pop.name} violated "${verdict.rule}" and was moved to compliant habitat.` });
    } else {
      dropped++;
      droppedByRule[verdict.rule!] = (droppedByRule[verdict.rule!] ?? 0) + 1;
      if (log.length < 220)
        log.push({ action: "drop", rule: verdict.rule!, text: `${pop.name} removed — no habitat in this region satisfies "${verdict.rule}".` });
    }
  }

  // --- R5: grazers need forage within reach ---------------------------------
  const forageOK = (p: Pt) =>
    env.hasBiomeNear(p, GRAZE_BIOMES, 160) ||
    kept.some((k) => k.category === "forage" && dist(k.point, p) < kmToUnits(160));
  for (let i = kept.length - 1; i >= 0; i--) {
    const k = kept[i];
    const sp = bySpecies.get(k.speciesId)!;
    if (!sp.needsForage || forageOK(k.point)) continue;
    const spot = findSpot(sp, env, rng, 12);
    if (spot && forageOK(spot.p)) {
      kept[i] = { ...k, point: spot.p, compartmentId: compartmentAt(spot.p, comps), origin: "relocated (no_forage)" };
      relocated++;
    } else {
      kept.splice(i, 1);
      dropped++;
      droppedByRule["no_forage"] = (droppedByRule["no_forage"] ?? 0) + 1;
      if (log.length < 220) log.push({ action: "drop", rule: "no_forage", text: `${k.name} removed — grazing herd without pasture in reach.` });
    }
  }

  // --- R6: density caps per compartment --------------------------------------
  const capFor = (c: RegionCompartment) => Math.max(4, Math.round(4 + c.landShare * 140 * config.richness));
  const byComp = new Map<number, BioFeature[]>();
  for (const k of kept) {
    const arr = byComp.get(k.compartmentId) ?? [];
    arr.push(k);
    byComp.set(k.compartmentId, arr);
  }
  const final: BioFeature[] = [];
  for (const [compId, arr] of byComp) {
    const comp = comps.find((c) => c.id === compId);
    // Max 2 populations of one species per compartment (keep the richest).
    const perSpecies = new Map<string, BioFeature[]>();
    for (const f of arr) {
      const g = perSpecies.get(f.speciesId) ?? [];
      g.push(f);
      perSpecies.set(f.speciesId, g);
    }
    let pruned: BioFeature[] = [];
    for (const g of perSpecies.values()) {
      g.sort((a, b) => b.abundance - a.abundance);
      const excess = g.length - 2;
      pruned.push(...g.slice(0, 2));
      if (excess > 0) {
        dropped += excess;
        droppedByRule["species_duplicate"] = (droppedByRule["species_duplicate"] ?? 0) + excess;
      }
    }
    const cap = comp ? capFor(comp) : 10;
    if (pruned.length > cap) {
      pruned.sort(
        (a, b) =>
          Number(b.roles.includes("staple")) - Number(a.roles.includes("staple")) || b.abundance - a.abundance
      );
      const excess = pruned.length - cap;
      dropped += excess;
      droppedByRule["overcrowded"] = (droppedByRule["overcrowded"] ?? 0) + excess;
      pruned = pruned.slice(0, cap);
    }
    final.push(...pruned);
  }

  // --- R7: food security — Layer 4's contract --------------------------------
  const addedForRoles: string[] = [];
  let added = 0;
  const hasRole = (role: string) => final.some((f) => f.roles.includes(role as BioFeature["roles"][number]));
  for (const req of REQUIRED_ROLES) {
    if (hasRole(req.role)) continue;
    const candidates = SPECIES_CATALOG.filter((s) => s.roles.includes(req.role as SpeciesDef["roles"][number]));
    let placedSp: SpeciesDef | null = null;
    let placedAt: { p: Pt; irrigated?: boolean } | null = null;
    for (const sp of candidates) {
      const spot = findSpot(sp, env, rng, 22);
      if (spot) {
        placedSp = sp;
        placedAt = spot;
        break;
      }
    }
    if (placedSp && placedAt) {
      const pop = makePopulation(rng, placedSp, placedAt.p, comps, `food-security addition (${req.role})`, 2);
      pop.irrigated = placedAt.irrigated;
      final.push(pop);
      added++;
      addedForRoles.push(`${req.label} → ${placedSp.name}`);
      log.push({ action: "add", rule: "food_security", text: `No ${req.label.toLowerCase()} survived finetuning — added ${placedSp.name} at its best-fit habitat.` });
    } else {
      log.push({ action: "add", rule: "food_security", text: `${req.label}: no catalog species is climate-compatible with this region (allowed absence).` });
    }
  }

  const report: BioFinetuneReport = {
    rawCount: raw.length,
    keptAsIs,
    relocated,
    dropped,
    added,
    finalCount: final.length,
    droppedByRule,
    addedForRoles,
    speciesPresent: new Set(final.map((f) => f.speciesId)).size,
    elapsedMs: Math.round(performance.now() - t0),
  };
  return { populations: final, report, log };
}
