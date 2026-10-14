import type { GeneratedRegion, Pt } from "../types";
import { dist } from "../geom";
import { kmToUnits, unitsToKm } from "../constants";
import { BioEnvReader } from "../bio/bio-env";

// ---------------------------------------------------------------------------
// TERRAIN-AWARE A* PATHFINDING & CORRIDOR RELAXATION
// ---------------------------------------------------------------------------

export interface RoutePathResult {
  points: Pt[];
  lengthKm: number;
  bridgesCount: number;
  mountainPassesCount: number;
  isSeaLane: boolean;
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
  // Terrain traversal cost grid: [row * cols + col]
  private landCost: Float32Array;
  private seaCost: Float32Array;
  // Existing corridors discount map: 0..1 (1 = fresh terrain, 0.3 = established highway)
  private corridorDiscount: Float32Array;
  // River proximity map (cells with river crossings)
  private riverCrossing: Uint8Array;
  private mountainRidge: Uint8Array;

  constructor(region: GeneratedRegion) {
    this.geo = new BioEnvReader(region);
    const b = region.descriptor.bbox;
    this.minX = b.minX;
    this.minY = b.minY;
    this.width = Math.max(1, b.maxX - b.minX);
    this.height = Math.max(1, b.maxY - b.minY);
    this.cellW = this.width / this.gridCols;
    this.cellH = this.height / this.gridRows;

    const totalCells = this.gridCols * this.gridRows;
    this.landCost = new Float32Array(totalCells);
    this.seaCost = new Float32Array(totalCells);
    this.corridorDiscount = new Float32Array(totalCells).fill(1.0);
    this.riverCrossing = new Uint8Array(totalCells);
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
        } else {
          // Land: impassable for ships
          this.seaCost[idx] = 9999.0;

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

          // River valleys offer natural travel corridors
          if (env.freshKm <= 4) {
            cost *= 0.65; // river valley following
          }
          if (env.freshKm <= 1.2) {
            this.riverCrossing[idx] = 1;
          }

          this.landCost[idx] = cost;
        }
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
      this.minY + (r(row) + 0.5) * this.cellH,
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
   */
  findRoute(start: Pt, end: Pt, isSeaLane = false): RoutePathResult {
    const [startC, startR] = this.toGrid(start);
    const [endC, endR] = this.toGrid(end);

    const costGrid = isSeaLane ? this.seaCost : this.landCost;
    const startIndex = startR * this.gridCols + startC;
    const endIndex = endR * this.gridCols + endC;

    if (startIndex === endIndex) {
      return {
        points: [start, end],
        lengthKm: unitsToKm(dist(start, end)),
        bridgesCount: 0,
        mountainPassesCount: 0,
        isSeaLane,
      };
    }

    // A* algorithm on 8-connected grid
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

    const heuristic = (c: number, r: number) => {
      const dx = c - endC;
      const dy = r - endR;
      return Math.hypot(dx, dy);
    };

    gScore[startIndex] = 0;
    fScore[startIndex] = heuristic(startC, startR);
    pushOpen(startIndex, fScore[startIndex]);

    let found = false;
    let iterations = 0;
    const maxIterations = 5500;

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

        const cellCost = costGrid[nextIdx];
        if (cellCost >= 5000.0) continue; // impassable

        const discount = this.corridorDiscount[nextIdx];
        const stepCost = dDists[dir] * cellCost * discount;
        const tentativeG = gScore[current] + stepCost;

        if (tentativeG < gScore[nextIdx]) {
          cameFrom[nextIdx] = current;
          gScore[nextIdx] = tentativeG;
          fScore[nextIdx] = tentativeG + heuristic(nextC, nextR);
          pushOpen(nextIdx, fScore[nextIdx]);
        }
      }
    }

    let waypoints: Pt[] = [];
    if (found) {
      let cur = endIndex;
      const rawIndices: number[] = [];
      while (cur !== -1) {
        rawIndices.push(cur);
        cur = cameFrom[cur];
      }
      rawIndices.reverse();

      // Sample indices into world points
      waypoints.push(start);
      // Downsample path to avoid excessive density (every 2-3 cells)
      for (let i = 1; i < rawIndices.length - 1; i += 2) {
        const c = rawIndices[i] % this.gridCols;
        const r = Math.floor(rawIndices[i] / this.gridCols);
        waypoints.push(this.toWorld(c, r));
      }
      waypoints.push(end);
    } else {
      // Fallback: straight or slight 3-point arc if A* timed out
      const mid: Pt = [
        (start[0] + end[0]) / 2 + (Math.random() - 0.5) * kmToUnits(10),
        (start[1] + end[1]) / 2 + (Math.random() - 0.5) * kmToUnits(10),
      ];
      waypoints = [start, mid, end];
    }

    // Smooth spline
    const smoothed = smoothPath(waypoints, isSeaLane ? 1 : 2);

    // Compute stats
    let lenUnits = 0;
    let bridgesCount = 0;
    let mountainPassesCount = 0;

    for (let i = 0; i < smoothed.length - 1; i++) {
      lenUnits += dist(smoothed[i], smoothed[i + 1]);
      const [c, r] = this.toGrid(smoothed[i]);
      const idx = r * this.gridCols + c;
      if (!isSeaLane && this.riverCrossing[idx]) bridgesCount++;
      if (!isSeaLane && this.mountainRidge[idx]) mountainPassesCount++;
    }

    // Group close bridge encounters into single crossings
    bridgesCount = Math.max(0, Math.round(bridgesCount / 3));
    mountainPassesCount = Math.max(0, Math.round(mountainPassesCount / 4));

    return {
      points: smoothed,
      lengthKm: Math.round(unitsToKm(lenUnits) * 10) / 10,
      bridgesCount,
      mountainPassesCount,
      isSeaLane,
    };
  }
}

function r(val: number): number {
  return val;
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
