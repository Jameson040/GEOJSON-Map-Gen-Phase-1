import type { GeneratedRegion, GenProgress } from "../types";
import type { Settlement } from "../human/human-types";
import type { ZonePopulation } from "../population/population-types";
import type { CadastreConfig, CadastreLayerResult, SettlementCadastre } from "./cadastre-types";
import { generateCadastre } from "./cadastre-generate";

// ---------------------------------------------------------------------------
// JIT CADASTRE ENGINE & LRU CACHE
//
// Enables "Google Earth for Fantasy World Lite" deep zooming without memory
// explosion: generates cadastral street networks and village house roofs
// lazily on-demand when the camera enters zoom range, deterministically.
// ---------------------------------------------------------------------------

const cadastreCache = new Map<string, SettlementCadastre>();

export function getCadastreForSettlement(
  geo: GeneratedRegion,
  settlement: Settlement,
  population?: ZonePopulation,
  config?: CadastreConfig
): SettlementCadastre {
  const cacheKey = `${geo.descriptor.id}::${settlement.id}`;
  const existing = cadastreCache.get(cacheKey);
  if (existing) return existing;

  const created = generateCadastre(geo, settlement, population, config);
  cadastreCache.set(cacheKey, created);
  return created;
}

export function hasCachedCadastre(regionId: string, settlementId: string): boolean {
  return cadastreCache.has(`${regionId}::${settlementId}`);
}

export function peekCachedCadastre(regionId: string, settlementId: string): SettlementCadastre | undefined {
  return cadastreCache.get(`${regionId}::${settlementId}`);
}

export function clearCadastreCache(regionId?: string): void {
  if (!regionId) {
    cadastreCache.clear();
    return;
  }
  const prefix = `${regionId}::`;
  for (const key of cadastreCache.keys()) {
    if (key.startsWith(prefix)) {
      cadastreCache.delete(key);
    }
  }
}

/** Batch generator for entire region (for Cascade All or Layer 5 button) */
export async function generateCadastreLayer(
  geo: GeneratedRegion,
  settlements: Settlement[],
  populations?: Map<string, ZonePopulation>,
  config?: CadastreConfig,
  onProgress?: (p: GenProgress) => void
): Promise<CadastreLayerResult> {
  const t0 = performance.now();
  const cadastres = new Map<string, SettlementCadastre>();
  const total = settlements.length;

  let totalBuildings = 0;
  let totalStreetsKm = 0;
  let totalRoofAreaM2 = 0;
  let allPassing = true;

  for (let i = 0; i < total; i++) {
    const s = settlements[i];
    const pop = populations?.get(s.id);

    if (onProgress && i % 3 === 0) {
      onProgress({
        stage: 1,
        totalStages: 1,
        stageName: `Surveying Cadastre: ${s.name} (${s.tier})`,
        percent: Math.round(((i + 1) / total) * 100),
        featuresCount: totalBuildings,
        elapsedMs: Math.round(performance.now() - t0),
      });
      // Yield to event loop
      await new Promise((r) => setTimeout(r, 0));
    }

    const c = getCadastreForSettlement(geo, s, pop, config);
    cadastres.set(s.id, c);

    totalBuildings += c.stats.totalBuildings;
    totalStreetsKm += c.stats.totalStreetLengthM / 1000;
    totalRoofAreaM2 += c.stats.totalRoofAreaM2;
    if (!c.verificationAfter.passedAll) allPassing = false;
  }

  if (onProgress) {
    onProgress({
      stage: 1,
      totalStages: 1,
      stageName: "Cadastre Complete",
      percent: 100,
      featuresCount: totalBuildings,
      elapsedMs: Math.round(performance.now() - t0),
    });
  }

  return {
    regionId: geo.descriptor.id,
    cadastres,
    stats: {
      settlementsCount: total,
      totalBuildings,
      totalStreetsKm: Math.round(totalStreetsKm * 10) / 10,
      totalRoofAreaKm2: Math.round((totalRoofAreaM2 / 1_000_000) * 100) / 100,
      allPassing,
    },
  };
}
