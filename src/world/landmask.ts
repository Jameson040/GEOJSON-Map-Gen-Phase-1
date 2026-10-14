import type { BBox, Pt } from "./types";

/**
 * A rasterised inside/outside mask for one region outline.
 *
 * Tier-2 needs to sample tens of thousands of candidate points and ask
 * "is this on land?". Running a 300-vertex ray-cast per query would cost
 * ~9M operations. Instead we rasterise the outline once into a bitmask and
 * answer every subsequent query in O(1).
 *
 * It also stores a coarse distance-to-coast field, which Tier-2 uses to
 * place mountains inland, rivers flowing seaward, and coastal wetlands.
 */
export class LandMask {
  readonly bbox: BBox;
  readonly cols: number;
  readonly rows: number;
  private cellW: number;
  private cellH: number;
  private mask: Uint8Array;
  /** Chebyshev-ish distance to the nearest ocean cell, in grid cells. */
  private coastDist: Float32Array;
  private maxCoastDist = 1;

  constructor(outline: Pt[], bbox: BBox, resolution = 320) {
    this.bbox = bbox;
    const w = bbox.maxX - bbox.minX;
    const h = bbox.maxY - bbox.minY;
    const aspect = h / Math.max(1e-6, w);
    this.cols = Math.max(32, Math.round(resolution));
    this.rows = Math.max(32, Math.round(resolution * aspect));
    this.cellW = w / this.cols;
    this.cellH = h / this.rows;
    this.mask = new Uint8Array(this.cols * this.rows);
    this.coastDist = new Float32Array(this.cols * this.rows);

    this.rasterise(outline);
    this.computeCoastDistance();
  }

  /** Scanline rasterisation of the outline polygon. */
  private rasterise(ring: Pt[]) {
    const n = ring.length;
    for (let r = 0; r < this.rows; r++) {
      const y = this.bbox.minY + (r + 0.5) * this.cellH;
      // Collect X crossings of the scanline
      const xs: number[] = [];
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = ring[i][1];
        const yj = ring[j][1];
        if (yi > y !== yj > y) {
          const t = (y - yi) / (yj - yi);
          xs.push(ring[i][0] + t * (ring[j][0] - ring[i][0]));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xStart = xs[k];
        const xEnd = xs[k + 1];
        let c0 = Math.floor((xStart - this.bbox.minX) / this.cellW);
        let c1 = Math.ceil((xEnd - this.bbox.minX) / this.cellW);
        c0 = Math.max(0, c0);
        c1 = Math.min(this.cols - 1, c1);
        const rowOff = r * this.cols;
        for (let c = c0; c <= c1; c++) {
          const cx = this.bbox.minX + (c + 0.5) * this.cellW;
          if (cx >= xStart && cx <= xEnd) this.mask[rowOff + c] = 1;
        }
      }
    }
  }

  /**
   * Two-pass chamfer distance transform: for every land cell, how far is the
   * nearest ocean cell. Cheap (O(n)) and good enough for placement heuristics.
   */
  private computeCoastDistance() {
    const { cols, rows } = this;
    const INF = 1e9;
    const d = this.coastDist;
    for (let i = 0; i < d.length; i++) d[i] = this.mask[i] ? INF : 0;

    // Forward pass
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (d[i] === 0) continue;
        let best = d[i];
        if (c > 0) best = Math.min(best, d[i - 1] + 1);
        if (r > 0) best = Math.min(best, d[i - cols] + 1);
        if (r > 0 && c > 0) best = Math.min(best, d[i - cols - 1] + 1.414);
        if (r > 0 && c < cols - 1) best = Math.min(best, d[i - cols + 1] + 1.414);
        d[i] = best;
      }
    }
    // Backward pass
    for (let r = rows - 1; r >= 0; r--) {
      for (let c = cols - 1; c >= 0; c--) {
        const i = r * cols + c;
        if (d[i] === 0) continue;
        let best = d[i];
        if (c < cols - 1) best = Math.min(best, d[i + 1] + 1);
        if (r < rows - 1) best = Math.min(best, d[i + cols] + 1);
        if (r < rows - 1 && c < cols - 1) best = Math.min(best, d[i + cols + 1] + 1.414);
        if (r < rows - 1 && c > 0) best = Math.min(best, d[i + cols - 1] + 1.414);
        d[i] = best;
        if (best < INF && best > this.maxCoastDist) this.maxCoastDist = best;
      }
    }
  }

  private cellIndex(p: Pt): number {
    const c = Math.floor((p[0] - this.bbox.minX) / this.cellW);
    const r = Math.floor((p[1] - this.bbox.minY) / this.cellH);
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  /** O(1) land test. */
  isLand(p: Pt): boolean {
    const i = this.cellIndex(p);
    return i >= 0 && this.mask[i] === 1;
  }

  /** Distance to the nearest coast, in planetary units. */
  distanceToCoast(p: Pt): number {
    const i = this.cellIndex(p);
    if (i < 0) return 0;
    return this.coastDist[i] * this.cellW;
  }

  /** 0 at the shoreline, 1 deep in the continental interior. */
  inlandFactor(p: Pt): number {
    const i = this.cellIndex(p);
    if (i < 0) return 0;
    return Math.min(1, this.coastDist[i] / this.maxCoastDist);
  }

  // ---- cell-level accessors (used by the compartment grid) ----------------
  get cellWidth(): number {
    return this.cellW;
  }
  get cellHeight(): number {
    return this.cellH;
  }
  isLandIndex(i: number): boolean {
    return this.mask[i] === 1;
  }
  /** 0 at the shoreline, 1 at the deepest interior cell. */
  inlandIndex(i: number): number {
    return Math.min(1, this.coastDist[i] / this.maxCoastDist);
  }
  cellCenter(i: number): Pt {
    const r = Math.floor(i / this.cols);
    const c = i - r * this.cols;
    return [this.bbox.minX + (c + 0.5) * this.cellW, this.bbox.minY + (r + 0.5) * this.cellH];
  }
  /** The most inland point of the landmass (summit of a central massif). */
  deepestPoint(): Pt {
    let best = -1;
    let bestV = -1;
    for (let i = 0; i < this.coastDist.length; i++) {
      if (this.mask[i] === 1 && this.coastDist[i] > bestV && this.coastDist[i] < 1e8) {
        bestV = this.coastDist[i];
        best = i;
      }
    }
    return best >= 0
      ? this.cellCenter(best)
      : [(this.bbox.minX + this.bbox.maxX) / 2, (this.bbox.minY + this.bbox.maxY) / 2];
  }

  /** Total land cells -> usable as a cheap area estimate. */
  get landCellCount(): number {
    let n = 0;
    for (let i = 0; i < this.mask.length; i++) n += this.mask[i];
    return n;
  }

  /**
   * Rejection-sample a random land point, optionally requiring a minimum
   * inland factor (so rivers don't spawn on a beach).
   */
  sampleLand(rng: () => number, minInland = 0, tries = 40): Pt | null {
    const w = this.bbox.maxX - this.bbox.minX;
    const h = this.bbox.maxY - this.bbox.minY;
    for (let t = 0; t < tries; t++) {
      const p: Pt = [this.bbox.minX + rng() * w, this.bbox.minY + rng() * h];
      const i = this.cellIndex(p);
      if (i < 0 || this.mask[i] !== 1) continue;
      if (minInland > 0 && this.coastDist[i] / this.maxCoastDist < minInland) continue;
      return p;
    }
    return null;
  }

  /**
   * March from a start point down the coast-distance gradient toward the sea.
   *
   * A raw steepest-descent walk on a chamfer field produces dead-straight
   * radial spokes, because the field's gradient points straight at the nearest
   * shore. Real rivers don't do that, so the walk carries **inertia** (it
   * prefers to keep its heading) and a small **stochastic wander**, which
   * together bend the channel and let it slip past shallow local minima.
   *
   * Returns the path plus whether it actually made it to the shoreline; a
   * stalled walk means an interior (endorheic) basin.
   */
  flowToCoast(
    start: Pt,
    rng: () => number,
    maxSteps = 400
  ): { path: Pt[]; reachedCoast: boolean } {
    const path: Pt[] = [start];
    let cur: Pt = [start[0], start[1]];
    const step = this.cellW * 1.15;
    let heading: number | null = null;
    let reachedCoast = false;

    for (let s = 0; s < maxSteps; s++) {
      const i = this.cellIndex(cur);
      if (i < 0) {
        reachedCoast = true;
        break;
      }
      const here = this.coastDist[i];
      if (here <= 1.3) {
        reachedCoast = true;
        break;
      }

      let bestAngle = 0;
      let bestScore = Infinity;
      let bestRaw = Infinity;
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const probe: Pt = [cur[0] + Math.cos(ang) * step, cur[1] + Math.sin(ang) * step];
        const pi = this.cellIndex(probe);
        const raw = pi < 0 ? -1 : this.coastDist[pi];
        // Inertia keeps the channel coherent; jitter breaks the radial symmetry
        let score = raw;
        if (heading !== null) score -= Math.cos(ang - heading) * 0.85;
        score += (rng() - 0.5) * 0.5;
        if (score < bestScore) {
          bestScore = score;
          bestRaw = raw;
          bestAngle = ang;
        }
      }
      // Genuinely stuck (a closed depression), not just a flat spot
      if (bestRaw >= here + 0.75) break;

      heading = bestAngle;
      cur = [cur[0] + Math.cos(bestAngle) * step, cur[1] + Math.sin(bestAngle) * step];
      path.push(cur);
    }
    return { path, reachedCoast };
  }
}
