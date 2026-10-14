import type {
  BBox,
  ConflictRecord,
  FinetuneReport,
  MapFeature,
  Pt,
  RegionConfig,
  RegionDescriptor,
} from "./types";
import { LandMask } from "./landmask";
import {
  bboxOfCoords,
  bboxOfRing,
  centroidOf,
  dist,
  nearestOnLine,
  pointInPolygon,
  pointInRing,
  polygonArea,
} from "./geom";
import { areaUnitsToKm2, kmToUnits, unitsToKm } from "./constants";
import {
  type SizeProfile,
  DETAIL_SPACING_FACTOR,
  DETAIL_RIVER_CAP_FACTOR,
  tectonicSettingOf,
  volcanoCapFor,
} from "./size-classes";

// ---------------------------------------------------------------------------
// POST-GENERATION FINETUNE STAGE
//
// Operates strictly on the already-generated Tier-2 feature list without
// modifying the upstream generation pipeline. Resolves physical & topological
// conflicts by dropping invalid features, snapping crossing rivers into true
// confluences, truncating ocean/lake pass-throughs, and pruning stray craton
// volcanoes and overcrowded 100K river tangles.
// ---------------------------------------------------------------------------

interface IndexedSegment {
  riverId: string;
  riverName: string;
  order: number;
  a: Pt;
  b: Pt;
  isTerminal: boolean;
}

class RiverSegmentGrid {
  private minX: number;
  private minY: number;
  private cellW: number;
  private cellH: number;
  private cols: number;
  private rows: number;
  private cells: IndexedSegment[][];

  constructor(bbox: BBox, cols = 140, rows = 140) {
    this.minX = bbox.minX;
    this.minY = bbox.minY;
    this.cols = cols;
    this.rows = rows;
    this.cellW = Math.max(1e-6, (bbox.maxX - bbox.minX) / cols);
    this.cellH = Math.max(1e-6, (bbox.maxY - bbox.minY) / rows);
    this.cells = Array.from({ length: cols * rows }, () => []);
  }

  private clampC(x: number) {
    return Math.max(0, Math.min(this.cols - 1, Math.floor((x - this.minX) / this.cellW)));
  }
  private clampR(y: number) {
    return Math.max(0, Math.min(this.rows - 1, Math.floor((y - this.minY) / this.cellH)));
  }

  insertRiver(river: MapFeature) {
    const pts = river.geometry.coordinates as Pt[];
    const order = river.properties.strahlerOrder ?? 1;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const seg: IndexedSegment = {
        riverId: river.id,
        riverName: river.properties.name,
        order,
        a,
        b,
        isTerminal: i === pts.length - 2,
      };
      const c0 = this.clampC(Math.min(a[0], b[0]));
      const c1 = this.clampC(Math.max(a[0], b[0]));
      const r0 = this.clampR(Math.min(a[1], b[1]));
      const r1 = this.clampR(Math.max(a[1], b[1]));
      for (let r = r0; r <= r1; r++) {
        const off = r * this.cols;
        for (let c = c0; c <= c1; c++) {
          this.cells[off + c].push(seg);
        }
      }
    }
  }

  queryNearSegment(a: Pt, b: Pt, pad: number): IndexedSegment[] {
    const c0 = this.clampC(Math.min(a[0], b[0]) - pad);
    const c1 = this.clampC(Math.max(a[0], b[0]) + pad);
    const r0 = this.clampR(Math.min(a[1], b[1]) - pad);
    const r1 = this.clampR(Math.max(a[1], b[1]) + pad);
    const out: IndexedSegment[] = [];
    const seen = new Set<IndexedSegment>();
    for (let r = r0; r <= r1; r++) {
      const off = r * this.cols;
      for (let c = c0; c <= c1; c++) {
        const bucket = this.cells[off + c];
        for (let i = 0; i < bucket.length; i++) {
          const s = bucket[i];
          if (!seen.has(s)) {
            seen.add(s);
            out.push(s);
          }
        }
      }
    }
    return out;
  }
}

/**
 * Exact 2D line segment intersection between p1->p2 and p3->p4.
 * Returns parameter t along p1->p2 (0..1) and intersection point, or null.
 */
export function segmentIntersection(
  p1: Pt,
  p2: Pt,
  p3: Pt,
  p4: Pt
): { t: number; u: number; point: Pt } | null {
  const d1x = p2[0] - p1[0];
  const d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0];
  const d2y = p4[1] - p3[1];

  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null;

  const dx = p3[0] - p1[0];
  const dy = p3[1] - p1[1];
  const t = (dx * d2y - dy * d2x) / denom;
  const u = (dx * d1y - dy * d1x) / denom;

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      t,
      u,
      point: [p1[0] + t * d1x, p1[1] + t * d1y],
    };
  }
  return null;
}

/** Closest point on segment a->b to point p, plus distance. */
export function closestOnSegment(p: Pt, a: Pt, b: Pt): { point: Pt; dist: number; u: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return { point: [a[0], a[1]], dist: dist(p, a), u: 0 };
  let u = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  u = Math.max(0, Math.min(1, u));
  const pt: Pt = [a[0] + u * dx, a[1] + u * dy];
  return { point: pt, dist: dist(p, pt), u };
}

function bboxesOverlap(a: BBox, b: BBox, pad = 0): boolean {
  return (
    a.minX - pad <= b.maxX &&
    a.maxX + pad >= b.minX &&
    a.minY - pad <= b.maxY &&
    a.maxY + pad >= b.minY
  );
}

/** Shared rule (finetune + verifier): does a biome patch cover any land? */
export function biomeTouchesLand(ring: Pt[], mask: LandMask, regionCentroid: Pt): boolean {
  if (mask.isLand(centroidOf(ring))) return true;
  if (pointInRing(regionCentroid, ring) && mask.isLand(regionCentroid)) return true;
  for (const v of ring) if (mask.isLand(v)) return true;
  return false;
}

/** Excise any self-intersecting loops along a polyline. */
function removeSelfLoops(pts: Pt[]): Pt[] {
  const out = pts.slice();
  let i = 0;
  while (i < out.length - 1) {
    let spliced = false;
    for (let j = 0; j < i - 1; j++) {
      const hit = segmentIntersection(out[j], out[j + 1], out[i], out[i + 1]);
      if (hit) {
        out.splice(j + 1, i - j, hit.point);
        i = j + 1;
        spliced = true;
        break;
      }
    }
    if (!spliced) i++;
  }
  return out;
}

export function runFinetuneStage(
  rawFeatures: MapFeature[],
  descriptor: RegionDescriptor,
  config: RegionConfig,
  mask: LandMask,
  profile: SizeProfile
): {
  features: MapFeature[];
  report: FinetuneReport;
  finetuneLogs: ConflictRecord[];
} {
  const t0 = performance.now();
  const finetuneLogs: ConflictRecord[] = [];
  const km = (v: number) => kmToUnits(v);

  // Bucket raw features by category
  const coastlines: MapFeature[] = [];
  const ranges: MapFeature[] = [];
  const plateaus: MapFeature[] = [];
  const rawLakes: MapFeature[] = [];
  const rawVolcanoes: MapFeature[] = [];
  const rawPeaks: MapFeature[] = [];
  const rawRivers: MapFeature[] = [];
  const rawBiomes: MapFeature[] = [];
  const others: MapFeature[] = [];

  for (const f of rawFeatures) {
    switch (f.properties.featureType) {
      case "coastline":
        coastlines.push(f);
        break;
      case "mountain_range":
        ranges.push(f);
        break;
      case "plateau":
        plateaus.push(f);
        break;
      case "lake":
        rawLakes.push(f);
        break;
      case "volcano":
        rawVolcanoes.push(f);
        break;
      case "mountain":
        rawPeaks.push(f);
        break;
      case "river":
        rawRivers.push(f);
        break;
      case "desert":
      case "forest":
      case "savanna":
      case "grassland":
      case "tundra":
      case "glacier":
      case "wetland":
        rawBiomes.push(f);
        break;
      default:
        others.push(f);
    }
  }

  // -------------------------------------------------------------------------
  // PASS 1: Lake Basin Discipline — Count Cap, Spacing & Zipf Size Rescaling
  //   Raw generation spawns many oversized lake candidates. Here in Finetune:
  //   1. Cap total lakes to profile.hydro.finetuneMaxLakes (e.g. <= 15 on a continent)
  //   2. Enforce minimum inter-lake basin spacing (profile.hydro.finetuneLakeSpacingKm)
  //   3. Radially shrink oversized raw lakes around their centroid into a
  //      realistic Zipf/Pareto size hierarchy (at most 1 premier Great Lake,
  //      with subsequent lakes tapering by (k+1)^-0.55)
  //   4. Cap cumulative lake surface area to <= finetuneMaxLakeShare (~0.5%) of land area
  // -------------------------------------------------------------------------
  const sortedLakes = [...rawLakes].sort(
    (a, b) => (b.properties.areaKm2 ?? 0) - (a.properties.areaKm2 ?? 0)
  );
  const keptLakes: MapFeature[] = [];
  let lakesDroppedOverlapOrCoast = 0;
  let lakesRescaled = 0;
  let totalLakeAreaKm2 = 0;

  const maxLakesAllowed = profile.hydro.finetuneMaxLakes;
  const minLakeSpacing = km(profile.hydro.finetuneLakeSpacingKm);
  const maxPremierRadiusKm = Math.min(
    profile.hydro.finetuneMaxLakeRadiusKm,
    Math.sqrt(Math.max(1, descriptor.areaKm2)) * 0.0105
  );
  const maxTotalLakeAreaKm2 = descriptor.areaKm2 * profile.hydro.finetuneMaxLakeShare;

  for (const lk of sortedLakes) {
    if (keptLakes.length >= maxLakesAllowed) {
      lakesDroppedOverlapOrCoast++;
      continue;
    }

    let ring = (lk.geometry.coordinates[0] as Pt[]).map((p) => [p[0], p[1]] as Pt);
    const centre = centroidOf(ring);
    const coastDistUnits = mask.distanceToCoast(centre);

    // Must sit firmly inland (never breaching the coast)
    if (!mask.isLand(centre) || coastDistUnits < km(profile.hydro.lakeCoastBufferKm)) {
      lakesDroppedOverlapOrCoast++;
      continue;
    }

    // Enforce inter-lake basin spacing & disjointness against already-accepted lakes
    let tooCloseOrOverlaps = false;
    for (const existing of keptLakes) {
      const exRing = existing.geometry.coordinates[0] as Pt[];
      const exCentre = centroidOf(exRing);
      if (dist(centre, exCentre) < minLakeSpacing) {
        tooCloseOrOverlaps = true;
        break;
      }
      if (
        bboxesOverlap(lk.bbox, existing.bbox, km(8)) &&
        (pointInRing(centre, exRing) ||
          ring.some((pt) => pointInRing(pt, exRing)) ||
          exRing.some((pt) => pointInRing(pt, ring)))
      ) {
        tooCloseOrOverlaps = true;
        break;
      }
    }
    if (tooCloseOrOverlaps) {
      lakesDroppedOverlapOrCoast++;
      continue;
    }

    // Zipf rank radius ceiling for the k-th lake: k=0 gets maxPremierRadiusKm,
    // k=1 gets ~0.68x, k=2 gets ~0.55x, etc., plus local coast-clearance cap
    const rankIndex = keptLakes.length;
    const rankRadiusCapKm = maxPremierRadiusKm * Math.pow(rankIndex + 1, -0.55);
    const coastClearanceKm = Math.max(
      0.08,
      (unitsToKm(coastDistUnits) - profile.hydro.lakeCoastBufferKm * 0.85) * 0.7
    );
    const allowedRadiusKm = Math.max(
      profile.hydro.lakeRadiusKm[0] * 0.5,
      Math.min(rankRadiusCapKm, coastClearanceKm)
    );

    const rawAreaKm2 = Math.max(1e-4, areaUnitsToKm2(polygonArea([ring])));
    const rawRadiusKm = Math.sqrt(rawAreaKm2 / Math.PI);

    let wasRescaled = false;
    if (rawRadiusKm > allowedRadiusKm) {
      const scaleFactor = allowedRadiusKm / rawRadiusKm;
      ring = ring.map(
        ([x, y]) =>
          [
            centre[0] + (x - centre[0]) * scaleFactor,
            centre[1] + (y - centre[1]) * scaleFactor,
          ] as Pt
      );
      wasRescaled = true;
    }

    // Verify all vertices of the (possibly rescaled) lake sit on dry land
    if (!ring.every((pt) => mask.isLand(pt))) {
      lakesDroppedOverlapOrCoast++;
      continue;
    }

    const finalAreaKm2 = Math.max(0.01, areaUnitsToKm2(polygonArea([ring])));

    // Enforce cumulative freshwater surface area budget across the landmass
    if (keptLakes.length >= 1 && totalLakeAreaKm2 + finalAreaKm2 > maxTotalLakeAreaKm2) {
      lakesDroppedOverlapOrCoast++;
      continue;
    }

    if (wasRescaled) lakesRescaled++;
    totalLakeAreaKm2 += finalAreaKm2;

    const formattedArea =
      finalAreaKm2 < 100 ? Math.round(finalAreaKm2 * 100) / 100 : Math.round(finalAreaKm2);

    keptLakes.push({
      ...lk,
      geometry: { type: "Polygon", coordinates: [ring] },
      bbox: bboxOfRing(ring),
      properties: {
        ...lk.properties,
        areaKm2: formattedArea,
        depth: wasRescaled
          ? Math.max(8, Math.round((lk.properties.depth ?? 80) * Math.sqrt(allowedRadiusKm / rawRadiusKm)))
          : lk.properties.depth,
      },
    });
  }

  if (rawLakes.length > keptLakes.length || lakesRescaled > 0) {
    const sharePct = ((totalLakeAreaKm2 / Math.max(1, descriptor.areaKm2)) * 100).toFixed(2);
    finetuneLogs.push({
      kind: "drainage",
      tier: 2,
      regionId: descriptor.id,
      description: `Finetune Stage disciplined lake basins: pruned ${lakesDroppedOverlapOrCoast} excess/clustered lakes and rescaled ${lakesRescaled} oversized basins into a Zipf size hierarchy (${keptLakes.length} lakes retained, covering ${sharePct}% of ${descriptor.name}).`,
    });
  }

  const pointInAnyLake = (p: Pt): MapFeature | null => {
    for (const lk of keptLakes) {
      if (
        p[0] >= lk.bbox.minX &&
        p[0] <= lk.bbox.maxX &&
        p[1] >= lk.bbox.minY &&
        p[1] <= lk.bbox.maxY &&
        pointInPolygon(p, lk.geometry.coordinates as Pt[][])
      ) {
        return lk;
      }
    }
    return null;
  };

  // -------------------------------------------------------------------------
  // PASS 2: Volcano Tectonic & Hydrological Reconciliation
  //   - No volcanoes in water or lakes
  //   - No random volcanoes scattered across flat craton shields
  //   - Continents without subduction/hotspot keep only rare high-relief rift vents
  //   - Enforce minimum volcanic spacing along arcs
  // -------------------------------------------------------------------------
  // Volcano cap = size class × tectonic setting (shared definition with the
  // generator and verifier). On volcanic islands the island IS the edifice,
  // so the "must sit on an orogenic arc" rule is waived.
  const setting = tectonicSettingOf(descriptor, ranges.length > 0);
  const isHotspot = setting === "hotspot" || descriptor.kind === "island";
  const maxVolcanoCap = volcanoCapFor(profile, setting);
  const minVolcanoSpacing = km(profile.volcano.spacingKm);
  const maxArcOffset = km(profile.volcano.arcOffsetKm);

  const sortedVolcanoes = [...rawVolcanoes].sort(
    (a, b) => (b.properties.elevation ?? 0) - (a.properties.elevation ?? 0)
  );
  const keptVolcanoes: MapFeature[] = [];
  let volcanoesDroppedCraton = 0;
  let volcanoesDroppedWaterOrCrowd = 0;

  for (const v of sortedVolcanoes) {
    if (keptVolcanoes.length >= maxVolcanoCap) {
      volcanoesDroppedCraton++;
      continue;
    }
    const p = v.geometry.coordinates as Pt;

    // 1. Must be on dry land and not inside a lake
    if (!mask.isLand(p) || pointInAnyLake(p) !== null) {
      volcanoesDroppedWaterOrCrowd++;
      continue;
    }

    // 2. Tectonic arc / hotspot check: must sit inside or near an orogenic belt or plateau
    if (!isHotspot) {
      const inOrNearBelt = ranges.some((r) => {
        if (!bboxesOverlap(v.bbox, r.bbox, maxArcOffset)) return false;
        const ring = r.geometry.coordinates[0] as Pt[];
        if (pointInRing(p, ring)) return true;
        return nearestOnLine(ring, p).dist <= maxArcOffset;
      });
      const inPlateau = plateaus.some(
        (pl) =>
          bboxesOverlap(v.bbox, pl.bbox, maxArcOffset * 0.3) &&
          pointInRing(p, pl.geometry.coordinates[0] as Pt[])
      );
      if (!inOrNearBelt && !inPlateau) {
        volcanoesDroppedCraton++;
        continue;
      }
    }

    // 3. Minimum spacing check against already-kept volcanoes
    const tooClose = keptVolcanoes.some(
      (kv) => dist(p, kv.geometry.coordinates as Pt) < minVolcanoSpacing
    );
    if (tooClose) {
      volcanoesDroppedWaterOrCrowd++;
      continue;
    }

    keptVolcanoes.push(v);
  }

  if (rawVolcanoes.length > keptVolcanoes.length) {
    finetuneLogs.push({
      kind: "volcanism",
      tier: 2,
      regionId: descriptor.id,
      description: `Finetune Stage pruned ${rawVolcanoes.length - keptVolcanoes.length} unrealistic volcanoes (${volcanoesDroppedCraton} stray craton vents outside subduction/hotspot zones, ${volcanoesDroppedWaterOrCrowd} crowded or submerged vents), keeping ${keptVolcanoes.length} tectonically valid vents.`,
    });
  }

  // -------------------------------------------------------------------------
  // PASS 3: Summit / Peak Deduplication & Hydrological Cleanup
  // -------------------------------------------------------------------------
  const sortedPeaks = [...rawPeaks].sort(
    (a, b) => (b.properties.elevation ?? 0) - (a.properties.elevation ?? 0)
  );
  const keptPeaks: MapFeature[] = [];
  let peaksDroppedWaterOrCrowd = 0;

  // Spatial hash for peak spacing
  const minPeakDist = km(profile.relief.peakSpacingKm * DETAIL_SPACING_FACTOR[config.detailLevel]);
  const peakCellSize = Math.max(1e-3, minPeakDist);
  const peakGrid = new Map<string, Pt[]>();

  for (const pk of sortedPeaks) {
    const p = pk.geometry.coordinates as Pt;
    if (!mask.isLand(p) || pointInAnyLake(p) !== null) {
      peaksDroppedWaterOrCrowd++;
      continue;
    }
    const gx = Math.floor(p[0] / peakCellSize);
    const gy = Math.floor(p[1] / peakCellSize);
    let crowded = false;
    for (let dx = -1; dx <= 1 && !crowded; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = peakGrid.get(`${gx + dx}:${gy + dy}`);
        if (!cell) continue;
        for (const q of cell) {
          if (dist(p, q) < minPeakDist) {
            crowded = true;
            break;
          }
        }
      }
    }
    if (crowded) {
      peaksDroppedWaterOrCrowd++;
      continue;
    }
    const key = `${gx}:${gy}`;
    let bucket = peakGrid.get(key);
    if (!bucket) {
      bucket = [];
      peakGrid.set(key, bucket);
    }
    bucket.push(p);
    keptPeaks.push(pk);
  }

  // Re-assign clean rank-based LOD on surviving peaks
  const peakLodTiers: [number, number][] = [
    [60, 0],
    [220, 1.6],
    [900, 3.2],
    [3000, 6],
  ];
  for (let i = 0; i < keptPeaks.length; i++) {
    let lod = 11;
    for (const [limit, z] of peakLodTiers) {
      if (i < limit) {
        lod = z;
        break;
      }
    }
    keptPeaks[i].lodMinZoom = lod;
  }

  // -------------------------------------------------------------------------
  // PASS 4: River Network Topological & Hydrological Correction
  //   Fixes:
  //   1. Rivers crossing ocean bays or starting in water
  //   2. Rivers passing straight through lakes instead of terminating at lake rim
  //   3. Rivers crossing each other (X-junctions) or meeting and separating
  //   4. Hanging tributaries whose parent was pruned or truncated
  //   5. Overcrowded 100K parallel river corridors
  // -------------------------------------------------------------------------
  const segGrid = new RiverSegmentGrid(descriptor.bbox, 160, 160);
  const keptRivers: MapFeature[] = [];
  const keptRiverById = new Map<string, MapFeature>();

  let riversSnappedConfluence = 0;
  let riversClippedCoast = 0;
  let riversClippedLake = 0;
  let riversDroppedBraidOrCrowd = 0;
  let riversDroppedStub = 0;

  // Sort rivers: highest Strahler order first (5 -> 4 -> 3 -> 2 -> 1), then longest first
  const sortedRivers = [...rawRivers].sort((a, b) => {
    const oa = a.properties.strahlerOrder ?? 1;
    const ob = b.properties.strahlerOrder ?? 1;
    if (ob !== oa) return ob - oa;
    return (b.properties.lengthKm ?? 0) - (a.properties.lengthKm ?? 0);
  });

  // All hydrological tolerances scale with the land-size class
  const spacingFactor = DETAIL_SPACING_FACTOR[config.detailLevel];
  const snapRadius = km(profile.hydro.snapKm);
  const minHeadwaterClearance = km(profile.hydro.headClearanceKm * Math.min(1.15, spacingFactor));
  const corridorRadius = km(profile.hydro.corridorKm * spacingFactor);
  const coastReach = km(profile.hydro.coastReachKm);

  // Survivor cap: class base × detail factor, so an islet keeps a handful of
  // streams and a supercontinent at Ultra keeps a few thousand
  const maxRegionRivers = Math.max(
    3,
    Math.round(profile.hydro.maxRivers * DETAIL_RIVER_CAP_FACTOR[config.detailLevel])
  );

  for (const rawRiv of sortedRivers) {
    if (keptRivers.length >= maxRegionRivers) {
      riversDroppedBraidOrCrowd++;
      continue;
    }

    const order = rawRiv.properties.strahlerOrder ?? 1;
    let pts = (rawRiv.geometry.coordinates as Pt[]).map((p) => [p[0], p[1]] as Pt);
    if (pts.length < 2) {
      riversDroppedStub++;
      continue;
    }

    // --- Step 4A: Strip any leading ocean/lake vertices at headwaters ---
    while (
      pts.length > 0 &&
      (!mask.isLand(pts[0]) || pointInAnyLake(pts[0]) !== null)
    ) {
      pts.shift();
    }
    if (pts.length < 2) {
      riversDroppedStub++;
      continue;
    }

    // Headwater clearance: don't spawn a new river right on top of an existing river
    const headHits = segGrid.queryNearSegment(pts[0], pts[0], minHeadwaterClearance);
    let headTooClose = false;
    for (const s of headHits) {
      if (closestOnSegment(pts[0], s.a, s.b).dist < minHeadwaterClearance) {
        headTooClose = true;
        break;
      }
    }
    if (headTooClose) {
      riversDroppedBraidOrCrowd++;
      continue;
    }

    // Remove any accidental fractal self-intersection loops on this river first
    pts = removeSelfLoops(pts);
    if (pts.length < 2) {
      riversDroppedStub++;
      continue;
    }

    // --- Step 4B: Walk from headwater downstream, clipping at first coast or lake ---
    let mouthType: NonNullable<MapFeature["properties"]["mouthType"]> =
      rawRiv.properties.mouthType ?? "ocean_delta";
    let drainsToId = rawRiv.properties.drainsToId;
    let drainsToName = rawRiv.properties.drainsToName;

    let clippedAtCoast = false;
    let clippedAtLake = false;

    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const p = pts[i];
      // Check lake entry (either vertex p is inside lake, or segment prev->p crosses lake ring)
      let hitLake = pointInAnyLake(p);
      if (!hitLake) {
        for (const lk of keptLakes) {
          if (!bboxesOverlap(bboxOfCoords([prev, p]), lk.bbox)) continue;
          const ring = lk.geometry.coordinates[0] as Pt[];
          for (let j = 0; j < ring.length - 1; j++) {
            if (segmentIntersection(prev, p, ring[j], ring[j + 1])) {
              hitLake = lk;
              break;
            }
          }
          if (hitLake) break;
        }
      }
      if (hitLake) {
        // Terminate at the last dry point just outside the lake rim
        const ring = hitLake.geometry.coordinates[0] as Pt[];
        const near = nearestOnLine(ring, prev).point;
        const safeRim: Pt = [
          prev[0] + (near[0] - prev[0]) * 0.88,
          prev[1] + (near[1] - prev[1]) * 0.88,
        ];
        const endPt = pointInAnyLake(safeRim) ? prev : safeRim;
        pts = pts.slice(0, i).concat([endPt]);
        mouthType = "lake_inflow";
        drainsToId = hitLake.id;
        drainsToName = hitLake.properties.name;
        clippedAtLake = true;
        break;
      }
      // Check coastline exit
      if (!mask.isLand(p)) {
        const mid: Pt = [(prev[0] + p[0]) / 2, (prev[1] + p[1]) / 2];
        const coastPt = mask.isLand(mid) ? mid : prev;
        pts = pts.slice(0, i).concat([coastPt]);
        mouthType = "ocean_delta";
        drainsToId = undefined;
        drainsToName = undefined;
        clippedAtCoast = true;
        break;
      }
    }

    if (clippedAtCoast) riversClippedCoast++;
    if (clippedAtLake) riversClippedLake++;

    if (pts.length < 2) {
      riversDroppedStub++;
      continue;
    }

    // --- Step 4C: Check against existing rivers for crossings, confluence capture, & parallel crowding ---
    let capturedBy: { riverId: string; riverName: string; cutIndex: number; junctionPt: Pt } | null =
      null;
    let crowdedSteps = 0;

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const nearby = segGrid.queryNearSegment(a, b, Math.max(snapRadius, corridorRadius));
      if (nearby.length === 0) continue;

      // 1) Check exact geometric intersection with any existing river segment
      let earliestT = Infinity;
      let hitSeg: IndexedSegment | null = null;
      let hitPt: Pt | null = null;

      for (const s of nearby) {
        const inter = segmentIntersection(a, b, s.a, s.b);
        if (inter && inter.t < earliestT) {
          earliestT = inter.t;
          hitSeg = s;
          // Weld confluence directly on parent channel
          hitPt = inter.point;
        }
      }

      if (hitSeg && hitPt) {
        capturedBy = {
          riverId: hitSeg.riverId,
          riverName: hitSeg.riverName,
          cutIndex: i,
          junctionPt: hitPt,
        };
        break;
      }

      // 2) Check proximity snap (if b comes within snapRadius of an existing channel)
      let closestDist = snapRadius;
      let closestSeg: IndexedSegment | null = null;
      let closestPt: Pt | null = null;
      let minCorridorDist = Infinity;

      for (const s of nearby) {
        const c = closestOnSegment(b, s.a, s.b);
        if (c.dist < minCorridorDist) minCorridorDist = c.dist;
        if (c.dist < closestDist) {
          closestDist = c.dist;
          closestSeg = s;
          closestPt = c.point;
        }
      }

      if (closestSeg && closestPt) {
        // Ensure the snapped segment a -> closestPt doesn't cross any segment in nearby
        let snapT = 1;
        let finalSeg = closestSeg;
        let finalPt = closestPt;
        for (const s of nearby) {
          const inter = segmentIntersection(a, closestPt, s.a, s.b);
          if (inter && inter.t < snapT) {
            snapT = inter.t;
            finalSeg = s;
            finalPt = inter.point;
          }
        }
        capturedBy = {
          riverId: finalSeg.riverId,
          riverName: finalSeg.riverName,
          cutIndex: i,
          junctionPt: finalPt,
        };
        break;
      }

      if (minCorridorDist < corridorRadius) {
        crowdedSteps++;
      }
    }

    // Reject rivers that run parallel in an already-occupied valley corridor
    if (!capturedBy && pts.length > 3 && crowdedSteps / (pts.length - 1) > 0.35) {
      riversDroppedBraidOrCrowd++;
      continue;
    }

    if (capturedBy) {
      pts = pts.slice(0, capturedBy.cutIndex + 1).concat([capturedBy.junctionPt]);
      mouthType = "confluence";
      drainsToId = capturedBy.riverId;
      drainsToName = capturedBy.riverName;
      riversSnappedConfluence++;
    } else if (mouthType === "confluence") {
      // A tributary that was supposed to join a parent river NEVER reached any
      // accepted river (e.g. its parent was pruned or truncated upstream).
      // Try snapping its tail if within 2.2x snapRadius; otherwise drop it!
      const tail = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      const tailNear = segGrid.queryNearSegment(prev, tail, snapRadius * 2.2);
      let bestD = snapRadius * 2.2;
      let bestS: IndexedSegment | null = null;
      let bestP: Pt | null = null;
      for (const s of tailNear) {
        const c = closestOnSegment(tail, s.a, s.b);
        if (c.dist < bestD) {
          bestD = c.dist;
          bestS = s;
          bestP = c.point;
        }
      }
      if (bestS && bestP) {
        // Verify the final link prev -> bestP doesn't cross another segment
        const linkCheck = segGrid.queryNearSegment(prev, bestP, snapRadius);
        const crosses = linkCheck.some((s) => segmentIntersection(prev, bestP!, s.a, s.b) !== null);
        if (crosses) {
          riversDroppedBraidOrCrowd++;
          continue;
        }
        pts[pts.length - 1] = bestP;
        drainsToId = bestS.riverId;
        drainsToName = bestS.riverName;
        riversSnappedConfluence++;
      } else {
        riversDroppedBraidOrCrowd++;
        continue;
      }
    } else if (mouthType === "lake_inflow" && !clippedAtLake) {
      // Verify the target lake still exists in keptLakes and is near the river mouth
      const targetLake = keptLakes.find((lk) => lk.id === drainsToId);
      const tail = pts[pts.length - 1];
      const nearLake =
        targetLake &&
        nearestOnLine(targetLake.geometry.coordinates[0] as Pt[], tail).dist <= snapRadius * 3.5;
      if (!nearLake) {
        if (mask.distanceToCoast(tail) <= coastReach) {
          mouthType = "ocean_delta";
          drainsToId = undefined;
          drainsToName = undefined;
        } else {
          riversDroppedStub++;
          continue;
        }
      }
    } else if (mouthType === "ocean_delta") {
      // Trunk river must actually reach near the coast (class-scaled)
      const tail = pts[pts.length - 1];
      if (mask.distanceToCoast(tail) > coastReach) {
        riversDroppedStub++;
        continue;
      }
    }

    // Strip any newly introduced self-loops and verify 100% planarity against segGrid
    pts = removeSelfLoops(pts);

    let hasResidualCrossing = false;
    for (let i = 0; i < pts.length - 1 && !hasResidualCrossing; i++) {
      const pa = pts[i];
      const pb = pts[i + 1];
      if (dist(pa, pb) < 1e-4) {
        hasResidualCrossing = true;
        break;
      }
      const cands = segGrid.queryNearSegment(pa, pb, snapRadius * 0.2);
      for (const s of cands) {
        if (segmentIntersection(pa, pb, s.a, s.b) !== null) {
          hasResidualCrossing = true;
          break;
        }
      }
    }
    if (hasResidualCrossing) {
      riversDroppedBraidOrCrowd++;
      continue;
    }

    // Recompute physical length and enforce minimum viable river length
    let totalUnits = 0;
    for (let i = 1; i < pts.length; i++) totalUnits += dist(pts[i - 1], pts[i]);
    const rawKm = unitsToKm(totalUnits);
    const lengthKm = rawKm < 20 ? Math.round(rawKm * 10) / 10 : Math.round(rawKm);
    const minKm = profile.hydro.minRiverKm[Math.min(5, Math.max(1, order))] ?? profile.hydro.minRiverKm[1];
    if (pts.length < 2 || lengthKm < minKm) {
      riversDroppedStub++;
      continue;
    }

    // Final safety check: ensure every vertex of pts is on dry land and outside lakes
    if (!pts.every((pt) => mask.isLand(pt) && pointInAnyLake(pt) === null)) {
      riversDroppedStub++;
      continue;
    }

    const cleanedRiver: MapFeature = {
      ...rawRiv,
      geometry: { type: "LineString", coordinates: pts },
      bbox: bboxOfCoords(pts),
      properties: {
        ...rawRiv.properties,
        lengthKm,
        mouthType,
        drainsToId,
        drainsToName,
      },
    };

    segGrid.insertRiver(cleanedRiver);
    keptRivers.push(cleanedRiver);
    keptRiverById.set(cleanedRiver.id, cleanedRiver);
  }

  if (rawRivers.length > 0) {
    finetuneLogs.push({
      kind: "drainage",
      tier: 2,
      regionId: descriptor.id,
      description: `Finetune Stage resolved river topology: ${riversSnappedConfluence} crossing/meeting rivers snapped into true Y-confluences, ${riversClippedCoast} clipped at coastline, ${riversClippedLake} terminated at lake rims, and ${
        riversDroppedBraidOrCrowd + riversDroppedStub
      } braided/parallel/hanging segments removed (${keptRivers.length} clean channels retained).`,
    });
  }

  // -------------------------------------------------------------------------
  // PASS 5: Biome & Glacier Sanity Pass
  // -------------------------------------------------------------------------
  const keptBiomes: MapFeature[] = [];
  let biomesDroppedInvalid = 0;

  for (const b of rawBiomes) {
    const ring = b.geometry.coordinates[0] as Pt[];
    // A patch is anchored if it covers land at all: on a skerry the patch is
    // larger than the island and its centroid may fall offshore.
    if (!biomeTouchesLand(ring, mask, descriptor.centroid)) {
      biomesDroppedInvalid++;
      continue;
    }
    if (b.properties.featureType === "glacier") {
      const temp = b.properties.meanTempC ?? 0;
      const elev = b.properties.elevation ?? 0;
      if (temp > 2 && elev < 2400) {
        biomesDroppedInvalid++;
        continue;
      }
    }
    keptBiomes.push(b);
  }

  const finalFeatures: MapFeature[] = [
    ...coastlines,
    ...keptBiomes,
    ...plateaus,
    ...ranges,
    ...keptLakes,
    ...keptRivers,
    ...keptPeaks,
    ...keptVolcanoes,
    ...others,
  ];

  const report: FinetuneReport = {
    rawFeatureCount: rawFeatures.length,
    finalFeatureCount: finalFeatures.length,
    elapsedMs: Math.round(performance.now() - t0),
    volcanoesRaw: rawVolcanoes.length,
    volcanoesKept: keptVolcanoes.length,
    volcanoesDroppedCraton,
    volcanoesDroppedWaterOrCrowd,
    riversRaw: rawRivers.length,
    riversKept: keptRivers.length,
    riversSnappedConfluence,
    riversClippedCoast,
    riversClippedLake,
    riversDroppedBraidOrCrowd,
    riversDroppedStub,
    peaksRaw: rawPeaks.length,
    peaksKept: keptPeaks.length,
    peaksDroppedWaterOrCrowd,
    lakesRaw: rawLakes.length,
    lakesKept: keptLakes.length,
    lakesRescaled,
    lakesDroppedOverlapOrCoast,
    biomesRaw: rawBiomes.length,
    biomesKept: keptBiomes.length,
    biomesDroppedInvalid,
  };

  return { features: finalFeatures, report, finetuneLogs };
}
