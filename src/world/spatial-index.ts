import type { BBox, MapFeature, Pt } from "./types";
import { dist, pointInPolygon } from "./geom";

/**
 * Uniform-grid spatial index scoped to an arbitrary bounding box, so the exact
 * same class serves the planetary macro map (7200×3600) and a single region
 * tab (a few hundred units across) with equally tight cells.
 */
export class SpatialGrid {
  readonly bounds: BBox;
  private cols: number;
  private rows: number;
  private cellW: number;
  private cellH: number;
  private cells: number[][];
  private features: MapFeature[] = [];

  constructor(bounds: BBox, targetCells = 4096) {
    this.bounds = bounds;
    const w = Math.max(1e-6, bounds.maxX - bounds.minX);
    const h = Math.max(1e-6, bounds.maxY - bounds.minY);
    const aspect = w / h;
    this.cols = Math.max(8, Math.round(Math.sqrt(targetCells * aspect)));
    this.rows = Math.max(8, Math.round(targetCells / this.cols));
    this.cellW = w / this.cols;
    this.cellH = h / this.rows;
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
  }

  static forFeatures(features: MapFeature[], bounds: BBox): SpatialGrid {
    const grid = new SpatialGrid(bounds, Math.min(16384, Math.max(1024, features.length)));
    grid.insertAll(features);
    return grid;
  }

  insertAll(features: MapFeature[]) {
    for (let i = 0; i < features.length; i++) this.insert(features[i]);
  }

  insert(feature: MapFeature): number {
    const idx = this.features.length;
    this.features.push(feature);
    const b = feature.bbox;
    const minC = this.clampCol((b.minX - this.bounds.minX) / this.cellW);
    const maxC = this.clampCol((b.maxX - this.bounds.minX) / this.cellW);
    const minR = this.clampRow((b.minY - this.bounds.minY) / this.cellH);
    const maxR = this.clampRow((b.maxY - this.bounds.minY) / this.cellH);
    for (let r = minR; r <= maxR; r++) {
      const off = r * this.cols;
      for (let c = minC; c <= maxC; c++) this.cells[off + c].push(idx);
    }
    return idx;
  }

  private clampCol(v: number) {
    return Math.max(0, Math.min(this.cols - 1, Math.floor(v)));
  }
  private clampRow(v: number) {
    return Math.max(0, Math.min(this.rows - 1, Math.floor(v)));
  }

  /** Frustum cull + level-of-detail filter. */
  query(view: BBox, zoom: number): MapFeature[] {
    const minC = this.clampCol((view.minX - this.bounds.minX) / this.cellW);
    const maxC = this.clampCol((view.maxX - this.bounds.minX) / this.cellW);
    const minR = this.clampRow((view.minY - this.bounds.minY) / this.cellH);
    const maxR = this.clampRow((view.maxY - this.bounds.minY) / this.cellH);

    const seen = new Set<number>();
    const out: MapFeature[] = [];
    for (let r = minR; r <= maxR; r++) {
      const off = r * this.cols;
      for (let c = minC; c <= maxC; c++) {
        const cell = this.cells[off + c];
        for (let i = 0; i < cell.length; i++) {
          const idx = cell[i];
          if (seen.has(idx)) continue;
          seen.add(idx);
          const f = this.features[idx];
          if (zoom < f.lodMinZoom) continue;
          const b = f.bbox;
          if (b.maxX >= view.minX && b.minX <= view.maxX && b.maxY >= view.minY && b.minY <= view.maxY) {
            out.push(f);
          }
        }
      }
    }
    return out;
  }

  /** Hit-test for hover/click, priority-ordered so small features win. */
  pick(p: Pt, radius: number, zoom: number): MapFeature | null {
    const c = this.clampCol((p[0] - this.bounds.minX) / this.cellW);
    const r = this.clampRow((p[1] - this.bounds.minY) / this.cellH);
    const candidates: MapFeature[] = [];
    for (let rr = r - 1; rr <= r + 1; rr++) {
      if (rr < 0 || rr >= this.rows) continue;
      for (let cc = c - 1; cc <= c + 1; cc++) {
        if (cc < 0 || cc >= this.cols) continue;
        for (const idx of this.cells[rr * this.cols + cc]) {
          const f = this.features[idx];
          if (zoom < f.lodMinZoom) continue;
          candidates.push(f);
        }
      }
    }
    if (!candidates.length) return null;

    // 1) Points
    let best: MapFeature | null = null;
    let bestD = radius;
    for (const f of candidates) {
      if (f.geometry.type !== "Point") continue;
      const d = dist(p, f.geometry.coordinates as Pt);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    if (best) return best;

    // 2) Lines
    bestD = radius;
    for (const f of candidates) {
      if (f.geometry.type !== "LineString") continue;
      const co = f.geometry.coordinates as Pt[];
      for (let i = 0; i + 1 < co.length; i++) {
        const d = segDist(p, co[i], co[i + 1]);
        if (d < bestD) {
          bestD = d;
          best = f;
        }
      }
    }
    if (best) return best;

    // 3) Polygons, smallest-first so a lake beats the continent under it
    const PRIORITY: Record<string, number> = {
      lake: 10,
      glacier: 9,
      volcano: 9,
      canyon: 8,
      plateau: 7,
      mountain_range: 7,
      desert: 5,
      forest: 5,
      savanna: 5,
      grassland: 5,
      tundra: 5,
      wetland: 5,
      island: 4,
      coastline: 3,
      continent: 2,
      ice_cap: 1,
      sea: 0,
    };
    let bestPri = -1;
    let bestArea = Infinity;
    for (const f of candidates) {
      if (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon") continue;
      const inside =
        f.geometry.type === "Polygon"
          ? pointInPolygon(p, f.geometry.coordinates as Pt[][])
          : (f.geometry.coordinates as Pt[][][]).some((poly) => pointInPolygon(p, poly));
      if (!inside) continue;
      const pri = PRIORITY[f.properties.featureType] ?? 0;
      const area = (f.bbox.maxX - f.bbox.minX) * (f.bbox.maxY - f.bbox.minY);
      if (pri > bestPri || (pri === bestPri && area < bestArea)) {
        bestPri = pri;
        bestArea = area;
        best = f;
      }
    }
    return best;
  }

  get size() {
    return this.features.length;
  }
  get all() {
    return this.features;
  }
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}
