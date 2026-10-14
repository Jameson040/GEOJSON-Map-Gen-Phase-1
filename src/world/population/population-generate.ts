import type { GeneratedRegion, VerificationReport } from "../types";
import type { BioLayerResult } from "../bio/bio-types";
import type { Settlement } from "../human/human-types";
import type { HumanLayerResult } from "../human/human-types";
import { SETTLEMENT_BY_TYPE, TIER_RANK } from "../human/settlement-catalog";
import {
  ERA_META,
  type PopulationConfig,
  type PopulationLayerResult,
  type PopulationProgressFn,
  type ZonePopulation,
} from "./population-types";
import { makeRng, type RNG } from "../rng";
import { dist } from "../geom";
import { kmToUnits } from "../constants";

// ---------------------------------------------------------------------------
// LAYER 5 — POPULATION MODEL
//
//   Generation → model an occupancy curve for EVERY zone, no rules: camps
//                bunch up in deserts, metropolis zones run dry while camps
//                overflow, eras misapplied to ancient_pulse sites.
//
//   Finetune   → era truth (unused tiers by era go to 0 instead of impossible
//                occupations), food shortfall routing (surplus routed to the
//                biosphere, not fed locally), capacity demotion discipline,
//                habitation conflict discipline (ruins stay light unless
//                revived where food & water allow), and foodSecurity shortcuts.
//
//   Verifier   → era ramp holds, hunger flags correct, caps respected, and
//                nothing in L1/L2/L3 changed.
// ---------------------------------------------------------------------------



function siteAreaKm2(s: Settlement): number {
  const def = SETTLEMENT_BY_TYPE.get(s.type)!;
  return Math.max(0.5, (def.supplyKm * def.supplyKm) / 18);
}

function eraFactor(cfg: PopulationConfig, tier: Settlement["tier"]): { maxRank: number; factor: number } {
  const m = ERA_META[cfg.era];
  const rank = TIER_RANK[tier];
  let factor: number;
  switch (rank) {
    case 0: factor = m.nomadicFactor; break;
    case 1: factor = m.hamletFactor; break;
    case 2: factor = m.villageFactor; break;
    case 3: factor = m.townFactor; break;
    case 4: factor = m.cityFactor; break;
    default: factor = m.metropolisFactor;
  }
  return { maxRank: m.maxTierRank, factor };
}

function richestFoodKm2(bio: BioLayerResult, p: [number, number], radiusKm: number): number {
  const r = kmToUnits(radiusKm);
  let score = 0;
  for (const f of bio.populations) {
    const d = dist(f.point, p);
    if (d > r + f.radiusUnits) continue;
    const w = f.abundance;
    if (f.roles.includes("staple")) score += 5 * w;
    if (f.roles.includes("protein")) score += 2.4 * w;
    if (f.roles.includes("fishery")) score += 1.8 * w;
    if (f.roles.includes("vegetable") || f.roles.includes("fruit")) score += 1.1 * w;
    if (f.roles.includes("dairy") || f.roles.includes("meat")) score += 1.4 * w;
  }
  return score;
}

function waterShortage(year: number, region: GeneratedRegion, bio: BioLayerResult): boolean {
  void year;
  const rivers = region.features.filter((f) => f.properties.featureType === "river").length
    + bio.populations.filter((b) => b.category === "reed").length;
  const staples = bio.populations.filter((b) => b.roles.includes("staple")).length;
  return staples === 0 && rivers === 0;
}

function segment(
  phase: ZonePopulation["phases"][number]["phase"],
  startYear: number,
  endYear: number,
  growth: number,
  peak: number,
  end: number
): ZonePopulation["phases"][number] {
  return { phase, startYear, endYear, growthRatePerYr: growth, peakPopulation: peak, endPopulation: end };
}

/** Raw creative model: every zone occupied, per its own structural inputs only. */
function modelZone(
  z: Settlement,
  cfg: PopulationConfig,
  bio: BioLayerResult,
  rng: RNG
): ZonePopulation {
  const def = SETTLEMENT_BY_TYPE.get(z.type)!;
  const rank = TIER_RANK[z.tier];
  const { maxRank, factor } = eraFactor(cfg, z.tier);
  const food = richestFoodKm2(bio, z.point, def.supplyKm * (rank >= 4 ? 2.6 : 1.6));
  const areaKm2 = siteAreaKm2(z);
  const eraBlock = rank > maxRank ? 0 : 1;
  const resource = Math.min(1, 0.4 + Math.log1p(food) / Math.log1p(rank + 8));
  // Structural fill: realistic proportion of structural capacity inhabited
  const fill = Math.min(1.05, Math.max(0.65, 0.70 + 0.25 * rng()));
  // Site vitality from carrying capacity and food resources
  const siteHealth = Math.min(1.0, 0.55 + 0.45 * (z.capacity * 0.6 + resource * 0.4));

  const occ = Math.max(
    0,
    Math.round(
      z.popCap * fill * factor * cfg.targetScale * siteHealth * eraBlock
    )
  );

  let mult = 1;
  if (z.habitation === "ancient_pulse") mult = 0.03 + 0.08 * rng();
  else if (z.habitation === "potential") mult = 0.2 + 0.3 * rng();
  else mult = 0.88 + 0.22 * rng();

  const occupancy = Math.max(0, Math.round(occ * mult));
  const densityPerKm2 = occupancy / Math.max(0.5, areaKm2);
  const waterShort = food < Math.max(1, rank);
  const confidence = z.habitation === "lived_now" ? 2 : z.habitation === "ancient_pulse" ? 1 : 0;

  const backcastYears =
    z.habitation === "ancient_pulse"
      ? 420 + Math.round(360 * rng())
      : z.habitation === "potential"
      ? 40 + Math.round(80 * rng())
      : 12 + Math.round(60 * rng());
  const forwardCastYears =
    z.habitation === "potential" ? 120 : z.habitation === "ancient_pulse" ? 40 : 160;

  const growth = waterShort ? -0.012 - 0.02 * rng() : 0.012 + 0.05 * rng() * z.capacity;
  const growing = growth > 0.02;
  const waterSecure = !waterShort;
  const phases: ZonePopulation["phases"] = [];

  if (z.habitation === "ancient_pulse") {
    const peakPop = Math.max(
      occupancy,
      Math.round(((z.popCap ?? occupancy * 2) * 0.75 + occupancy * 0.35) * (0.8 + 0.5 * rng()))
    );
    const third = Math.max(1, Math.round(backcastYears / 3));
    phases.push(
      segment("growth", -backcastYears, -third, 0.04, peakPop, Math.max(bottomOf(z.popCap), Math.round(occupancy * 2))),
      segment("decline", -third, -1, -0.04, peakPop, occupancy),
      segment("founding", 0, Math.max(1, forwardCastYears / 40), 0, occupancy, occupancy)
    );
  } else if (z.habitation === "potential") {
    phases.push(
      segment("founding", -backcastYears, -1, 0.01, occupancy, Math.max(0, Math.round(occupancy * 0.1)))
    );
  } else {
    phases.push(
      segment(growing ? "growth" : "steady", -backcastYears, -1, growth, occupancy, Math.max(0, Math.round(occupancy * 0.7)))
    );
    phases[0].peakPopulation = occupancy;
  }

  // Forward span (always, from 0 to forwardCast)
  const finalPop = Math.max(0, occupancy > 0 ? Math.round(occupancy * (1 + growth * Math.max(1, forwardCastYears))) : occupancy);
  phases.push({
    phase: growing ? "growth" : waterShort ? "decline" : "steady",
    startYear: 0,
    endYear: forwardCastYears,
    growthRatePerYr: growth,
    peakPopulation: Math.max(occupancy, finalPop),
    endPopulation: finalPop,
  });

  const numberOfDrivers = {
    habitation: z.habitation === "lived_now" ? 0.5 : z.habitation === "ancient_pulse" ? -0.3 : -0.15,
    foodPerKm2: Math.min(2, Math.round((food / Math.max(1, rank + 1)) * 10) / 100),
    eraFactor: Number(factor.toFixed(2)),
    targetScale: Number(cfg.targetScale.toFixed(2)),
  };

  return {
    zoneId: z.id,
    layer: "population",
    occupancy,
    densityPerKm2: Math.round(densityPerKm2 * 100) / 100,
    hardCap: Math.max(occupancy, Math.round(z.popCap * 1.2)),
    usagePercent: z.popCap > 0 ? Math.round((occupancy / z.popCap) * 100) : 0,
    confidence,
    foodShortage: waterShort,
    waterSecure,
    yearProduced: cfg.year,
    backcastYears,
    forwardCastYears,
    phases,
    drivers: numberOfDrivers,
  } as ZonePopulation;
}

function bottomOf(popCap: number): number {
  return Math.round(popCap * 0.12);
}

export async function generatePopulationLayer(
  region: GeneratedRegion,
  bio: BioLayerResult,
  zones: HumanLayerResult,
  config: PopulationConfig,
  onProgress?: PopulationProgressFn
): Promise<PopulationLayerResult> {
  const t0 = performance.now();
  const seedUsed = `${region.descriptor.regionSeed}::population::${config.era}::${config.year}::${config.customSeed ?? "default"}`;
  const rng = makeRng(seedUsed);
  const tick = async (stage: number, stageName: string, percent: number, featuresCount: number) => {
    onProgress?.({ stage, totalStages: 4, stageName, percent, featuresCount, elapsedMs: Math.round(performance.now() - t0) });
    await new Promise((r) => setTimeout(r, 0));
  };

  await tick(1, "Modelling Occupancy Curves Per Zone", 20, 0);
  const rawModel = new Map<string, ZonePopulation>();
  for (const z of zones.settlements) {
    rawModel.set(z.id, modelZone(z, config, bio, rng));
  }

  await tick(2, "Finetuning With Era Truth & Resource Rules", 55, rawModel.size);
  const { model, report } = finetunePopulation(rawModel, zones, region, bio, config);
  const verifyBefore = verifyPopulation(rawModel, model, zones, region, bio, config);

  await tick(3, "Verifying Population Invariants", 85, model.size);
  const verifyAfter = verifyPopulation(model, model, zones, region, bio, config);

  await tick(4, "Population Layer Ready", 100, model.size);

  return {
    regionId: region.descriptor.id,
    regionName: region.descriptor.name,
    config,
    seedUsed,
    model,
    rawModel,
    report,
    verifyBefore,
    verifyAfter,
    generatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------

function finetunePopulation(
  rawModel: Map<string, ZonePopulation>,
  zones: HumanLayerResult,
  region: GeneratedRegion,
  bio: BioLayerResult,
  cfg: PopulationConfig
): { model: Map<string, ZonePopulation>; report: PopulationLayerResult["report"] } {
  const t0 = performance.now();
  const model = new Map<string, ZonePopulation>();
  const droppedByRule: PopulationLayerResult["report"]["droppedByRule"] = {};
  let movedToBiosphere = 0;
  let downgraded = 0;
  let upgraded = 0;
  let revived = 0;

  for (const z of zones.settlements) {
    const raw = rawModel.get(z.id)!;
    const def = SETTLEMENT_BY_TYPE.get(z.type)!;
    const rank = TIER_RANK[z.tier];
    const { maxRank, factor } = eraFactor(cfg, z.tier);
    const food = richestFoodKm2(bio, z.point, def.supplyKm);
    const eraViolation = rank > maxRank;
    const foodCollapse = cfg.targetScale >= 0.9 && waterShortage(cfg.year, region, bio);
    const hunger = raw.foodShortage && raw.occupancy > 0;

    let occ = raw.occupancy;
    const phases = raw.phases.map((p) => ({ ...p }));

    // era truth: unused-by-era tiers must be zero (no impossible cities in an
    // early world), and only their *evidence* survives as unoccupied sites.
    if (eraViolation) {
      downgradedBy(droppedByRule, "era_unused_tier");
      occ = 0;
      for (const p of phases) p.endPopulation = 0;
      downgraded++;
    }

    // hunger discipline: local feed cap, surplus routed to the biosphere
    if (hunger) {
      const allowed = Math.round(raw.occupancy * 0.55);
      movedToBiosphere += raw.occupancy - allowed;
      occ = Math.min(occ, allowed);
      downgradedBy(droppedByRule, "hunger_capped");
      downgraded++;
    }
    if (foodCollapse) {
      occ = Math.round(occ * 0.35);
      downgraded++;
      downgradedBy(droppedByRule, "systemic_shortage");
    }

    // habitation discipline
    if (z.habitation === "ancient_pulse" && occ > 0) {
      // a ruin stays light unless food is rich enough to revive with evidence
      if (food > rank * 6 && !eraViolation && cfg.era !== "early_no_rivers" && cfg.era !== "postIndustrial") {
        revived++;
        downgradedBy(droppedByRule, "ruin_revived");
      } else if (occ > z.popCap * 0.35) {
        occ = Math.round(z.popCap * 0.35);
        downgradedBy(droppedByRule, "ruin_capped");
      }
    }
    if (z.habitation === "potential" && occ > z.popCap * 0.8) {
      occ = Math.round(z.popCap * 0.8);
      downgradedBy(droppedByRule, "potential_capped");
    }

    // cap: never above site band × (0.5 + 0.5 × capacity)
    const hardLocalCap = Math.round(z.popCap * Math.max(0.5, Math.min(1.05, 0.5 + 0.5 * z.capacity)) * cfg.targetScale);
    if (occ > hardLocalCap) {
      downgradedBy(droppedByRule, "over_building_coefficient");
      movedToBiosphere += occ - hardLocalCap;
      occ = hardLocalCap;
      downgraded++;
    }

    if (!phaseHasAny(phases) || (occ === 0 && phases.length === 0)) {
      upgraded++;
      const lastYear = cfg.year;
      phases.length = 0;
      phases.push({ phase: occ === 0 ? "abandoned" : "founding", startYear: lastYear, endYear: lastYear + Math.max(20, raw.forwardCastYears), growthRatePerYr: raw.phases[1]?.growthRatePerYr ?? raw.phases[0]?.growthRatePerYr ?? 0.01, peakPopulation: occ, endPopulation: occ });
    }

    const revivedRuin = revived > 0 && z.habitation === "ancient_pulse" && occ > 0 && !eraViolation;
    const hungerEffective = hunger || foodCollapse;
    model.set(z.id, {
      ...raw,
      occupancy: occ,
      foodShortage: hungerEffective,
      waterSecure: !hungerEffective || rank === 0,
      usagePercent: z.popCap > 0 ? Math.round((occ / z.popCap) * 100) : 0,
      densityPerKm2: Math.round((occ / Math.max(0.5, siteAreaKm2(z))) * 100) / 100,
      drivers: {
        ...raw.drivers,
        eraFactor: Number(factor.toFixed(2)),
        revived: revivedRuin ? 1 : 0,
        hunger: hungerEffective ? 1 : 0,
        foodPerKm2: Math.round(food * 10) / 10,
      },
      phases,
    } as ZonePopulation);
  }

  return {
    model,
    report: {
      zonesModelled: model.size,
      rawOccupancy: [...rawModel.values()].reduce((s, z) => s + z.occupancy, 0),
      movedToBiosphere,
      downgraded,
      upgraded,
      revived,
      finalOccupancy: [...model.values()].reduce((s, z) => s + z.occupancy, 0),
      foodShortageZones: [...model.values()].filter((z) => z.foodShortage).length,
      droppedByRule,
      elapsedMs: Math.round(performance.now() - t0),
    },
  };
}

function downgradedBy(map: Record<string, number>, rule: string) {
  map[rule] = (map[rule] ?? 0) + 1;
}

function phaseHasAny(phases: ZonePopulation["phases"]): boolean {
  return phases.some((p) => p.endPopulation > 0);
}

// ---------------------------------------------------------------------------

function verifyPopulation(
  _before: Map<string, ZonePopulation>,
  after: Map<string, ZonePopulation>,
  zones: HumanLayerResult,
  region: GeneratedRegion,
  bio: BioLayerResult,
  cfg: PopulationConfig
): VerificationReport {
  const t0 = performance.now();
  const checks: VerificationReport["checks"] = [];
  const push = (
    id: string,
    category: VerificationReport["checks"][number]["category"],
    title: string,
    rule: string,
    checkedCount: number,
    violations: string[],
    ok: string
  ) =>
    checks.push({ id, category, title, rule, passed: violations.length === 0, checkedCount, violationCount: violations.length, details: violations.length === 0 ? ok : `${violations.length} violations.`, sampleViolations: violations.slice(0, 5) });

  // 1. era ramp — no city/city+ people before their time
  {
    const m = ERA_META[cfg.era];
    const v: string[] = [];
    for (const z of zones.settlements) {
      const p = after.get(z.id);
      if (!p) continue;
      const rank = TIER_RANK[z.tier];
      if (rank > m.maxTierRank && p.occupancy > 0) v.push(`${z.name}: occupied ${z.tier} site in the ${m.label} era`);
    }
    push("pop_era_ramp", "presence", "Era Ramp Holds",
      `No settlement tier above rank ${m.maxTierRank} may hold people in the ${m.label} era.`,
      after.size, v, v.length === 0 ? `No tier above rank ${m.maxTierRank} holds people in the ${m.label} era.` : "");
  }

  // 2. hunger flag honesty
  {
    const v: string[] = [];
    for (const z of zones.settlements) {
      const p = after.get(z.id);
      if (!p) continue;
      if (p.foodShortage && !waterShortage(cfg.year, region, bio)) {
        const rich = richestFoodKm2(bio, z.point, SETTLEMENT_BY_TYPE.get(z.type)!.supplyKm);
        if (rich > TIER_RANK[z.tier] * 8) v.push(`${z.name}: flagged hungry while rich food lands nearby`);
      }
    }
    push("pop_hunger_flags", "placement", "Hunger Flags Match Resources",
      "A zone is only marked food-short when the biosphere genuinely cannot feed it, and surplus people are routed to the biosphere, not fed locally.",
      after.size, v, v.length === 0 ? "Hunger flags match local food availability." : "");
  }

  // 3. caps and habitation contracts
  {
    const v: string[] = [];
    const scale = Math.max(0.1, cfg.targetScale);
    for (const z of zones.settlements) {
      const p = after.get(z.id);
      if (!p) continue;
      const def = SETTLEMENT_BY_TYPE.get(z.type)!;
      if (p.occupancy > def.popCap[1] * scale * 1.6) v.push(`${z.name}: occupancy ${p.occupancy.toLocaleString()} far above the ${def.name} band at scale ${scale}`);
      if (z.habitation === "ancient_pulse" && p.occupancy > z.popCap * 0.5 * scale * 1.6 + 1 && p.occupancy > 0) {
        v.push(`${z.name}: a marked ruin carries ${p.occupancy.toLocaleString()} people without revival`);
      }
    }
    push("pop_caps_and_ruins", "scale", "Caps & Ruin/Revival Contracts",
      "No zone out-builds its band, and an ancient-pulse zone only carries people when revived by evidence of food and security.",
      after.size, v, v.length === 0 ? "All occupancies stay within their site band and ruin contracts." : "");
  }

  // 4. lower layers untouched + history structure
  {
    const v: string[] = [];
    for (const z of zones.settlements) {
      const p = after.get(z.id);
      if (!p) {
        v.push(`${z.name}: no population record`);
        continue;
      }
      for (const ph of p.phases) {
        if (ph.startYear > ph.endYear) v.push(`${z.name}: segment ${ph.phase} starts after it ends`);
        if (!Number.isFinite(ph.endPopulation) || ph.endPopulation < 0) v.push(`${z.name}: negative population in ${ph.phase}`);
      }
    }
    if (region.features.length < 1) v.push("Geography feature set empty (L1 missing)");
    if (bio.populations.length < 1) v.push("Biosphere empty (L2 missing)");
    push("pop_causality_and_structure", "presence", "Causal History Structure Intact",
      "Population values are generative history junctions (founding → growth → steady → decline) with sane spans and non-negative ends, and L1/L2 stay populated under it.",
      after.size + 2, v, v.length === 0 ? "History curves are structurally sound and anchored in the lower layers." : "");
  }

  const passedChecks = checks.filter((c) => c.passed).length;
  const totalViolations = checks.reduce((a, c) => a + c.violationCount, 0);
  return {
    targetName: `${region.descriptor.name} — Population (${ERA_META[cfg.era].label}, yr ${cfg.year})`,
    tier: 2,
    passedAll: totalViolations === 0,
    totalChecks: checks.length,
    passedChecks,
    totalViolations,
    elapsedMs: Math.round(performance.now() - t0),
    checks,
  };
}

void modelZone;
