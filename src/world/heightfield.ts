import type { GeneratedRegion, MapFeature, Pt } from "./types";
import { pointInRing, dist } from "./geom";
import { unitsToKm, kmToUnits } from "./constants";
import { LandMask } from "./landmask";
import { cellNoise } from "./noise";

// ---------------------------------------------------------------------------
// DERIVED HEIGHTFIELD — MATH ONLY
//
// The world generator is vector-based: elevation lives as attributes on
// mountain-range ribbons, plateaus, summits and volcanoes — there is no
// heightmap, and the rivers were carved by the LandMask's coast-distance
// gradient, not by terrain. This module DERIVES a continuous elevation
// raster from those frozen features, purely as read-only math for consumer
// layers (the road pathfinder today). It is never rendered, never exported,
// never written back into the region.
//
// Consistency with the existing hydrology is the hard constraint. Rivers
// already exist and must flow downhill in this field, so the field is
// HYDROLOGICALLY CONDITIONED in three stages:
//   1. Channel carving — each river (trunks before tributaries) is walked
//      source→mouth along its whole polyline; any cell that would make the
//      channel climb is carved down, and neighbours are pulled part-way
//      toward the channel so real valley floors form.
//   2. Lakes are planed to a surface below their lowest LAND shoreline.
//   3. An enforcement pass re-walks every river and carves whatever climbs
//      remain (river crossings can dig pits in each other's channels; the
//      enforcement guarantees the no-climb invariant regardless).
// Summit host cells are protected from carving so stated peak elevations
// survive, and lake cells (by cell centre) are skipped by channel logic —
// the channel continues below the water surface.
// ---------------------------------------------------------------------------

export interface HeightFieldReport {
  cols: number;
  rows: number;
  cellKm: number;
  /** Rivers walked in the conditioning pass. */
  riversConditioned: number;
  /** Rivers that still climb along their polyline (must stay 0). */
  riverViolations: number;
  lakesFlattened: number;
  /** Lakes whose surface is not below their shoreline (must stay 0). */
  lakeViolations: number;
  peaksChecked: number;
  /** Summits whose field elevation matches their stated elevation. */
  peaksHonored: number;
  rangesChecked: number;
  /** Ranges whose crest is reached in the field. */
  rangesHonored: number;
  bakeMs: number;
}

interface Ring {
  ring: Pt[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

export class HeightField {
  readonly cols: number;
  readonly rows: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly cellKm: number;
  private minX: number;
  private minY: number;
  /** Elevation in metres, [row * cols + col]. Sea cells are 0. */
  readonly elev: Float32Array;
  readonly report: HeightFieldReport;

  constructor(region: GeneratedRegion, mask: LandMask, seed = region.descriptor.regionSeed) {
    const t0 = performance.now();
    const b = region.descriptor.bbox;
    this.minX = b.minX;
    this.minY = b.minY;
    const w = Math.max(1e-6, b.maxX - b.minX);
    const h = Math.max(1e-6, b.maxY - b.minY);
    // Aspect-correct cells, ~256 across the long axis (bounded for speed).
    this.cellW = w / 256;
    this.cellH = h / 256;
    this.cols = Math.min(384, Math.max(64, Math.ceil(w / this.cellW)));
    this.rows = Math.min(384, Math.max(64, Math.ceil(h / this.cellH)));
    this.cellKm = unitsToKm(Math.max(this.cellW, this.cellH));
    this.elev = new Float32Array(this.cols * this.rows);

    // ---- 1. Split the frozen features ----------------------------------
    const reliefs: (Ring & { elevM: number; isPlateau: boolean })[] = [];
    const peaks: { p: Pt; elevM: number; radiusUnits: number }[] = [];
    const rivers: { pts: Pt[]; order: number }[] = [];
    const lakes: Ring[] = [];
    for (const f of region.features as MapFeature[]) {
      const t = f.properties.featureType;
      if ((t === "mountain_range" || t === "plateau") && f.geometry.type === "Polygon") {
        reliefs.push({
          ring: f.geometry.coordinates[0] as Pt[],
          bbox: f.bbox,
          elevM: (f.properties.elevation as number | undefined) ?? (t === "plateau" ? 1200 : 2200),
          isPlateau: t === "plateau",
        });
      } else if ((t === "mountain" || t === "volcano") && f.geometry.type === "Point") {
        const p = f.geometry.coordinates as Pt;
        const elevM = (f.properties.elevation as number | undefined) ?? 1500;
        const prominence = (f.properties.prominence as number | undefined) ?? elevM * 0.4;
        // Cone radius from prominence: prominent summits command wide aprons.
        const radiusKm = Math.max(8, Math.min(42, 8 + prominence / 45));
        peaks.push({ p, elevM, radiusUnits: kmToUnits(radiusKm) });
      } else if (t === "river" && f.geometry.type === "LineString") {
        rivers.push({
          pts: f.geometry.coordinates as Pt[],
          order: (f.properties.strahlerOrder as number | undefined) ?? 1,
        });
      } else if (t === "lake" && f.geometry.type === "Polygon") {
        lakes.push({ ring: f.geometry.coordinates[0] as Pt[], bbox: f.bbox });
      }
    }

    // Cell-centre lake mask (used by channel carving and verification).
    const lakeCell = new Uint8Array(this.cols * this.rows);
    for (const lake of lakes) {
      const [c0, c1, r0, r1] = this.bboxCells(lake.bbox);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const p = this.cellCenter(c, r);
          if (this.inBBox(p, lake.bbox) && pointInRing(p, lake.ring)) lakeCell[r * this.cols + c] = 1;
        }
      }
    }

    // Summit host cells are protected from channel carving.
    const peakCell = new Uint8Array(this.cols * this.rows);
    for (const pk of peaks) {
      const [c, r] = this.toGrid(pk.p);
      if (c >= 0 && c < this.cols && r >= 0 && r < this.rows) peakCell[r * this.cols + c] = 1;
    }

    // ---- 2. Continental dome from the SAME field the rivers descend ----
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const idx = r * this.cols + c;
        const p = this.cellCenter(c, r);
        if (!mask.isLand(p)) continue;
        const cdKm = unitsToKm(mask.distanceToCoast(p));
        // Concave dome: sea level at the shore, ~1.2–1.4 km over deep
        // interiors — the elevation image of the coast-distance gradient
        // the LandMask already flowed the rivers down.
        this.elev[idx] = (1500 * cdKm) / (cdKm + 140);
      }
    }

    // ---- 3. Range ribbons & plateau slabs ------------------------------
    for (const rel of reliefs) {
      const bw = unitsToKm(rel.bbox.maxX - rel.bbox.minX);
      const bh = unitsToKm(rel.bbox.maxY - rel.bbox.minY);
      const skirtUnits = kmToUnits(Math.max(18, 0.35 * Math.min(bw, bh)));
      // Decimate the ring for cheap outside-distance probes.
      const stride = Math.max(1, Math.floor(rel.ring.length / 48));
      const ringPts: Pt[] = [];
      for (let i = 0; i < rel.ring.length; i += stride) ringPts.push(rel.ring[i]);

      const c0 = Math.max(0, Math.floor((rel.bbox.minX - skirtUnits - this.minX) / this.cellW));
      const c1 = Math.min(this.cols - 1, Math.ceil((rel.bbox.maxX + skirtUnits - this.minX) / this.cellW));
      const r0 = Math.max(0, Math.floor((rel.bbox.minY - skirtUnits - this.minY) / this.cellH));
      const r1 = Math.min(this.rows - 1, Math.ceil((rel.bbox.maxY + skirtUnits - this.minY) / this.cellH));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const idx = r * this.cols + c;
          const p = this.cellCenter(c, r);
          const inside = this.inBBox(p, rel.bbox) && pointInRing(p, rel.ring);
          let target: number;
          if (inside) {
            // Crest varies slightly so ranges aren't table-flat.
            const n = cellNoise(c, r, `${seed}::relief`);
            target = rel.elevM * (rel.isPlateau ? 1.0 : 0.92 + 0.08 * n);
          } else {
            let best = Infinity;
            for (const q of ringPts) {
              const d = dist(p, q);
              if (d < best) best = d;
            }
            if (best >= skirtUnits) continue;
            const wgt = 1 - best / skirtUnits; // 0..1
            target = rel.elevM * 0.92 * wgt * wgt;
          }
          if (target > this.elev[idx]) this.elev[idx] = target;
        }
      }
    }

    // ---- 4. Summit & volcano cones (splat, max-composited) -------------
    for (const pk of peaks) {
      const c0 = Math.max(0, Math.floor((pk.p[0] - pk.radiusUnits - this.minX) / this.cellW));
      const c1 = Math.min(this.cols - 1, Math.ceil((pk.p[0] + pk.radiusUnits - this.minX) / this.cellW));
      const r0 = Math.max(0, Math.floor((pk.p[1] - pk.radiusUnits - this.minY) / this.cellH));
      const r1 = Math.min(this.rows - 1, Math.ceil((pk.p[1] + pk.radiusUnits - this.minY) / this.cellH));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const idx = r * this.cols + c;
          const d = dist(this.cellCenter(c, r), pk.p);
          if (d >= pk.radiusUnits) continue;
          const cone = pk.elevM * Math.cos((Math.PI / 2) * (d / pk.radiusUnits));
          if (cone > this.elev[idx]) this.elev[idx] = cone;
        }
      }
      // Guarantee the summit's own cell holds the full stated elevation,
      // even when the cone is narrower than one field cell.
      const [pc, pr] = this.toGrid(pk.p);
      if (pc >= 0 && pc < this.cols && pr >= 0 && pr < this.rows) {
        const idx = pr * this.cols + pc;
        if (this.elev[idx] < pk.elevM) this.elev[idx] = pk.elevM;
      }
    }

    // ---- 5. Micro-relief grain -----------------------------------------
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const idx = r * this.cols + c;
        if (this.elev[idx] <= 0 || peakCell[idx]) continue; // surveyed summits stay exact
        const n = cellNoise(c, r, `${seed}::grain`);
        this.elev[idx] += (n - 0.5) * 2 * (8 + 0.012 * this.elev[idx]);
      }
    }

    // ---- 6. Channel carving --------------------------------------------
    // Trunks first so tributary mouths meet an already-carved channel.
    // The walk interpolates ALONG each segment so the whole channel
    // descends at field resolution, whatever the vertex spacing.
    const walkSteps = (a: Pt, b: Pt, visit: (p: Pt) => void) => {
      const segLen = dist(a, b);
      const steps = Math.max(1, Math.ceil(segLen / (Math.min(this.cellW, this.cellH) * 0.5)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        visit([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    };
    rivers.sort((a, b) => b.order - a.order);
    for (const riv of rivers) {
      if (riv.pts.length < 2) continue;
      const depth = 3 + riv.order * 1.5; // channel depth below the valley floor
      let floor = Infinity;
      let first = true;
      const carve = (p: Pt) => {
        const [c, r] = this.toGrid(p);
        if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return;
        const idx = r * this.cols + c;
        if (lakeCell[idx] || peakCell[idx]) return; // water plane / summit host cell
        if (first) {
          floor = this.elev[idx];
          first = false;
          return; // never carve the headwater itself
        }
        // Strict descent; adopt any deeper carve left by an earlier river
        // (a confluence joins at the trunk's level).
        floor = Math.min(floor - 0.15, this.elev[idx]);
        const channel = floor - depth;
        if (this.elev[idx] > channel) this.elev[idx] = channel;
        // Pull the 8 neighbours part-way down so a valley floor forms
        // around the channel instead of a slot canyon wall.
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr;
            const nc = c + dc;
            if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue;
            const ni = nr * this.cols + nc;
            if (lakeCell[ni] || peakCell[ni]) continue;
            const e = this.elev[ni];
            if (e > channel) this.elev[ni] = channel + (e - channel) * 0.55;
          }
        }
      };
      for (let i = 1; i < riv.pts.length; i++) walkSteps(riv.pts[i - 1], riv.pts[i], carve);
    }

    // ---- 7. Lakes become bowls (below their lowest LAND shoreline) -----
    for (const lake of lakes) {
      const shoreMin = this.landShoreMin(lake, lakeCell, mask);
      if (!Number.isFinite(shoreMin)) continue; // coastal lagoon — the sea is not a shore
      const surface = Math.max(1, shoreMin - 4);
      const [c0, c1, r0, r1] = this.bboxCells(lake.bbox);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const idx = r * this.cols + c;
          // Summit host cells stay dry — an island in the lake.
          if (lakeCell[idx] && !peakCell[idx]) this.elev[idx] = surface;
        }
      }
    }

    // ---- 8. Sea level clamp --------------------------------------------
    for (let i = 0; i < this.elev.length; i++) {
      const p = this.cellCenter(i % this.cols, Math.floor(i / this.cols));
      if (this.elev[i] < 1 && mask.isLand(p) && !lakeCell[i]) this.elev[i] = 1;
    }

    // ---- 9. Enforcement pass -------------------------------------------
    // Cross-river carves can leave pits followed by climbs in an earlier
    // channel; alternating sweeps re-walk every river and plane any
    // residual climb (never below sea level, never touching summits or
    // lake planes). Alternating the river order each sweep guarantees any
    // crossing pair gets re-planed after its partner; iterate to fixpoint.
    for (let sweep = 0; sweep < 40; sweep++) {
      let planed = 0;
      const ordered = sweep % 2 === 0 ? rivers : [...rivers].reverse();
      for (const riv of ordered) {
        if (riv.pts.length < 2) continue;
        let floor = Infinity;
        let first = true;
        const enforce = (p: Pt) => {
          const [c, r] = this.toGrid(p);
          if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return;
          const idx = r * this.cols + c;
          if (lakeCell[idx] || peakCell[idx]) return;
          if (first) {
            floor = this.elev[idx];
            first = false;
            return;
          }
          if (this.elev[idx] > floor) {
            this.elev[idx] = Math.max(1, floor);
            planed++;
          }
          // Non-strict (allow flats): strict descent constraints would
          // ratchet forever inside constraint cycles — two rivers crossing
          // in opposite directions. Flats are physically fine; the carve
          // pass already provides each channel's own strict descent.
          floor = Math.min(floor, this.elev[idx]);
          if (floor < 1) floor = 1;
        };
        for (let i = 1; i < riv.pts.length; i++) walkSteps(riv.pts[i - 1], riv.pts[i], enforce);
      }
      // A clean reversed sweep after a clean forward sweep is the fixpoint
      // (order matters for crossing pairs, so one direction alone isn't).
      if (planed === 0 && sweep % 2 === 1) break;
    }

    this.report = {
      ...this.verify(region, mask, rivers, lakes, lakeCell, peakCell),
      riversConditioned: rivers.length,
      lakesFlattened: lakes.length,
      bakeMs: Math.round(performance.now() - t0),
    };
  }

  private inBBox(p: Pt, b: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
    return p[0] >= b.minX && p[0] <= b.maxX && p[1] >= b.minY && p[1] <= b.maxY;
  }

  /** Cell index window (inclusive) covered by a world bbox. */
  private bboxCells(b: { minX: number; minY: number; maxX: number; maxY: number }): [number, number, number, number] {
    return [
      Math.max(0, Math.floor((b.minX - this.minX) / this.cellW)),
      Math.min(this.cols - 1, Math.ceil((b.maxX - this.minX) / this.cellW)),
      Math.max(0, Math.floor((b.minY - this.minY) / this.cellH)),
      Math.min(this.rows - 1, Math.ceil((b.maxY - this.minY) / this.cellH)),
    ];
  }

  private cellCenter(c: number, r: number): Pt {
    return [this.minX + (c + 0.5) * this.cellW, this.minY + (r + 0.5) * this.cellH];
  }

  /**
   * Lowest shoreline cell elevation for a lake. Cell-based and
   * interior-immune: rim vertices whose own cell is open lake water are
   * ignored, so planing the interior can never feed back into the shore.
   */
  private landShoreMin(lake: Ring, lakeCell: Uint8Array, mask: LandMask): number {
    let shoreMin = Infinity;
    for (const q of lake.ring) {
      if (!mask.isLand(q)) continue;
      const [c, r] = this.toGrid(q);
      if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) continue;
      const idx = r * this.cols + c;
      if (lakeCell[idx]) continue; // rim sample that is really open water
      const e = this.elev[idx];
      if (e > 0) shoreMin = Math.min(shoreMin, e);
    }
    return shoreMin;
  }

  private toGrid(p: Pt): [number, number] {
    const c = Math.floor((p[0] - this.minX) / this.cellW);
    const r = Math.floor((p[1] - this.minY) / this.cellH);
    return [c, r];
  }

  /** Bilinear elevation at any world point (metres; 0 at sea). */
  elevAt(p: Pt): number {
    const fx = (p[0] - this.minX) / this.cellW - 0.5;
    const fy = (p[1] - this.minY) / this.cellH - 0.5;
    const c0 = Math.floor(fx);
    const r0 = Math.floor(fy);
    if (c0 < 0 || c0 >= this.cols - 1 || r0 < 0 || r0 >= this.rows - 1) {
      const c = Math.max(0, Math.min(this.cols - 1, Math.round(fx)));
      const r = Math.max(0, Math.min(this.rows - 1, Math.round(fy)));
      return this.elev[r * this.cols + c];
    }
    const tx = fx - c0;
    const ty = fy - r0;
    const i00 = r0 * this.cols + c0;
    const e00 = this.elev[i00];
    const e10 = this.elev[i00 + 1];
    const e01 = this.elev[i00 + this.cols];
    const e11 = this.elev[i00 + this.cols + 1];
    return e00 * (1 - tx) * (1 - ty) + e10 * tx * (1 - ty) + e01 * (1 - tx) * ty + e11 * tx * ty;
  }

  /**
   * Hard invariants of the derived field, measured against the frozen
   * features it was built from: rivers must flow downhill, lakes must sit
   * in bowls, summits and crests must be honoured. Uses the same
   * nearest-cell walk and the same skip rules (lake planes, summit cells)
   * as the enforcement pass.
   */
  private verify(
    region: GeneratedRegion,
    mask: LandMask,
    rivers: { pts: Pt[]; order: number }[],
    lakes: Ring[],
    lakeCell: Uint8Array,
    peakCell: Uint8Array
  ): Pick<HeightFieldReport, "cols" | "rows" | "cellKm" | "riverViolations" | "lakeViolations" | "peaksChecked" | "peaksHonored" | "rangesChecked" | "rangesHonored"> {
    let riverViolations = 0;
    let lakeViolations = 0;
    let peaksChecked = 0;
    let peaksHonored = 0;
    let rangesChecked = 0;
    let rangesHonored = 0;

    // Rivers: nearest-cell walk, skipping lake planes and summit cells.
    const walkSteps = (a: Pt, b: Pt, visit: (p: Pt) => void) => {
      const segLen = dist(a, b);
      const steps = Math.max(1, Math.ceil(segLen / (Math.min(this.cellW, this.cellH) * 0.5)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        visit([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    };
    for (const riv of rivers) {
      if (riv.pts.length < 2) continue;
      let prev = Infinity;
      let bad = false;
      const check = (p: Pt) => {
        if (bad) return;
        const [c, r] = this.toGrid(p);
        if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return;
        const idx = r * this.cols + c;
        if (lakeCell[idx] || peakCell[idx]) return;
        const e = this.elev[idx];
        if (e > prev + 2) bad = true;
        prev = Math.min(prev, e);
      };
      for (let i = 1; i < riv.pts.length && !bad; i++) walkSteps(riv.pts[i - 1], riv.pts[i], check);
      if (bad) riverViolations++;
    }

    // Lakes: interior plane must sit below the lowest land shoreline.
    for (const lake of lakes) {
      const shoreMin = this.landShoreMin(lake, lakeCell, mask);
      if (!Number.isFinite(shoreMin)) continue; // ocean lagoon
      let interiorMax = -Infinity;
      const [c0, c1, r0, r1] = this.bboxCells(lake.bbox);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const idx = r * this.cols + c;
          // Summit host cells may rise as islands above the water plane.
          if (lakeCell[idx] && !peakCell[idx]) interiorMax = Math.max(interiorMax, this.elev[idx]);
        }
      }
      // The water plane must sit below its shoreline. Near sea level there
      // is no room for a 4 m bowl, so the cap relaxes to the rim itself.
      const cap = shoreMin > 5 ? shoreMin - 1 : shoreMin;
      if (interiorMax > cap) lakeViolations++;
    }

    for (const f of region.features as MapFeature[]) {
      const t = f.properties.featureType;
      if ((t === "mountain" || t === "volcano") && f.geometry.type === "Point") {
        peaksChecked++;
        const p = f.geometry.coordinates as Pt;
        const [c, r] = this.toGrid(p);
        const e = c >= 0 && c < this.cols && r >= 0 && r < this.rows ? this.elev[r * this.cols + c] : this.elevAt(p);
        if (e >= (f.properties.elevation as number) - 30) peaksHonored++;
      } else if (t === "mountain_range" && f.geometry.type === "Polygon") {
        rangesChecked++;
        const ring = f.geometry.coordinates[0] as Pt[];
        const b = f.bbox;
        let maxE = 0;
        const [c0, c1, r0, r1] = this.bboxCells(b);
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const p = this.cellCenter(c, r);
            if (!this.inBBox(p, b) || !pointInRing(p, ring)) continue;
            maxE = Math.max(maxE, this.elev[r * this.cols + c]);
          }
        }
        if (maxE >= (f.properties.elevation as number) * 0.85) rangesHonored++;
      }
    }

    return {
      cols: this.cols,
      rows: this.rows,
      cellKm: Math.round(this.cellKm * 10) / 10,
      riverViolations,
      lakeViolations,
      peaksChecked,
      peaksHonored,
      rangesChecked,
      rangesHonored,
    };
  }
}
