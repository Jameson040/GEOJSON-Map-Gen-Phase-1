import type { GeneratedRegion, Pt, RegionCompartment } from "../types";
import type { BioLayerResult } from "../bio/bio-types";
import type { ResourceLayerResult } from "../resources/resource-types";
import type {
  HabitationState,
  HumanConfig,
  HumanLayerResult,
  HumanProgressFn,
  HumanStats,
  Settlement,
  SettlementDef,
  SettlementDiff,
  SettlementTier,
} from "./human-types";
import { SETTLEMENT_CATALOG, TIER_RANK } from "./settlement-catalog";
import { HumanEnvReader } from "./human-env";
import { runHumanFinetune } from "./human-finetune";
import { verifyHumanLayer } from "./human-verifier";
import { makeRng, range, type RNG } from "../rng";
import { makeStem } from "../names";

// ---------------------------------------------------------------------------
// LAYER 4 GENERATION — creative and unconstrained, and POPULATION-FREE.
//
// Candidate habitable zones of every type are dropped anywhere: a metropolis
// site mid-desert, a fishing site on a summit. Nobody lives anywhere yet —
// population is Layer 5, produced per zone against all three layers beneath.
// ---------------------------------------------------------------------------

let uid = 0;
const nid = () => `set_${++uid}`;

const SUFFIX: Record<SettlementTier, string[]> = {
  nomadic: ["Camp", "Ground", "Flats"],
  hamlet: ["stead", "wick", "croft", "holm"],
  village: ["ton", "by", "ham", "ford", "dale"],
  town: ["bury", "mouth", "bridge", "market", "haven"],
  city: ["polis", "grad", "abad", "burg", "ia"],
  metropolis: ["opolis", "burgh", "a"],
};

export function nameSettlement(rng: RNG, def: SettlementDef): string {
  const stem = makeStem(rng);
  const suf = SUFFIX[def.tier][Math.floor(rng() * SUFFIX[def.tier].length)];
  if (def.tier === "nomadic") return `${stem} ${suf}`;
  if (def.type === "monastery") return `${stem} Abbey`;
  if (def.type === "hill_fort" || def.type === "fortress_city") return `${stem} Keep`;
  if (def.type === "capital_city") return `${stem}`;
  return `${stem}${suf}`;
}

/** Default evidence state: mostly active inhabited sites, a few emerging and relics. */
export function chooseHabitation(rng: RNG): HabitationState {
  const roll = rng();
  if (roll < 0.05) return "ancient_pulse"; // abandoned long ago — a ruin or old camp
  if (roll < 0.15) return "potential"; // suitable emerging site
  return "lived_now";
}

function compartmentAt(p: Pt, comps: RegionCompartment[]): number {
  for (const c of comps) {
    if (p[0] >= c.bbox.minX && p[0] <= c.bbox.maxX && p[1] >= c.bbox.minY && p[1] <= c.bbox.maxY) return c.id;
  }
  return -1;
}

export function makeSettlement(
  rng: RNG,
  def: SettlementDef,
  p: Pt,
  comps: RegionCompartment[],
  origin: string,
  habitation?: HabitationState
): Settlement {
  const popCap = Math.round(range(rng, def.popCap[0], def.popCap[1]));
  const rank = TIER_RANK[def.tier];
  return {
    id: nid(),
    layer: "human",
    type: def.type,
    tier: def.tier,
    name: nameSettlement(rng, def),
    glyph: def.glyph,
    point: p,
    popCap,
    capacity: 0,
    habitation: habitation ?? chooseHabitation(rng),
    compartmentId: compartmentAt(p, comps),
    resourceRoles: [],
    siteTraits: [],
    origin,
    lodZoom: rank >= 4 ? 0 : rank === 3 ? 0.9 : rank === 2 ? 2 : 3.2,
  };
}

function pickDef(rng: RNG, urbanisation: number): SettlementDef {
  const w: Record<SettlementTier, number> = {
    nomadic: 0.5,
    hamlet: 2.8 - urbanisation * 0.5,
    village: 3.2,
    town: 1.4 + urbanisation,
    city: 0.6 + urbanisation * 0.8,
    metropolis: 0.1 + urbanisation * 0.3,
  };
  const total = Object.values(w).reduce((s, x) => s + x, 0);
  let roll = rng() * total;
  let tier: SettlementTier = "village";
  for (const [t, x] of Object.entries(w) as [SettlementTier, number][]) {
    roll -= x;
    if (roll <= 0) {
      tier = t;
      break;
    }
  }
  const pool = SETTLEMENT_CATALOG.filter((d) => d.tier === tier);
  return pool[Math.floor(rng() * pool.length)];
}

export async function generateHumanLayer(
  region: GeneratedRegion,
  bio: BioLayerResult,
  config: HumanConfig,
  onProgress?: HumanProgressFn,
  resources?: ResourceLayerResult | null
): Promise<HumanLayerResult> {
  uid = 0;
  const t0 = performance.now();
  const seedUsed = `${region.descriptor.regionSeed}::human::${config.customSeed ?? "default"}`;
  const rng = makeRng(seedUsed);
  const tick = async (stage: number, stageName: string, percent: number, featuresCount: number) => {
    onProgress?.({ stage, totalStages: 4, stageName, percent, featuresCount, elapsedMs: Math.round(performance.now() - t0) });
    await new Promise((r) => setTimeout(r, 0));
  };

  await tick(1, "Reading Frozen Geography & Biosphere", 10, 0);
  const env = new HumanEnvReader(region, bio, resources);
  const comps = region.compartments;
  const geoCount = region.features.length;
  const bioCount = bio.populations.length;

  await tick(2, "Creative Scatter — Marking Habitable Sites Freely", 30, 0);
  const b = region.descriptor.bbox;
  const padX = (b.maxX - b.minX) * 0.15;
  const padY = (b.maxY - b.minY) * 0.15;
  const landMkm2 = region.descriptor.areaKm2 / 1e6;
  const target = Math.max(30, Math.min(1200, Math.round((60 + Math.sqrt(landMkm2) * 140 + landMkm2 * 45 + comps.length * 1.5) * config.density)));

  const raw: Settlement[] = [];
  for (let i = 0; i < target; i++) {
    const def = pickDef(rng, config.urbanisation);
    const p: Pt = [range(rng, b.minX - padX, b.maxX + padX), range(rng, b.minY - padY, b.maxY + padY)];
    raw.push(makeSettlement(rng, def, p, comps, "creative founding"));
  }
  if (!raw.some((s) => s.tier === "city" || s.tier === "metropolis")) {
    const cap = SETTLEMENT_CATALOG.find((d) => d.type === "capital_city")!;
    raw.push(makeSettlement(rng, cap, [range(rng, b.minX, b.maxX), range(rng, b.minY, b.maxY)], comps, "creative founding"));
  }

  await tick(3, "Finetune — Resolving Water, Resources, Terrain & Hierarchy", 60, raw.length);
  const verifyBefore = verifyHumanLayer(raw, env, region, bio, geoCount, bioCount);
  const { settlements, report, log, diffs } = runHumanFinetune(raw, env, region, config, rng);

  await tick(4, "Verifying Habitable-Zone Invariants", 90, settlements.length);
  const verifyAfter = verifyHumanLayer(settlements, env, region, bio, geoCount, bioCount);
  const stats = computeStats(settlements);
  await tick(4, "Habitable Zones Ready", 100, settlements.length);

  return {
    regionId: region.descriptor.id,
    regionName: region.descriptor.name,
    config,
    seedUsed,
    settlements,
    rawSettlements: raw,
    diffs,
    report,
    log,
    verifyBefore,
    verifyAfter,
    stats,
    generatedAt: Date.now(),
  };
}

function computeStats(s: Settlement[]): HumanStats {
  const byTier: Record<SettlementTier, number> = { nomadic: 0, hamlet: 0, village: 0, town: 0, city: 0, metropolis: 0 };
  const byType: Record<string, number> = {};
  const byHabitation: Record<HabitationState, number> = { lived_now: 0, ancient_pulse: 0, potential: 0 };
  let bestSite: HumanStats["bestSite"] = null;
  let totalCapacity = 0;
  let landShare = 0;
  for (const x of s) {
    byTier[x.tier]++;
    byType[x.type] = (byType[x.type] ?? 0) + 1;
    byHabitation[x.habitation]++;
    totalCapacity += x.popCap;
    landShare += x.capacity;
    if (!bestSite || x.capacity > bestSite.capacity) bestSite = { name: x.name, type: x.type, capacity: Math.round(x.capacity * 100) / 100 };
  }
  return {
    zones: s.length,
    byTier,
    byType,
    bestSite,
    totalCapacity,
    areaCoverage: s.length ? Math.round((landShare / s.length) * 100) / 100 : 0,
    byHabitation,
  };
}

export function diffSettlements(before: Settlement[], after: Settlement[]): SettlementDiff[] {
  const byId = new Map(before.map((s) => [s.id, s]));
  const out: SettlementDiff[] = [];
  for (const s of after) {
    const old = byId.get(s.id);
    if (!old) out.push({ id: s.id, type: s.type, afterCap: s.popCap, note: "added" });
    else if (old.popCap !== s.popCap) out.push({ id: s.id, type: s.type, beforeCap: old.popCap, afterCap: s.popCap, note: "structural capacity change" });
  }
  for (const s of before) if (!after.find((a) => a.id === s.id)) out.push({ id: s.id, type: s.type, beforeCap: s.popCap, note: "removed" });
  return out;
}
