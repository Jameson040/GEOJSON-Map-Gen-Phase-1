import type { BBox, MapFeature, Pt, RegionCompartment } from "./types";
import type { LandMask } from "./landmask";
import { areaUnitsToKm2 } from "./constants";

// ---------------------------------------------------------------------------
// INTRA-REGION COMPARTMENTS
//
// The landmass is split into square processing blocks whose side length comes
// from its size class (4 km blocks on an islet, 450 km blocks on a continent).
// Point-like and patch-like features (lakes, biomes, inselbergs, free
// headwaters) are then allotted to blocks in proportion to the land each
// block holds, and sampled inside that block.
//
// Effects:
//   • density follows land area, so a continent's far corner is as developed
//     as its centre, and a sliver peninsula doesn't get over-stuffed;
//   • sampling is direct (pick a land cell) instead of blind rejection over
//     the bounding box, which matters on skinny or ragged islands;
//   • per-block feature counts are reported back and can be drawn as an
//     overlay, so generation cost is visible block by block.
// ---------------------------------------------------------------------------

interface Block {
  id: number;
  col: number;
  row: number;
  bbox: BBox;
  cells: number[];
}

export class CompartmentGrid {
  readonly blocks: Block[];
  readonly blockUnits: number;
  private cols: number;
  private rows: number;
  private cumulative: number[];
  private totalCells: number;
  private mask: LandMask;
  private indexByColRow = new Map<number, number>();

  constructor(mask: LandMask, requestedBlockUnits: number, maxBlocksPerAxis = 28) {
    this.mask = mask;
    const w = mask.bbox.maxX - mask.bbox.minX;
    const h = mask.bbox.maxY - mask.bbox.minY;
    // Never exceed maxBlocksPerAxis² blocks, never shrink below one mask cell
    const minBlock = Math.max(w, h) / maxBlocksPerAxis;
    this.blockUnits = Math.max(requestedBlockUnits, minBlock, mask.cellWidth);
    this.cols = Math.max(1, Math.ceil(w / this.blockUnits));
    this.rows = Math.max(1, Math.ceil(h / this.blockUnits));

    const tmp: Block[] = [];
    const lookup = new Map<number, Block>();
    const totalMaskCells = mask.cols * mask.rows;
    for (let i = 0; i < totalMaskCells; i++) {
      if (!mask.isLandIndex(i)) continue;
      const p = mask.cellCenter(i);
      const c = Math.min(this.cols - 1, Math.floor((p[0] - mask.bbox.minX) / this.blockUnits));
      const r = Math.min(this.rows - 1, Math.floor((p[1] - mask.bbox.minY) / this.blockUnits));
      const key = r * this.cols + c;
      let b = lookup.get(key);
      if (!b) {
        const minX = mask.bbox.minX + c * this.blockUnits;
        const minY = mask.bbox.minY + r * this.blockUnits;
        b = {
          id: 0,
          col: c,
          row: r,
          bbox: { minX, minY, maxX: minX + this.blockUnits, maxY: minY + this.blockUnits },
          cells: [],
        };
        lookup.set(key, b);
        tmp.push(b);
      }
      b.cells.push(i);
    }
    tmp.sort((a, b) => a.row - b.row || a.col - b.col);
    tmp.forEach((b, i) => {
      b.id = i;
      this.indexByColRow.set(b.row * this.cols + b.col, i);
    });
    this.blocks = tmp;

    this.cumulative = [];
    let acc = 0;
    for (const b of this.blocks) {
      acc += b.cells.length;
      this.cumulative.push(acc);
    }
    this.totalCells = acc;
  }

  get count(): number {
    return this.blocks.length;
  }

  /** Random land point inside one block, optionally requiring an inland factor. */
  sampleIn(block: Block, rng: () => number, minInland = 0, tries = 14): Pt | null {
    if (!block.cells.length) return null;
    const cw = this.mask.cellWidth;
    const ch = this.mask.cellHeight;
    for (let t = 0; t < tries; t++) {
      const idx = block.cells[Math.floor(rng() * block.cells.length)];
      if (minInland > 0 && this.mask.inlandIndex(idx) < minInland) continue;
      const c = this.mask.cellCenter(idx);
      return [c[0] + (rng() - 0.5) * cw * 0.9, c[1] + (rng() - 0.5) * ch * 0.9];
    }
    return null;
  }

  /** Area-weighted random land point anywhere on the landmass. */
  sample(rng: () => number, minInland = 0): Pt | null {
    if (!this.totalCells) return null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const target = rng() * this.totalCells;
      let lo = 0;
      let hi = this.cumulative.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.cumulative[mid] > target) hi = mid;
        else lo = mid + 1;
      }
      const p = this.sampleIn(this.blocks[lo], rng, minInland);
      if (p) return p;
    }
    return null;
  }

  /** Largest-remainder apportionment of `total` items by land share. */
  allocate(total: number): number[] {
    const n = this.blocks.length;
    if (!n || total <= 0) return new Array(n).fill(0);
    const exact = this.blocks.map((b) => (b.cells.length / this.totalCells) * total);
    const out = exact.map((x) => Math.floor(x));
    let remaining = total - out.reduce((s, x) => s + x, 0);
    const order = exact
      .map((x, i) => ({ i, frac: x - Math.floor(x) }))
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < order.length && remaining > 0; k++, remaining--) out[order[k].i]++;
    return out;
  }

  blockIndexAt(p: Pt): number {
    const c = Math.floor((p[0] - this.mask.bbox.minX) / this.blockUnits);
    const r = Math.floor((p[1] - this.mask.bbox.minY) / this.blockUnits);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return this.indexByColRow.get(r * this.cols + c) ?? -1;
  }

  /** Summarise blocks with the final (post-finetune) feature counts. */
  summarise(features: MapFeature[]): RegionCompartment[] {
    const counts = new Array(this.blocks.length).fill(0);
    for (const f of features) {
      const t = f.properties.featureType;
      if (t === "coastline") continue;
      const g = f.geometry;
      let p: Pt;
      if (g.type === "Point") p = g.coordinates as Pt;
      else if (g.type === "LineString") p = (g.coordinates as Pt[])[0];
      else p = [(f.bbox.minX + f.bbox.maxX) / 2, (f.bbox.minY + f.bbox.maxY) / 2];
      const idx = this.blockIndexAt(p);
      if (idx >= 0) counts[idx]++;
    }
    const cellKm2 = areaUnitsToKm2(this.mask.cellWidth * this.mask.cellHeight);
    return this.blocks.map((b, i) => ({
      id: b.id,
      bbox: b.bbox,
      landKm2: Math.round(b.cells.length * cellKm2 * 10) / 10,
      landShare: b.cells.length / this.totalCells,
      featureCount: counts[i],
    }));
  }
}
