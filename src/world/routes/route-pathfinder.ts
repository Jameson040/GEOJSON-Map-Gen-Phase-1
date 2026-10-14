import type { GeneratedRegion, Pt } from "../types";
import { dist } from "../geom";
import { kmToUnits, unitsToKm } from "../constants";
import { BioEnvReader } from "../bio/bio-env";
import { makeRng } from "../rng";

// ---------------------------------------------------------------------------
// TERRAIN-AWARE A* PATHFINDING & CORRIDOR RELAXATION
//
// Cost model (per 100×100 cell):
//   • Mountain ranges +16, plateaus +2.8 — peaks are avoided, not impassable
//     (real roads cross at passes; the finetune renames those routes).
//   • River VALLEY band (beside the water, ~0.4–4 km out): ×0.7 — roads like
//     walking along valleys and lake shores where the going is easy.
//   • River CHANNEL (in/on the water itself): a crossing toll that scales
//     with the river's Strahler order — fording a headwater is cheap,
//     bridging a great trunk is expensive. Because the toll is paid PER CELL,
//     A* naturally crosses at the narrowest point and perpendicular (fewest
//     toll cells), and never rides lengthwise down a big river.
//   • Lakes are impassable for roads (attempt 1). Only when no land detour
//     exists does a second attempt allow a costly causeway/ferry crossing.
// ---------------------------------------------------------------------------

export interface RoutePathResult {
  points: Pt[];
  lengthKm: number;
  sinuosity: number;
  bridgesCount: number;
  mountainPassesCount: number;
  lakeCrossings: number;
  isSeaLane: boolean;
}

/** Crossing toll per cell for a river of the given Strahler order. */
function channelToll(order: number): number {
  return 2 + Math.max(0, order - 1) * 4.5; // order 1 ≈ 2, order 5 ≈ 20
}

export class RoutePathfinder {
  private geo: BioEnvReader;
  private width: number;
  private height: number;
  private gridCols = 100;
  private gridRows = 100;
  private minX: number;
  private minY: number;
  private cellW: number;
  private cellH: number;
  private seed: string;
  private cellDiagKm: number;
  private channelDetectKm: number;
  // Terrain traversal cost grid: [row * cols + col]
  private landCost: Float32Array;
  private seaCost: Float32Array;
  // Existing corridors discount map: 0..1 (1 = fresh terrain, 0.3 = established highway)
  private corridorDiscount: Float32Array;
  // River channel cells (true water crossing) with the river's Strahler order
  private riverChannel: Uint8Array;
  private riverOrder: Uint8Array;
  private lakeCell: Uint8Array;
  private mountainRidge: Uint8Array;

  constructor(region: GeneratedRegion, seed = region.descriptor.regionSeed) {
    this.geo = new BioEnvReader(region);
    this.seed = seed;
    const b = region.descriptor.bbox;
    this.minX = b.minX;
    this.minY = b.minY;
    this.width = Math.max(1, b.maxX - b.minX);
    this.height = Math.max(1, b.maxY - b.minY);
    this.cellW = this.width / this.gridCols;
    this.cellH = this.height / this.gridRows;
    // Cell-scale detection radius: a river vertex marks its host cell as
    // channel. Half the cell diagonal guarantees every vertex falls inside
    // its nearest cell centre's radius, whatever the map scale.
    this.cellDiagKm = unitsToKm(Math.hypot(this.cellW, this.cellH));
    this.channelDetectKm = Math.max(0.4, 0.55 * this.cellDiagKm);

    const totalCells = this.gridCols * this.gridRows;
    this.landCost = new Float32Array(totalCells);
    this.seaCost = new Float32Array(totalCells);
    this.corridorDiscount = new Float32Array(totalCells).fill(1.0);
    this.riverChannel = new Uint8Array(totalCells);
    this.riverOrder = new Uint8Array(totalCells);
    this.lakeCell = new Uint8Array(totalCells);
    this.mountainRidge = new Uint8Array(totalCells);

    this.bakeCostGrids();
  }

  private bakeCostGrids(): void {
    for (let r = 0; r < this.gridRows; r++) {
      for (let c = 0; c < this.gridCols; c++) {
        const idx = r * this.gridCols + c;
        const p: Pt = [
          this.minX + (c + 0.5) * this.cellW,
          this.minY + (r + 0.5) * this.cellH,
        ];
        const env = this.geo.envAt(p);

        // --- Sea Lane Costs ---
        if (!env.onLand) {
          // Open water: safe navigable lanes, bonus near coastline
          const coastDist = env.coastKm;
          this.seaCost[idx] = coastDist < 40 ? 1.0 : 1.4; // slight preference for coastal shipping
          this.landCost[idx] = 9999.0; // impassable for land roads
          continue;
        }

        // Land: impassable for ships
        this.seaCost[idx] = 9999.0;

        // --- Lakes: roads must go around (a second A* attempt may ferry across) ---
        if (this.geo.pointInLake(p)) {
          this.lakeCell[idx] = 1;
          this.landCost[idx] = 9999.0;
          continue;
        }

        // --- Land Route Costs ---
        let cost = 1.0;
        if (env.inRange) {
          // Mountain peak / ridge
          cost += 16.0;
          this.mountainRidge[idx] = 1;
        } else if (env.inPlateau) {
          cost += 2.8;
        }

        // Biome effects
        if (env.biome === "wetland") cost += 5.5; // muddy marsh
        else if (env.biome === "glacier") cost += 25.0; // frozen ice field
        else if (env.biome === "desert") cost += 2.2;
        else if (env.biome === "grassland" || env.biome === "savanna") cost *= 0.8; // easy flat travel
        else if (env.biome === "forest") cost += 1.4;

        // --- Rivers ---
        const river = this.geo.nearestRiverInfo(p);
        if (river) {
          if (unitsToKm(river.distUnits) <= this.channelDetectKm) {
            // The river runs through this cell: pay the crossing toll (per
            // cell, so lengthwise travel in a river is prohibitive while a
            // narrow, near-perpendicular crossing is merely priced in). The
            // toll scales with the river's Strahler order — fording a
            // headwater is cheap, bridging a great trunk is not.
            this.riverChannel[idx] = 1;
            this.riverOrder[idx] = Math.min(9, river.order);
            cost *= channelToll(river.order);
          } else if (unitsToKm(river.distUnits) <= this.channelDetectKm + 1.25 * this.cellDiagKm) {
            // Valley floor beside the river: favoured going.
            cost *= 0.7;
          }
        } else if (env.freshKm <= this.channelDetectKm + 1.25 * this.cellDiagKm) {
          // Lake shores (no river vertices nearby) are pleasant walking too.
          cost *= 0.7;
        }

        this.landCost[idx] = cost;
      }
    }
  }

  /** Convert world coordinates to grid cell [col, row] */
  private toGrid(p: Pt): [number, number] {
    const col = Math.max(0, Math.min(this.gridCols - 1, Math.floor((p[0] - this.minX) / this.cellW)));
    const row = Math.max(0, Math.min(this.gridRows - 1, Math.floor((p[1] - this.minY) / this.cellH)));
    return [col, row];
  }

  /** Convert grid cell [col, row] to world coordinates */
  private toWorld(col: number, row: number): Pt {
    return [
      this.minX + (col + 0.5) * this.cellW,
      this.minY + (row + 0.5) * this.cellH,
    ];
  }

  /** Reinforce an established highway so future feeder roads naturally branch into it */
  markCorridor(points: Pt[]): void {
    for (const p of points) {
      const [c, r] = this.toGrid(p);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc >= 0 && nc < this.gridCols && nr >= 0 && nr < this.gridRows) {
            const idx = nr * this.gridCols + nc;
            this.corridorDiscount[idx] = Math.min(this.corridorDiscount[idx], dc === 0 && dr === 0 ? 0.35 : 0.6);
          }
        }
      }
    }
  }

  /**
   * Find terrain-respecting route between start and end.
   * Lakes are impassable on the first attempt; a second attempt allows a
   * costly causeway/ferry so the network never fails to connect. Sea lanes
   * embark at the nearest navigable water cell of each port — non-coastal
   * ports return null and get no maritime lane at all. Over-winding results
   * (sinuosity > 4) are retried on a relaxed cost surface, trading terrain
   * fidelity for a saner line.
   */
  findRoute(start: Pt, end: Pt, isSeaLane = false): RoutePathResult | null {
    let a = start;
    let b = end;
    let snapS: Pt | null = null;
    let snapE: Pt | null = null;
    if (isSeaLane) {
      const s = this.snapToWater(start);
      const e = this.snapToWater(end);
      if (!s || !e) return null; // not a viable maritime pair
      a = s.pt;
      b = e.pt;
      if (s.snapped) snapS = s.pt;
      if (e.snapped) snapE = e.pt;
    }

    const direct = this.astar(a, b, isSeaLane, false, 1);
    const path = direct ?? (!isSeaLane ? this.astar(a, b, isSeaLane, true, 1) : null);
    const usedCauseway = !direct && !!path;

    const decorate = (wp: Pt[]): Pt[] => {
      let out = wp;
      if (snapS) out = [start, ...out];
      if (snapE) out = [...out, end];
      return out;
    };

    let waypoints: Pt[];
    if (path) {
      waypoints = decorate(path);
    } else {
      waypoints = this.fallbackArc(start, end);
    }

    let result = this.buildResult(waypoints, usedCauseway, isSeaLane);

    // Straightening retry: a road that chases every cheap valley ribbon can
    // wind absurdly. Re-run with terrain costs compressed toward flat cost.
    if (!isSeaLane && result.sinuosity > 4.0) {
      const straighter = this.astar(a, b, false, false, 0.35) ?? this.astar(a, b, false, true, 0.35);
      if (straighter) {
        const alt = this.buildResult(decorate(straighter), usedCauseway, isSeaLane);
        if (alt.sinuosity < result.sinuosity) result = alt;
      }
      if (result.sinuosity > 4.8) {
        // Last resort: a near-straight arc beats a ludicrous squiggle.
        result = this.buildResult(this.fallbackArc(start, end), false, isSeaLane);
      }
    }

    return result;
  }

  /** Smooth, measure and classify a waypoint chain into a route result. */
  private buildResult(waypoints: Pt[], usedCauseway: boolean, isSeaLane: boolean): RoutePathResult {
    // Smooth spline
    const smoothed = smoothPath(waypoints, isSeaLane ? 1 : 2);

    // Compute stats from the FINAL drawn line: a crossing is a contiguous
    // run of channel/lake/ridge cells along the smoothed polyline (a single
    // gap point is tolerated — Chaikin corners can dip one sample off-cell).
    let lenUnits = 0;
    const inChannel: boolean[] = [];
    const inLake: boolean[] = [];
    const onRidge: boolean[] = [];

    for (let i = 0; i < smoothed.length; i++) {
      if (i > 0) lenUnits += dist(smoothed[i - 1], smoothed[i]);
      const [c, r] = this.toGrid(smoothed[i]);
      const idx = r * this.gridCols + c;
      inChannel.push(!isSeaLane && this.riverChannel[idx] === 1);
      inLake.push(!isSeaLane && this.lakeCell[idx] === 1);
      onRidge.push(!isSeaLane && this.mountainRidge[idx] === 1);
    }

    const countRuns = (flags: boolean[]): number => {
      let runs = 0;
      let open = 0;
      let gap = 0;
      for (const f of flags) {
        if (f) {
          if (open === 0 && gap === 0) runs++;
          open++;
          gap = 0;
        } else if (open > 0) {
          gap++;
          if (gap > 1) {
            open = 0;
            gap = 0;
          }
        }
      }
      return runs;
    };

    const lengthKm = Math.round(unitsToKm(lenUnits) * 10) / 10;
    const straightKm = unitsToKm(dist(smoothed[0], smoothed[smoothed.length - 1]));

    return {
      points: smoothed,
      lengthKm,
      sinuosity: straightKm > 0 ? Math.round((lengthKm / straightKm) * 100) / 100 : 1,
      bridgesCount: countRuns(inChannel),
      mountainPassesCount: countRuns(onRidge),
      lakeCrossings: usedCauseway ? Math.max(1, countRuns(inLake)) : countRuns(inLake),
      isSeaLane,
    };
  }

  /** Straight-ish deterministic arc used only when A* cannot connect at all. */
  private fallbackArc(start: Pt, end: Pt): Pt[] {
    const rng = makeRng(`${this.seed}::fallback::${start[0].toFixed(2)},${start[1].toFixed(2)}::${end[0].toFixed(2)},${end[1].toFixed(2)}`);
    const mid: Pt = [
      (start[0] + end[0]) / 2 + (rng() - 0.5) * kmToUnits(10),
      (start[1] + end[1]) / 2 + (rng() - 0.5) * kmToUnits(10),
    ];
    return [start, mid, end];
  }

  /**
   * Nearest navigable water cell to a (possibly land-locked) port point.
   * Only genuinely coastal ports — a couple of cells of approach — qualify;
   * anything further inland returns null and gets no sea lane.
   */
  private snapToWater(p: Pt): { pt: Pt; snapped: boolean } | null {
    const [c0, r0] = this.toGrid(p);
    const startIdx = r0 * this.gridCols + c0;
    if (this.seaCost[startIdx] < 5000) return { pt: p, snapped: false }; // already at sea
    for (let ring = 1; ring <= 3; ring++) {
      let best: Pt | null = null;
      let bestD = Infinity;
      for (let dc = -ring; dc <= ring; dc++) {
        for (let dr = -ring; dr <= ring; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue; // ring shell only
          const c = c0 + dc;
          const r = r0 + dr;
          if (c < 0 || c >= this.gridCols || r < 0 || r >= this.gridRows) continue;
          if (this.seaCost[r * this.gridCols + c] >= 5000) continue;
          const w = this.toWorld(c, r);
          const d = dist(p, w);
          if (d < bestD) {
            bestD = d;
            best = w;
          }
        }
      }
      if (best) return { pt: best, snapped: true };
    }
    return null;
  }

  /**
   * Core A* over the 8-connected grid. Returns null when no path exists.
   * `relax` < 1 compresses land terrain costs toward flat 1.0 (impassable
   * stays impassable) — used by the sinuosity straightening retry.
   */
  private astar(start: Pt, end: Pt, isSeaLane: boolean, allowLakes: boolean, relax: number): Pt[] | null {
    const [startC, startR] = this.toGrid(start);
    const [endC, endR] = this.toGrid(end);

    const startIndex = startR * this.gridCols + startC;
    const endIndex = endR * this.gridCols + endC;

    if (startIndex === endIndex) {
      return [start, end];
    }

    const costGrid = isSeaLane ? this.seaCost : this.landCost;
    const totalCells = this.gridCols * this.gridRows;
    const gScore = new Float32Array(totalCells).fill(Infinity);
    const fScore = new Float32Array(totalCells).fill(Infinity);
    const cameFrom = new Int32Array(totalCells).fill(-1);
    const closed = new Uint8Array(totalCells);

    // Min-heap / priority queue for A*
    const openSet: number[] = [];
    const pushOpen = (nodeIdx: number, fVal: number) => {
      openSet.push(nodeIdx);
      // bubble up
      let i = openSet.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (fScore[openSet[p]] <= fVal) break;
        openSet[i] = openSet[p];
        openSet[p] = nodeIdx;
        i = p;
      }
    };

    const popOpen = (): number => {
      const top = openSet[0];
      const bottom = openSet.pop()!;
      if (openSet.length > 0) {
        openSet[0] = bottom;
        let i = 0;
        const len = openSet.length;
        while (true) {
          const left = (i << 1) + 1;
          const right = left + 1;
          let best = i;
          if (left < len && fScore[openSet[left]] < fScore[openSet[best]]) best = left;
          if (right < len && fScore[openSet[right]] < fScore[openSet[best]]) best = right;
          if (best === i) break;
          const swap = openSet[i];
          openSet[i] = openSet[best];
          openSet[best] = swap;
          i = best;
        }
      }
      return top;
    };

    // Admissible heuristic: terrain discounts mean a step can cost as little
    // as ~0.56 cell-units, so plain Euclidean distance would overestimate.
    const heuristic = (c: number, r: number) => {
      const dx = c - endC;
      const dy = r - endR;
      return 0.5 * Math.hypot(dx, dy);
    };

    const cellCost = (idx: number): number => {
      if (!isSeaLane && allowLakes && this.lakeCell[idx] === 1) return 9.0; // causeway/ferry toll
      const base = costGrid[idx];
      if (base >= 5000) return base; // impassable stays impassable when relaxed
      if (relax < 1) return 1 + (base - 1) * relax;
      return base;
    };

    gScore[startIndex] = 0;
    fScore[startIndex] = heuristic(startC, startR);
    pushOpen(startIndex, fScore[startIndex]);

    let found = false;
    let iterations = 0;
    const maxIterations = 40_000;

    const dCols = [0, 1, 1, 1, 0, -1, -1, -1];
    const dRows = [-1, -1, 0, 1, 1, 1, 0, -1];
    const dDists = [1, 1.414, 1, 1.414, 1, 1.414, 1, 1.414];

    while (openSet.length > 0 && iterations++ < maxIterations) {
      const current = popOpen();
      if (current === endIndex) {
        found = true;
        break;
      }
      closed[current] = 1;

      const curC = current % this.gridCols;
      const curR = Math.floor(current / this.gridCols);

      for (let dir = 0; dir < 8; dir++) {
        const nextC = curC + dCols[dir];
        const nextR = curR + dRows[dir];
        if (nextC < 0 || nextC >= this.gridCols || nextR < 0 || nextR >= this.gridRows) continue;

        const nextIdx = nextR * this.gridCols + nextC;
        if (closed[nextIdx]) continue;

        const nextCost = cellCost(nextIdx);
        if (nextCost >= 5000.0) continue; // impassable

        const discount = this.corridorDiscount[nextIdx];
        const stepCost = dDists[dir] * nextCost * discount;
        const tentativeG = gScore[current] + stepCost;

        if (tentativeG < gScore[nextIdx]) {
          cameFrom[nextIdx] = current;
          gScore[nextIdx] = tentativeG;
          fScore[nextIdx] = tentativeG + heuristic(nextC, nextR);
          pushOpen(nextIdx, fScore[nextIdx]);
        }
      }
    }

    if (!found) return null;

    let cur = endIndex;
    const rawIndices: number[] = [];
    while (cur !== -1) {
      rawIndices.push(cur);
      cur = cameFrom[cur];
    }
    rawIndices.reverse();

    // Sample indices into world points (start/end snap to true settlements)
    const waypoints: Pt[] = [start];
    for (let i = 1; i < rawIndices.length - 1; i += 2) {
      const c = rawIndices[i] % this.gridCols;
      const r = Math.floor(rawIndices[i] / this.gridCols);
      waypoints.push(this.toWorld(c, r));
    }
    waypoints.push(end);
    return waypoints;
  }
}

/** Chaikin corner-cutting smoothing algorithm */
function smoothPath(pts: Pt[], iterations: number): Pt[] {
  if (pts.length <= 2) return pts;
  let current = pts;

  for (let it = 0; it < iterations; it++) {
    const next: Pt[] = [current[0]];
    for (let i = 0; i < current.length - 1; i++) {
      const p0 = current[i];
      const p1 = current[i + 1];
      // Q = 0.75 p0 + 0.25 p1
      next.push([p0[0] * 0.75 + p1[0] * 0.25, p0[1] * 0.75 + p1[1] * 0.25]);
      // R = 0.25 p0 + 0.75 p1
      next.push([p0[0] * 0.25 + p1[0] * 0.75, p0[1] * 0.25 + p1[1] * 0.75]);
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}
