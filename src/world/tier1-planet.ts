import type {
  BBox,
  ConflictRecord,
  ConvergentEdge,
  GenProgress,
  MapFeature,
  PlanetConfig,
  PlanetMacro,
  PlanetStats,
  Pt,
  RegionDescriptor,
  TectonicPlate,
} from "./types";
import { type RNG, makeRng, range, irange, chance, choice, makeRadialNoise } from "./rng";
import {
  centroidOf,
  dist,
  polygonArea,
  radialPolygon,
  fractalLine,
  bboxOfRing,
  bboxOfCoords,
  pointInRing,
} from "./geom";
import { nameFeature, makeStem } from "./names";
import { classifyLandArea, profileFor, budgetFor, SIZE_CLASS_ORDER } from "./size-classes";
import type { LandSizeClass } from "./types";
import {
  PLANET_WIDTH,
  PLANET_HEIGHT,
  areaUnitsToKm2,
  xToLon,
  yToLat,
  climateZoneAt,
  equatorDistance,
} from "./constants";

// ---------------------------------------------------------------------------
// TIER 1 — Macro planetary architecture.
//
// This stage deliberately generates ONLY the big structures: tectonic plates,
// continents, island arcs, ocean basins, trenches and polar caps. A few hundred
// features total, so the planetary view stays instant no matter what.
//
// Everything it produces doubles as the *input contract* for Tier 2: each
// landmass is exported as a RegionDescriptor carrying its lon/lat, area,
// climate band, plate membership and convergent collision vectors.
// ---------------------------------------------------------------------------

let uid = 0;
const nid = (p: string) => `${p}${++uid}`;

const bboxesOverlap = (a: BBox, b: BBox) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export async function generatePlanetMacro(
  config: PlanetConfig,
  onProgress?: (p: GenProgress) => void
): Promise<PlanetMacro> {
  uid = 0;
  const t0 = performance.now();
  const rng: RNG = makeRng(config.seed);
  const features: MapFeature[] = [];
  const log: ConflictRecord[] = [];
  const TOTAL = 6;

  const tick = async (stage: number, stageName: string, percent: number) => {
    onProgress?.({
      stage,
      totalStages: TOTAL,
      stageName,
      percent,
      featuresCount: features.length,
      elapsedMs: Math.round(performance.now() - t0),
    });
    await new Promise((r) => setTimeout(r, 0));
  };

  // -------------------------------------------------------------------------
  // 1. Tectonic plates — drifting lithospheric cells
  // -------------------------------------------------------------------------
  await tick(1, "Seeding Lithospheric Plates", 8);
  const plateCount = irange(rng, 9, 14);
  const plates: TectonicPlate[] = [];
  for (let i = 0; i < plateCount; i++) {
    plates.push({
      id: i,
      name: `${makeStem(rng)} Plate`,
      center: [range(rng, 0, PLANET_WIDTH), range(rng, PLANET_HEIGHT * 0.08, PLANET_HEIGHT * 0.92)],
      driftAngle: range(rng, 0, Math.PI * 2),
      driftSpeed: range(rng, 0.3, 1) * config.tectonicActivity,
      oceanic: chance(rng, 0.45),
    });
  }

  /** Convergent vectors acting on a point, derived from neighbouring plates. */
  const convergenceAt = (p: Pt, ownPlate: TectonicPlate): ConvergentEdge[] => {
    const edges: ConvergentEdge[] = [];
    for (const other of plates) {
      if (other.id === ownPlate.id) continue;
      const d = dist(p, other.center);
      if (d > PLANET_WIDTH * 0.24) continue;
      const toward = Math.atan2(other.center[1] - p[1], other.center[0] - p[0]);
      // Relative velocity projected onto the axis joining the two plates
      const relX =
        Math.cos(other.driftAngle) * other.driftSpeed - Math.cos(ownPlate.driftAngle) * ownPlate.driftSpeed;
      const relY =
        Math.sin(other.driftAngle) * other.driftSpeed - Math.sin(ownPlate.driftAngle) * ownPlate.driftSpeed;
      const closing = -(relX * Math.cos(toward) + relY * Math.sin(toward));
      if (closing <= 0.05) continue; // divergent or transform, no orogeny
      const proximity = 1 - d / (PLANET_WIDTH * 0.24);
      edges.push({
        angle: toward,
        strength: clamp(closing * proximity * 2.6, 0.18, 1),
        withPlateId: other.id,
        withPlateName: other.name,
        type: other.oceanic && !ownPlate.oceanic ? "subduction" : "collision",
      });
    }
    return edges.sort((a, b) => b.strength - a.strength).slice(0, 3);
  };

  // Plate boundary lines (purely decorative on the macro map)
  for (let i = 0; i < plates.length; i++) {
    const a = plates[i];
    const b = plates[(i + 1) % plates.length];
    if (dist(a.center, b.center) > PLANET_WIDTH * 0.35) continue;
    const line = fractalLine(rng, a.center, b.center, 0.14, 4);
    features.push({
      id: nid("pb"),
      geometry: { type: "LineString", coordinates: line },
      properties: {
        id: nid("pb_p"),
        name: `${a.name} / ${b.name} Boundary`,
        featureType: "plate_boundary",
        tier: 1,
        plateId: a.id,
        geologicalOrigin: "Lithospheric plate margin",
      },
      bbox: bboxOfCoords(line),
      lodMinZoom: 0,
    });
  }

  // -------------------------------------------------------------------------
  // 2. Continents — one per longitudinal sector, grown on a plate
  // -------------------------------------------------------------------------
  await tick(2, "Accreting Continental Cratons", 28);
  const continents: MapFeature[] = [];
  const contCount = clamp(config.continentCount, 3, 8);
  const sector = PLANET_WIDTH / contCount;

  for (let i = 0; i < contCount; i++) {
    const cx = range(rng, i * sector + sector * 0.18, (i + 1) * sector - sector * 0.18);
    // Keep continents mostly off the extreme poles
    const cy = range(rng, PLANET_HEIGHT * 0.16, PLANET_HEIGHT * 0.84);
    const sizeRoll = rng();
    const baseR = range(rng, 380, 760) * (0.7 + sizeRoll * 0.75) * (1 / Math.sqrt(contCount / 5));

    // Base craton plus sub-cratonic lobes, resolved as a single simple outline.
    // (Splicing rings would create self-intersections, which break both the
    // even-odd fill and the Tier-2 land-mask rasteriser downstream.)
    const blobs: Blob[] = [{ c: [cx, cy] as Pt, r: baseR, fn: makeRadialNoise(rng, irange(rng, 6, 9)) }];
    const lobes = irange(rng, 1, 3);
    for (let l = 0; l < lobes; l++) {
      const la = range(rng, 0, Math.PI * 2);
      const ld = baseR * range(rng, 0.45, 0.85);
      blobs.push({
        c: [cx + Math.cos(la) * ld, cy + Math.sin(la) * ld] as Pt,
        r: baseR * range(rng, 0.42, 0.68),
        fn: makeRadialNoise(rng, 5),
      });
    }

    let ring = unionBlobOutline([cx, cy], blobs, 180, 0.05);

    // Clamp inside the planet canvas
    ring = ring.map(
      ([x, y]) => [clamp(x, 8, PLANET_WIDTH - 8), clamp(y, 8, PLANET_HEIGHT - 8)] as Pt
    );

    const bbox = bboxOfRing(ring);
    const centre = centroidOf(ring);
    const plate =
      plates.reduce((best, p) => (dist(p.center, centre) < dist(best.center, centre) ? p : best), plates[0]);

    const name = nameFeature(rng, "continent", i + 1);
    const feat: MapFeature = {
      id: nid("cont"),
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        id: nid("cont_p"),
        name,
        featureType: "continent",
        tier: 1,
        elevation: Math.round(range(rng, 280, 780)),
        plateId: plate.id,
        areaKm2: Math.round(areaUnitsToKm2(polygonArea([ring]))),
        climateZone: climateZoneAt(centre[1]),
        geologicalOrigin: `Archean craton riding the ${plate.name}`,
      },
      bbox,
      lodMinZoom: 0,
    };

    // Collision resolution against already-placed continents
    for (const other of continents) {
      if (!bboxesOverlap(bbox, other.bbox)) continue;
      const oc = centroidOf(other.geometry.coordinates[0]);
      if (dist(centre, oc) < baseR * 0.75) {
        log.push({
          kind: "orogeny",
          tier: 1,
          description: `"${name}" is colliding with "${other.properties.name}" along a suture zone — Tier 2 will raise a Himalayan-class fold belt on the contact flank.`,
          relatedFeatureId: other.id,
          relatedFeatureName: other.properties.name,
        });
      }
    }

    continents.push(feat);
    features.push(feat);
  }

  // -------------------------------------------------------------------------
  // 3. Island arcs, microcontinents & hotspot chains
  // -------------------------------------------------------------------------
  await tick(3, "Extruding Island Arcs & Hotspot Chains", 50);
  const islands: MapFeature[] = [];

  /** Place a small island if it clears every existing landmass. */
  const tryIslet = (c: Pt, sr: number, group: string, hotspot: boolean) => {
    if (c[0] < 40 || c[0] > PLANET_WIDTH - 40 || c[1] < 40 || c[1] > PLANET_HEIGHT - 40) return;
    const ring = radialPolygon(c, sr, makeRadialNoise(rng, 3), 28, 0.06);
    const bbox = bboxOfRing(ring);
    const pad = sr * 0.6;
    const padded: BBox = { minX: bbox.minX - pad, minY: bbox.minY - pad, maxX: bbox.maxX + pad, maxY: bbox.maxY + pad };
    for (const k of [...continents, ...islands]) {
      if (!bboxesOverlap(padded, k.bbox)) continue;
      const kr = k.geometry.coordinates[0] as Pt[];
      if (pointInRing(c, kr) || ring.some((pt) => pointInRing(pt, kr)) || kr.some((pt) => pointInRing(pt, ring))) return;
    }
    const areaKm2 = areaUnitsToKm2(polygonArea([ring]));
    const plate = plates.reduce((b, p) => (dist(p.center, c) < dist(b.center, c) ? p : b), plates[0]);
    const term = areaKm2 < 50 ? choice(rng, ["Skerry", "Cay", "Stack"]) : areaKm2 < 500 ? "Islet" : "Isle";
    const feat: MapFeature = {
      id: nid("isl"),
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        id: nid("isl_p"),
        name: `${makeStem(rng)} ${term}`,
        featureType: "island",
        tier: 1,
        elevation: Math.round(range(rng, 15, Math.min(900, 60 + areaKm2 * 0.4))),
        plateId: plate.id,
        areaKm2: areaKm2 < 100 ? Math.round(areaKm2 * 10) / 10 : Math.round(areaKm2),
        climateZone: climateZoneAt(c[1]),
        geologicalOrigin: hotspot
          ? `Mantle plume hotspot seamount near the ${group} chain`
          : `Subduction arc volcanic islet of the ${group} group`,
      },
      bbox,
      lodMinZoom: sr > 15 ? 0.55 : sr > 4 ? 2 : sr > 1 ? 5 : 12,
    };
    islands.push(feat);
    features.push(feat);
  };
  const chains = Math.round(irange(rng, 7, 13) * config.islandDensity);

  for (let c = 0; c < chains; c++) {
    const hotspot = chance(rng, 0.35);
    const start: Pt = [range(rng, 150, PLANET_WIDTH - 150), range(rng, 260, PLANET_HEIGHT - 260)];
    const ang = range(rng, 0, Math.PI * 2);
    const len = range(rng, 260, 820);
    const count = irange(rng, 3, 9);
    const chainName = makeStem(rng);

    for (let j = 0; j < count; j++) {
      const t = count === 1 ? 0 : j / (count - 1);
      const bow = Math.sin(t * Math.PI) * range(rng, -90, 90);
      const ix = start[0] + Math.cos(ang) * len * t + Math.cos(ang + Math.PI / 2) * bow;
      const iy = start[1] + Math.sin(ang) * len * t + Math.sin(ang + Math.PI / 2) * bow;
      if (ix < 60 || ix > PLANET_WIDTH - 60 || iy < 60 || iy > PLANET_HEIGHT - 60) continue;

      const r = range(rng, 26, 105) * (hotspot ? 1 - t * 0.5 : 1);
      const ring = radialPolygon([ix, iy], r, makeRadialNoise(rng, 4), 56, 0.08);
      const bbox = bboxOfRing(ring);

      // Accretion: an island that lands on a continent becomes a peninsula
      const host = continents.find(
        (k) => bboxesOverlap(bbox, k.bbox) && pointInRing([ix, iy], k.geometry.coordinates[0])
      );
      if (host) {
        log.push({
          kind: "contain",
          tier: 1,
          description: `Arc fragment "${chainName}" rammed into "${host.properties.name}" and was accreted as a coastal terrane rather than surviving as an island.`,
          relatedFeatureId: host.id,
          relatedFeatureName: host.properties.name,
        });
        continue;
      }

      const centre: Pt = [ix, iy];
      const plate = plates.reduce(
        (best, p) => (dist(p.center, centre) < dist(best.center, centre) ? p : best),
        plates[0]
      );
      const nm = `${chainName} ${count > 3 ? romanNumeral(j + 1) : ""}`.trim() + (r > 70 ? " Island" : " Isle");

      const feat: MapFeature = {
        id: nid("isl"),
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: {
          id: nid("isl_p"),
          name: nm,
          featureType: "island",
          tier: 1,
          elevation: Math.round(range(rng, 60, 900)),
          plateId: plate.id,
          areaKm2: Math.round(areaUnitsToKm2(polygonArea([ring]))),
          climateZone: climateZoneAt(iy),
          geologicalOrigin: hotspot
            ? `Mantle plume hotspot volcano in the ${chainName} chain`
            : `Subduction volcanic arc of the ${chainName} group`,
        },
        bbox,
        lodMinZoom: r > 55 ? 0 : 0.55,
      };
      islands.push(feat);
      features.push(feat);

      // Satellite islets fill in the size spectrum below the main arc islands
      const sats = irange(rng, 0, 3);
      for (let s = 0; s < sats; s++) {
        const sr = 0.12 + Math.pow(rng(), 2.4) * 7; // ≈0.7 km … 40 km radius
        const ang = range(rng, 0, Math.PI * 2);
        const off = r * range(rng, 1.25, 2.1) + sr;
        tryIslet([ix + Math.cos(ang) * off, iy + Math.sin(ang) * off], sr, chainName, hotspot);
      }
    }
  }

  // Lone oceanic islets: seamount tops, coral cays and sea stacks
  const loneIslets = Math.round(irange(rng, 10, 22) * config.islandDensity);
  for (let k = 0; k < loneIslets; k++) {
    const c: Pt = [range(rng, 80, PLANET_WIDTH - 80), range(rng, 200, PLANET_HEIGHT - 200)];
    tryIslet(c, 0.1 + Math.pow(rng(), 2.8) * 4, makeStem(rng), chance(rng, 0.5));
  }

  // -------------------------------------------------------------------------
  // 4. Ocean basins, seas & subduction trenches
  // -------------------------------------------------------------------------
  await tick(4, "Naming Ocean Basins & Cutting Trenches", 68);
  const land = [...continents, ...islands];
  const seas: MapFeature[] = [];
  const seaTarget = irange(rng, 5, 8);
  for (let s = 0; s < seaTarget; s++) {
    let centre: Pt | null = null;
    for (let t = 0; t < 40; t++) {
      const cand: Pt = [range(rng, 200, PLANET_WIDTH - 200), range(rng, 300, PLANET_HEIGHT - 300)];
      const onLand = land.some(
        (l) =>
          cand[0] >= l.bbox.minX &&
          cand[0] <= l.bbox.maxX &&
          cand[1] >= l.bbox.minY &&
          cand[1] <= l.bbox.maxY &&
          pointInRing(cand, l.geometry.coordinates[0])
      );
      const tooClose = seas.some((o) => dist(cand, centroidOf(o.geometry.coordinates[0])) < 700);
      if (!onLand && !tooClose) {
        centre = cand;
        break;
      }
    }
    if (!centre) continue;

    const r = range(rng, 320, 720);
    const ring = radialPolygon(centre, r, makeRadialNoise(rng, 5), 64, 0.05).map(
      ([x, y]) => [clamp(x, 0, PLANET_WIDTH), clamp(y, 0, PLANET_HEIGHT)] as Pt
    );
    const name = nameFeature(rng, "sea");
    const feat: MapFeature = {
      id: nid("sea"),
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        id: nid("sea_p"),
        name,
        featureType: "sea",
        tier: 1,
        depth: Math.round(range(rng, 1800, 7200)),
        areaKm2: Math.round(areaUnitsToKm2(polygonArea([ring]))),
        geologicalOrigin: "Oceanic basin floored by basaltic crust",
      },
      bbox: bboxOfRing(ring),
      lodMinZoom: 0,
    };
    seas.push(feat);
    features.push(feat);
  }

  // Trenches follow convergent oceanic margins
  const trenches: MapFeature[] = [];
  for (const p of plates) {
    if (!p.oceanic || !chance(rng, 0.6)) continue;
    const ang = p.driftAngle + Math.PI / 2;
    const l = range(rng, 500, 1400);
    const a: Pt = [p.center[0] - Math.cos(ang) * l * 0.5, p.center[1] - Math.sin(ang) * l * 0.5];
    const b: Pt = [p.center[0] + Math.cos(ang) * l * 0.5, p.center[1] + Math.sin(ang) * l * 0.5];
    const line = fractalLine(rng, a, b, 0.1, 4);
    const feat: MapFeature = {
      id: nid("trn"),
      geometry: { type: "LineString", coordinates: line },
      properties: {
        id: nid("trn_p"),
        name: `${makeStem(rng)} Trench`,
        featureType: "trench",
        tier: 1,
        depth: Math.round(range(rng, 6800, 11200)),
        plateId: p.id,
        geologicalOrigin: `Subduction trench where the ${p.name} dives into the mantle`,
      },
      bbox: bboxOfCoords(line),
      lodMinZoom: 0.25,
    };
    trenches.push(feat);
    features.push(feat);
  }

  // -------------------------------------------------------------------------
  // 5. Polar ice caps (macro silhouette only; Tier 2 details the glaciers)
  // -------------------------------------------------------------------------
  await tick(5, "Freezing Polar Ice Caps", 82);
  for (const north of [true, false]) {
    const capY = north ? 0 : PLANET_HEIGHT;
    const spread = PLANET_HEIGHT * 0.1 * config.polarIceExtent;
    const ring: Pt[] = [];
    const steps = 80;
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * PLANET_WIDTH;
      const wobble =
        Math.sin(x * 0.0031 + (north ? 0 : 2.1)) * spread * 0.45 +
        Math.sin(x * 0.0087 + 1.3) * spread * 0.22;
      ring.push([x, north ? spread + wobble : capY - spread - wobble]);
    }
    if (north) {
      ring.push([PLANET_WIDTH, 0], [0, 0]);
    } else {
      ring.push([PLANET_WIDTH, PLANET_HEIGHT], [0, PLANET_HEIGHT]);
    }
    ring.push([ring[0][0], ring[0][1]]);

    features.push({
      id: nid("cap"),
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        id: nid("cap_p"),
        name: north ? "Boreal Ice Cap" : "Austral Ice Cap",
        featureType: "ice_cap",
        tier: 1,
        meanTempC: Math.round(range(rng, -48, -22)),
        areaKm2: Math.round(areaUnitsToKm2(polygonArea([ring]))),
        geologicalOrigin: "Perennial sea-ice and continental ice sheet",
      },
      bbox: bboxOfRing(ring),
      lodMinZoom: 0,
    });
  }

  // -------------------------------------------------------------------------
  // 6. Export region descriptors (the Tier 1 -> Tier 2 handoff)
  // -------------------------------------------------------------------------
  await tick(6, "Publishing Region Descriptors for Tier 2", 94);
  const regions: RegionDescriptor[] = [];

  for (const l of land) {
    const ring = l.geometry.coordinates[0] as Pt[];
    const areaUnits = polygonArea([ring]);
    const areaKm2 = areaUnitsToKm2(areaUnits);
    // Every landmass is detailable: its size class, not a cut-off, decides
    // what Tier 2 is allowed to build on it.
    const sizeClass = classifyLandArea(areaKm2);

    const centre = centroidOf(ring);
    const plate = plates.find((p) => p.id === l.properties.plateId) ?? plates[0];
    const edges = convergenceAt(centre, plate);

    // Which named seas wash this coast?
    const adjacentSeas = seas
      .filter((s) => dist(centroidOf(s.geometry.coordinates[0]), centre) < 1100)
      .map((s) => s.properties.name)
      .slice(0, 3);

    const yTop = l.bbox.minY;
    const yBot = l.bbox.maxY;
    const eqY = PLANET_HEIGHT / 2;

    // Detail budget scales with land area but is hard-capped so any single
    // region tab stays smooth to generate and render.
    const detailBudget = budgetFor(areaKm2, profileFor(sizeClass));

    regions.push({
      id: l.id,
      name: l.properties.name,
      kind: l.properties.featureType === "continent" ? "continent" : "island",
      outline: ring,
      bbox: l.bbox,
      centroid: centre,
      lon: xToLon(centre[0]),
      lat: yToLat(centre[1]),
      areaKm2: areaKm2 < 100 ? Math.round(areaKm2 * 10) / 10 : Math.round(areaKm2),
      areaUnits,
      sizeClass,
      linearScaleKm: Math.round(Math.sqrt(areaKm2) * 10) / 10,
      volcanicIsland: l.properties.featureType === "island",
      climateZone: climateZoneAt(centre[1]),
      spansEquator: yTop < eqY && yBot > eqY,
      touchesPole: equatorDistance(yTop) > 0.86 || equatorDistance(yBot) > 0.86,
      plateId: plate.id,
      plateName: plate.name,
      convergentEdges: edges,
      hotspot: (l.properties.geologicalOrigin ?? "").includes("hotspot"),
      adjacentSeas,
      // Deterministic child seed: same planet seed + same region => same detail
      regionSeed: `${config.seed}::${l.id}`,
      detailBudget,
    });
  }

  regions.sort((a, b) => b.areaKm2 - a.areaKm2);

  const totalLandUnits = land.reduce((s, l) => s + polygonArea(l.geometry.coordinates), 0);
  const largest = regions[0] ?? { name: "—", areaKm2: 0 };

  const stats: PlanetStats = {
    seed: config.seed,
    macroFeatures: features.length,
    continents: continents.length,
    islands: islands.length,
    seas: seas.length,
    trenches: trenches.length,
    plates: plates.length,
    landCoveragePercent: Math.round((totalLandUnits / (PLANET_WIDTH * PLANET_HEIGHT)) * 100),
    totalLandAreaKm2: Math.round(areaUnitsToKm2(totalLandUnits)),
    largestContinent: { name: largest.name, areaKm2: largest.areaKm2 },
    sizeClassCounts: SIZE_CLASS_ORDER.reduce((acc, id) => {
      acc[id] = regions.filter((r) => r.sizeClass === id).length;
      return acc;
    }, {} as Record<LandSizeClass, number>),
    generationTimeMs: Math.round(performance.now() - t0),
  };

  log.push({
    kind: "inherit",
    tier: 1,
    description: `Macro pass complete: ${features.length} planetary features and ${regions.length} region descriptors published. Detail generation is deferred until a region tab is opened.`,
  });

  await tick(6, "Planet Ready", 100);

  return { config, features, regions, plates, stats, log };
}

// --- helpers ---------------------------------------------------------------

export interface Blob {
  c: Pt;
  r: number;
  fn: (angle: number) => number;
}

/** Signed "insideness" of a point w.r.t. one noisy radial blob (>0 = inside). */
function blobInside(p: Pt, b: Blob): boolean {
  const dx = p[0] - b.c[0];
  const dy = p[1] - b.c[1];
  const d = Math.hypot(dx, dy);
  const a = Math.atan2(dy, dx);
  return d <= Math.max(2, b.r * (1 + b.fn(a)));
}

/**
 * Trace the union of several overlapping blobs as ONE simple closed ring by
 * ray-marching outward from a common interior point. The result is a
 * star-domain polygon: guaranteed non-self-intersecting, which keeps both the
 * canvas fill and the Tier-2 scanline land mask correct.
 */
function unionBlobOutline(origin: Pt, blobs: Blob[], steps: number, jitter: number): Pt[] {
  let maxReach = 0;
  for (const b of blobs) maxReach = Math.max(maxReach, dist(origin, b.c) + b.r * 1.6);

  const ring: Pt[] = [];
  const march = Math.max(48, Math.round(maxReach / 6));

  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    let last = 0;
    for (let s = 1; s <= march; s++) {
      const rr = (s / march) * maxReach;
      const p: Pt = [origin[0] + cos * rr, origin[1] + sin * rr];
      let inside = false;
      for (let k = 0; k < blobs.length; k++) {
        if (blobInside(p, blobs[k])) {
          inside = true;
          break;
        }
      }
      if (inside) last = rr;
    }
    if (last === 0) last = blobs[0].r * 0.35;
    const wob = 1 + (Math.sin(a * 17.3) * 0.55 + Math.sin(a * 31.1 + 1.7) * 0.45) * jitter;
    ring.push([origin[0] + cos * last * wob, origin[1] + sin * last * wob]);
  }
  ring.push([ring[0][0], ring[0][1]]);
  return ring;
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
function romanNumeral(n: number) {
  return ROMAN[n] ?? String(n);
}

export { choice };
