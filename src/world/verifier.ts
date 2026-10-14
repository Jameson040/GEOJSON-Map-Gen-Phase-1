import type {
  BBox,
  MapFeature,
  PlanetMacro,
  Pt,
  RegionDescriptor,
  VerificationCheck,
  VerificationReport,
} from "./types";
import { LandMask } from "./landmask";
import {
  bboxOfCoords,
  centroidOf,
  dist,
  nearestOnLine,
  pointInPolygon,
  pointInRing,
} from "./geom";
import {
  PLANET_HEIGHT,
  PLANET_WIDTH,
  kmToUnits,
  unitsToKm,
} from "./constants";
import { closestOnSegment, segmentIntersection, biomeTouchesLand } from "./finetune-stage";
import { ringSelfIntersects, ringsIntersect, shapeMetrics } from "./tier1-finetune";
import { bboxOfRing } from "./geom";
import {
  type SizeProfile,
  DETAIL_MULTIPLIER,
  budgetFor,
  tectonicSettingOf,
  volcanoCapFor,
  formatKm,
} from "./size-classes";
import type { RegionDetailLevel } from "./types";
import { areaUnitsToKm2 } from "./constants";
import { polygonArea } from "./geom";

function bboxesOverlap(a: BBox, b: BBox, pad = 0): boolean {
  return (
    a.minX - pad <= b.maxX &&
    a.maxX + pad >= b.minX &&
    a.minY - pad <= b.maxY &&
    a.maxY + pad >= b.minY
  );
}

// ---------------------------------------------------------------------------
// TIER 1 PLANETARY VERIFIER
// ---------------------------------------------------------------------------

export function verifyPlanetMacro(macro: PlanetMacro): VerificationReport {
  const t0 = performance.now();
  const checks: VerificationCheck[] = [];

  const continents = macro.features.filter((f) => f.properties.featureType === "continent");
  const islands = macro.features.filter((f) => f.properties.featureType === "island");
  const seas = macro.features.filter((f) => f.properties.featureType === "sea");
  const caps = macro.features.filter((f) => f.properties.featureType === "ice_cap");

  // 1. Presence of macro planetary structures
  {
    const violations: string[] = [];
    if (continents.length < 3) violations.push(`Only ${continents.length} continents (expected >= 3)`);
    if (macro.plates.length < 5) violations.push(`Only ${macro.plates.length} plates (expected >= 5)`);
    if (seas.length < 2) violations.push(`Only ${seas.length} named seas (expected >= 2)`);
    checks.push({
      id: "macro_presence",
      category: "presence",
      title: "Macro Planetary Structures Present",
      rule: "Planet must have >= 3 continents, >= 5 tectonic plates, and named ocean basins.",
      passed: violations.length === 0,
      checkedCount: macro.features.length,
      violationCount: violations.length,
      details: `${continents.length} continents, ${islands.length} islands, ${macro.plates.length} plates, ${seas.length} seas.`,
      sampleViolations: violations,
    });
  }

  // 2. Valid closed geometry on an equirectangular globe. Longitude may be
  // unwrapped outside 0..7200 for seam-crossing non-land features; latitude
  // must remain bounded because poles are not periodic.
  {
    const violations: string[] = [];
    for (const f of macro.features) {
      if (f.geometry.type === "Polygon") {
        const ring = f.geometry.coordinates[0] as Pt[];
        if (!ring || ring.length < 4) {
          violations.push(`${f.properties.name}: degenerate polygon (<4 pts)`);
          continue;
        }
        for (const [x, y] of ring) {
          if (!Number.isFinite(x) || !Number.isFinite(y) || y < -1 || y > PLANET_HEIGHT + 1) {
            violations.push(`${f.properties.name}: invalid cylindrical coordinate (${x.toFixed(1)},${y.toFixed(1)})`);
            break;
          }
        }
      }
    }
    checks.push({
      id: "macro_valid_bounds",
      category: "placement",
      title: "Valid Geometry on Cylindrical Globe",
      rule: "All macro polygons must be closed and finite; latitude must remain between the poles while longitude may wrap periodically.",
      passed: violations.length === 0,
      checkedCount: macro.features.length,
      violationCount: violations.length,
      details:
        violations.length === 0
          ? `All ${macro.features.length} macro features have valid cylindrical coordinates.`
          : `${violations.length} features have invalid globe coordinates.`,
      sampleViolations: violations.slice(0, 5),
    });
  }

  // 3. Islands offshore (not buried inside continents)
  {
    const violations: string[] = [];
    for (const isl of islands) {
      const c = centroidOf(isl.geometry.coordinates[0] as Pt[]);
      for (const cont of continents) {
        if (
          bboxesOverlap(isl.bbox, cont.bbox) &&
          pointInRing(c, cont.geometry.coordinates[0] as Pt[])
        ) {
          violations.push(`${isl.properties.name} centroid is inside continent ${cont.properties.name}`);
          break;
        }
      }
    }
    checks.push({
      id: "macro_islands_offshore",
      category: "placement",
      title: "Islands Located in Ocean (Not Inside Continents)",
      rule: "No island centroid may sit inside a continental landmass.",
      passed: violations.length === 0,
      checkedCount: islands.length,
      violationCount: violations.length,
      details:
        violations.length === 0
          ? `All ${islands.length} islands are properly situated in oceanic waters.`
          : `${violations.length} islands overlap continental interiors.`,
      sampleViolations: violations.slice(0, 5),
    });
  }

  // 4. Seas anchored in ocean water
  {
    const violations: string[] = [];
    for (const s of seas) {
      const c = centroidOf(s.geometry.coordinates[0] as Pt[]);
      for (const cont of continents) {
        if (pointInRing(c, cont.geometry.coordinates[0] as Pt[])) {
          violations.push(`${s.properties.name} centroid is on land inside ${cont.properties.name}`);
          break;
        }
      }
    }
    checks.push({
      id: "macro_seas_in_ocean",
      category: "hydrology",
      title: "Ocean Basins Anchored in Open Water",
      rule: "Named sea basins must be centered in oceanic space, never inside a continent.",
      passed: violations.length === 0,
      checkedCount: seas.length,
      violationCount: violations.length,
      details:
        violations.length === 0
          ? `All ${seas.length} seas are centered in open ocean.`
          : `${violations.length} seas misplaced on land.`,
      sampleViolations: violations.slice(0, 5),
    });
  }

  // 5. Polar ice caps restricted to polar latitudes
  {
    const violations: string[] = [];
    for (const cap of caps) {
      const c = centroidOf(cap.geometry.coordinates[0] as Pt[]);
      const isPolar = c[1] < PLANET_HEIGHT * 0.22 || c[1] > PLANET_HEIGHT * 0.78;
      if (!isPolar) {
        violations.push(`${cap.properties.name} centroid at Y=${c[1].toFixed(0)} is outside polar zones`);
      }
    }
    checks.push({
      id: "macro_polar_caps",
      category: "climate",
      title: "Polar Ice Caps Restricted to High Latitudes",
      rule: "Planetary ice caps must form only in Arctic/Antarctic polar latitudes.",
      passed: violations.length === 0,
      checkedCount: caps.length,
      violationCount: violations.length,
      details:
        violations.length === 0
          ? `All ${caps.length} polar caps sit within high-latitude polar bands.`
          : `${violations.length} ice caps outside polar zones.`,
      sampleViolations: violations.slice(0, 5),
    });
  }

  // 6. Landmass topology: simple rings, no two landmasses overlapping
  {
    const violations: string[] = [];
    const land = [...continents, ...islands].map((f) => ({
      f,
      ring: f.geometry.coordinates[0] as Pt[],
      bbox: bboxOfRing(f.geometry.coordinates[0] as Pt[]),
    }));
    for (const l of land) {
      if (ringSelfIntersects(l.ring)) violations.push(`${l.f.properties.name}: coastline crosses itself`);
      if (l.bbox.minX <= 1 || l.bbox.maxX >= PLANET_WIDTH - 1) {
        violations.push(`${l.f.properties.name}: landmass touches the 2D antimeridian seam`);
      }
    }
    for (let i = 0; i < land.length; i++)
      for (let j = i + 1; j < land.length; j++) {
        if (ringsIntersect(land[i].ring, land[j].ring, land[i].bbox, land[j].bbox)) {
          violations.push(`${land[i].f.properties.name} overlaps ${land[j].f.properties.name}`);
        }
      }
    checks.push({
      id: "macro_landmass_topology",
      category: "placement",
      title: "Landmasses Simple & Disjoint",
      rule: "Every coastline must be simple and disjoint, and the chosen 2D antimeridian must run entirely through ocean.",
      passed: violations.length === 0,
      checkedCount: land.length,
      violationCount: violations.length,
      details:
        violations.length === 0
          ? `All ${land.length} landmasses have simple, non-overlapping coastlines.`
          : `${violations.length} self-crossing or overlapping coastlines.`,
      sampleViolations: violations.slice(0, 5),
    });
  }

  // 7. Continent shape realism: no near-circular blobs
  //    Earth reference (boundary PCA aspect / solidity, coarse outline):
  //    Africa ≈1.3/0.85, S. America ≈1.9/0.8, Australia ≈1.3/0.86, Europe ≈1.4/0.6.
  //    A blob that is BOTH round (aspect < 1.25) AND convex (solidity > 0.86)
  //    has none of the elongation, gulfs or peninsulas real continents show.
  {
    const violations: string[] = [];
    const details: string[] = [];
    for (const c of continents) {
      const m = shapeMetrics(c.geometry.coordinates[0] as Pt[]);
      details.push(`${c.properties.name} ${m.aspect}/${m.solidity}`);
      if (m.aspect < 1.25 && m.solidity > 0.86) {
        violations.push(`${c.properties.name}: near-circular blob (aspect ${m.aspect}, solidity ${m.solidity})`);
      }
    }
    checks.push({
      id: "macro_continent_shape_realism",
      category: "scale",
      title: "Continent Shapes Are Not Circular Blobs",
      rule: "Each continent must be elongated (aspect ≥ 1.25) or indented by gulfs/peninsulas (solidity ≤ 0.86).",
      passed: violations.length === 0,
      checkedCount: continents.length,
      violationCount: violations.length,
      details:
        violations.length === 0
          ? `All ${continents.length} continents have realistic silhouettes (aspect/solidity: ${details.join(", ")}).`
          : `${violations.length} of ${continents.length} continents are near-circular.`,
      sampleViolations: violations.slice(0, 5),
    });
  }

  const passedChecks = checks.filter((c) => c.passed).length;
  const totalViolations = checks.reduce((s, c) => s + c.violationCount, 0);

  return {
    targetName: `Planet (${macro.config.seed})`,
    tier: 1,
    passedAll: totalViolations === 0,
    totalChecks: checks.length,
    passedChecks,
    totalViolations,
    elapsedMs: Math.round(performance.now() - t0),
    checks,
  };
}

// ---------------------------------------------------------------------------
// TIER 2 REGIONAL VERIFIER
// ---------------------------------------------------------------------------

export function verifyRegionDetail(
  features: MapFeature[],
  descriptor: RegionDescriptor,
  mask: LandMask,
  profile: SizeProfile,
  detailLevel: RegionDetailLevel
): VerificationReport {
  const t0 = performance.now();
  const km = (v: number) => kmToUnits(v);
  const checks: VerificationCheck[] = [];

  const coastlines = features.filter((f) => f.properties.featureType === "coastline");
  void coastlines;
  const ranges = features.filter((f) => f.properties.featureType === "mountain_range");
  const plateaus = features.filter((f) => f.properties.featureType === "plateau");
  const peaks = features.filter((f) => f.properties.featureType === "mountain");
  const volcanoes = features.filter((f) => f.properties.featureType === "volcano");
  const lakes = features.filter((f) => f.properties.featureType === "lake");
  const rivers = features.filter((f) => f.properties.featureType === "river");
  const glaciers = features.filter((f) => f.properties.featureType === "glacier");
  const biomes = features.filter((f) =>
    ["desert", "forest", "savanna", "grassland", "tundra", "glacier", "wetland"].includes(
      f.properties.featureType
    )
  );

  const pointInAnyLake = (p: Pt): MapFeature | null => {
    for (const lk of lakes) {
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
  // Check 1: Core Regional Geography Present
  // -------------------------------------------------------------------------
  {
    // Presence requirements come from the land-size class: an islet needs a
    // coastline and a biome, a continent needs ranges, summits and rivers.
    const violations: string[] = [];
    const counts: Record<string, number> = {};
    for (const f of features) counts[f.properties.featureType] = (counts[f.properties.featureType] ?? 0) + 1;
    for (const req of profile.requires) {
      if (!counts[req]) violations.push(`${profile.label} requires at least one "${req}" but none exist`);
    }
    if (biomes.length === 0) violations.push("No ecological biomes generated");
    for (const forb of profile.forbids) {
      if (counts[forb]) violations.push(`${profile.label} forbids "${forb}" but ${counts[forb]} exist`);
    }

    checks.push({
      id: "presence_core_geography",
      category: "presence",
      title: `Required Features for ${profile.label} Present`,
      rule: `${profile.label}: requires ${[...profile.requires, "biome"].join(", ")}${
        profile.forbids.length ? `; forbids ${profile.forbids.join(", ")}` : ""
      }.`,
      passed: violations.length === 0,
      checkedCount: features.length,
      violationCount: violations.length,
      details: `${ranges.length} ranges, ${peaks.length} peaks, ${rivers.length} rivers, ${lakes.length} lakes, ${biomes.length} biomes.`,
      sampleViolations: violations,
    });
  }

  // -------------------------------------------------------------------------
  // Check 2: Summits on Dry Land (Never in Ocean or Lakes, No Stacking)
  // -------------------------------------------------------------------------
  {
    const violations: string[] = [];
    const cellSz = km(profile.relief.peakSpacingKm * 0.7);
    const grid = new Map<string, Pt[]>();

    for (const pk of peaks) {
      const p = pk.geometry.coordinates as Pt;
      if (!mask.isLand(p)) {
        violations.push(`${pk.properties.name}: summit is in the ocean`);
        continue;
      }
      const lk = pointInAnyLake(p);
      if (lk) {
        violations.push(`${pk.properties.name}: summit sits inside ${lk.properties.name}`);
        continue;
      }
      const gx = Math.floor(p[0] / cellSz);
      const gy = Math.floor(p[1] / cellSz);
      let stacked = false;
      for (let dx = -1; dx <= 1 && !stacked; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = grid.get(`${gx + dx}:${gy + dy}`);
          if (!bucket) continue;
          for (const q of bucket) {
            if (dist(p, q) < cellSz) {
              stacked = true;
              break;
            }
          }
        }
      }
      if (stacked) {
        violations.push(`${pk.properties.name}: crowded <${formatKm(profile.relief.peakSpacingKm * 0.7)} from another summit`);
        continue;
      }
      const key = `${gx}:${gy}`;
      const b = grid.get(key) ?? [];
      b.push(p);
      grid.set(key, b);
    }

    checks.push({
      id: "peaks_on_dry_land",
      category: "placement",
      title: "Summits on Dry Land & Properly Spaced",
      rule: "Every mountain peak must sit on dry land (never in ocean or lakes) with >= 10 km prominence spacing.",
      passed: violations.length === 0,
      checkedCount: peaks.length,
      violationCount: violations.length,
      details:
        violations.length === 0
          ? `All ${peaks.length.toLocaleString()} summits verified on dry land with valid spacing.`
          : `${violations.length.toLocaleString()} summits in water or crowded.`,
      sampleViolations: violations.slice(0, 5),
    });
  }

  // -------------------------------------------------------------------------
  // Check 3: Volcanoes Tectonically Justified & Dry ("No Volcanoes At Large")
  // -------------------------------------------------------------------------
  {
    const violations: string[] = [];
    const setting = tectonicSettingOf(descriptor, ranges.length > 0);
    // Volcanic islands are their own edifice: arc-proximity rule waived
    const isHotspot = setting === "hotspot" || descriptor.kind === "island";
    const maxAllowed = volcanoCapFor(profile, setting);

    if (volcanoes.length > maxAllowed) {
      violations.push(
        `Excess regional volcanoes: ${volcanoes.length} present, but tectonic setting allows at most ${maxAllowed}`
      );
    }

    const maxArcDist = km(profile.volcano.arcOffsetKm * 1.05);
    const minSpacing = km(profile.volcano.spacingKm * 0.94);

    for (let i = 0; i < volcanoes.length; i++) {
      const v = volcanoes[i];
      const p = v.geometry.coordinates as Pt;
      if (!mask.isLand(p)) {
        violations.push(`${v.properties.name}: located in ocean outside land mask`);
        continue;
      }
      if (pointInAnyLake(p)) {
        violations.push(`${v.properties.name}: located inside a lake basin`);
        continue;
      }
      if (!isHotspot) {
        const nearBelt = ranges.some((r) => {
          if (!bboxesOverlap(v.bbox, r.bbox, maxArcDist)) return false;
          const ring = r.geometry.coordinates[0] as Pt[];
          return pointInRing(p, ring) || nearestOnLine(ring, p).dist <= maxArcDist;
        });
        const inPlat = plateaus.some(
          (pl) =>
            bboxesOverlap(v.bbox, pl.bbox, maxArcDist * 0.3) &&
            pointInRing(p, pl.geometry.coordinates[0] as Pt[])
        );
        if (!nearBelt && !inPlat) {
          violations.push(`${v.properties.name}: stray craton volcano far from any orogenic arc or rift plateau`);
          continue;
        }
      }
      for (let j = 0; j < i; j++) {
        const q = volcanoes[j].geometry.coordinates as Pt;
        if (dist(p, q) < minSpacing) {
          violations.push(`${v.properties.name}: clustered <${formatKm(profile.volcano.spacingKm * 0.94)} from ${volcanoes[j].properties.name}`);
          break;
        }
      }
    }

    checks.push({
      id: "volcanoes_tectonic_and_dry",
      category: "tectonics",
      title: "Volcanoes Restricted to Tectonic Arcs & Hotspots",
      rule: "Volcanoes must only occur along subduction/orogenic arcs, rift plateaus, or hotspots, never scattered across stable cratons or water.",
      passed: violations.length === 0,
      checkedCount: volcanoes.length,
      violationCount: violations.length,
      details:
        violations.length === 0
          ? `${volcanoes.length} volcanoes verified along tectonic arcs/hotspots (max cap ${maxAllowed}).`
          : `${violations.length} volcano placement/tectonic violations found.`,
      sampleViolations: violations.slice(0, 5),
    });
  }

  // -------------------------------------------------------------------------
  // Check 4: Lakes Inland, Disjoint & Proportionally Spaced
  // -------------------------------------------------------------------------
  {
    const violations: string[] = [];
    const maxAllowedLakes = profile.hydro.finetuneMaxLakes;
    const minLakeDist = km(profile.hydro.finetuneLakeSpacingKm * 0.94);

    if (lakes.length > maxAllowedLakes) {
      violations.push(
        `Excess lake count: ${lakes.length} lakes present (realistic ${profile.label} cap is ${maxAllowedLakes})`
      );
    }

    for (let i = 0; i < lakes.length; i++) {
      const lk = lakes[i];
      const ring = lk.geometry.coordinates[0] as Pt[];
      const c = centroidOf(ring);
      if (!mask.isLand(c) || !ring.every((pt) => mask.isLand(pt))) {
        violations.push(`${lk.properties.name}: spills across coastline into ocean`);
        continue;
      }
      for (let j = 0; j < i; j++) {
        const other = lakes[j];
        const oRing = other.geometry.coordinates[0] as Pt[];
        const oc = centroidOf(oRing);
        if (dist(c, oc) < minLakeDist) {
          violations.push(
            `${lk.properties.name}: clustered <${formatKm(profile.hydro.finetuneLakeSpacingKm)} from ${other.properties.name}`
          );
          break;
        }
        if (!bboxesOverlap(lk.bbox, other.bbox)) continue;
        if (pointInRing(c, oRing) || ring.some((pt) => pointInRing(pt, oRing))) {
          violations.push(`${lk.properties.name}: overlaps ${other.properties.name}`);
          break;
        }
      }
    }

    checks.push({
      id: "lakes_inland_and_disjoint",
      category: "hydrology",
      title: "Lakes Inland, Spaced & Count-Disciplined",
      rule: `All lakes must sit inland, separated by >= ${formatKm(profile.hydro.finetuneLakeSpacingKm)}, and <= ${maxAllowedLakes} total basins for a ${profile.label}.`,
      passed: violations.length === 0,
      checkedCount: lakes.length,
      violationCount: violations.length,
      details:
        violations.length === 0
          ? `All ${lakes.length} lakes (cap ${maxAllowedLakes}) are strictly inland, disjoint, and spaced.`
          : `${violations.length} lake count, spacing, or shoreline violations.`,
      sampleViolations: violations.slice(0, 5),
    });
  }

  // -------------------------------------------------------------------------
  // Check 5: Rivers Stay on Land (No Ocean Leaps)
  // -------------------------------------------------------------------------
  {
    const violations: string[] = [];
    for (const r of rivers) {
      const pts = r.geometry.coordinates as Pt[];
      const offLand = pts.some((pt) => !mask.isLand(pt));
      if (offLand) {
        violations.push(`${r.properties.name}: river vertices exit land mask into ocean water`);
      }
    }

    checks.push({
      id: "rivers_on_land_no_ocean_leaps",
      category: "hydrology",
      title: "Rivers Strictly Onshore (No Ocean Bay Leaps)",
      rule: "Every river vertex must remain on land; rivers may never cross ocean bays.",
      passed: violations.length === 0,
      checkedCount: rivers.length,
      violationCount: violations.length,
      details:
        violations.length === 0
          ? `All ${rivers.length.toLocaleString()} rivers stay 100% onshore from source to mouth.`
          : `${violations.length.toLocaleString()} rivers have vertices in ocean water.`,
      sampleViolations: violations.slice(0, 5),
    });
  }

  // -------------------------------------------------------------------------
  // Check 6: Rivers Do Not Pass Through Lakes
  // -------------------------------------------------------------------------
  {
    const violations: string[] = [];
    for (const r of rivers) {
      const pts = r.geometry.coordinates as Pt[];
      let insideLake: MapFeature | null = null;
      // Check interior vertices (and all vertices)
      for (let i = 0; i < pts.length; i++) {
        const lk = pointInAnyLake(pts[i]);
        if (lk) {
          insideLake = lk;
          break;
        }
      }
      if (insideLake) {
        violations.push(`${r.properties.name}: passes inside ${insideLake.properties.name}`);
      }
    }

    checks.push({
      id: "rivers_no_lake_passthrough",
      category: "hydrology",
      title: "Rivers Terminate at Lake Rims (No Lake Pass-Throughs)",
      rule: "Rivers must terminate at lake shorelines as inflows rather than running through lake interiors.",
      passed: violations.length === 0,
      checkedCount: rivers.length,
      violationCount: violations.length,
      details:
        violations.length === 0
          ? `0 rivers pass through lake interiors across ${rivers.length.toLocaleString()} channels.`
          : `${violations.length.toLocaleString()} rivers pass through lake interiors.`,
      sampleViolations: violations.slice(0, 5),
    });
  }

  // -------------------------------------------------------------------------
  // Check 7: Rivers Do Not Cross or Meet-and-Separate (Planar Drainage Tree)
  // -------------------------------------------------------------------------
  {
    const violations: string[] = [];
    // Index all river segments into a uniform grid for fast all-pairs intersection test
    const b = descriptor.bbox;
    const cols = 120;
    const rows = 120;
    const cw = Math.max(1e-6, (b.maxX - b.minX) / cols);
    const ch = Math.max(1e-6, (b.maxY - b.minY) / rows);
    interface VerSeg {
      riverId: string;
      riverName: string;
      drainsToId?: string;
      segIdx: number;
      totalSegs: number;
      a: Pt;
      b: Pt;
    }
    const cells: VerSeg[][] = Array.from({ length: cols * rows }, () => []);
    const clampC = (x: number) => Math.max(0, Math.min(cols - 1, Math.floor((x - b.minX) / cw)));
    const clampR = (y: number) => Math.max(0, Math.min(rows - 1, Math.floor((y - b.minY) / ch)));

    // Cap check at first 4000 rivers so even huge raw 50K sets return quickly
    const sampleRivers = rivers.slice(0, 4000);

    for (const r of sampleRivers) {
      const pts = r.geometry.coordinates as Pt[];
      const nSegs = pts.length - 1;
      for (let i = 0; i < nSegs; i++) {
        const pa = pts[i];
        const pb = pts[i + 1];
        const c0 = clampC(Math.min(pa[0], pb[0]));
        const c1 = clampC(Math.max(pa[0], pb[0]));
        const r0 = clampR(Math.min(pa[1], pb[1]));
        const r1 = clampR(Math.max(pa[1], pb[1]));

        const seen = new Set<VerSeg>();
        for (let rr = r0; rr <= r1; rr++) {
          const off = rr * cols;
          for (let cc = c0; cc <= c1; cc++) {
            for (const s of cells[off + cc]) {
              if (seen.has(s)) continue;
              seen.add(s);
              // Skip adjacent segments on the same river
              if (s.riverId === r.id && Math.abs(s.segIdx - i) <= 1) continue;

              const hit = segmentIntersection(pa, pb, s.a, s.b);
              if (!hit) continue;

              // Is this a legitimate endpoint confluence between a tributary's last segment and its parent?
              const rIsTermOfS =
                i === nSegs - 1 && r.properties.drainsToId === s.riverId && hit.t > 0.92;
              const sIsTermOfR =
                s.segIdx === s.totalSegs - 1 && s.drainsToId === r.id && hit.u > 0.92;
              if (rIsTermOfS || sIsTermOfR) continue;

              violations.push(
                s.riverId === r.id
                  ? `${r.properties.name}: self-intersects at segment ${i}`
                  : `${r.properties.name} crosses and separates from ${s.riverName}`
              );
              break;
            }
          }
        }

        const seg: VerSeg = {
          riverId: r.id,
          riverName: r.properties.name,
          drainsToId: r.properties.drainsToId,
          segIdx: i,
          totalSegs: nSegs,
          a: pa,
          b: pb,
        };
        for (let rr = r0; rr <= r1; rr++) {
          const off = rr * cols;
          for (let cc = c0; cc <= c1; cc++) {
            cells[off + cc].push(seg);
          }
        }
      }
    }

    checks.push({
      id: "rivers_no_crossings_or_braids",
      category: "hydrology",
      title: "Planar Dendritic Topology (No Crossing / Separating Rivers)",
      rule: "Rivers may converge at Y-junction confluences but must never cross over each other (X-junctions) or meet and separate.",
      passed: violations.length === 0,
      checkedCount: sampleRivers.length,
      violationCount: violations.length,
      details:
        violations.length === 0
          ? `0 river crossings or meet-and-separate braids across ${sampleRivers.length.toLocaleString()} channels.`
          : `${violations.length.toLocaleString()} river crossings / braid separations detected.`,
      sampleViolations: violations.slice(0, 5),
    });
  }

  // -------------------------------------------------------------------------
  // Check 8: Valid River Drainage Termini (No Hanging Tributaries or Stubs)
  // -------------------------------------------------------------------------
  {
    const violations: string[] = [];
    const riverById = new Map<string, MapFeature>();
    for (const r of rivers) riverById.set(r.id, r);

    for (const r of rivers) {
      const pts = r.geometry.coordinates as Pt[];
      const end = pts[pts.length - 1];
      const lenKm = r.properties.lengthKm ?? 0;
      if (lenKm < profile.hydro.minRiverKm[1] * 0.8) {
        violations.push(`${r.properties.name}: degenerate stub river (${lenKm} km)`);
        continue;
      }
      const mouth = r.properties.mouthType;
      if (mouth === "confluence") {
        const parent = r.properties.drainsToId ? riverById.get(r.properties.drainsToId) : null;
        if (!parent) {
          violations.push(`${r.properties.name}: hanging tributary (parent river missing)`);
          continue;
        }
        const pPts = parent.geometry.coordinates as Pt[];
        let minD = Infinity;
        for (let i = 0; i < pPts.length - 1; i++) {
          const d = closestOnSegment(end, pPts[i], pPts[i + 1]).dist;
          if (d < minD) minD = d;
        }
        if (minD > km(profile.hydro.snapKm * 2.5)) {
          violations.push(
            `${r.properties.name}: tributary mouth is ${Math.round(unitsToKm(minD))} km away from parent ${parent.properties.name}`
          );
        }
      } else if (mouth === "ocean_delta") {
        const dCoast = mask.distanceToCoast(end);
        if (dCoast > km(profile.hydro.coastReachKm * 1.12)) {
          violations.push(
            `${r.properties.name}: trunk river stalls inland (${Math.round(unitsToKm(dCoast))} km from coast)`
          );
        }
      }
    }

    checks.push({
      id: "rivers_valid_drainage_termini",
      category: "hydrology",
      title: "Connected Drainage Termini (No Hanging Tributaries)",
      rule: "Every tributary must physically join an existing parent river, and every trunk must reach the coast or a lake.",
      passed: violations.length === 0,
      checkedCount: rivers.length,
      violationCount: violations.length,
      details:
        violations.length === 0
          ? `All ${rivers.length.toLocaleString()} rivers connect cleanly to their parent channel, lake, or ocean delta.`
          : `${violations.length.toLocaleString()} rivers have disconnected or stalled termini.`,
      sampleViolations: violations.slice(0, 5),
    });
  }

  // -------------------------------------------------------------------------
  // Check 9: Glaciers Restricted to Freezing / High-Altitude Zones
  // -------------------------------------------------------------------------
  {
    const violations: string[] = [];
    for (const g of glaciers) {
      if (!biomeTouchesLand(g.geometry.coordinates[0] as Pt[], mask, descriptor.centroid)) {
        violations.push(`${g.properties.name}: glacier covers no land`);
        continue;
      }
      const temp = g.properties.meanTempC ?? 0;
      const elev = g.properties.elevation ?? 0;
      if (temp > 2 && elev < 2400) {
        violations.push(`${g.properties.name}: warm lowland glacier (${temp}°C, ${elev}m)`);
      }
    }

    checks.push({
      id: "glaciers_cold_or_high",
      category: "climate",
      title: "Glaciers Restricted to Polar or Alpine Snowlines",
      rule: "Glaciers may only form where mean temperature <= 2°C or summit elevation >= 2400 m.",
      passed: violations.length === 0,
      checkedCount: glaciers.length,
      violationCount: violations.length,
      details:
        violations.length === 0
          ? `All ${glaciers.length} glaciers satisfy thermal/elevation snowline constraints.`
          : `${violations.length} glaciers violate thermal constraints.`,
      sampleViolations: violations.slice(0, 5),
    });
  }

  // -------------------------------------------------------------------------
  // Check 10: Terrestrial Biomes Anchored on Land
  // -------------------------------------------------------------------------
  {
    const violations: string[] = [];
    for (const b of biomes) {
      if (!biomeTouchesLand(b.geometry.coordinates[0] as Pt[], mask, descriptor.centroid)) {
        violations.push(`${b.properties.name} (${b.properties.featureType}): patch covers no land`);
      }
    }

    checks.push({
      id: "biomes_anchored_on_land",
      category: "climate",
      title: "Biomes Anchored on Continental Landmass",
      rule: "All terrestrial biome polygons must have their anchor centroid inside the land mask.",
      passed: violations.length === 0,
      checkedCount: biomes.length,
      violationCount: violations.length,
      details:
        violations.length === 0
          ? `All ${biomes.length} biome polygons are anchored on land.`
          : `${violations.length} biomes have centroids outside land.`,
      sampleViolations: violations.slice(0, 5),
    });
  }

  // -------------------------------------------------------------------------
  // Check 11: Size-Class Conformance — everything is at the right scale
  // -------------------------------------------------------------------------
  {
    const violations: string[] = [];
    const P = profile;

    // Drainage hierarchy depth
    for (const r of rivers) {
      const o = r.properties.strahlerOrder ?? 1;
      if (o > P.hydro.maxStrahler) {
        violations.push(`${r.properties.name}: Strahler order ${o} exceeds ${P.label} max of ${P.hydro.maxStrahler}`);
      }
    }
    // Fold-belt count
    if (ranges.length > P.relief.ranges[1]) {
      violations.push(`${ranges.length} mountain ranges exceed ${P.label} max of ${P.relief.ranges[1]}`);
    }
    // Elevation ceiling
    for (const pk of peaks) {
      if ((pk.properties.elevation ?? 0) > P.relief.maxElevation) {
        violations.push(`${pk.properties.name}: ${pk.properties.elevation} m exceeds ${P.label} ceiling ${P.relief.maxElevation} m`);
      }
    }
    // Lake size window & total freshwater area share (enforced by Finetune Zipf rescaling)
    const maxPremierR = Math.min(
      P.hydro.finetuneMaxLakeRadiusKm,
      Math.sqrt(Math.max(1, descriptor.areaKm2)) * 0.0105
    );
    const lakeMaxKm2 = Math.PI * Math.pow(maxPremierR, 2) * 1.15;
    let totalLakeArea = 0;
    for (const lk of lakes) {
      const a = areaUnitsToKm2(polygonArea(lk.geometry.coordinates as Pt[][]));
      totalLakeArea += a;
      if (a > lakeMaxKm2) {
        violations.push(
          `${lk.properties.name}: ${Math.round(a).toLocaleString()} km² exceeds ${P.label} premier basin cap ≈${Math.round(lakeMaxKm2).toLocaleString()} km²`
        );
      }
    }
    const maxTotalShareKm2 = descriptor.areaKm2 * P.hydro.finetuneMaxLakeShare * 1.15;
    if (lakes.length > 1 && totalLakeArea > maxTotalShareKm2) {
      violations.push(
        `Total lake surface area (${Math.round(totalLakeArea).toLocaleString()} km²) exceeds ${(
          P.hydro.finetuneMaxLakeShare * 100
        ).toFixed(2)}% of ${P.label} area`
      );
    }
    // Biome patch size window
    const biomeMaxKm2 = Math.PI * Math.pow(P.biome.radiusKm[1], 2) * 2.2;
    for (const b of biomes) {
      if (b.properties.elevation !== undefined) continue; // summit icecaps are sized separately
      const a = areaUnitsToKm2(polygonArea(b.geometry.coordinates as Pt[][]));
      if (a > biomeMaxKm2) {
        violations.push(`${b.properties.name}: ${Math.round(a).toLocaleString()} km² patch exceeds ${P.label} max`);
      }
    }
    // Feature density: never more than the class budget allows
    const budgetCap = Math.round(budgetFor(descriptor.areaKm2, P) * DETAIL_MULTIPLIER[detailLevel] * 1.15) + 12;
    if (features.length > budgetCap) {
      violations.push(`${features.length.toLocaleString()} features exceed the ${P.label} budget of ${budgetCap.toLocaleString()}`);
    }

    checks.push({
      id: "size_class_conformance",
      category: "scale",
      title: `Scale Conforms to ${P.label} Compartment`,
      rule: `${P.label}: ≤ ${P.relief.ranges[1]} ranges, summits ≤ ${P.relief.maxElevation.toLocaleString()} m, Strahler ≤ ${P.hydro.maxStrahler}, lake radius ≤ ${formatKm(P.hydro.lakeRadiusKm[1])}, biome radius ≤ ${formatKm(P.biome.radiusKm[1])}, ≤ ${budgetCap.toLocaleString()} features.`,
      passed: violations.length === 0,
      checkedCount: features.length,
      violationCount: violations.length,
      details:
        violations.length === 0
          ? `All ${features.length.toLocaleString()} features respect the ${P.label} scale envelope (${descriptor.areaKm2.toLocaleString()} km²).`
          : `${violations.length.toLocaleString()} features out of scale for a ${P.label}.`,
      sampleViolations: violations.slice(0, 5),
    });
  }

  // Suppress unused import warning if any
  void bboxOfCoords;

  const passedChecks = checks.filter((c) => c.passed).length;
  const totalViolations = checks.reduce((s, c) => s + c.violationCount, 0);

  return {
    targetName: descriptor.name,
    tier: 2,
    passedAll: totalViolations === 0,
    totalChecks: checks.length,
    passedChecks,
    totalViolations,
    elapsedMs: Math.round(performance.now() - t0),
    checks,
  };
}
