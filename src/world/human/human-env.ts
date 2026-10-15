import type { GeneratedRegion, MapFeature, Pt } from "../types";
import type { BioFeature, BioLayerResult } from "../bio/bio-types";
import type { ResourceDepositNode, ResourceLayerResult } from "../resources/resource-types";
import type { SettlementDef, SiteNeed } from "./human-types";
import { BioEnvReader } from "../bio/bio-env";
import { dist } from "../geom";
import { kmToUnits, unitsToKm } from "../constants";

// ---------------------------------------------------------------------------
// READ-ONLY bridge for Layer 4. Reuses the biosphere's geography reader (which
// itself only reads the frozen GeneratedRegion) and adds a view of the frozen
// biosphere populations and geological resources, so a settlement site can be
// judged on terrain, water, biome, food and mineral supply without touching lower layers.
// ---------------------------------------------------------------------------

export interface SiteReport {
  ok: boolean;
  rule?: string;
  traits: SiteNeed[];
  supplies: string[];
  waterSource?: string;
  score: number;
}

const FARM_BIOMES = new Set(["grassland", "savanna", "forest", "wetland"]);
const PASTURE_BIOMES = new Set(["grassland", "savanna", "tundra"]);

export class HumanEnvReader {
  readonly geo: BioEnvReader;
  readonly region: GeneratedRegion;
  readonly bio: BioLayerResult;
  readonly resources?: ResourceLayerResult | null;
  private riverNames: { pts: Pt[]; name: string }[] = [];
  private lakeNames: { c: Pt; r: number; name: string }[] = [];
  private isIsland: boolean;

  constructor(region: GeneratedRegion, bio: BioLayerResult, resources?: ResourceLayerResult | null) {
    this.region = region;
    this.bio = bio;
    this.resources = resources;
    this.geo = new BioEnvReader(region);
    this.isIsland = region.descriptor.kind === "island";
    for (const f of region.features as MapFeature[]) {
      if (f.properties.featureType === "river" && f.geometry.type === "LineString") {
        const co = f.geometry.coordinates as Pt[];
        const pts: Pt[] = [];
        for (let i = 0; i < co.length; i += 2) pts.push(co[i]);
        this.riverNames.push({ pts, name: f.properties.name });
      } else if (f.properties.featureType === "lake" && f.geometry.type === "Polygon") {
        const b = f.bbox;
        this.lakeNames.push({
          c: [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2],
          r: Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2,
          name: f.properties.name,
        });
      }
    }
  }

  nearestWater(p: Pt): { km: number; name: string; kind: "river" | "lake" } | null {
    let best: { km: number; name: string; kind: "river" | "lake" } | null = null;
    for (const r of this.riverNames) {
      for (const q of r.pts) {
        const d = unitsToKm(dist(p, q));
        if (!best || d < best.km) best = { km: d, name: r.name, kind: "river" };
      }
    }
    for (const l of this.lakeNames) {
      const d = unitsToKm(Math.max(0, dist(p, l.c) - l.r));
      if (!best || d < best.km) best = { km: d, name: l.name, kind: "lake" };
    }
    return best;
  }

  /** Bio populations whose supply circle reaches within `km` of p. */
  foodWithin(p: Pt, km: number): BioFeature[] {
    const r = kmToUnits(km);
    return this.bio.populations.filter((b) => dist(b.point, p) <= r + b.radiusUnits);
  }

  /** Geological resource deposits whose center lies within `km` of p. */
  mineralsWithin(p: Pt, km: number): ResourceDepositNode[] {
    if (!this.resources?.deposits) return [];
    const r = kmToUnits(km);
    return this.resources.deposits.filter((d) => dist(d.point, p) <= r);
  }

  randomLandPoint(rng: () => number, minInland = 0): Pt | null {
    return this.geo.mask.sampleLand(rng, minInland);
  }

  randomCoastPoint(rng: () => number): Pt | null {
    // a land point just inside the shore
    for (let t = 0; t < 30; t++) {
      const off = this.geo.randomOffshorePoint(rng, 0.5, 3);
      if (!off) continue;
      // walk inward a bit
      const c = this.region.descriptor.centroid;
      const dx = c[0] - off[0];
      const dy = c[1] - off[1];
      const L = Math.hypot(dx, dy) || 1;
      for (const step of [6, 12, 20, 32]) {
        const p: Pt = [off[0] + (dx / L) * step, off[1] + (dy / L) * step];
        if (this.geo.mask.isLand(p)) return p;
      }
    }
    return null;
  }

  randomRiverSite(rng: () => number): Pt | null {
    const r = this.geo.randomRiverPoint(rng);
    if (!r) return null;
    for (let t = 0; t < 8; t++) {
      const p: Pt = [r[0] + (rng() - 0.5) * kmToUnits(5), r[1] + (rng() - 0.5) * kmToUnits(5)];
      if (this.geo.mask.isLand(p)) return p;
    }
    return null;
  }

  /** Evaluate a candidate site for a settlement definition. */
  evaluate(def: SettlementDef, p: Pt): SiteReport {
    const env = this.geo.envAt(p);
    const traits: SiteNeed[] = [];
    if (!env.onLand) return { ok: false, rule: "in_ocean", traits, supplies: [], score: -1 };
    if (env.biome === "glacier") return { ok: false, rule: "on_glacier", traits, supplies: [], score: -1 };
    if (def.forbidBiomes && env.biome && def.forbidBiomes.includes(env.biome))
      return { ok: false, rule: `hostile_biome:${env.biome}`, traits, supplies: [], score: -1 };

    const water = this.nearestWater(p);
    const coastKm = env.coastKm;
    const supplies = this.foodWithin(p, def.supplyKm);
    const nearbyMinerals = this.mineralsWithin(p, Math.max(30, def.supplyKm));
    const roles = new Set<string>();
    for (const s of supplies) for (const r of s.roles) roles.add(r);

    // --- traits present at this site ---
    if (coastKm <= 12) traits.push("coast");
    if (water && water.kind === "river" && water.km <= 6) traits.push("river");
    if (water && water.km <= 25) traits.push("freshwater");
    if (env.biome && FARM_BIOMES.has(env.biome) && !env.inRange)
      traits.push("farmland");
    if ((env.biome && PASTURE_BIOMES.has(env.biome)) || roles.has("forage")) traits.push("pasture");
    if (env.biome === "forest" || roles.has("timber")) traits.push("forest");
    if (roles.has("fishery")) traits.push("fish");
    if (env.inRange) traits.push("mountain");
    if (env.inRange || env.inPlateau) traits.push("highland");
    if (!env.inRange) traits.push("flat");
    if (env.biome === "desert") traits.push("desert");
    if (env.biome === "desert" && water && water.km <= 12) traits.push("oasis");
    if (this.isIsland) traits.push("island");
    if (nearbyMinerals.length > 0) traits.push("minerals");

    // --- hard needs ---
    for (const need of def.needs) {
      if (!traits.includes(need)) return { ok: false, rule: `needs_${need}`, traits, supplies: [], score: -1 };
    }
    // --- water ---
    const waterKm = Math.min(water ? water.km : Infinity, def.needs.includes("coast") ? coastKm : Infinity);
    if (waterKm > def.waterKm) return { ok: false, rule: "no_water", traits, supplies: [], score: -1 };
    // --- food supply from the biosphere ---
    if (def.foodRoles.length > 0) {
      const hasFood = def.foodRoles.some((role) => roles.has(role)) || roles.has("staple") || roles.has("fishery") || traits.includes("farmland");
      if (!hasFood) return { ok: false, rule: `no_food:${def.foodRoles[0]}`, traits, supplies: [], score: -1 };
    }

    let score = 1;
    for (const pref of def.prefers) if (traits.includes(pref)) score += 0.5;
    for (const role of def.foodRoles) if (roles.has(role)) score += 0.35;
    if ((def.type === "mining_camp" || def.type === "mining_town") && nearbyMinerals.length > 0) {
      score += 1.0;
    }
    score += Math.min(2, supplies.length * 0.1);
    if (water) score += Math.max(0, 1 - water.km / 30) * 0.5;
    const allSupplies = [
      ...supplies.map((s) => s.name),
      ...nearbyMinerals.map((m) => m.name),
    ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 8);
    return {
      ok: true,
      traits,
      supplies: allSupplies,
      waterSource: coastKm <= 12 && def.needs.includes("coast") ? "the coast" : water && water.km <= 25 ? water.name : undefined,
      score,
    };
  }
}
