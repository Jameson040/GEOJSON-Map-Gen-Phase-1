import union from "@turf/union";
import { polygon as turfPolygon, featureCollection as turfFeatureCollection } from "@turf/helpers";
import type {
  BBox,
  ConflictRecord,
  LandSizeClass,
  MapFeature,
  PlanetMacro,
  Pt,
  RegionDescriptor,
  ShapeArchetype,
  ShapeFinetuneReport,
  ShapeLandmassRecord,
} from "./types";
import { type RNG, makeRng, range, irange, chance } from "./rng";
import { bboxOfRing, centroidOf, pointInRing } from "./geom";
import { segmentIntersection } from "./finetune-stage";
import {
  PLANET_WIDTH,
  PLANET_HEIGHT,
  areaUnitsToKm2,
  unitsToKm,
  xToLon,
  yToLat,
  climateZoneAt,
  equatorDistance,
  wrapWorldX,
} from "./constants";
import { classifyLandArea, profileFor, budgetFor, SIZE_CLASS_ORDER } from "./size-classes";

// ---------------------------------------------------------------------------
// TIER-1 SHAPE FINETUNE
//
// The raw macro generator builds every landmass as a noisy radial blob, so
// continents all read as "distorted circles". This post-pass reshapes them
// WITHOUT touching the generator:
//
//   • each landmass keeps its place (area-weighted centroid is pinned) and its
//     size (area is renormalised), so its size class and Tier-2 budget hold;
//   • its silhouette is rebuilt from a real-world ARCHETYPE:
//        wedge       – Africa, South America, India (one broad end, one tip)
//        cordillera  – the Americas' Pacific margin (long, bent, narrow)
//        lobed       – Europe, North America (many peninsulas and inland seas)
//        shield      – Australia, Antarctica (compact, with bights and capes)
//        arc_sliver  – Japan, New Zealand, Sumatra (elongated along the arc)
//        block_island– Madagascar, Borneo (chunky with capes)
//   • every transform is either a plane homeomorphism (stretch, taper, bend,
//     low-gradient domain warp) or a star-domain radial edit, so the outline
//     stays a simple, non-self-intersecting ring;
//   • candidates are validated against neighbours and seas and retried with a
//     rotated axis or lower intensity; if nothing fits, the raw shape is kept.
// ---------------------------------------------------------------------------

export const ARCHETYPE_INFO: Record<ShapeArchetype, { label: string; analog: string }> = {
  wedge: { label: "Wedge", analog: "Africa · South America · India" },
  cordillera: { label: "Cordillera Arc", analog: "The Americas' Pacific margin" },
  lobed: { label: "Lobed", analog: "Europe · North America" },
  shield: { label: "Compact Shield", analog: "Australia · Antarctica" },
  arc_sliver: { label: "Arc Sliver", analog: "Japan · New Zealand · Sumatra" },
  block_island: { label: "Block Island", analog: "Madagascar · Borneo" },
};

const ISLAND_RESHAPE_MIN_KM2 = 2000;
const ISLET_KM2 = 500;
const RAW_SEAM_X = 8;

/**
 * Reconstruct longitude vertices flattened by the raw generator's rectangular
 * canvas clamp. The raw macro rings are sampled at uniform polar angles, so
 * the missing radii can be interpolated from the nearest unclipped rays. The
 * restored points are allowed outside 0..PLANET_WIDTH: longitude is periodic.
 */
function restoreRawSeam(ring: Pt[]): Pt[] {
  const pts = openRing(ring);
  const clipped = pts.map((p) => p[0] <= RAW_SEAM_X + 0.25 || p[0] >= PLANET_WIDTH - RAW_SEAM_X - 0.25);
  if (!clipped.some(Boolean) || clipped.every(Boolean)) return ring;

  const n = pts.length;
  // Estimate the original ray origin using only vertices that were not
  // flattened against the old left/right canvas edges.
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < n; i++) {
    if (clipped[i]) continue;
    const th = (i / n) * Math.PI * 2;
    const s = Math.sin(th);
    const c = -Math.cos(th);
    const rhs = pts[i][0] * s + pts[i][1] * c;
    a11 += s * s;
    a12 += s * c;
    a22 += c * c;
    b1 += s * rhs;
    b2 += c * rhs;
  }
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-9) return ring;
  const origin: Pt = [(b1 * a22 - b2 * a12) / det, (a11 * b2 - a12 * b1) / det];

  const radius = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (clipped[i]) continue;
    const th = (i / n) * Math.PI * 2;
    radius[i] =
      (pts[i][0] - origin[0]) * Math.cos(th) + (pts[i][1] - origin[1]) * Math.sin(th);
  }

  const out = pts.map((p) => [p[0], p[1]] as Pt);
  for (let i = 0; i < n; i++) {
    if (!clipped[i]) continue;
    let prev = (i - 1 + n) % n;
    let next = (i + 1) % n;
    while (clipped[prev] && prev !== i) prev = (prev - 1 + n) % n;
    while (clipped[next] && next !== i) next = (next + 1) % n;
    if (prev === i || next === i) continue;
    const steps = (next - prev + n) % n;
    const at = (i - prev + n) % n;
    const t = steps > 0 ? at / steps : 0;
    const r = radius[prev] * (1 - t) + radius[next] * t;
    const th = (i / n) * Math.PI * 2;
    out[i] = [origin[0] + Math.cos(th) * r, origin[1] + Math.sin(th) * r];
  }
  return closeRing(out);
}

// ---------------------------------------------------------------------------
// Geometry helpers (exported: the verifier uses the same definitions)
// ---------------------------------------------------------------------------

export function signedArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
}

/** Area-weighted centroid — stable regardless of vertex density. */
export function polygonCentroid(ring: Pt[]): Pt {
  const A = signedArea(ring);
  if (Math.abs(A) < 1e-12) return centroidOf(ring);
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const cr = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    cx += (ring[i][0] + ring[i + 1][0]) * cr;
    cy += (ring[i][1] + ring[i + 1][1]) * cr;
  }
  return [cx / (6 * A), cy / (6 * A)];
}

function openRing(ring: Pt[]): Pt[] {
  const n = ring.length;
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) return ring.slice(0, n - 1);
  return ring.slice();
}

function closeRing(pts: Pt[]): Pt[] {
  return [...pts, [pts[0][0], pts[0][1]] as Pt];
}

const d2 = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Resample a ring to n points evenly spaced by arc length (returns closed). */
export function resampleRing(ring: Pt[], n: number): Pt[] {
  const pts = openRing(ring);
  const m = pts.length;
  const cum = [0];
  for (let i = 0; i < m; i++) cum.push(cum[i] + d2(pts[i], pts[(i + 1) % m]));
  const P = cum[m];
  const out: Pt[] = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const s = (k / n) * P;
    while (seg < m - 1 && cum[seg + 1] < s) seg++;
    const a = pts[seg];
    const b = pts[(seg + 1) % m];
    const L = cum[seg + 1] - cum[seg];
    const t = L > 0 ? (s - cum[seg]) / L : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return closeRing(out);
}

const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/**
 * True if every ray from c crosses the boundary exactly once. Tiny reversals
 * (< 0.002 rad) are tolerated: they come from canvas clamping, which flattens
 * the ring onto the map edge but keeps it star-shaped for practical purposes.
 */
function isStarFrom(open: Pt[], c: Pt): boolean {
  let sum = 0;
  let pos = 0;
  let neg = 0;
  const n = open.length;
  for (let i = 0; i < n; i++) {
    const a = open[i];
    const b = open[(i + 1) % n];
    const d = angDiff(Math.atan2(b[1] - c[1], b[0] - c[0]), Math.atan2(a[1] - c[1], a[0] - c[0]));
    if (d > 0) pos += d;
    else neg -= d;
    sum += d;
  }
  const minor = Math.min(pos, neg);
  return minor < 0.002 * 4 && Math.abs(Math.abs(sum) - Math.PI * 2) < 0.02;
}

/**
 * Raw Tier-1 landmasses are traced as rays at uniform angles 2πi/n from their
 * generation origin. That origin isn't stored, but it is recoverable by least
 * squares: each vertex p_i must satisfy cross(p_i − o, dir_i) = 0.
 */
function rayOriginEstimate(open: Pt[]): Pt | null {
  const n = open.length;
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    const s = Math.sin(th);
    const c = -Math.cos(th);
    const rhs = open[i][0] * s + open[i][1] * c;
    a11 += s * s;
    a12 += s * c;
    a22 += c * c;
    b1 += s * rhs;
    b2 += c * rhs;
  }
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-9) return null;
  return [(b1 * a22 - b2 * a12) / det, (a11 * b2 - a12 * b1) / det];
}

function findKernel(ring: Pt[], hint?: Pt | null): Pt | null {
  const open = openRing(ring);
  const b = bboxOfRing(ring);
  const c0 = polygonCentroid(ring);
  const origin = rayOriginEstimate(open);
  const cands: Pt[] = [
    ...(hint ? [hint] : []),
    ...(origin ? [origin] : []),
    c0,
    centroidOf(ring),
    [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2],
  ];
  const G = 13;
  const grid: Pt[] = [];
  for (let i = 1; i < G; i++)
    for (let j = 1; j < G; j++) grid.push([b.minX + ((b.maxX - b.minX) * i) / G, b.minY + ((b.maxY - b.minY) * j) / G]);
  grid.sort((p, q) => d2(p, c0) - d2(q, c0));
  cands.push(...grid);
  for (const c of cands.slice(0, 60)) {
    if (!pointInRing(c, ring)) continue;
    if (isStarFrom(open, c)) return c;
  }
  return null;
}

// ---- segment grid ---------------------------------------------------------

function avgEdge(ring: Pt[]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) s += d2(ring[i], ring[i + 1]);
  return s / Math.max(1, ring.length - 1);
}

function buildSegGrid(ring: Pt[], cell: number) {
  const map = new Map<string, number[]>();
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    const c0 = Math.floor(Math.min(a[0], b[0]) / cell);
    const c1 = Math.floor(Math.max(a[0], b[0]) / cell);
    const r0 = Math.floor(Math.min(a[1], b[1]) / cell);
    const r1 = Math.floor(Math.max(a[1], b[1]) / cell);
    for (let cx = c0; cx <= c1; cx++)
      for (let cy = r0; cy <= r1; cy++) {
        const k = `${cx},${cy}`;
        let bucket = map.get(k);
        if (!bucket) {
          bucket = [];
          map.set(k, bucket);
        }
        bucket.push(i);
      }
  }
  return map;
}

/** Does a closed ring cross itself anywhere? */
export function ringSelfIntersects(ring: Pt[]): boolean {
  const n = ring.length - 1;
  if (n < 4) return false;
  const b = bboxOfRing(ring);
  const cell = Math.max(avgEdge(ring) * 3, Math.max(b.maxX - b.minX, b.maxY - b.minY) / 400, 1e-9);
  const map = buildSegGrid(ring, cell);
  for (const bucket of map.values()) {
    for (let x = 0; x < bucket.length; x++) {
      for (let y = x + 1; y < bucket.length; y++) {
        const i = bucket[x];
        const j = bucket[y];
        const gap = Math.abs(i - j);
        if (gap <= 1 || gap === n - 1) continue;
        if (segmentIntersection(ring[i], ring[i + 1], ring[j], ring[j + 1])) return true;
      }
    }
  }
  return false;
}

/** First self-intersection of a closed ring (segment indices + point), or null. */
function findSelfIntersection(ring: Pt[]): { i: number; j: number; p: Pt } | null {
  const n = ring.length - 1;
  if (n < 4) return null;
  const b = bboxOfRing(ring);
  const cell = Math.max(avgEdge(ring) * 3, Math.max(b.maxX - b.minX, b.maxY - b.minY) / 400, 1e-9);
  const map = buildSegGrid(ring, cell);
  for (const bucket of map.values())
    for (let x = 0; x < bucket.length; x++)
      for (let y = x + 1; y < bucket.length; y++) {
        const i = Math.min(bucket[x], bucket[y]);
        const j = Math.max(bucket[x], bucket[y]);
        const gap = j - i;
        if (gap <= 1 || gap === n - 1) continue;
        const hit = segmentIntersection(ring[i], ring[i + 1], ring[j], ring[j + 1]);
        if (hit) return { i, j, p: hit.point };
      }
  return null;
}

/**
 * Remove pinches and figure-eights (e.g. two polygons touching at a single
 * point after a union) by splitting at the crossing and keeping the larger loop.
 */
export function repairRing(ring: Pt[]): Pt[] {
  let r = ring;
  for (let guard = 0; guard < 25; guard++) {
    const hit = findSelfIntersection(r);
    if (!hit) return r;
    const { i, j, p } = hit;
    const outer = closeRing([...r.slice(0, i + 1), p, ...r.slice(j + 1, r.length - 1)]);
    const inner = closeRing([p, ...r.slice(i + 1, j + 1)]);
    r = Math.abs(signedArea(outer)) >= Math.abs(signedArea(inner)) ? outer : inner;
    if (r.length < 4) return ring;
  }
  return r;
}

const bboxOverlap = (a: BBox, b: BBox, pad = 0) =>
  a.minX - pad <= b.maxX && a.maxX + pad >= b.minX && a.minY - pad <= b.maxY && a.maxY + pad >= b.minY;

/** Do two closed rings touch, cross, or contain one another? */
export function ringsIntersect(a: Pt[], b: Pt[], ba?: BBox, bb?: BBox): boolean {
  const A = ba ?? bboxOfRing(a);
  const B = bb ?? bboxOfRing(b);
  if (!bboxOverlap(A, B)) return false;
  const cell = Math.max(avgEdge(b) * 3, Math.max(B.maxX - B.minX, B.maxY - B.minY) / 64, 1e-9);
  const map = buildSegGrid(b, cell);
  for (let i = 0; i < a.length - 1; i++) {
    const p = a[i];
    const q = a[i + 1];
    const minX = Math.max(Math.min(p[0], q[0]), B.minX);
    const maxX = Math.min(Math.max(p[0], q[0]), B.maxX);
    const minY = Math.max(Math.min(p[1], q[1]), B.minY);
    const maxY = Math.min(Math.max(p[1], q[1]), B.maxY);
    if (minX > maxX || minY > maxY) continue;
    const seen = new Set<number>();
    for (let cx = Math.floor(minX / cell); cx <= Math.floor(maxX / cell); cx++)
      for (let cy = Math.floor(minY / cell); cy <= Math.floor(maxY / cell); cy++) {
        const bucket = map.get(`${cx},${cy}`);
        if (!bucket) continue;
        for (const j of bucket) {
          if (seen.has(j)) continue;
          seen.add(j);
          if (segmentIntersection(p, q, b[j], b[j + 1])) return true;
        }
      }
  }
  return pointInRing(a[0], b) || pointInRing(b[0], a);
}

function shiftRingX(ring: Pt[], dx: number): Pt[] {
  return dx === 0 ? ring : ring.map(([x, y]) => [x + dx, y] as Pt);
}

/** Put a whole ring in the same periodic longitude image as referenceX. */
function alignRingX(ring: Pt[], referenceX: number): Pt[] {
  const cx = polygonCentroid(ring)[0];
  return shiftRingX(ring, Math.round((referenceX - cx) / PLANET_WIDTH) * PLANET_WIDTH);
}

/** Ring intersection on a cylindrical globe, not a rectangular sheet. */
function ringsIntersectGlobe(a: Pt[], b: Pt[]): boolean {
  const aa = a;
  const bb = alignRingX(b, polygonCentroid(a)[0]);
  return ringsIntersect(aa, bb, bboxOfRing(aa), bboxOfRing(bb));
}

function pointInRingGlobe(p: Pt, ring: Pt[]): boolean {
  const rr = alignRingX(ring, p[0]);
  return pointInRing(p, rr);
}

function convexHullArea(pts: Pt[]): number {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return 0;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  const hull = closeRing([...lower.slice(0, -1), ...upper.slice(0, -1)]);
  return Math.abs(signedArea(hull));
}

/**
 * Shape descriptors used by the verifier:
 *  aspect   – √(λ1/λ2) of the boundary's principal axes (1 = round)
 *  solidity – area / convex-hull area (1 = convex blob, lower = gulfs & peninsulas)
 */
export function shapeMetrics(ring: Pt[]): { aspect: number; solidity: number; areaUnits: number } {
  const areaUnits = Math.abs(signedArea(ring));
  const hull = convexHullArea(openRing(ring));
  const s = openRing(resampleRing(ring, 256));
  let mx = 0;
  let my = 0;
  for (const p of s) {
    mx += p[0];
    my += p[1];
  }
  mx /= s.length;
  my /= s.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of s) {
    const dx = p[0] - mx;
    const dy = p[1] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = Math.max(1e-12, tr / 2 - disc);
  return {
    aspect: Math.round(Math.sqrt(l1 / l2) * 100) / 100,
    solidity: Math.round((hull > 0 ? areaUnits / hull : 1) * 1000) / 1000,
    areaUnits,
  };
}

/** Angle of the boundary's major principal axis. */
export function principalAxis(ring: Pt[]): number {
  const s = openRing(resampleRing(ring, 128));
  let mx = 0;
  let my = 0;
  for (const p of s) {
    mx += p[0];
    my += p[1];
  }
  mx /= s.length;
  my /= s.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of s) {
    sxx += (p[0] - mx) ** 2;
    syy += (p[1] - my) ** 2;
    sxy += (p[0] - mx) * (p[1] - my);
  }
  return 0.5 * Math.atan2(2 * sxy, sxx - syy);
}

/** Realism margin used to rank candidates (positive = clearly not a blob). */
function realismScore(m: { aspect: number; solidity: number }): number {
  return Math.max(m.aspect - 1.25, 0) * 1.5 + Math.max(0.86 - m.solidity, 0) * 4;
}

// ---------------------------------------------------------------------------
// Shape parameters & transforms
// ---------------------------------------------------------------------------

interface ShapeParams {
  archetype: ShapeArchetype;
  axis: number;
  aspect: number;
  taper: number;
  bend: number;
  peninsulas: { theta: number; width: number; length: number }[];
  gulfs: { theta: number; halfWidth: number; depth: number }[];
  waves: { kx: number; ky: number; phase: number; ax: number; ay: number }[];
  fractalK: number;
  fractalDepth: number;
  resampleN: number;
}

const ARCH_RANGES: Record<
  ShapeArchetype,
  { aspect: [number, number]; taper: [number, number]; bend: [number, number]; pen: [number, number]; gulf: [number, number] }
> = {
  wedge: { aspect: [1.35, 1.8], taper: [0.4, 0.58], bend: [0, 0.12], pen: [0, 1], gulf: [1, 2] },
  cordillera: { aspect: [1.8, 2.5], taper: [0.1, 0.3], bend: [0.18, 0.38], pen: [1, 2], gulf: [0, 1] },
  lobed: { aspect: [1.15, 1.5], taper: [0, 0.2], bend: [0, 0.12], pen: [3, 5], gulf: [2, 3] },
  shield: { aspect: [1.25, 1.5], taper: [0.05, 0.2], bend: [0, 0.08], pen: [1, 2], gulf: [1, 2] },
  arc_sliver: { aspect: [2.0, 3.1], taper: [0.1, 0.35], bend: [0.15, 0.4], pen: [0, 1], gulf: [0, 1] },
  block_island: { aspect: [1.4, 2.0], taper: [0.1, 0.3], bend: [0, 0.15], pen: [1, 3], gulf: [0, 1] },
};

function drawParams(rng: RNG, archetype: ShapeArchetype, axis: number, R: number, isContinent: boolean): ShapeParams {
  const A = ARCH_RANGES[archetype];
  const sgn = () => (chance(rng, 0.5) ? 1 : -1);
  const used: number[] = [];
  const pickAngle = () => {
    for (let t = 0; t < 30; t++) {
      const th = range(rng, -Math.PI, Math.PI);
      if (used.every((u) => Math.abs(angDiff(th, u)) > 0.55)) {
        used.push(th);
        return th;
      }
    }
    const th = range(rng, -Math.PI, Math.PI);
    used.push(th);
    return th;
  };
  const peninsulas = Array.from({ length: irange(rng, A.pen[0], A.pen[1]) }, () => ({
    theta: pickAngle(),
    // Wide and moderate: the later stretch/taper narrow them further, and thin
    // needles read as artefacts rather than Italy/Florida-type peninsulas
    width: R * range(rng, 0.17, 0.3),
    length: R * range(rng, 0.18, 0.4),
  }));
  const gulfs = Array.from({ length: irange(rng, A.gulf[0], A.gulf[1]) }, () => ({
    theta: pickAngle(),
    halfWidth: range(rng, 0.22, 0.5),
    depth: range(rng, 0.18, 0.38),
  }));
  const waves = Array.from({ length: 3 }, () => {
    const L = R * range(rng, 1.2, 2.6);
    const dir = range(rng, 0, Math.PI * 2);
    const k = (Math.PI * 2) / L;
    return {
      kx: Math.cos(dir) * k,
      ky: Math.sin(dir) * k,
      phase: range(rng, 0, Math.PI * 2),
      ax: R * range(rng, 0.02, 0.04) * sgn(),
      ay: R * range(rng, 0.02, 0.04) * sgn(),
    };
  });
  return {
    archetype,
    axis,
    aspect: range(rng, A.aspect[0], A.aspect[1]),
    taper: range(rng, A.taper[0], A.taper[1]) * sgn(),
    bend: range(rng, A.bend[0], A.bend[1]) * sgn(),
    peninsulas,
    gulfs,
    waves,
    fractalK: isContinent ? 0.18 : 0.14,
    fractalDepth: isContinent ? 2 : 1,
    resampleN: isContinent ? 360 : 140,
  };
}

/**
 * Arc-length based coastal bumps along the smoothed outward normal — used for
 * sutured / non-star landmasses where the radial edit has no valid kernel.
 * Validation afterwards rejects any candidate that self-intersects.
 */
function normalBumps(pts: Pt[], P: ShapeParams, R: number, intensity: number): Pt[] {
  const n = pts.length;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + d2(pts[i - 1], pts[i]));
  const per = cum[n - 1] + d2(pts[n - 1], pts[0]);
  const orient = signedArea(closeRing(pts)) > 0 ? 1 : -1;
  // Feature anchors on the coast, taken from the drawn angles
  const anchor = (theta: number) => ((theta + Math.PI) / (Math.PI * 2)) * per;
  const out: Pt[] = [];
  const m = 3;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - m + n) % n];
    const b = pts[(i + m) % n];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    // Outward normal: for CCW rings (positive area in y-down space) it's (ty,-tx)
    const nx = (ty / tl) * orient;
    const ny = (-tx / tl) * orient;
    let off = 0;
    for (const pen of P.peninsulas) {
      const c = anchor(pen.theta);
      let ds = Math.abs(cum[i] - c);
      ds = Math.min(ds, per - ds);
      const x = ds / (pen.width / 2);
      if (x < 1) off += pen.length * 0.8 * intensity * (x < 0.55 ? 1 : Math.pow(Math.cos(((x - 0.55) / 0.45) * (Math.PI / 2)), 2));
    }
    for (const g of P.gulfs) {
      const c = anchor(g.theta);
      let ds = Math.abs(cum[i] - c);
      ds = Math.min(ds, per - ds);
      const x = ds / (g.halfWidth * R);
      if (x < 1) off -= g.depth * R * 0.7 * intensity * Math.pow(Math.cos((x * Math.PI) / 2), 2);
    }
    out.push([pts[i][0] + nx * off, pts[i][1] + ny * off]);
  }
  return out;
}

function applyShape(
  raw: Pt[],
  P: ShapeParams,
  kernel: Pt | null,
  intensity: number,
  axisOffset: number,
  fractalScale: number,
  fractalRng: RNG,
  allowBumps = true
): { ring: Pt[]; clampLoss: number } {
  const rawA = Math.abs(signedArea(raw));
  const rawC = polygonCentroid(raw);
  let pts = openRing(resampleRing(raw, Math.max(P.resampleN, Math.min(900, openRing(raw).length))));
  // Resampling can cut across a narrow strait on sutured shapes; fall back to
  // the original vertices when it would introduce a crossing.
  if (!kernel && ringSelfIntersects(closeRing(pts))) pts = openRing(raw);

  // 1. Star-domain radial edits: peninsulas and gulfs
  const O: Pt = kernel ?? rawC;
  if (kernel) pts = starify(pts, O);
  let R = 0;
  for (const p of pts) R += d2(p, O);
  R /= pts.length;
  if (kernel) {
    pts = pts.map((p) => {
      const th = Math.atan2(p[1] - O[1], p[0] - O[0]);
      const r0 = d2(p, O);
      let factor = 1;
      for (const g of P.gulfs) {
        const x = Math.abs(angDiff(th, g.theta)) / g.halfWidth;
        if (x < 1) factor *= 1 - g.depth * intensity * Math.pow(Math.cos((x * Math.PI) / 2), 2);
      }
      let r = r0 * Math.max(0.3, factor);
      for (const pen of P.peninsulas) {
        const hw = Math.min(0.6, pen.width / (2 * R));
        const x = Math.abs(angDiff(th, pen.theta)) / hw;
        if (x < 1) {
          const prof = x < 0.55 ? 1 : Math.pow(Math.cos(((x - 0.55) / 0.45) * (Math.PI / 2)), 2);
          r += pen.length * intensity * prof;
        }
      }
      return [O[0] + Math.cos(th) * r, O[1] + Math.sin(th) * r] as Pt;
    });
  } else if (allowBumps) {
    pts = normalBumps(pts, P, R, intensity);
  }

  // 2. Injective frame warps: stretch, taper, bend (all plane homeomorphisms)
  const ax = P.axis + axisOffset;
  const ca = Math.cos(ax);
  const sa = Math.sin(ax);
  let Lh = 1e-9;
  const uv = pts.map((p) => {
    const dx = p[0] - O[0];
    const dy = p[1] - O[1];
    const u = dx * ca + dy * sa;
    const v = -dx * sa + dy * ca;
    Lh = Math.max(Lh, Math.abs(u));
    return [u, v];
  });
  const s = Math.sqrt(1 + (P.aspect - 1) * intensity);
  const taper = P.taper * intensity;
  const bend = P.bend * intensity;
  pts = uv.map(([u, v]) => {
    const t = u / Lh;
    let v2 = v * (1 + taper * t);
    v2 += bend * Lh * (t * t - 1 / 3);
    const u3 = u * s;
    const v3 = v2 / s;
    return [O[0] + u3 * ca - v3 * sa, O[1] + u3 * sa + v3 * ca] as Pt;
  });

  // 3. Low-gradient domain warp (Σ|a·k| < 1 keeps it injective)
  pts = pts.map((p) => {
    let dx = 0;
    let dy = 0;
    for (const w of P.waves) {
      const arg = w.kx * p[0] + w.ky * p[1] + w.phase;
      dx += w.ax * intensity * Math.sin(arg);
      dy += w.ay * intensity * Math.cos(arg * 1.07 + 0.9);
    }
    return [p[0] + dx, p[1] + dy] as Pt;
  });

  // 4. Fractal coastline texture (midpoint displacement along the normal)
  const k = P.fractalK * fractalScale;
  if (k > 0) {
    for (let it = 0; it < P.fractalDepth; it++) {
      const next: Pt[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const L = d2(a, b);
        const nx = -(b[1] - a[1]) / (L || 1);
        const ny = (b[0] - a[0]) / (L || 1);
        const off = (fractalRng() * 2 - 1) * k * L;
        next.push(a, [(a[0] + b[0]) / 2 + nx * off, (a[1] + b[1]) / 2 + ny * off]);
      }
      pts = next;
    }
  }

  // 5. Pin the place and size: renormalise area, restore the centroid
  let ring = closeRing(pts);
  const A = Math.abs(signedArea(ring));
  const C = polygonCentroid(ring);
  const sc = A > 0 ? Math.sqrt(rawA / A) : 1;
  ring = ring.map(([x, y]) => [rawC[0] + (x - C[0]) * sc, rawC[1] + (y - C[1]) * sc] as Pt);

  // 6. Longitude is periodic: NEVER clamp or squeeze X against the rectangular
  //    map edge. A point at x=-20 is simply 20 units west of the antimeridian
  //    and will later wrap to the right side of the chosen ocean seam.
  //    Latitude is not periodic, so softly contain Y at the two poles.
  const b = bboxOfRing(ring);
  const MAX_NUDGE = 25;
  const EDGE = 8;
  const MARGIN = 30;
  let sy = 0;
  if (b.minY < EDGE + MARGIN) sy = Math.min(MAX_NUDGE, EDGE + MARGIN - b.minY);
  else if (b.maxY > PLANET_HEIGHT - EDGE - MARGIN) sy = -Math.min(MAX_NUDGE, b.maxY - (PLANET_HEIGHT - EDGE - MARGIN));
  const softY = (v: number, lo: number, hi: number) => {
    const a = lo + MARGIN;
    const z = hi - MARGIN;
    if (v < a) return a - MARGIN * Math.tanh((a - v) / MARGIN);
    if (v > z) return z + MARGIN * Math.tanh((v - z) / MARGIN);
    return v;
  };
  const squeezed = ring.map(([x, y]) => [x, softY(y + sy, EDGE, PLANET_HEIGHT - EDGE)] as Pt);
  const clampLoss = rawA > 0 ? Math.max(0, 1 - Math.abs(signedArea(squeezed)) / rawA) : 0;
  return { ring: squeezed, clampLoss };
}

/** Drop the few vertices whose angle about c runs backwards → strictly star-shaped. */
function starify(pts: Pt[], c: Pt): Pt[] {
  const ang = (p: Pt) => Math.atan2(p[1] - c[1], p[0] - c[0]);
  // Orientation from the total signed turning
  let total = 0;
  for (let i = 0; i < pts.length; i++) total += angDiff(ang(pts[(i + 1) % pts.length]), ang(pts[i]));
  const dir = total >= 0 ? 1 : -1;
  const out: Pt[] = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const step = angDiff(ang(pts[i]), ang(out[out.length - 1])) * dir;
    if (step > 1e-9 && acc + step < Math.PI * 2 - 1e-6) {
      acc += step;
      out.push(pts[i]);
    }
  }
  return out.length >= 8 ? out : pts;
}

// ---------------------------------------------------------------------------
// Main pass
// ---------------------------------------------------------------------------

interface Land {
  f: MapFeature;
  ring: Pt[];
  bbox: BBox;
  areaKm2: number;
  isContinent: boolean;
}

function largestExteriorRing(geom: any): Pt[] | null {
  if (!geom) return null;
  if (geom.type === "Polygon") return geom.coordinates[0] as Pt[];
  if (geom.type === "MultiPolygon") {
    let best: Pt[] | null = null;
    let bestA = -1;
    for (const poly of geom.coordinates as Pt[][][]) {
      const a = Math.abs(signedArea(poly[0]));
      if (a > bestA) {
        bestA = a;
        best = poly[0];
      }
    }
    return best;
  }
  return null;
}

const fmtArea = (a: number) => (a < 100 ? Math.round(a * 10) / 10 : Math.round(a));

/** Find the longitude furthest from every final landmass: an ocean-only seam. */
function chooseOceanSeam(lands: Land[]): number {
  const intervals = lands.map((l) => {
    const cx = polygonCentroid(l.ring)[0];
    const r = alignRingX(l.ring, cx);
    const b = bboxOfRing(r);
    return { cx, min: b.minX, max: b.maxX };
  });
  let bestX = 0;
  let bestClearance = -Infinity;
  const samples = 1440; // quarter-degree resolution
  for (let i = 0; i < samples; i++) {
    const s = (i / samples) * PLANET_WIDTH;
    let clearance = Infinity;
    for (const it of intervals) {
      const q = s + Math.round((it.cx - s) / PLANET_WIDTH) * PLANET_WIDTH;
      const d = q < it.min ? it.min - q : q > it.max ? q - it.max : -Math.min(q - it.min, it.max - q);
      clearance = Math.min(clearance, d);
    }
    if (clearance > bestClearance) {
      bestClearance = clearance;
      bestX = s;
    }
  }
  return bestX;
}

/** Rotate a coordinate path around the cylindrical planet and keep it continuous. */
function rotatePathAtSeam(path: Pt[], seamX: number, closed: boolean): Pt[] {
  if (!path.length) return path;
  const out: Pt[] = [];
  for (let i = 0; i < path.length; i++) {
    let x = wrapWorldX(path[i][0] - seamX);
    if (i > 0) {
      while (x - out[i - 1][0] > PLANET_WIDTH / 2) x -= PLANET_WIDTH;
      while (x - out[i - 1][0] < -PLANET_WIDTH / 2) x += PLANET_WIDTH;
    }
    out.push([x, path[i][1]]);
  }
  if (closed && out.length > 1) out[out.length - 1] = [out[0][0], out[0][1]];

  // Put the path's centre in the canonical map image. Because the chosen seam
  // is ocean-only, every land ring then falls wholly inside 0..PLANET_WIDTH.
  const body = closed ? out.slice(0, -1) : out;
  const mean = body.reduce((s, p) => s + p[0], 0) / Math.max(1, body.length);
  const shift = Math.round((PLANET_WIDTH / 2 - mean) / PLANET_WIDTH) * PLANET_WIDTH;
  return out.map(([x, y]) => [x + shift, y] as Pt);
}

function geometryBBox(g: MapFeature["geometry"]): BBox {
  const flat: Pt[] = [];
  const walk = (v: any) => {
    if (Array.isArray(v) && typeof v[0] === "number") flat.push(v as Pt);
    else if (Array.isArray(v)) for (const x of v) walk(x);
  };
  walk(g.coordinates);
  return bboxOfRing(flat);
}

function rotateFeatureAtSeam(f: MapFeature, seamX: number): MapFeature {
  // A polar cap covers every longitude; rotating it changes nothing and can
  // produce a needlessly unwrapped 14,400-unit ring.
  if (f.properties.featureType === "ice_cap") return f;
  let geometry: MapFeature["geometry"];
  if (f.geometry.type === "Point") {
    const [x, y] = f.geometry.coordinates as Pt;
    geometry = { type: "Point", coordinates: [wrapWorldX(x - seamX), y] };
  } else if (f.geometry.type === "LineString") {
    geometry = { type: "LineString", coordinates: rotatePathAtSeam(f.geometry.coordinates as Pt[], seamX, false) };
  } else if (f.geometry.type === "Polygon") {
    geometry = {
      type: "Polygon",
      coordinates: (f.geometry.coordinates as Pt[][]).map((r) => rotatePathAtSeam(r, seamX, true)),
    };
  } else {
    geometry = {
      type: "MultiPolygon",
      coordinates: (f.geometry.coordinates as Pt[][][]).map((p) =>
        p.map((r) => rotatePathAtSeam(r, seamX, true))
      ),
    };
  }
  return { ...f, geometry, bbox: geometryBBox(geometry) };
}

export function finetunePlanetShapes(macro: PlanetMacro): PlanetMacro {
  const t0 = performance.now();
  const log: ConflictRecord[] = [];
  const records: ShapeLandmassRecord[] = [];
  const rawFeatures = macro.features;
  const featureById = new Map<string, MapFeature>(rawFeatures.map((f) => [f.id, f]));
  const removed = new Set<string>();
  const regionById = new Map<string, RegionDescriptor>(macro.regions.map((r) => [r.id, r]));

  const toLand = (f: MapFeature): Land => {
    const ring = f.geometry.coordinates[0] as Pt[];
    return {
      f,
      ring,
      bbox: bboxOfRing(ring),
      areaKm2: areaUnitsToKm2(Math.abs(signedArea(ring))),
      isContinent: f.properties.featureType === "continent",
    };
  };
  let lands: Land[] = rawFeatures
    .filter((f) => f.properties.featureType === "continent" || f.properties.featureType === "island")
    .map(toLand);

  // Restore any longitude that the original rectangular canvas flattened.
  // This happens entirely in finetuning; the raw generator remains unchanged.
  for (let i = 0; i < lands.length; i++) {
    const l = lands[i];
    const restored = restoreRawSeam(l.ring);
    if (restored === l.ring) continue;
    const nf: MapFeature = {
      ...l.f,
      geometry: { type: "Polygon", coordinates: [restored] },
      bbox: bboxOfRing(restored),
      properties: {
        ...l.f.properties,
        areaKm2: fmtArea(areaUnitsToKm2(Math.abs(signedArea(restored)))),
      },
    };
    featureById.set(nf.id, nf);
    lands[i] = toLand(nf);
  }

  // Ray-origin hints from the untouched raw rings (before any repair/suture)
  const originHint = new Map<string, Pt | null>();
  for (const l of lands) originHint.set(l.f.id, rayOriginEstimate(openRing(l.ring)));

  const seaCentroids: Pt[] = rawFeatures
    .filter((f) => f.properties.featureType === "sea")
    .map((f) => centroidOf(f.geometry.coordinates[0] as Pt[]));

  const replace = (id: string, ring: Pt[]) => {
    const old = featureById.get(id)!;
    const areaKm2 = areaUnitsToKm2(Math.abs(signedArea(ring)));
    const nf: MapFeature = {
      ...old,
      geometry: { type: "Polygon", coordinates: [ring] },
      bbox: bboxOfRing(ring),
      properties: { ...old.properties, areaKm2: fmtArea(areaKm2) },
    };
    featureById.set(id, nf);
    const idx = lands.findIndex((l) => l.f.id === id);
    if (idx >= 0) lands[idx] = toLand(nf);
  };

  // -------------------------------------------------------------------------
  // STEP 0 — repair raw coastlines that cross themselves (canvas clamping and
  // ray wobble can fold a raw ring onto itself)
  // -------------------------------------------------------------------------
  for (const l of [...lands]) {
    if (!ringSelfIntersects(l.ring)) continue;
    replace(l.f.id, repairRing(l.ring));
    log.push({
      kind: "erode",
      tier: 1,
      description: `The raw coastline of "${l.f.properties.name}" folded back on itself; the finetune cut the fold and kept the main landmass.`,
      relatedFeatureId: l.f.id,
      relatedFeatureName: l.f.properties.name,
    });
  }

  // Raw-vs-finetuned comparison uses the restored/repaired raw silhouettes,
  // so even the RAW view is a globe and never displays a sliced coastline.
  const rawDisplayById = new Map<string, MapFeature>(featureById);

  // -------------------------------------------------------------------------
  // STEP A — suture landmasses that already overlap in the raw pass.
  // Repeated until stable: a suture fills the sea enclosed between two
  // landmasses, which can swallow islets that must then be accreted too.
  // -------------------------------------------------------------------------
  for (let pass = 0; pass < 4; pass++) {
    const removedBefore = removed.size;
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      while (parent.get(x) !== x) x = parent.get(x)!;
      return x;
    };
    for (const l of lands) parent.set(l.f.id, l.f.id);
    for (let i = 0; i < lands.length; i++)
      for (let j = i + 1; j < lands.length; j++) {
        if (ringsIntersectGlobe(lands[i].ring, lands[j].ring)) {
          parent.set(find(lands[j].f.id), find(lands[i].f.id));
        }
      }
    const groups = new Map<string, Land[]>();
    for (const l of lands) {
      const r = find(l.f.id);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r)!.push(l);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => Number(b.isContinent) - Number(a.isContinent) || b.areaKm2 - a.areaKm2);
      const keeper = group[0];
      let merged: any = turfPolygon([keeper.ring]);
      for (const other of group.slice(1)) {
        // A small island overlapping a continent is absorbed without a union:
        // unioning it in would pinch the coast and destroy the continent's
        // star structure, which the reshape relies on.
        const absorbOnly = keeper.isContinent && !other.isContinent && other.areaKm2 < keeper.areaKm2 * 0.1;
        if (!absorbOnly) {
          try {
            const aligned = alignRingX(other.ring, polygonCentroid(keeper.ring)[0]);
            const u = union(turfFeatureCollection([merged, turfPolygon([aligned])]));
            if (u) merged = u;
          } catch {
            /* keep going: an un-unionable sliver is simply absorbed */
          }
        }
        removed.add(other.f.id);
        const continentMerge = keeper.isContinent && other.isContinent;
        records.push({
          id: other.f.id,
          name: other.f.properties.name,
          kind: other.isContinent ? "continent" : "island",
          archetype: "none",
          status: continentMerge ? "sutured" : "accreted",
          intensity: 0,
          attempts: 0,
          aspectBefore: 0,
          aspectAfter: 0,
          solidityBefore: 0,
          solidityAfter: 0,
          verticesBefore: other.ring.length,
          verticesAfter: 0,
          peninsulas: 0,
          gulfs: 0,
          centroidShiftKm: 0,
          areaChangePct: 0,
          note: `merged into ${keeper.f.properties.name}`,
        });
        log.push({
          kind: continentMerge ? "merge" : "contain",
          tier: 1,
          description: continentMerge
            ? `Continents "${keeper.f.properties.name}" and "${other.f.properties.name}" overlapped in the raw pass; the finetune sutured them into one landmass along the collision zone.`
            : `"${other.f.properties.name}" overlapped "${keeper.f.properties.name}" in the raw pass and was accreted onto its coast.`,
          relatedFeatureId: keeper.f.id,
          relatedFeatureName: keeper.f.properties.name,
        });
      }
      const ring = largestExteriorRing(merged.geometry);
      if (ring && ring.length >= 4 && ring !== keeper.ring) replace(keeper.f.id, repairRing(ring));
    }
    lands = lands.filter((l) => !removed.has(l.f.id));
    if (removed.size === removedBefore) break;
  }

  // -------------------------------------------------------------------------
  // STEP B — archetype reshape, largest first, validated against neighbours
  // -------------------------------------------------------------------------
  const archetypeUse = new Map<ShapeArchetype, number>();
  const targets = [...lands]
    .filter((l) => l.isContinent || l.areaKm2 >= ISLAND_RESHAPE_MIN_KM2)
    .sort((a, b) => Number(b.isContinent) - Number(a.isContinent) || b.areaKm2 - a.areaKm2);

  const islandCentres = lands.filter((l) => !l.isContinent).map((l) => ({ id: l.f.id, c: polygonCentroid(l.ring) }));

  for (const target of targets) {
    const id = target.f.id;
    if (removed.has(id)) continue;
    const cur = lands.find((l) => l.f.id === id);
    if (!cur) continue;
    const raw = cur.ring;
    const region = regionById.get(id);
    const rng = makeRng(`${macro.config.seed}::shape::${id}`);

    // --- archetype choice (weighted, with variety across continents) ---
    let archetype: ShapeArchetype;
    let axis = range(rng, 0, Math.PI);
    if (cur.isContinent) {
      const subduction = region?.convergentEdges.some((e) => e.type === "subduction") ?? false;
      const polar = region?.touchesPole ?? false;
      const base: [ShapeArchetype, number][] = [
        ["wedge", 3],
        ["cordillera", subduction ? 5 : 2],
        ["lobed", 3],
        ["shield", polar ? 4 : 2],
      ];
      const weighted = base.map(([a, w]) => [a, w * ((archetypeUse.get(a) ?? 0) > 0 ? 0.3 : 1)] as [ShapeArchetype, number]);
      const total = weighted.reduce((s, [, w]) => s + w, 0);
      let roll = rng() * total;
      archetype = weighted[weighted.length - 1][0];
      for (const [a, w] of weighted) {
        roll -= w;
        if (roll <= 0) {
          archetype = a;
          break;
        }
      }
      archetypeUse.set(archetype, (archetypeUse.get(archetype) ?? 0) + 1);
      // Build on the elongation the landmass already has, so stretching never
      // fights the raw shape; cordilleras follow the active margin instead
      axis = principalAxis(raw) + range(rng, -0.26, 0.26);
      const strongest = region?.convergentEdges[0];
      if (archetype === "cordillera" && strongest) axis = strongest.angle + Math.PI / 2;
    } else {
      archetype = cur.areaKm2 > 100_000 && chance(rng, 0.45) ? "block_island" : "arc_sliver";
      // Island arcs: elongate along the chain toward the nearest sister island
      const c = polygonCentroid(raw);
      let best: Pt | null = null;
      let bestD = 1200;
      for (const o of islandCentres) {
        if (o.id === id) continue;
        const d = d2(c, o.c);
        if (d < bestD) {
          bestD = d;
          best = o.c;
        }
      }
      if (best) axis = Math.atan2(best[1] - c[1], best[0] - c[0]);
    }

    const kernel = findKernel(raw, originHint.get(id));
    let R = 0;
    const rc = polygonCentroid(raw);
    const ro = openRing(raw);
    for (const p of ro) R += d2(p, rc);
    R /= ro.length;
    const params = drawParams(rng, archetype, axis, R, cur.isContinent);

    const before = shapeMetrics(raw);
    const rot = archetype === "cordillera" ? Math.PI / 7 : Math.PI / 4;
    const schedule = [
      { intensity: 1, off: 0, frac: 1 },
      { intensity: 1, off: rot, frac: 1 },
      { intensity: 1, off: -rot, frac: 1 },
      { intensity: 1, off: Math.PI / 2, frac: 1 },
      { intensity: 0.75, off: 0, frac: 1 },
      { intensity: 0.75, off: rot, frac: 1 },
      { intensity: 0.75, off: -rot, frac: 1 },
      { intensity: 0.5, off: 0, frac: 0.6 },
      { intensity: 0.5, off: Math.PI / 2, frac: 0.6 },
      { intensity: 0.3, off: 0, frac: 0 },
    ];
    // Boost steps: only reached (for continents) if nothing realistic was found
    const boost = [
      { intensity: 1.3, off: 0, frac: 1 },
      { intensity: 1.3, off: Math.PI / 2, frac: 1 },
      { intensity: 1.15, off: rot, frac: 1 },
    ];
    let foundRealistic = false;

    let accepted: Pt[] | null = null;
    let used = schedule[0];
    let attempts = 0;
    let accretedIslets: Land[] = [];
    let bestScore = -Infinity;

    for (const step of [...schedule, ...boost]) {
      if (step.intensity > 1 && (foundRealistic || !cur.isContinent)) break;
      attempts++;
      const { ring: cand, clampLoss } = applyShape(
        raw,
        params,
        kernel,
        step.intensity,
        step.off,
        step.frac,
        makeRng(`${macro.config.seed}::coast::${id}::${attempts}`),
        // Without a star kernel, only the first half of the schedule tries
        // normal-direction bumps; later attempts use the injective warps alone
        !!kernel || attempts <= 5
      );
      if (ringSelfIntersects(cand)) continue;
      let hard = false;
      const soft: Land[] = [];
      // Islands the new coast reaches may be accreted as terranes: islets
      // always, larger islands only onto a continent at least 20× their size.
      const terraneLimit = cur.isContinent ? cur.areaKm2 * 0.05 : ISLET_KM2;
      for (const o of lands) {
        if (o.f.id === id || removed.has(o.f.id)) continue;
        if (ringsIntersectGlobe(cand, o.ring)) {
          if (!o.isContinent && (o.areaKm2 < ISLET_KM2 || o.areaKm2 <= terraneLimit)) soft.push(o);
          else {
            hard = true;
            break;
          }
        }
      }
      if (hard || soft.length > 4) continue;

      let final = cand;
      const terranes = soft.filter((o) => o.areaKm2 >= ISLET_KM2);
      if (terranes.length) {
        let merged: any = turfPolygon([cand]);
        for (const t of terranes) {
          try {
            const aligned = alignRingX(t.ring, polygonCentroid(cand)[0]);
            const u = union(turfFeatureCollection([merged, turfPolygon([aligned])]));
            if (u) merged = u;
          } catch {
            /* un-unionable: treat as absorbed */
          }
        }
        const unionRing = largestExteriorRing(merged.geometry);
        if (!unionRing || unionRing.length < 4) continue;
        const ring = repairRing(unionRing);
        if (ringSelfIntersects(ring)) continue;
        final = ring;
        // The union can close off a strait: re-check everything not yet absorbed
        for (const o of lands) {
          if (o.f.id === id || removed.has(o.f.id) || soft.includes(o)) continue;
          if (ringsIntersectGlobe(final, o.ring)) {
            if (!o.isContinent && o.areaKm2 < ISLET_KM2) soft.push(o);
            else {
              hard = true;
              break;
            }
          }
        }
        if (hard) continue;
      }
      if (seaCentroids.some((sc) => pointInRingGlobe(sc, final)))
        continue;

      // Valid. Rank by realism; penalise canvas clipping, lost intensity and
      // (lightly) accreted islets. Stop early on a clearly realistic fit.
      const m = shapeMetrics(final);
      const realistic = m.aspect >= 1.3 || m.solidity <= 0.84;
      const score =
        realismScore(m) -
        clampLoss * 6 -
        (1 - step.intensity) * 0.15 -
        (soft.length - terranes.length) * 0.05 -
        terranes.length * 0.12;
      if (score > bestScore) {
        bestScore = score;
        accepted = final;
        used = step;
        accretedIslets = soft;
      }
      if (realistic) foundRealistic = true;
      if (!cur.isContinent || (realistic && clampLoss < 0.03)) break;
    }

    const info = ARCHETYPE_INFO[archetype];
    if (!accepted) {
      records.push({
        id,
        name: cur.f.properties.name,
        kind: cur.isContinent ? "continent" : "island",
        archetype,
        status: "kept_raw",
        intensity: 0,
        attempts,
        aspectBefore: before.aspect,
        aspectAfter: before.aspect,
        solidityBefore: before.solidity,
        solidityAfter: before.solidity,
        verticesBefore: raw.length,
        verticesAfter: raw.length,
        peninsulas: 0,
        gulfs: 0,
        centroidShiftKm: 0,
        areaChangePct: 0,
        note: "no candidate cleared its neighbours",
      });
      continue;
    }

    for (const islet of accretedIslets) {
      removed.add(islet.f.id);
      records.push({
        id: islet.f.id,
        name: islet.f.properties.name,
        kind: "island",
        archetype: "none",
        status: "accreted",
        intensity: 0,
        attempts: 0,
        aspectBefore: 0,
        aspectAfter: 0,
        solidityBefore: 0,
        solidityAfter: 0,
        verticesBefore: islet.ring.length,
        verticesAfter: 0,
        peninsulas: 0,
        gulfs: 0,
        centroidShiftKm: 0,
        areaChangePct: 0,
        note:
          islet.areaKm2 >= ISLET_KM2
            ? `terrane accreted onto ${cur.f.properties.name}`
            : `absorbed by the reshaped coast of ${cur.f.properties.name}`,
      });
      log.push({
        kind: "contain",
        tier: 1,
        description:
          islet.areaKm2 >= ISLET_KM2
            ? `"${islet.f.properties.name}" (${Math.round(islet.areaKm2).toLocaleString()} km²) lay in the path of the reshaped coast of "${cur.f.properties.name}" and was accreted onto it as a terrane.`
            : `Islet "${islet.f.properties.name}" was absorbed as a coastal skerry when "${cur.f.properties.name}" was reshaped.`,
        relatedFeatureId: id,
        relatedFeatureName: cur.f.properties.name,
      });
    }
    lands = lands.filter((l) => !removed.has(l.f.id));

    replace(id, accepted);
    const after = shapeMetrics(accepted);
    const shiftKm = unitsToKm(d2(polygonCentroid(raw), polygonCentroid(accepted)));
    const areaPct = ((after.areaUnits - before.areaUnits) / before.areaUnits) * 100;
    const status = used.intensity >= 1 ? "reshaped" : "softened";
    records.push({
      id,
      name: cur.f.properties.name,
      kind: cur.isContinent ? "continent" : "island",
      archetype,
      status,
      intensity: used.intensity,
      attempts,
      aspectBefore: before.aspect,
      aspectAfter: after.aspect,
      solidityBefore: before.solidity,
      solidityAfter: after.solidity,
      verticesBefore: raw.length,
      verticesAfter: accepted.length,
      peninsulas: kernel ? params.peninsulas.length : 0,
      gulfs: kernel ? params.gulfs.length : 0,
      centroidShiftKm: Math.round(shiftKm * 10) / 10,
      areaChangePct: Math.round(areaPct * 100) / 100,
    });
    if (cur.isContinent || cur.areaKm2 > 100_000) {
      log.push({
        kind: "reshape",
        tier: 1,
        description: `"${cur.f.properties.name}" reshaped as a ${info.label} (${info.analog}) at ${Math.round(used.intensity * 100)}% intensity: aspect ${before.aspect} → ${after.aspect}, solidity ${before.solidity} → ${after.solidity}, ${kernel ? params.peninsulas.length : 0} peninsulas, ${kernel ? params.gulfs.length : 0} gulfs. Centroid held within ${shiftKm.toFixed(1)} km, area within ${Math.abs(areaPct).toFixed(2)}%.`,
        relatedFeatureId: id,
        relatedFeatureName: cur.f.properties.name,
      });
    }
  }

  // -------------------------------------------------------------------------
  // STEP C — choose an ocean-only antimeridian and rotate the globe.
  // Longitude zero is arbitrary on a procedural planet. Moving the 2D seam
  // through the widest ocean gap guarantees that no landmass is sliced by the
  // left/right map boundary while preserving every relative position.
  // -------------------------------------------------------------------------
  const finalLands = lands.filter((l) => !removed.has(l.f.id));
  const rawDisplayLands = rawFeatures
    .map((f) => rawDisplayById.get(f.id) ?? f)
    .filter((f) => f.properties.featureType === "continent" || f.properties.featureType === "island")
    .map(toLand);
  // Keep the comparison view intact too: seam must be ocean in both the raw
  // restored silhouettes and the final reshaped silhouettes.
  const seamX = chooseOceanSeam([...finalLands, ...rawDisplayLands]);
  const rotationDeg = -(seamX / PLANET_WIDTH) * 360;

  const preRotate = rawFeatures.filter((f) => !removed.has(f.id)).map((f) => featureById.get(f.id)!);
  const features = preRotate.map((f) => rotateFeatureAtSeam(f, seamX));
  const rotatedById = new Map(features.map((f) => [f.id, f]));
  const rawDisplayFeatures = rawFeatures.map((f) => rotateFeatureAtSeam(rawDisplayById.get(f.id) ?? f, seamX));

  log.push({
    kind: "reshape",
    tier: 1,
    description: `Globe seam moved ${Math.abs(rotationDeg).toFixed(1)}° to the widest ocean corridor. Longitude now wraps continuously at that ocean-only antimeridian; no continent or island is cut by the 2D map edge.`,
  });

  // -------------------------------------------------------------------------
  // STEP D — republish region descriptors & stats in the rotated datum
  // -------------------------------------------------------------------------

  const regions: RegionDescriptor[] = [];
  for (const r of macro.regions) {
    if (removed.has(r.id)) continue;
    const f = rotatedById.get(r.id);
    if (!f) continue;
    const ring = f.geometry.coordinates[0] as Pt[];
    const areaUnits = Math.abs(signedArea(ring));
    const areaKm2 = areaUnitsToKm2(areaUnits);
    const sizeClass = classifyLandArea(areaKm2);
    const centre = polygonCentroid(ring);
    const bbox = bboxOfRing(ring);
    const eqY = PLANET_HEIGHT / 2;
    regions.push({
      ...r,
      outline: ring,
      bbox,
      centroid: centre,
      lon: xToLon(centre[0]),
      lat: yToLat(centre[1]),
      areaKm2: fmtArea(areaKm2),
      areaUnits,
      sizeClass,
      linearScaleKm: Math.round(Math.sqrt(areaKm2) * 10) / 10,
      detailBudget: budgetFor(areaKm2, profileFor(sizeClass)),
      climateZone: climateZoneAt(centre[1]),
      spansEquator: bbox.minY < eqY && bbox.maxY > eqY,
      touchesPole: equatorDistance(bbox.minY) > 0.86 || equatorDistance(bbox.maxY) > 0.86,
    });
  }
  regions.sort((a, b) => b.areaKm2 - a.areaKm2);

  const landF = features.filter((f) => f.properties.featureType === "continent" || f.properties.featureType === "island");
  const totalLandUnits = landF.reduce((s, f) => s + Math.abs(signedArea(f.geometry.coordinates[0] as Pt[])), 0);
  const largest = regions[0] ?? { name: "—", areaKm2: 0 };

  const reshapedRecs = records.filter((r) => r.archetype !== "none");
  const report: ShapeFinetuneReport = {
    elapsedMs: Math.round(performance.now() - t0),
    processed: reshapedRecs.length,
    reshaped: records.filter((r) => r.status === "reshaped").length,
    softened: records.filter((r) => r.status === "softened").length,
    keptRaw: records.filter((r) => r.status === "kept_raw").length,
    sutured: records.filter((r) => r.status === "sutured").length,
    accreted: records.filter((r) => r.status === "accreted").length,
    seamX,
    longitudeRotationDeg: Math.round(rotationDeg * 10) / 10,
    records,
  };

  log.push({
    kind: "reshape",
    tier: 1,
    description: `Shape finetune: ${report.reshaped} landmasses reshaped at full intensity, ${report.softened} softened to clear neighbours, ${report.keptRaw} kept raw, ${report.sutured} sutured, ${report.accreted} accreted — every place and size preserved, ${report.elapsedMs} ms.`,
  });

  return {
    ...macro,
    features,
    regions,
    rawFeatures: rawDisplayFeatures,
    plates: macro.plates.map((p) => ({
      ...p,
      center: [wrapWorldX(p.center[0] - seamX), p.center[1]] as Pt,
    })),
    shape: report,
    log: [...macro.log, ...log],
    stats: {
      ...macro.stats,
      macroFeatures: features.length,
      continents: features.filter((f) => f.properties.featureType === "continent").length,
      islands: features.filter((f) => f.properties.featureType === "island").length,
      landCoveragePercent: Math.round((totalLandUnits / (PLANET_WIDTH * PLANET_HEIGHT)) * 100),
      totalLandAreaKm2: Math.round(areaUnitsToKm2(totalLandUnits)),
      largestContinent: { name: largest.name, areaKm2: largest.areaKm2 },
      sizeClassCounts: SIZE_CLASS_ORDER.reduce((acc, c) => {
        acc[c] = regions.filter((r) => r.sizeClass === c).length;
        return acc;
      }, {} as Record<LandSizeClass, number>),
    },
  };
}
