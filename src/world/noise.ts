/**
 * Deterministic, stateless value noise for derived math layers
 * (heightfields, cost surfaces). Hashing cell coordinates with the region
 * seed means no RNG stream is consumed and no call order matters — the same
 * cell always yields the same value, in any process, on any retry.
 */
export function cellNoise(col: number, row: number, seed: string): number {
  let h = (2166136261 ^ (col * 374761393) ^ (row * 668265263)) >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h ^ seed.charCodeAt(i)) * 16777619) >>> 0;
  }
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return (h ^ (h >>> 16)) / 4294967296;
}
