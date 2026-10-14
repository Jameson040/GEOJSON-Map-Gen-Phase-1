// Planar geometry helpers. We deliberately avoid turf's geodesic-aware
// functions (distance/buffer/area assume real lon/lat) since our world
// lives on an abstract flat plane. Boolean ops (union/intersect/difference)
// from turf are planar under the hood via polygon-clipping, so those are safe.

export type Pt = [number, number];

export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function lerp(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function centroidOf(points: Pt[]): Pt {
  const n = points.length;
  const sum = points.reduce((s, p) => [s[0] + p[0], s[1] + p[1]] as Pt, [0, 0] as Pt);
  return [sum[0] / n, sum[1] / n];
}

// Shoelace area (planar), sign indicates winding.
export function ringArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
}

export function polygonArea(coords: Pt[][]): number {
  if (!coords.length) return 0;
  let a = Math.abs(ringArea(coords[0]));
  for (let i = 1; i < coords.length; i++) a -= Math.abs(ringArea(coords[i]));
  return Math.max(0, a);
}

// Nearest point on a polyline to a given point (pure Euclidean).
export function nearestOnLine(line: Pt[], p: Pt): { point: Pt; index: number; t: number; dist: number } {
  let best = { point: line[0], index: 0, t: 0, dist: Infinity };
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1e-9;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cand: Pt = [a[0] + dx * t, a[1] + dy * t];
    const d = dist(cand, p);
    if (d < best.dist) best = { point: cand, index: i, t, dist: d };
  }
  return best;
}

export function ringToLine(ring: Pt[]): Pt[] {
  return ring;
}

// Simple point-in-ring test (ray casting), planar.
export function pointInRing(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1];
    const xj = ring[j][0],
      yj = ring[j][1];
    const intersect = yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(p: Pt, poly: Pt[][]): boolean {
  if (!poly.length) return false;
  if (!pointInRing(p, poly[0])) return false;
  for (let i = 1; i < poly.length; i++) if (pointInRing(p, poly[i])) return false;
  return true;
}

export function pointInAnyPolygon(p: Pt, polys: Pt[][][]): boolean {
  return polys.some((poly) => pointInPolygon(p, poly));
}

export function bboxOfRing(ring: Pt[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function bboxOfCoords(coords: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i < coords.length; i++) {
    const x = coords[i][0];
    const y = coords[i][1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function bboxOfPolygon(rings: Pt[][]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (!rings.length || !rings[0].length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return bboxOfRing(rings[0]);
}

export function bboxOfMultiPolygon(polys: Pt[][][]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) {
    const b = bboxOfPolygon(poly);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, minY, maxX, maxY };
}

// Generate an organic closed ring from a radius(angle) function with optional high-frequency fractal detail.
export function radialPolygon(
  center: Pt,
  baseRadius: number,
  radiusFn: (angle: number) => number,
  steps = 48,
  fractalJitter = 0
): Pt[] {
  const ring: Pt[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const jitter = fractalJitter > 0 ? (Math.sin(a * 19.3) * 0.5 + Math.sin(a * 37.7) * 0.3) * fractalJitter : 0;
    // Floor relative to the radius so sub-kilometre islets can exist; large
    // shapes keep the original 2-unit floor and are unaffected.
    const r = Math.max(Math.min(2, baseRadius * 0.12), baseRadius * (1 + radiusFn(a) + jitter));
    ring.push([center[0] + Math.cos(a) * r, center[1] + Math.sin(a) * r]);
  }
  ring.push([ring[0][0], ring[0][1]]); // force exact closure
  return ring;
}

// Midpoint-displacement fractal line between two points (river/range meander).
export function fractalLine(rng: () => number, a: Pt, b: Pt, roughness: number, depth = 6): Pt[] {
  let points: Pt[] = [a, b];
  let disp = dist(a, b) * roughness;
  for (let d = 0; d < depth; d++) {
    const next: Pt[] = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const mid = lerp(p1, p2, 0.5);
      const dx = p2[0] - p1[0];
      const dy = p2[1] - p1[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const offset = (rng() * 2 - 1) * disp;
      next.push([mid[0] + nx * offset, mid[1] + ny * offset]);
      next.push(p2);
    }
    points = next;
    disp *= 0.55;
  }
  return points;
}

// Build a ribbon polygon (used for mountain ranges) around a centerline.
export function ribbonFromLine(line: Pt[], width: (t: number) => number): Pt[] {
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    const prev = line[Math.max(0, i - 1)];
    const next = line[Math.min(line.length - 1, i + 1)];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const w = width(i / (line.length - 1)) / 2;
    left.push([p[0] + nx * w, p[1] + ny * w]);
    right.push([p[0] - nx * w, p[1] - ny * w]);
  }
  const ring = [...left, ...right.reverse()];
  ring.push([ring[0][0], ring[0][1]]);
  return ring;
}

// Chaikin-style corner smoothing for nicer, more organic coastlines when rendering.
export function smoothRing(ring: Pt[], iterations = 2): Pt[] {
  let pts = ring;
  for (let it = 0; it < iterations; it++) {
    const out: Pt[] = [];
    const n = pts.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      out.push([p0[0] * 0.75 + p1[0] * 0.25, p0[1] * 0.75 + p1[1] * 0.25]);
      out.push([p0[0] * 0.25 + p1[0] * 0.75, p0[1] * 0.25 + p1[1] * 0.75]);
    }
    out.push(out[0]);
    pts = out;
  }
  return pts;
}

export function distanceToPolygonBoundary(p: Pt, poly: Pt[][]): number {
  let best = Infinity;
  for (const ring of poly) {
    const { dist: d } = nearestOnLine(ring, p);
    if (d < best) best = d;
  }
  return best;
}
