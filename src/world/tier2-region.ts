import type {
  ConflictRecord,
  GenProgress,
  GeneratedRegion,
  MapFeature,
  Pt,
  RegionConfig,
  RegionDescriptor,
  RegionStats,
} from "./types";
import { type RNG, makeRng, range, irange, chance, choice, makeRadialNoise } from "./rng";
import {
  centroidOf,
  dist,
  polygonArea,
  radialPolygon,
  fractalLine,
  ribbonFromLine,
  bboxOfRing,
  bboxOfCoords,
  nearestOnLine,
} from "./geom";
import { nameFeature, makeStem } from "./names";
import { LandMask } from "./landmask";
import { CompartmentGrid } from "./compartments";
import {
  areaUnitsToKm2,
  unitsToKm,
  kmToUnits,
  baseRainfall,
  baseTemperature,
  climateZoneAt,
  prevailingWindAngle,
  prevailingWindName,
  equatorDistance,
} from "./constants";
import {
  type SizeProfile,
  classifyLandArea,
  profileFor,
  positionInClass,
  lerpRange,
  budgetFor,
  DETAIL_MULTIPLIER,
  MASK_RES_FACTOR,
  tectonicSettingOf,
  volcanoCapFor,
  formatArea,
  formatKm,
} from "./size-classes";
import { runFinetuneStage } from "./finetune-stage";
import { verifyRegionDetail } from "./verifier";

// ---------------------------------------------------------------------------
// TIER 2 — Regional detail, compartmentalised by land size.
//
// Runs on ONE landmass at a time, in its own tab. Everything is derived from
// the RegionDescriptor handed over by Tier 1, and every scale decision is
// taken from the landmass's SIZE PROFILE (see size-classes.ts):
//
//   • size class        -> which feature families exist, their km scales,
//                          counts, max Strahler order, elevation ceilings
//   • compartment grid  -> land split into blocks; scattered features are
//                          apportioned per block by land share
//   • regionSeed        -> deterministic, reproducible per region
//   • convergentEdges   -> orientation & height of fold belts
//   • lat / climateZone -> rainfall, temperature, biome bands, glaciation
//   • outline           -> rasterised LandMask; nothing spawns in the sea
// ---------------------------------------------------------------------------

let uid = 0;
const nid = (prefix: string) => `${prefix}_${++uid}`;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Keep short channels precise (islets), long ones as whole kilometres. */
const roundKm = (km: number) => (km < 20 ? Math.round(km * 10) / 10 : Math.round(km));

export async function generateRegionDetail(
  descriptor: RegionDescriptor,
  config: RegionConfig,
  onProgress?: (p: GenProgress) => void
): Promise<GeneratedRegion> {
  uid = 0;
  const t0 = performance.now();
  const effectiveSeed = config.customSeed?.trim() || descriptor.regionSeed;
  const rng: RNG = makeRng(effectiveSeed + "|" + config.detailLevel);
  const features: MapFeature[] = [];
  const log: ConflictRecord[] = [];
  const TOTAL = 8;

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

  // ---- Size compartment ---------------------------------------------------
  const sizeClass = descriptor.sizeClass ?? classifyLandArea(descriptor.areaKm2);
  const P: SizeProfile = profileFor(sizeClass);
  const tPos = positionInClass(descriptor.areaKm2, P);
  const inClass = (r: [number, number]) => lerpRange(r, tPos);
  const countIn = (r: [number, number]) => Math.round(inClass(r));
  const mul = DETAIL_MULTIPLIER[config.detailLevel];
  const budget = Math.max(3, Math.round(budgetFor(descriptor.areaKm2, P) * mul));
  const linearKm = Math.sqrt(Math.max(0.01, descriptor.areaKm2));
  const km = (v: number) => kmToUnits(v);

  const push = (f: MapFeature) => {
    f.properties.regionId = descriptor.id;
    f.properties.regionName = descriptor.name;
    f.properties.tier = 2;
    features.push(f);
  };

  // -------------------------------------------------------------------------
  // 0. Rasterise the inherited outline & lay out the compartment grid
  // -------------------------------------------------------------------------
  await tick(1, "Rasterising Coastline & Laying Out Compartments", 6);
  const maskRes = Math.round(P.maskResolution * MASK_RES_FACTOR[config.detailLevel]);
  const mask = new LandMask(descriptor.outline, descriptor.bbox, maskRes);
  const comps = new CompartmentGrid(mask, km(P.compartmentKm));

  const spanX = descriptor.bbox.maxX - descriptor.bbox.minX;
  const spanY = descriptor.bbox.maxY - descriptor.bbox.minY;
  const diag = Math.hypot(spanX, spanY);
  const windAngle = prevailingWindAngle(descriptor.centroid[1]);
  /** Point-feature bbox half-size: tiny on an islet, a few units on a continent. */
  const ptPad = Math.max(1e-4, Math.min(4, diag * 0.004));

  log.push({
    kind: "inherit",
    tier: 2,
    regionId: descriptor.id,
    description: `"${descriptor.name}" (${formatArea(descriptor.areaKm2)}, ${descriptor.climateZone}, ${descriptor.plateName}) classified as ${P.label.toUpperCase()} — ${(tPos * 100).toFixed(0)}% through its class. Budget ${budget.toLocaleString()} features; ${mask.cols}×${mask.rows} land mask; ${comps.count} processing compartments of ${formatKm(unitsToKm(comps.blockUnits))}.`,
  });

  // -------------------------------------------------------------------------
  // 1. Detailed coastline — scale of inlets and headlands set by size class
  // -------------------------------------------------------------------------
  await tick(2, "Carving Fjords, Rias & Headlands", 15);
  const polar = equatorDistance(descriptor.centroid[1]) > 0.66;
  const detailedCoast = refineCoastline(rng, descriptor.outline, mask, polar, config.glaciation, P.coast);
  push({
    id: nid("coast"),
    geometry: { type: "Polygon", coordinates: [detailedCoast] },
    properties: {
      id: nid("coast_p"),
      name: `${descriptor.name} Coastline`,
      featureType: "coastline",
      tier: 2,
      areaKm2: descriptor.areaKm2,
      climateZone: descriptor.climateZone,
      geologicalOrigin: polar
        ? "Glacially over-deepened fjord coast with hanging valleys"
        : "Wave-dominated coast with rias, spits and headlands",
    },
    bbox: bboxOfRing(detailedCoast),
    lodMinZoom: 0,
  });
  if (polar && P.coast.fjordKm >= 5) {
    log.push({
      kind: "glaciation",
      tier: 2,
      regionId: descriptor.id,
      description: `Latitude ${descriptor.lat.toFixed(1)}° puts "${descriptor.name}" inside the Pleistocene ice limit — the coast was re-cut into fjords up to ${formatKm(P.coast.fjordKm)} long (${P.label} scale).`,
    });
  }

  // -------------------------------------------------------------------------
  // 2. Orogenic belts — only if the size class permits them
  // -------------------------------------------------------------------------
  await tick(3, "Uplifting Fold Belts from Plate Convergence", 28);
  interface Belt {
    line: Pt[];
    name: string;
    peakElev: number;
    width: number;
    id: string;
  }
  const belts: Belt[] = [];

  const edges = descriptor.convergentEdges.length
    ? descriptor.convergentEdges
    : [{ angle: range(rng, 0, Math.PI * 2), strength: 0.4, withPlateId: -1, withPlateName: "passive margin", type: "collision" as const }];

  const beltCount = P.relief.ranges[1] === 0 ? 0 : countIn(P.relief.ranges);

  for (let b = 0; b < beltCount; b++) {
    const edge = edges[b % edges.length];
    const beltAxis = edge.angle + Math.PI / 2 + range(rng, -0.35, 0.35);
    const offset = diag * range(rng, 0.05, 0.3);
    const anchor: Pt = [
      descriptor.centroid[0] + Math.cos(edge.angle) * offset,
      descriptor.centroid[1] + Math.sin(edge.angle) * offset,
    ];

    const half = diag * range(rng, P.relief.rangeLengthFrac[0], P.relief.rangeLengthFrac[1]);
    let a: Pt = [anchor[0] - Math.cos(beltAxis) * half, anchor[1] - Math.sin(beltAxis) * half];
    let z: Pt = [anchor[0] + Math.cos(beltAxis) * half, anchor[1] + Math.sin(beltAxis) * half];
    a = nudgeToLand(mask, a, descriptor.centroid) ?? a;
    z = nudgeToLand(mask, z, descriptor.centroid) ?? z;
    if (dist(a, z) < diag * 0.12) continue;

    const line = trimToLand(mask, fractalLine(rng, a, z, 0.2, 5));
    if (line.length < 6) continue;

    // Crest height: class base → class ceiling, driven by collision intensity
    const crest =
      P.relief.baseElevation + edge.strength * (P.relief.maxElevation - P.relief.baseElevation) * 0.95;
    const peakElev = Math.round(
      Math.min(P.relief.maxElevation, crest * config.reliefIntensity * range(rng, 0.86, 1.14))
    );
    const width = km(range(rng, P.relief.rangeWidthKm[0], P.relief.rangeWidthKm[1])) * (0.6 + edge.strength);
    const beltName = nameFeature(rng, "mountain_range");
    const ribbon = ribbonFromLine(line, (t) => width * Math.sin(Math.PI * t) * range(rng, 0.85, 1.15));
    const beltId = nid("belt");

    push({
      id: beltId,
      geometry: { type: "Polygon", coordinates: [ribbon] },
      properties: {
        id: nid("belt_p"),
        name: beltName,
        featureType: "mountain_range",
        tier: 2,
        elevation: peakElev,
        reliefM: Math.round(peakElev * 0.7),
        areaKm2: Math.round(areaUnitsToKm2(polygonArea([ribbon]))),
        geologicalOrigin:
          edge.type === "subduction"
            ? `Andean-type volcanic arc above the subducting ${edge.withPlateName}`
            : `Collisional fold-and-thrust belt against the ${edge.withPlateName}`,
      },
      bbox: bboxOfRing(ribbon),
      lodMinZoom: 0,
    });
    belts.push({ line, name: beltName, peakElev, width, id: beltId });

    log.push({
      kind: "orogeny",
      tier: 2,
      regionId: descriptor.id,
      description: `"${beltName}" raised perpendicular to the ${((edge.angle * 180) / Math.PI).toFixed(0)}° convergence vector (${edge.type}, strength ${edge.strength.toFixed(2)}): ${peakElev.toLocaleString()} m crest, ~${formatKm(unitsToKm(width))} wide — within the ${P.label} envelope of ${formatKm(P.relief.rangeWidthKm[0])}–${formatKm(P.relief.rangeWidthKm[1])}.`,
      relatedFeatureId: beltId,
      relatedFeatureName: edge.withPlateName,
    });
  }

  // Interior plateaus
  const plateauCount = P.relief.plateaus[1] === 0 ? 0 : countIn(P.relief.plateaus);
  for (let p = 0; p < plateauCount; p++) {
    const c = comps.sample(rng, 0.42);
    if (!c) continue;
    const r = km(range(rng, P.relief.plateauRadiusKm[0], P.relief.plateauRadiusKm[1]));
    const ring = radialPolygon(c, r, makeRadialNoise(rng, 5), 44, 0.05);
    push({
      id: nid("plat"),
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        id: nid("plat_p"),
        name: `${makeStem(rng)} Plateau`,
        featureType: "plateau",
        tier: 2,
        elevation: Math.round(Math.min(P.relief.maxElevation * 0.55, range(rng, 900, 3400)) * config.reliefIntensity),
        areaKm2: Math.round(areaUnitsToKm2(polygonArea([ring]))),
        geologicalOrigin: "Uplifted intracontinental tableland behind the fold belt",
      },
      bbox: bboxOfRing(ring),
      lodMinZoom: 0.2,
    });
  }

  // -------------------------------------------------------------------------
  // 3. Summits & volcanoes
  // -------------------------------------------------------------------------
  await tick(4, "Planting Summits, Cols & Volcanic Vents", 42);
  const peaks: MapFeature[] = [];
  const peakBudget = Math.max(1, Math.min(P.relief.maxPeaks, Math.round(budget * P.relief.peakShare)));
  const minPeakElev = Math.min(600, P.relief.maxElevation * 0.2);

  const makePeak = (p: Pt, elev: number, rank: number, origin: string, lod = 0): MapFeature => ({
    id: nid("pk"),
    geometry: { type: "Point", coordinates: p },
    properties: {
      id: nid("pk_p"),
      name: nameFeature(rng, "mountain", rank),
      featureType: "mountain",
      tier: 2,
      elevation: elev,
      prominence: Math.round(elev * range(rng, 0.25, 0.65)),
      meanTempC: Math.round(baseTemperature(p[1], elev)),
      geologicalOrigin: origin,
    },
    bbox: { minX: p[0] - ptPad, minY: p[1] - ptPad, maxX: p[0] + ptPad, maxY: p[1] + ptPad },
    lodMinZoom: lod,
  });

  if (belts.length) {
    const perBelt = Math.round(peakBudget / belts.length);
    for (const belt of belts) {
      for (let i = 0; i < perBelt; i++) {
        const t = range(rng, 0.02, 0.98);
        const seg = Math.min(belt.line.length - 2, Math.floor(t * (belt.line.length - 1)));
        const frac = t * (belt.line.length - 1) - seg;
        const base: Pt = [
          belt.line[seg][0] + (belt.line[seg + 1][0] - belt.line[seg][0]) * frac,
          belt.line[seg][1] + (belt.line[seg + 1][1] - belt.line[seg][1]) * frac,
        ];
        const lateral = range(rng, -belt.width * 0.45, belt.width * 0.45);
        const nAng =
          Math.atan2(belt.line[seg + 1][1] - belt.line[seg][1], belt.line[seg + 1][0] - belt.line[seg][0]) +
          Math.PI / 2;
        const p: Pt = [base[0] + Math.cos(nAng) * lateral, base[1] + Math.sin(nAng) * lateral];
        if (!mask.isLand(p)) continue;

        const axial = Math.sin(Math.PI * t);
        const lateralFall = 1 - Math.abs(lateral) / (belt.width * 0.5 + 1e-6);
        const elev = Math.round(
          belt.peakElev * (0.42 + 0.58 * axial) * (0.6 + 0.4 * lateralFall) * range(rng, 0.78, 1.12)
        );
        if (elev < minPeakElev) continue;
        const f = makePeak(
          p,
          Math.min(P.relief.maxElevation, elev),
          elev > belt.peakElev * 0.9 ? 1 : 2,
          `Summit of the ${belt.name}`
        );
        peaks.push(f);
        push(f);
      }
    }
  } else if (P.relief.centralMassif) {
    // No room for a fold belt: build a radial massif / volcanic edifice around
    // the most inland point, the way real small islands are shaped.
    const top = mask.deepestPoint();
    const topElev = Math.round(
      Math.min(
        P.relief.maxElevation,
        (P.relief.baseElevation + (P.relief.maxElevation - P.relief.baseElevation) * (0.35 + 0.65 * tPos)) *
          config.reliefIntensity *
          range(rng, 0.75, 1.1)
      )
    );
    const origin =
      descriptor.kind === "island" ? "Summit of the island's volcanic edifice" : "Crest of the central massif";
    const summit = makePeak(top, topElev, 1, origin);
    peaks.push(summit);
    push(summit);
    for (let i = 1; i < peakBudget; i++) {
      const p = comps.sample(rng, 0.25);
      if (!p) continue;
      const elev = Math.round(topElev * Math.pow(mask.inlandFactor(p), 0.7) * range(rng, 0.6, 0.95));
      if (elev < minPeakElev * 0.5) continue;
      const f = makePeak(p, elev, 2, `Secondary cone on the flank of ${summit.properties.name}`);
      peaks.push(f);
      push(f);
    }
    log.push({
      kind: "contain",
      tier: 2,
      regionId: descriptor.id,
      description: `${P.label} class forbids fold belts: relief built as a radial massif — ${summit.properties.name} (${topElev.toLocaleString()} m) at the most inland point, with ${peaks.length - 1} flank summits.`,
    });
  }

  // Scattered inselbergs, apportioned block by block
  const inselbergs = Math.round(budget * P.relief.inselbergShare);
  if (inselbergs > 0) {
    const quotas = comps.allocate(inselbergs);
    comps.blocks.forEach((blk, bi) => {
      for (let k = 0; k < quotas[bi]; k++) {
        const p = comps.sampleIn(blk, rng, 0.2);
        if (!p) continue;
        const elev = Math.round(Math.min(P.relief.maxElevation * 0.35, range(rng, 400, 1800)) * config.reliefIntensity);
        const f = makePeak(p, elev, 3, "Isolated inselberg on the eroded shield", 2.6);
        peaks.push(f);
        push(f);
      }
    });
  }

  // Rank-based LOD
  {
    const ranked = [...peaks].sort((a, b) => (b.properties.elevation ?? 0) - (a.properties.elevation ?? 0));
    const tiers: [number, number][] = [
      [60, 0],
      [220, 1.6],
      [900, 3.2],
      [3000, 6],
    ];
    for (let i = 0; i < ranked.length; i++) {
      let lod = 11;
      for (const [limit, z] of tiers) {
        if (i < limit) {
          lod = z;
          break;
        }
      }
      ranked[i].lodMinZoom = lod;
    }
  }

  // Volcanoes — count capped by size class × tectonic setting
  const volcanoes: MapFeature[] = [];
  const setting = tectonicSettingOf(descriptor, belts.length > 0);
  const vCap = volcanoCapFor(P, setting);
  const formula =
    clamp(budget * 0.012, 1, 400) * (setting === "subduction" ? 1.9 : 1) * (descriptor.hotspot ? 2.2 : 1);
  const volcCount = vCap === 0 ? 0 : Math.max(1, Math.round(Math.min(formula, vCap * 2)));

  for (let v = 0; v < volcCount; v++) {
    let p: Pt | null = null;
    if (belts.length && chance(rng, 0.75)) {
      const belt = choice(rng, belts);
      const idx = irange(rng, 0, belt.line.length - 1);
      const jitter = belt.width * range(rng, -0.6, 0.6);
      p = [belt.line[idx][0] + jitter, belt.line[idx][1] + jitter * 0.5];
      if (!mask.isLand(p)) p = null;
    }
    if (!p) p = comps.sample(rng, descriptor.kind === "island" ? 0.3 : 0.05);
    if (!p) continue;

    const active = chance(rng, setting === "subduction" ? 0.5 : 0.3);
    const elev = Math.round(range(rng, 0.35, 1) * Math.min(5200, P.relief.maxElevation) * config.reliefIntensity);
    const f: MapFeature = {
      id: nid("vol"),
      geometry: { type: "Point", coordinates: p },
      properties: {
        id: nid("vol_p"),
        name: nameFeature(rng, "volcano"),
        featureType: "volcano",
        tier: 2,
        elevation: elev,
        isActiveVolcano: active,
        volcanoType: choice(rng, ["stratovolcano", "shield", "caldera", "fissure"] as const),
        meanTempC: Math.round(baseTemperature(p[1], elev)),
        geologicalOrigin: descriptor.hotspot
          ? "Mantle plume hotspot vent"
          : setting === "subduction"
          ? "Arc stratovolcano above the subducting slab"
          : "Intraplate rift volcanism",
      },
      bbox: { minX: p[0] - ptPad, minY: p[1] - ptPad, maxX: p[0] + ptPad, maxY: p[1] + ptPad },
      lodMinZoom: elev > 3200 ? 0 : 1.1,
    };
    volcanoes.push(f);
    push(f);
  }

  // -------------------------------------------------------------------------
  // 4. Lakes — radius window and count from the size class, per compartment
  // -------------------------------------------------------------------------
  await tick(5, "Filling Lake Basins Compartment by Compartment", 56);
  const lakes: MapFeature[] = [];
  const lakeTarget = Math.round(inClass(P.hydro.lakes) * (polar ? 1.5 : 1) * Math.sqrt(mul));
  const lakeQuotas = comps.allocate(lakeTarget);
  // Upper lake radius also slides with position inside the class
  const lrMin = P.hydro.lakeRadiusKm[0];
  const lrMax = lerpRange(P.hydro.lakeRadiusKm, Math.max(0.3, tPos));

  comps.blocks.forEach((blk, bi) => {
    for (let k = 0; k < lakeQuotas[bi]; k++) {
      const c = comps.sampleIn(blk, rng, 0.3);
      if (!c) continue;
      const glacial = polar || chance(rng, 0.3);
      const roll = Math.pow(rng(), 2.6);
      const rKm = (lrMin + roll * (lrMax - lrMin)) * (glacial ? 0.6 : 1);
      const ring = radialPolygon(c, km(rKm), makeRadialNoise(rng, 5), 30, 0.06);
      if (!ring.every((pt) => mask.isLand(pt))) continue;

      const areaKm2 = Math.max(0.01, areaUnitsToKm2(polygonArea([ring])));
      const f: MapFeature = {
        id: nid("lk"),
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: {
          id: nid("lk_p"),
          name: nameFeature(rng, "lake"),
          featureType: "lake",
          tier: 2,
          depth: Math.round(range(rng, 5, glacial ? 400 : 1400) * Math.min(1, 0.15 + rKm / Math.max(1, lrMax))),
          areaKm2: areaKm2 < 100 ? Math.round(areaKm2 * 100) / 100 : Math.round(areaKm2),
          climateZone: climateZoneAt(c[1]),
          geologicalOrigin: glacial
            ? "Glacially scoured basin behind a terminal moraine"
            : descriptor.kind === "island" && P.relief.centralMassif
            ? "Crater lake in a collapsed volcanic vent"
            : "Tectonic rift depression flooded to base level",
        },
        bbox: bboxOfRing(ring),
        lodMinZoom: rKm > lrMax * 0.45 ? 0 : rKm > lrMax * 0.2 ? 0.8 : 2.0,
      };
      lakes.push(f);
      push(f);
    }
  });

  // -------------------------------------------------------------------------
  // 5. Dendritic drainage — trunk count, max order and reach from the class
  // -------------------------------------------------------------------------
  await tick(6, "Routing Dendritic Drainage Networks", 74);
  const rivers: MapFeature[] = [];
  const maxOrder = P.hydro.maxStrahler;

  const headwaterMin = Math.min(800, P.relief.maxElevation * 0.3);
  const headwaterPool = [...peaks]
    .filter((p) => (p.properties.elevation ?? 0) > headwaterMin)
    .sort((a, b) => (b.properties.elevation ?? 0) - (a.properties.elevation ?? 0));

  const trunkBase = clamp(Math.round(linearKm / P.hydro.trunkSpacingKm), P.hydro.trunks[0], P.hydro.trunks[1]);
  const trunkTarget = Math.max(
    P.hydro.trunks[0] > 0 ? 1 : 0,
    Math.round(trunkBase * config.riverDensity * Math.sqrt(mul))
  );
  const riverCap = Math.max(4, Math.round(budget * P.hydro.riverShare));
  const minEmitKm = P.hydro.minRiverKm[1] * 0.5;

  const emitRiver = (
    path: Pt[],
    order: number,
    name: string,
    origin: string,
    mouthType: NonNullable<MapFeature["properties"]["mouthType"]>,
    drainsTo?: { id: string; name: string }
  ) => {
    if (path.length < 2) return null;
    let len = 0;
    for (let i = 1; i < path.length; i++) len += dist(path[i - 1], path[i]);
    const lengthKm = roundKm(unitsToKm(len));
    if (lengthKm < minEmitKm) return null;

    const rainMm = baseRainfall(path[0][1]) * config.moisture;
    const basinAreaKm2 = Math.min(descriptor.areaKm2 * 0.85, lengthKm * lengthKm * range(rng, 0.25, 0.9));
    // Runoff physics: basin × rainfall × runoff coefficient ÷ seconds per year
    const discharge = (basinAreaKm2 * 1e6 * (rainMm / 1000) * 0.35) / 3.156e7;

    const f: MapFeature = {
      id: nid("riv"),
      geometry: { type: "LineString", coordinates: path },
      properties: {
        id: nid("riv_p"),
        name,
        featureType: "river",
        tier: 2,
        strahlerOrder: order,
        lengthKm,
        dischargeM3s: discharge < 10 ? Math.round(discharge * 100) / 100 : Math.round(discharge),
        basinAreaKm2: basinAreaKm2 < 100 ? Math.round(basinAreaKm2 * 10) / 10 : Math.round(basinAreaKm2),
        mouthType,
        drainsToId: drainsTo?.id,
        drainsToName: drainsTo?.name,
        annualRainfallMm: Math.round(rainMm),
        geologicalOrigin: origin,
      },
      bbox: bboxOfCoords(path),
      // LOD relative to the class's own top order, so an islet's order-2
      // stream is as visible as a continent's order-5 trunk
      lodMinZoom: [0, 0.35, 1.0, 2.2, 4.0][Math.min(4, maxOrder - order)],
    };
    rivers.push(f);
    push(f);
    return f;
  };

  const spawnTributaries = (
    parentPath: Pt[],
    parentOrder: number,
    parentName: string,
    parentId: string,
    depth: number
  ) => {
    if (parentOrder <= 1 || depth > 3 || rivers.length >= riverCap) return;
    const childOrder = parentOrder - 1;
    const n = Math.max(1, Math.round(clamp(childOrder * 0.75, 1, 3.5) * config.riverDensity));

    for (let i = 0; i < n; i++) {
      if (rivers.length >= riverCap) return;
      const at = Math.floor(range(rng, 0.12, 0.92) * (parentPath.length - 1));
      const confluence = parentPath[at];
      const prev = parentPath[Math.max(0, at - 1)];
      const next = parentPath[Math.min(parentPath.length - 1, at + 1)];
      const flow = Math.atan2(next[1] - prev[1], next[0] - prev[0]);
      const side = chance(rng, 0.5) ? 1 : -1;
      const srcAngle = flow + Math.PI - side * range(rng, 0.35, 0.8);
      const reach =
        km(range(rng, P.hydro.tributaryReachKm[0], P.hydro.tributaryReachKm[1])) *
        (childOrder / parentOrder + 0.35);
      const src: Pt = [confluence[0] + Math.cos(srcAngle) * reach, confluence[1] + Math.sin(srcAngle) * reach];
      if (!mask.isLand(src)) continue;

      const path = fractalLine(rng, src, confluence, 0.16, childOrder >= 3 ? 4 : 3);
      if (!path.every((pt) => mask.isLand(pt))) continue;

      const child = emitRiver(
        path,
        childOrder,
        nameFeature(rng, "river", childOrder),
        `Order-${childOrder} tributary of the ${parentName}`,
        "confluence",
        { id: parentId, name: parentName }
      );
      if (child) spawnTributaries(path, childOrder, child.properties.name, child.id, depth + 1);
    }
  };

  const primaryTrunks = Math.ceil(trunkTarget * 0.65);
  for (let t = 0; t < trunkTarget; t++) {
    if (rivers.length >= riverCap) break;
    let head: Pt | null = null;
    if (headwaterPool.length && chance(rng, 0.72)) {
      const pick = headwaterPool[irange(rng, 0, Math.min(headwaterPool.length - 1, 240))];
      head = pick.geometry.coordinates as Pt;
    } else {
      head = comps.sample(rng, 0.45);
    }
    if (!head) continue;

    const flow = mask.flowToCoast(head, rng);
    let path = flow.path;
    if (path.length < 4) continue;

    if (!flow.reachedCoast) {
      const tail = path[path.length - 1];
      const { point: shore, dist: dShore } = nearestOnLine(descriptor.outline, tail);
      if (dShore > km(P.hydro.coastReachKm * 0.45)) {
        path = path.concat(fractalLine(rng, tail, shore, 0.12, 3).slice(1));
      }
    }

    const end = path[path.length - 1];
    const lakeHit = lakes.find(
      (lk) => dist(centroidOf(lk.geometry.coordinates[0]), end) < km(P.hydro.lakeRadiusKm[1] * 0.8)
    );

    let runLen = 0;
    for (let i = 1; i < path.length; i++) runLen += dist(path[i - 1], path[i]);
    const amp = Math.min(km(P.hydro.meanderKm), runLen * 0.035);
    path = meander(rng, meander(rng, path, amp), amp * 0.4);

    const order = t < primaryTrunks ? maxOrder : Math.max(1, maxOrder - 1);
    const name = nameFeature(rng, "river", order);
    const trunk = lakeHit
      ? emitRiver(path, order, name, `Trunk river draining into ${lakeHit.properties.name}`, "lake_inflow", {
          id: lakeHit.id,
          name: lakeHit.properties.name,
        })
      : emitRiver(path, order, name, "Trunk river reaching the ocean", "ocean_delta");
    if (!trunk) continue;

    if (lakeHit) {
      log.push({
        kind: "drainage",
        tier: 2,
        regionId: descriptor.id,
        description: `"${name}" never reaches the sea — the gradient field dead-ends in "${lakeHit.properties.name}", making it an endorheic inflow.`,
        relatedFeatureId: lakeHit.id,
        relatedFeatureName: lakeHit.properties.name,
      });
    }
    for (const belt of belts) {
      if (path.some((pt) => nearestOnLine(belt.line, pt).dist < belt.width * 0.55)) {
        log.push({
          kind: "cross",
          tier: 2,
          regionId: descriptor.id,
          description: `"${name}" predates the uplift of the ${belt.name} and has sawn an antecedent water gap through the ridge.`,
          relatedFeatureId: belt.id,
          relatedFeatureName: belt.name,
        });
        break;
      }
    }
    spawnTributaries(path, order, name, trunk.id, 0);
  }

  // -------------------------------------------------------------------------
  // 6. Biomes — patch size and count from the class, per compartment
  // -------------------------------------------------------------------------
  await tick(7, "Resolving Biomes & Orographic Rain Shadows", 88);
  const biomes: MapFeature[] = [];
  const shadowReach = km(Math.max(P.relief.rangeWidthKm[1] * 2.2, 2));

  const rainShadowAt = (p: Pt): { lee: boolean; belt: Belt | null } => {
    let best: Belt | null = null;
    let bestD = Infinity;
    for (const belt of belts) {
      const d = nearestOnLine(belt.line, p).dist;
      if (d < bestD) {
        bestD = d;
        best = belt;
      }
    }
    if (!best || bestD > shadowReach) return { lee: false, belt: null };
    const near = nearestOnLine(best.line, p).point;
    const alongWind = (p[0] - near[0]) * Math.cos(windAngle) + (p[1] - near[1]) * Math.sin(windAngle);
    return { lee: alongWind > 0, belt: best };
  };

  const biomeTarget = Math.max(P.biome.count[0], Math.round(inClass(P.biome.count) * Math.min(1.6, Math.sqrt(mul))));
  const biomeQuotas = comps.allocate(biomeTarget);
  let shadowLogged = 0;

  comps.blocks.forEach((blk, bi) => {
    for (let k = 0; k < biomeQuotas[bi]; k++) {
      const c = comps.sampleIn(blk, rng, 0.05);
      if (!c) continue;
      const { lee, belt } = rainShadowAt(c);
      const rain = baseRainfall(c[1]) * config.moisture * (lee ? 0.28 : 1.25);
      const temp = baseTemperature(c[1]);
      const zone = climateZoneAt(c[1]);

      let type: MapFeature["properties"]["featureType"];
      let origin: string;
      if (temp < -6 && config.glaciation > 0.35) {
        type = "glacier";
        origin = "Permanent ice field above the regional snowline";
      } else if (temp < 2) {
        type = "tundra";
        origin = "Permafrost tundra with cryoturbated soils";
      } else if (rain < 280) {
        type = "desert";
        origin = lee
          ? `Rain-shadow desert starved of moisture by the ${belt?.name ?? "coastal ranges"}`
          : "Subtropical high-pressure desert";
      } else if (rain < 700) {
        type = temp > 18 ? "savanna" : "grassland";
        origin = temp > 18 ? "Seasonal tropical savanna" : "Continental steppe grassland";
      } else {
        type = "forest";
        origin =
          temp > 21 ? "Perennially wet equatorial rainforest" : temp > 8 ? "Temperate broadleaf forest" : "Boreal taiga";
      }

      const r = km(range(rng, P.biome.radiusKm[0], lerpRange(P.biome.radiusKm, Math.max(0.25, tPos))));
      const ring = radialPolygon(c, r, makeRadialNoise(rng, 6), 40, 0.05);
      const areaKm2 = areaUnitsToKm2(polygonArea([ring]));
      const f: MapFeature = {
        id: nid("bio"),
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: {
          id: nid("bio_p"),
          name: nameFeature(rng, type === "glacier" ? "glacier" : type === "desert" ? "desert" : "forest"),
          featureType: type,
          tier: 2,
          annualRainfallMm: Math.round(rain),
          meanTempC: Math.round(temp),
          climateZone: zone,
          windward: !lee,
          areaKm2: areaKm2 < 100 ? Math.round(areaKm2 * 10) / 10 : Math.round(areaKm2),
          geologicalOrigin: origin,
        },
        bbox: bboxOfRing(ring),
        lodMinZoom: 0,
      };
      biomes.push(f);
      push(f);

      if (lee && type === "desert" && belt && shadowLogged < 6) {
        shadowLogged++;
        log.push({
          kind: "rainshadow",
          tier: 2,
          regionId: descriptor.id,
          description: `${prevailingWindName(c[1])} are wrung dry crossing the ${belt.name}; the lee flank receives only ~${Math.round(rain)} mm/yr, so "${f.properties.name}" was placed as a rain-shadow desert.`,
          relatedFeatureId: belt.id,
          relatedFeatureName: belt.name,
        });
      }
    }
  });

  // Summit ice caps
  const snowline = 2600 + (1 - equatorDistance(descriptor.centroid[1])) * 2600;
  let capped = 0;
  for (const pk of peaks) {
    const elev = pk.properties.elevation ?? 0;
    if (elev <= snowline || capped > 220) continue;
    if (!chance(rng, 0.55 * config.glaciation)) continue;
    capped++;
    const p = pk.geometry.coordinates as Pt;
    const r = km(range(rng, P.glacierCapKm[0], P.glacierCapKm[1])) * ((elev - snowline) / 2500 + 0.6);
    const ring = radialPolygon(p, r, makeRadialNoise(rng, 3), 20, 0.05);
    const f: MapFeature = {
      id: nid("gl"),
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        id: nid("gl_p"),
        name: `${pk.properties.name} Icecap`,
        featureType: "glacier",
        tier: 2,
        elevation: elev,
        meanTempC: Math.round(baseTemperature(p[1], elev)),
        geologicalOrigin: `Summit ice cap above the ${Math.round(snowline).toLocaleString()} m regional snowline`,
      },
      bbox: bboxOfRing(ring),
      lodMinZoom: 1.4,
    };
    biomes.push(f);
    push(f);
  }
  if (capped > 0) {
    log.push({
      kind: "glaciation",
      tier: 2,
      regionId: descriptor.id,
      description: `${capped} summits rise above the ${Math.round(snowline).toLocaleString()} m snowline computed for latitude ${descriptor.lat.toFixed(1)}° and carry permanent ice caps.`,
    });
  }

  // -------------------------------------------------------------------------
  // 7. Stage 8 — Finetune Stage & Geomorphic Verification (size-aware)
  // -------------------------------------------------------------------------
  await tick(8, "Finetune Stage — Resolving Conflicts at Class Scale", 95);

  const rawFeatures = features.slice();
  const verificationBefore = verifyRegionDetail(rawFeatures, descriptor, mask, P, config.detailLevel);

  const {
    features: finetunedFeatures,
    report: finetune,
    finetuneLogs,
  } = runFinetuneStage(rawFeatures, descriptor, config, mask, P);
  log.push(...finetuneLogs);

  const verificationAfter = verifyRegionDetail(finetunedFeatures, descriptor, mask, P, config.detailLevel);
  const compartments = comps.summarise(finetunedFeatures);

  // -------------------------------------------------------------------------
  // Stats (from the finetuned set)
  // -------------------------------------------------------------------------
  const finalPeaks = finetunedFeatures.filter((f) => f.properties.featureType === "mountain");
  const finalVolcanoes = finetunedFeatures.filter((f) => f.properties.featureType === "volcano");
  const finalRivers = finetunedFeatures.filter((f) => f.properties.featureType === "river");
  const finalLakes = finetunedFeatures.filter((f) => f.properties.featureType === "lake");
  const finalBiomes = finetunedFeatures.filter((f) =>
    ["desert", "forest", "savanna", "grassland", "tundra", "glacier", "wetland"].includes(f.properties.featureType)
  );
  const finalTrunks = finalRivers.filter(
    (r) => r.properties.mouthType === "ocean_delta" || r.properties.mouthType === "lake_inflow"
  ).length;
  const finalRiverKm = roundKm(finalRivers.reduce((s, r) => s + (r.properties.lengthKm ?? 0), 0));

  let highestPeak = { name: "—", elevation: 0 };
  let elevSum = 0;
  for (const p of finalPeaks) {
    const e = p.properties.elevation ?? 0;
    elevSum += e;
    if (e > highestPeak.elevation) highestPeak = { name: p.properties.name, elevation: e };
  }
  let longestRiver = { name: "—", lengthKm: 0 };
  for (const r of finalRivers) {
    const l = r.properties.lengthKm ?? 0;
    if (l > longestRiver.lengthKm) longestRiver = { name: r.properties.name, lengthKm: l };
  }
  let largestLake = { name: "—", areaKm2: 0 };
  for (const l of finalLakes) {
    const a = l.properties.areaKm2 ?? 0;
    if (a > largestLake.areaKm2) largestLake = { name: l.properties.name, areaKm2: a };
  }

  let coordCount = 0;
  for (const f of finetunedFeatures) {
    const g = f.geometry;
    if (g.type === "Point") coordCount += 1;
    else if (g.type === "LineString") coordCount += g.coordinates.length;
    else if (g.type === "Polygon") coordCount += g.coordinates[0].length;
  }

  const stats: RegionStats = {
    regionId: descriptor.id,
    regionName: descriptor.name,
    totalFeatures: finetunedFeatures.length,
    mountainRanges: belts.length,
    peaks: finalPeaks.length,
    volcanoes: finalVolcanoes.length,
    rivers: finalTrunks,
    riverSegments: finalRivers.length,
    totalRiverLengthKm: finalRiverKm,
    lakes: finalLakes.length,
    glaciers: finalBiomes.filter((b) => b.properties.featureType === "glacier").length,
    biomes: finalBiomes.length,
    highestPeak,
    longestRiver,
    largestLake,
    meanElevationM: finalPeaks.length ? Math.round(elevSum / finalPeaks.length) : 0,
    generationTimeMs: Math.round(performance.now() - t0),
    approxMemoryKb: Math.max(1, Math.round((coordCount * 16 + finetunedFeatures.length * 260) / 1024)),
  };

  await tick(8, "Region Finetuned & Verified", 100);

  return {
    descriptor,
    config: { ...config, customSeed: effectiveSeed },
    seed: effectiveSeed,
    sizeClass,
    compartments,
    features: finetunedFeatures,
    rawFeatures,
    stats,
    finetune,
    verificationBefore,
    verificationAfter,
    log,
    generatedAt: Date.now(),
  };
}

// --- helpers ---------------------------------------------------------------

/** Longest contiguous on-land run of a polyline, so ridges stop at the coast. */
function trimToLand(mask: LandMask, line: Pt[]): Pt[] {
  let bestStart = 0;
  let bestLen = 0;
  let curStart = -1;
  for (let i = 0; i <= line.length; i++) {
    const on = i < line.length && mask.isLand(line[i]);
    if (on) {
      if (curStart < 0) curStart = i;
    } else if (curStart >= 0) {
      const len = i - curStart;
      if (len > bestLen) {
        bestLen = len;
        bestStart = curStart;
      }
      curStart = -1;
    }
  }
  return bestLen === 0 ? [] : line.slice(bestStart, bestStart + bestLen);
}

/** Push a point toward the region interior until it lands on the mask. */
function nudgeToLand(mask: LandMask, p: Pt, interior: Pt): Pt | null {
  if (mask.isLand(p)) return p;
  for (let s = 1; s <= 14; s++) {
    const t = s / 14;
    const q: Pt = [p[0] + (interior[0] - p[0]) * t, p[1] + (interior[1] - p[1]) * t];
    if (mask.isLand(q)) return q;
  }
  return null;
}

/** Add sub-grid meander so raster-stepped flow paths look like real rivers. */
function meander(rng: RNG, path: Pt[], amp: number): Pt[] {
  if (path.length < 3) return path;
  const out: Pt[] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1];
    const b = path[i];
    const c = path[i + 1];
    const sx = (a[0] + 2 * b[0] + c[0]) / 4;
    const sy = (a[1] + 2 * b[1] + c[1]) / 4;
    const nx = -(c[1] - a[1]);
    const ny = c[0] - a[0];
    const nl = Math.hypot(nx, ny) || 1;
    const w = (rng() * 2 - 1) * amp;
    out.push([sx + (nx / nl) * w, sy + (ny / nl) * w]);
  }
  out.push(path[path.length - 1]);
  return out;
}

/**
 * Re-cut the smooth Tier-1 outline with coastal detail whose amplitude is
 * bounded by the size class: sub-kilometre coves on an islet, 160 km fjords
 * on a continent.
 */
function refineCoastline(
  rng: RNG,
  ring: Pt[],
  mask: LandMask,
  polar: boolean,
  glaciation: number,
  coast: SizeProfile["coast"]
): Pt[] {
  const out: Pt[] = [];
  const centre = centroidOf(ring);
  const fjordChance = polar ? 0.16 * glaciation * (coast.fjordChance / 0.05) : coast.fjordChance;
  const maxFjord = kmToUnits(polar ? coast.fjordKm : coast.fjordKm * 0.45);
  const maxCrenulation = kmToUnits(coast.crenulationKm);

  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    out.push(a);

    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const seg = Math.hypot(dx, dy) || 1e-9;
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

    let nx = -dy / seg;
    let ny = dx / seg;
    const probe = Math.max(1e-5, seg * 0.6);
    const inA = mask.isLand([mid[0] + nx * probe, mid[1] + ny * probe]);
    const inB = mask.isLand([mid[0] - nx * probe, mid[1] - ny * probe]);
    if (inB && !inA) {
      nx = -nx;
      ny = -ny;
    } else if (inA === inB) {
      if ((centre[0] - mid[0]) * nx + (centre[1] - mid[1]) * ny < 0) {
        nx = -nx;
        ny = -ny;
      }
    }

    if (chance(rng, fjordChance)) {
      const depth = Math.min(maxFjord, seg * range(rng, 1.2, 3.2));
      const mouthW = Math.min(seg * 0.45, depth * 0.3);
      const px = -ny;
      const py = nx;
      out.push([mid[0] + px * mouthW - nx * depth * 0.2, mid[1] + py * mouthW - ny * depth * 0.2]);
      out.push([mid[0] + nx * depth, mid[1] + ny * depth]);
      out.push([mid[0] - px * mouthW - nx * depth * 0.2, mid[1] - py * mouthW - ny * depth * 0.2]);
    } else {
      const amp = Math.max(-maxCrenulation, Math.min(maxCrenulation, seg * range(rng, -0.55, 0.55)));
      out.push([mid[0] + nx * amp, mid[1] + ny * amp]);
    }
  }
  out.push([out[0][0], out[0][1]]);
  return out;
}
