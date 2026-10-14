import type { GeneratedRegion, Pt, RegionCompartment } from "../types";
import type { BioConfig, BioFeature, BioLayerResult, BioProgressFn, BioStats, SpeciesDef, SpeciesKind } from "./bio-types";
import { SPECIES_CATALOG } from "./species-catalog";
import { BioEnvReader } from "./bio-env";
import { runBioFinetune } from "./bio-finetune";
import { verifyBioLayer } from "./bio-verifier";
import { makeRng, range, irange, type RNG } from "../rng";
import { kmToUnits } from "../constants";

// ---------------------------------------------------------------------------
// LAYER 2 GENERATION — deliberately creative and unconstrained.
//
// Populations are scattered with no regard for climate, habitat or water:
// rice may land on a glacier, tuna in a desert, camels in a rainforest.
// That chaos is the point — the Finetune stage is where geography-derived
// rules drop, relocate or add populations to resolve every contradiction.
// The frozen geographic layer is only read, never written.
// ---------------------------------------------------------------------------

let uid = 0;
const nid = () => `bio_${++uid}`;

function pickKind(rng: RNG, wildShare: number): SpeciesKind {
  const w: [SpeciesKind, number][] = [
    ["crop", 0.44],
    ["livestock", 0.2],
    ["wild", 0.22 * wildShare],
    ["flora", 0.14],
  ];
  const total = w.reduce((s, [, x]) => s + x, 0);
  let roll = rng() * total;
  for (const [k, x] of w) {
    roll -= x;
    if (roll <= 0) return k;
  }
  return "crop";
}

function compartmentAt(p: Pt, comps: RegionCompartment[]): number {
  for (const c of comps) {
    if (p[0] >= c.bbox.minX && p[0] <= c.bbox.maxX && p[1] >= c.bbox.minY && p[1] <= c.bbox.maxY) return c.id;
  }
  return -1;
}

export function makePopulation(
  rng: RNG,
  sp: SpeciesDef,
  p: Pt,
  comps: RegionCompartment[],
  origin: string,
  abundance?: 1 | 2 | 3
): BioFeature {
  const ab = abundance ?? ((irange(rng, 1, 3) as 1 | 2 | 3) || 2);
  const spreadKm = range(rng, sp.spreadKm[0], sp.spreadKm[1]) * (0.6 + ab * 0.25);
  const important = sp.staple || sp.kind === "livestock" || sp.roles.includes("fishery") || sp.roles.includes("timber");
  return {
    id: nid(),
    layer: "bio",
    speciesId: sp.id,
    name: sp.name,
    glyph: sp.glyph,
    kind: sp.kind,
    category: sp.category,
    roles: sp.roles,
    point: p,
    radiusUnits: kmToUnits(spreadKm),
    abundance: ab,
    compartmentId: compartmentAt(p, comps),
    origin,
    lodZoom: important && ab >= 2 ? 0 : ab >= 2 ? 1.6 : 3,
  };
}

export async function generateBioLayer(
  region: GeneratedRegion,
  config: BioConfig,
  onProgress?: BioProgressFn
): Promise<BioLayerResult> {
  uid = 0;
  const t0 = performance.now();
  const seedUsed = `${region.descriptor.regionSeed}::bio::${config.customSeed ?? "default"}`;
  const rng = makeRng(seedUsed);
  const tick = async (stage: number, stageName: string, percent: number, featuresCount: number) => {
    onProgress?.({ stage, totalStages: 4, stageName, percent, featuresCount, elapsedMs: Math.round(performance.now() - t0) });
    await new Promise((r) => setTimeout(r, 0));
  };

  // -- Stage 1: read the frozen geography (read-only) ------------------------
  await tick(1, "Reading Frozen Geographic Layer", 10, 0);
  const env = new BioEnvReader(region);
  const comps = region.compartments;
  const geoFeatureCountBefore = region.features.length;

  // -- Stage 2: creative scatter ---------------------------------------------
  await tick(2, "Creative Scatter — Seeding Populations Freely", 30, 0);
  const b = region.descriptor.bbox;
  const padX = (b.maxX - b.minX) * 0.18;
  const padY = (b.maxY - b.minY) * 0.18;
  const landMkm2 = region.descriptor.areaKm2 / 1e6;
  const target = Math.max(24, Math.min(1200, Math.round((comps.length * 1.5 + Math.sqrt(landMkm2) * 50 + landMkm2 * 10 + 16) * config.richness)));

  const byKind = new Map<SpeciesKind, SpeciesDef[]>();
  for (const sp of SPECIES_CATALOG) {
    const arr = byKind.get(sp.kind) ?? [];
    arr.push(sp);
    byKind.set(sp.kind, arr);
  }

  const raw: BioFeature[] = [];
  for (let i = 0; i < target; i++) {
    const kind = pickKind(rng, config.wildShare);
    const pool = byKind.get(kind)!;
    const sp = pool[Math.floor(rng() * pool.length)];
    // Anywhere in the padded bbox — including open ocean. No rules here.
    const p: Pt = [range(rng, b.minX - padX, b.maxX + padX), range(rng, b.minY - padY, b.maxY + padY)];
    raw.push(makePopulation(rng, sp, p, comps, "creative scatter"));
  }

  // -- Stage 3: finetune against geography -----------------------------------
  await tick(3, "Finetune — Resolving Contradictions vs Geography", 60, raw.length);
  const verifyBefore = verifyBioLayer(raw, env, region, geoFeatureCountBefore);
  const { populations, report, log } = runBioFinetune(raw, env, region, config, rng);

  // -- Stage 4: verify --------------------------------------------------------
  await tick(4, "Verifying Biosphere Invariants", 90, populations.length);
  const verifyAfter = verifyBioLayer(populations, env, region, geoFeatureCountBefore);

  const stats = computeStats(populations);
  await tick(4, "Biosphere Ready", 100, populations.length);

  return {
    regionId: region.descriptor.id,
    regionName: region.descriptor.name,
    config,
    seedUsed,
    populations,
    rawPopulations: raw,
    report,
    log,
    verifyBefore,
    verifyAfter,
    stats,
    generatedAt: Date.now(),
  };
}

function computeStats(pops: BioFeature[]): BioStats {
  const byKind: Record<SpeciesKind, number> = { crop: 0, livestock: 0, wild: 0, flora: 0 };
  const roleCoverage: Record<string, boolean> = {};
  const species = new Set<string>();
  const staples = new Set<string>();
  const proteins = new Set<string>();
  let irrigated = 0;
  for (const p of pops) {
    byKind[p.kind]++;
    species.add(p.speciesId);
    for (const r of p.roles) roleCoverage[r] = true;
    if (p.roles.includes("staple")) staples.add(p.name);
    if (p.roles.includes("protein") || p.roles.includes("meat") || p.roles.includes("fishery")) proteins.add(p.name);
    if (p.irrigated) irrigated++;
  }
  return {
    populations: pops.length,
    species: species.size,
    byKind,
    roleCoverage,
    staples: [...staples].slice(0, 8),
    proteins: [...proteins].slice(0, 8),
    irrigatedFarms: irrigated,
    wildPopulations: byKind.wild,
  };
}
