// Deterministic seeded PRNG (mulberry32) + small helpers.
// Kept dependency-free so a given seed always reproduces the same world.

export type RNG = () => number;

export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): RNG {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed: string): RNG {
  return mulberry32(hashSeed(seed));
}

export const range = (rng: RNG, min: number, max: number) => min + rng() * (max - min);
export const irange = (rng: RNG, min: number, max: number) => Math.floor(range(rng, min, max + 1));
export const chance = (rng: RNG, p: number) => rng() < p;
export function choice<T>(rng: RNG, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
export function weightedChoice<T>(rng: RNG, items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r <= 0) return item;
  }
  return items[items.length - 1][0];
}

// A cheap "Fourier blob" pseudo-noise: sum of harmonics with random phase/amplitude.
// Produces organic radial silhouettes without needing an external noise library.
export function makeRadialNoise(rng: RNG, harmonics = 6) {
  const terms = Array.from({ length: harmonics }, (_, i) => ({
    freq: i + 2,
    amp: range(rng, 0.12, 0.42) / (i + 1.4),
    phase: range(rng, 0, Math.PI * 2),
  }));
  return (angle: number) => terms.reduce((s, t) => s + t.amp * Math.sin(t.freq * angle + t.phase), 0);
}
