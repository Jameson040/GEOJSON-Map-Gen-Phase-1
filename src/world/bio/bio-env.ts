import type { GeneratedRegion, MapFeature, Pt } from "../types";
import type { EnvSample, SpeciesDef } from "./bio-types";
import { LandMask } from "../landmask";
import { pointInRing, dist } from "../geom";
import { baseRainfall, baseTemperature, kmToUnits, unitsToKm } from "../constants";

// ---------------------------------------------------------------------------
// READ-ONLY bridge between the biosphere layer and the frozen geographic
// layer. It samples — never mutates — the GeneratedRegion: land mask from the
// inherited outline, climate from the geographic biome patches (which already
// encode rain-shadow and latitude), relief from range/plateau polygons, and
// water from rivers, lakes and the detailed coastline.
// ---------------------------------------------------------------------------

const BIOME_TYPES = new Set(["desert", "forest", "savanna", "grassland", "tundra", "glacier", "wetland"]);

interface BiomePatch {
  ring: Pt[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  type: string;
  rainMm: number;
  tempC: number;
}

interface ReliefPoly {
  ring: Pt[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  elevM: number;
  isPlateau: boolean;
}

export class BioEnvReader {
  readonly mask: LandMask;
  private biomes: BiomePatch[] = [];
  private relief: ReliefPoly[] = [];
  private riverPts: Pt[] = [];
  /** Same sampled river vertices as riverPts, with Strahler order + discharge. */
  riverInfo: { p: Pt; order: number; dischargeM3s: number }[] = [];
  /** Actual lake polygons (riverPts/lakePts only store centre approximations). */
  lakeRings: { ring: Pt[]; bbox: { minX: number; minY: number; maxX: number; maxY: number } }[] = [];
  private lakePts: { c: Pt; rUnits: number }[] = [];
  private coastPts: Pt[] = [];
  private moisture: number;
  readonly region: GeneratedRegion;

  constructor(region: GeneratedRegion) {
    this.region = region;
    this.moisture = region.config.moisture ?? 1;
    this.mask = new LandMask(region.descriptor.outline, region.descriptor.bbox, 300);

    for (const f of region.features as MapFeature[]) {
      const t = f.properties.featureType;
      if (BIOME_TYPES.has(t) && f.geometry.type === "Polygon") {
        this.biomes.push({
          ring: f.geometry.coordinates[0] as Pt[],
          bbox: f.bbox,
          type: t,
          rainMm: f.properties.annualRainfallMm ?? baseRainfall(f.bbox.minY) * this.moisture,
          tempC: f.properties.meanTempC ?? baseTemperature(f.bbox.minY, 0),
        });
      } else if ((t === "mountain_range" || t === "plateau") && f.geometry.type === "Polygon") {
        this.relief.push({
          ring: f.geometry.coordinates[0] as Pt[],
          bbox: f.bbox,
          elevM: f.properties.elevation ?? 1500,
          isPlateau: t === "plateau",
        });
      } else if (t === "river" && f.geometry.type === "LineString") {
        const co = f.geometry.coordinates as Pt[];
        const order = (f.properties.strahlerOrder as number | undefined) ?? 1;
        const dischargeM3s = (f.properties.dischargeM3s as number | undefined) ?? 10;
        for (let i = 0; i < co.length; i += 3) {
          this.riverPts.push(co[i]);
          this.riverInfo.push({ p: co[i], order, dischargeM3s });
        }
      } else if (t === "lake" && f.geometry.type === "Polygon") {
        const ring = f.geometry.coordinates[0] as Pt[];
        this.lakeRings.push({ ring, bbox: f.bbox });
        const b = f.bbox;
        this.lakePts.push({
          c: [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2],
          rUnits: Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2,
        });
      } else if (t === "coastline" && f.geometry.type === "Polygon") {
        const ring = f.geometry.coordinates[0] as Pt[];
        const stride = Math.max(1, Math.floor(ring.length / 600));
        for (let i = 0; i < ring.length; i += stride) this.coastPts.push(ring[i]);
      }
    }
    // Fallback: no detailed coastline feature -> use the descriptor outline.
    if (!this.coastPts.length) {
      const o = region.descriptor.outline;
      const stride = Math.max(1, Math.floor(o.length / 400));
      for (let i = 0; i < o.length; i += stride) this.coastPts.push(o[i]);
    }
  }

  private inBBox(p: Pt, b: { minX: number; minY: number; maxX: number; maxY: number }) {
    return p[0] >= b.minX && p[0] <= b.maxX && p[1] >= b.minY && p[1] <= b.maxY;
  }

  nearestCoastKm(p: Pt): number {
    let best = Infinity;
    for (const c of this.coastPts) {
      const d = dist(p, c);
      if (d < best) best = d;
    }
    return unitsToKm(best);
  }

  /** True when the point lies inside an actual lake polygon. */
  pointInLake(p: Pt): boolean {
    for (const l of this.lakeRings) {
      if (!this.inBBox(p, l.bbox)) continue;
      if (pointInRing(p, l.ring)) return true;
    }
    return false;
  }

  /** Nearest sampled river vertex with its Strahler order and discharge. */
  nearestRiverInfo(p: Pt): { p: Pt; order: number; dischargeM3s: number; distUnits: number } | null {
    let best = Infinity;
    let bestInfo: { p: Pt; order: number; dischargeM3s: number } | null = null;
    for (const r of this.riverInfo) {
      const d = dist(p, r.p);
      if (d < best) {
        best = d;
        bestInfo = r;
      }
    }
    return bestInfo ? { ...bestInfo, distUnits: best } : null;
  }

  nearestFreshKm(p: Pt): number {
    let best = Infinity;
    for (const r of this.riverPts) {
      const d = dist(p, r);
      if (d < best) best = d;
    }
    for (const l of this.lakePts) {
      const d = Math.max(0, dist(p, l.c) - l.rUnits);
      if (d < best) best = d;
    }
    return unitsToKm(best);
  }

  closestFreshPoint(p: Pt): Pt | null {
    let bestDist = Infinity;
    let bestPt: Pt | null = null;
    for (const r of this.riverPts) {
      const d = dist(p, r);
      if (d < bestDist) {
        bestDist = d;
        bestPt = r;
      }
    }
    for (const l of this.lakePts) {
      const d = dist(p, l.c);
      if (d < bestDist) {
        bestDist = d;
        bestPt = l.c;
      }
    }
    return bestPt;
  }

  randomRiverPoint(rng: () => number): Pt | null {
    if (!this.riverPts.length && !this.lakePts.length) return null;
    const pool = this.riverPts.length + this.lakePts.length;
    const i = Math.floor(rng() * pool);
    if (i < this.riverPts.length) return this.riverPts[i];
    return this.lakePts[i - this.riverPts.length].c;
  }

  /** A point just offshore of a random stretch of coast (for marine species). */
  randomOffshorePoint(rng: () => number, minKm: number, maxKm: number): Pt | null {
    for (let t = 0; t < 24; t++) {
      const c = this.coastPts[Math.floor(rng() * this.coastPts.length)];
      const ang = rng() * Math.PI * 2;
      const d = kmToUnits(minKm + rng() * (maxKm - minKm));
      const p: Pt = [c[0] + Math.cos(ang) * d, c[1] + Math.sin(ang) * d];
      if (!this.mask.isLand(p)) return p;
    }
    return null;
  }

  biomeCentres(types: string[]): Pt[] {
    const out: Pt[] = [];
    for (const b of this.biomes) {
      if (!types.includes(b.type)) continue;
      out.push([(b.bbox.minX + b.bbox.maxX) / 2, (b.bbox.minY + b.bbox.maxY) / 2]);
    }
    return out;
  }

  hasBiomeNear(p: Pt, types: string[], withinKm: number): boolean {
    const r = kmToUnits(withinKm);
    for (const b of this.biomes) {
      if (!types.includes(b.type)) continue;
      const cx = Math.max(b.bbox.minX, Math.min(p[0], b.bbox.maxX));
      const cy = Math.max(b.bbox.minY, Math.min(p[1], b.bbox.maxY));
      if (dist(p, [cx, cy]) <= r) return true;
    }
    return false;
  }

  envAt(p: Pt): EnvSample {
    const onLand = this.mask.isLand(p);
    let biome: string | null = null;
    let rain = baseRainfall(p[1]) * this.moisture;
    let temp = baseTemperature(p[1], 0);
    for (const b of this.biomes) {
      if (!this.inBBox(p, b.bbox)) continue;
      if (pointInRing(p, b.ring)) {
        biome = b.type;
        rain = b.rainMm;
        temp = b.tempC;
        break;
      }
    }
    let inRange = false;
    let inPlateau = false;
    let rangeElevM = 0;
    for (const r of this.relief) {
      if (!this.inBBox(p, r.bbox)) continue;
      if (pointInRing(p, r.ring)) {
        if (r.isPlateau) inPlateau = true;
        else inRange = true;
        rangeElevM = Math.max(rangeElevM, r.elevM);
      }
    }
    if (inRange && rangeElevM > 0) {
      // Highland cooling on the frozen relief: ~6.5 °C / 1000 m on mid-slope.
      temp = Math.min(temp, baseTemperature(p[1], rangeElevM * 0.55));
    }
    const coastKm = this.nearestCoastKm(p);
    return {
      tempC: temp,
      rainMm: rain,
      onLand,
      biome,
      inRange,
      rangeElevM,
      inPlateau,
      coastKm,
      freshKm: this.nearestFreshKm(p),
      oceanKm: onLand ? -coastKm : coastKm,
    };
  }

  /**
   * Rule evaluation for one species at one spot. Returns ok, or the broken
   * rule id. `irrigated` marks a crop surviving below rMin thanks to nearby
   * fresh water (EcoCrop `irrigable` tweak).
   */
  suitability(sp: SpeciesDef, p: Pt, env?: EnvSample): { ok: boolean; rule?: string; irrigated?: boolean } {
    const e = env ?? this.envAt(p);

    if (sp.habitat === "marine") {
      if (e.onLand) return { ok: false, rule: "marine_on_land" };
      if (e.coastKm > 320) return { ok: false, rule: "beyond_fishing_banks" };
      if (e.tempC < sp.tMin || e.tempC > sp.tMax) return { ok: false, rule: "climate_envelope" };
      return { ok: true };
    }
    if (sp.habitat === "coastal") {
      if (e.coastKm > 25) return { ok: false, rule: "not_coastal" };
      if (e.tempC < sp.tMin || e.tempC > sp.tMax) return { ok: false, rule: "climate_envelope" };
      return { ok: true };
    }
    if (sp.habitat === "freshwater") {
      if (!e.onLand) return { ok: false, rule: "freshwater_in_ocean" };
      if (e.freshKm > 9) return { ok: false, rule: "no_freshwater_body" };
      if (e.tempC < sp.tMin || e.tempC > sp.tMax) return { ok: false, rule: "climate_envelope" };
      return { ok: true };
    }

    // --- terrestrial ---
    if (!e.onLand) return { ok: false, rule: "terrestrial_in_ocean" };
    if (e.tempC < sp.tMin || e.tempC > sp.tMax) return { ok: false, rule: "climate_envelope" };

    const listed = (b: string) => (sp.biomes ? sp.biomes.includes(b) : false);
    if (e.biome === "glacier" && !listed("glacier")) return { ok: false, rule: "on_glacier" };

    let irrigated = false;
    if (e.rainMm < sp.rMin) {
      if (sp.irrigable && e.freshKm <= 25) irrigated = true;
      else return { ok: false, rule: "too_dry" };
    }
    if (e.rainMm > sp.rMax) return { ok: false, rule: "too_wet" };
    if (e.biome === "desert" && !listed("desert") && !irrigated && sp.kind === "crop")
      return { ok: false, rule: "hostile_biome" };
    if (sp.biomes && e.biome && !sp.biomes.includes(e.biome) && (e.biome === "desert" || e.biome === "tundra"))
      return { ok: false, rule: "hostile_biome" };

    if (sp.waterKm !== undefined && e.freshKm > sp.waterKm) return { ok: false, rule: "needs_water_nearby" };
    if (sp.highland && !e.inRange && !e.inPlateau) return { ok: false, rule: "needs_highland" };
    if (sp.elevMaxM !== undefined && e.inRange && e.rangeElevM * 0.75 > sp.elevMaxM)
      return { ok: false, rule: "too_high" };

    return { ok: true, irrigated };
  }
}
