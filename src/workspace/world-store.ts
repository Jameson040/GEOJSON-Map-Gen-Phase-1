import { useCallback, useRef, useState } from "react";
import type { GeneratedRegion } from "../world/types";
import type { ResourceLayerResult } from "../world/resources";
import type { BioLayerResult } from "../world/bio/bio-types";
import type { HumanLayerResult } from "../world/human/human-types";
import type { PopulationLayerResult } from "../world/population/population-types";
import type { RouteLayerResult } from "../world/routes";
import type { CadastreLayerResult } from "../world/cadastre/cadastre-types";
import type { SpatialGrid } from "../world/spatial-index";
import { layerConsumers, type WorldLayerId } from "../world/layers";
import { clearCadastreCache } from "../world/cadastre/cadastre-cache";
import { evictRegionIndexes, withoutRegion } from "./lifecycle";

// ---------------------------------------------------------------------------
// WORLD LAYER STORE
//
// Single owner of the seven per-region layer maps. Every invalidation in the
// workspace flows through here and is derived from the WORLD_LAYERS registry
// (layerConsumers), so adding a layer or an input edge can no longer leave a
// hand-written eviction behind somewhere in App.tsx — the class of bug where
// a regenerated human layer kept serving the previous generation's cached
// cadastre cannot recur.
//
// Invalidation semantics (unchanged from the audited behaviour, plus two
// deliberate repairs — see PROJECT_ANALYSIS.md §5.1.1/§5.2.1):
//   • setting geo/human clears that region's JIT cadastre cache (settlement
//     IDs restart per generation and would otherwise collide),
//   • regenerating population now evicts the cadastre layer (roofs scale with
//     occupancy),
//   • a whole-planet reset now clears routes and cadastres too (region IDs
//     restart per planet and previously leaked across planets).
// ---------------------------------------------------------------------------

export interface WorldLayerMaps {
  geo: Map<string, GeneratedRegion>;
  resource: Map<string, ResourceLayerResult>;
  bio: Map<string, BioLayerResult>;
  human: Map<string, HumanLayerResult>;
  population: Map<string, PopulationLayerResult>;
  routes: Map<string, RouteLayerResult>;
  cadastre: Map<string, CadastreLayerResult>;
}

/** The single-region result type of each layer (the value stored in the maps). */
export type WorldLayerResult = {
  geo: GeneratedRegion;
  resource: ResourceLayerResult;
  bio: BioLayerResult;
  human: HumanLayerResult;
  population: PopulationLayerResult;
  routes: RouteLayerResult;
  cadastre: CadastreLayerResult;
};

const EMPTY_MAPS = (): WorldLayerMaps => ({
  geo: new Map(),
  resource: new Map(),
  bio: new Map(),
  human: new Map(),
  population: new Map(),
  routes: new Map(),
  cadastre: new Map(),
});

function withLayerSet<K extends WorldLayerId>(
  maps: WorldLayerMaps,
  regionId: string,
  layer: K,
  result: WorldLayerResult[K]
): WorldLayerMaps {
  // Per-case casts are sound: layer and result are bound to the same K at every call site.
  const next = { ...maps };
  switch (layer) {
    case "geo":
      next.geo = new Map(maps.geo).set(regionId, result as GeneratedRegion);
      break;
    case "resource":
      next.resource = new Map(maps.resource).set(regionId, result as ResourceLayerResult);
      break;
    case "bio":
      next.bio = new Map(maps.bio).set(regionId, result as BioLayerResult);
      break;
    case "human":
      next.human = new Map(maps.human).set(regionId, result as HumanLayerResult);
      break;
    case "population":
      next.population = new Map(maps.population).set(regionId, result as PopulationLayerResult);
      break;
    case "routes":
      next.routes = new Map(maps.routes).set(regionId, result as RouteLayerResult);
      break;
    case "cadastre":
      next.cadastre = new Map(maps.cadastre).set(regionId, result as CadastreLayerResult);
      break;
  }
  return next;
}

function withLayerRemoved(maps: WorldLayerMaps, regionId: string, layer: WorldLayerId): WorldLayerMaps {
  const next = { ...maps };
  switch (layer) {
    case "geo":
      next.geo = withoutRegion(maps.geo, regionId);
      break;
    case "resource":
      next.resource = withoutRegion(maps.resource, regionId);
      break;
    case "bio":
      next.bio = withoutRegion(maps.bio, regionId);
      break;
    case "human":
      next.human = withoutRegion(maps.human, regionId);
      break;
    case "population":
      next.population = withoutRegion(maps.population, regionId);
      break;
    case "routes":
      next.routes = withoutRegion(maps.routes, regionId);
      break;
    case "cadastre":
      next.cadastre = withoutRegion(maps.cadastre, regionId);
      break;
  }
  return next;
}

export function useWorldLayers() {
  const [maps, setMaps] = useState<WorldLayerMaps>(EMPTY_MAPS);
  const grids = useRef<Map<string, SpatialGrid>>(new Map());

  /** Store one region's layer result. */
  const setLayer = useCallback(<K extends WorldLayerId>(regionId: string, layer: K, result: WorldLayerResult[K]) => {
    setMaps((prev) => withLayerSet(prev, regionId, layer, result));
    if (layer === "geo") {
      // New geography: every spatial view index for this region is obsolete.
      evictRegionIndexes(grids.current, regionId);
      // Settlement IDs restart per generation — cached cadastres must not survive.
      clearCadastreCache(regionId);
    }
    if (layer === "human") {
      // New settlements carry the same IDs as the previous generation.
      clearCadastreCache(regionId);
    }
  }, []);

  /**
   * Evict every layer that (transitively) consumes `layer` for this region.
   * Driven by the registry: layerConsumers() walks dependsOn + refreshesFrom.
   */
  const invalidateAbove = useCallback((regionId: string, layer: WorldLayerId) => {
    const consumers = layerConsumers(layer);
    if (!consumers.length) return;
    setMaps((prev) => {
      let next = prev;
      for (const consumer of consumers) {
        if (!next[consumer].has(regionId)) continue;
        next = withLayerRemoved(next, regionId, consumer);
      }
      return next;
    });
    if (consumers.includes("human") || consumers.includes("geo")) {
      // Settlement identity changes downstream of a geography/biosphere rerun.
      clearCadastreCache(regionId);
    }
  }, []);

  /** Remove one layer result for one region (e.g. clearing the population layer). */
  const removeLayer = useCallback((regionId: string, layer: WorldLayerId) => {
    setMaps((prev) => (prev[layer].has(regionId) ? withLayerRemoved(prev, regionId, layer) : prev));
  }, []);

  /** Remove a region and every layer, index and cached cadastre it owns. */
  const unloadRegion = useCallback((regionId: string) => {
    setMaps((prev) => {
      let next = prev;
      for (const layer of Object.keys(prev) as WorldLayerId[]) {
        if (next[layer].has(regionId)) next = withLayerRemoved(next, regionId, layer);
      }
      return next;
    });
    evictRegionIndexes(grids.current, regionId);
    clearCadastreCache(regionId);
  }, []);

  /** New planet: clear every region, layer, index and cached cadastre. */
  const clearAll = useCallback(() => {
    setMaps(EMPTY_MAPS());
    grids.current.clear();
    clearCadastreCache();
  }, []);

  /** Restore: replace the whole layer state at once (never regenerates). */
  const replaceAll = useCallback((next: Partial<WorldLayerMaps>) => {
    const empty = EMPTY_MAPS();
    setMaps({
      geo: next.geo ?? empty.geo,
      resource: next.resource ?? empty.resource,
      bio: next.bio ?? empty.bio,
      human: next.human ?? empty.human,
      population: next.population ?? empty.population,
      routes: next.routes ?? empty.routes,
      cadastre: next.cadastre ?? empty.cadastre,
    });
    grids.current.clear();
    clearCadastreCache();
  }, []);

  return {
    maps,
    // Drop-in aliases for the previous individual states, so read sites don't churn.
    regionDetail: maps.geo,
    resourceLayers: maps.resource,
    bioLayers: maps.bio,
    humanLayers: maps.human,
    popLayers: maps.population,
    routeLayers: maps.routes,
    cadastreLayers: maps.cadastre,
    grids,
    setLayer,
    invalidateAbove,
    removeLayer,
    unloadRegion,
    clearAll,
    replaceAll,
  };
}
