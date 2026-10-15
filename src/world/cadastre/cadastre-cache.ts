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
//
// CACHE CORRECTNESS (see PROJECT_ANALYSIS.md §5.1.1): the key fingerprints
// everything a cadastre is a function of — the region, the settlement, the
// population model that sizes roofs, and the cadastre config. The frozen
// generators restart their ID counters on every run, so settlement IDs alone
// are NOT sufficient: a regenerated human layer reuses ids like "set_1" and
// would otherwise be served the previous generation's streets. Higher layers
// therefore also call clearCadastreCache(regionId) whenever the inputs a
// cadastre depends on are regenerated or unloaded.
// ---------------------------------------------------------------------------

const cadastreCache = new Map<string, SettlementCadastre>();

/** Deterministic fingerprint of the population model that scales a cadastre. */
function populationFingerprint(population?: ZonePopulation): string {
  if (!population) return "none";
  return `${population.occupancy}:${population.hardCap}`;
}

/** Deterministic fingerprint of the cadastre generation config. */
function configFingerprint(config?: CadastreConfig): string {
  if (!config) return "default";
  return `${config.buildingDensity}:${config.roofPitchMultiplier}:${config.customSeed ?? ""}:${config.forceMorphology ?? ""}:${config.enableDefensiveWalls ?? ""}`;
}

/**
 * Full cache key. Pure and exported so tests can assert that different
 * population models or configs can never collide onto one cached cadastre.
 */
export function cadastreCacheKey(
  regionId: string,
  settlementId: string,
  population?: ZonePopulation,
  config?: CadastreConfig
): string {
  return `${regionId}::${settlementId}::${populationFingerprint(population)}::${configFingerprint(config)}`;
}

export function getCadastreForSettlement(
  geo: GeneratedRegion,
  settlement: Settlement,
  population?: ZonePopulation,
  config?: CadastreConfig
): SettlementCadastre {
  const cacheKey = cadastreCacheKey(geo.descriptor.id, settlement.id, population, config);
  const existing = cadastreCache.get(cacheKey);
  if (existing) return existing;

  const created = generateCadastre(geo, settlement, population, config);
  cadastreCache.set(cacheKey, created);
  return created;
}

/** True when this settlement is cached for exactly these population + config inputs. */
export function hasCachedCadastre(
  regionId: string,
  settlementId: string,
  population?: ZonePopulation,
  config?: CadastreConfig
): boolean {
  return cadastreCache.has(cadastreCacheKey(regionId, settlementId, population, config));
}

export function peekCachedCadastre(
  regionId: string,
  settlementId: string,
  population?: ZonePopulation,
  config?: CadastreConfig
): SettlementCadastre | undefined {
  return cadastreCache.get(cadastreCacheKey(regionId, settlementId, population, config));
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

/** Number of resident cache entries (diagnostics & tests). */
export function cadastreCacheSize(): number {
  return cadastreCache.size;
}

/** Batch generator for entire region (for Cascade All or Layer 7 button) */
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
