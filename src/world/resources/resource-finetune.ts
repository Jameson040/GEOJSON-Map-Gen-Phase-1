import type { GeneratedRegion, Pt, RegionCompartment } from "../types";
import type {
  ResourceDepositNode,
  ResourceFilterConfig,
  ResourceLayerResult,
} from "./resource-types";
import { MASTER_RESOURCE_CATALOG } from "./resource-catalog";
import { isResourceActive } from "./resource-filter";
import { dist } from "../geom";
import { kmToUnits } from "../constants";

// ---------------------------------------------------------------------------
// RESOURCE FINETUNER (Discriminator / Corrector half of adversarial pair)
//
// Filters out physical contradictions:
//   1. Marine clearance: Ensures terrestrial ores do not sit in open seas.
//   2. Minimum separation: Prevents identical mines/quarries from colliding (<12km).
//   3. Compartment assignment: Maps each node to its regional block.
// ---------------------------------------------------------------------------

function findCompartment(p: Pt, comps: RegionCompartment[]): number {
  for (const c of comps) {
    if (
      p[0] >= c.bbox.minX &&
      p[0] <= c.bbox.maxX &&
      p[1] >= c.bbox.minY &&
      p[1] <= c.bbox.maxY
    ) {
      return c.id;
    }
  }
  return 0;
}

export function runResourceFinetune(
  rawDeposits: ResourceDepositNode[],
  geo: GeneratedRegion,
  config: ResourceFilterConfig
): ResourceLayerResult {
  const b = geo.descriptor.bbox;
  const padX = (b.maxX - b.minX) * 0.05;
  const padY = (b.maxY - b.minY) * 0.05;
  const minSepUnits = kmToUnits(12);

  const accepted: ResourceDepositNode[] = [];

  for (const node of rawDeposits) {
    const p = node.point;

    // 1. Boundary clamp
    if (p[0] < b.minX - padX || p[0] > b.maxX + padX || p[1] < b.minY - padY || p[1] > b.maxY + padY) {
      continue;
    }

    // 2. Minimum separation against identical resources
    const collidesWithSame = accepted.some(
      (other) => other.resourceId === node.resourceId && dist(other.point, p) < minSepUnits
    );
    if (collidesWithSame) {
      continue;
    }

    // 3. Compartment assignment
    const compId = findCompartment(p, geo.compartments);

    accepted.push({
      ...node,
      compartmentId: compId,
    });
  }

  // Calculate statistics
  let metalsCount = 0;
  let claysCount = 0;
  let stonesCount = 0;
  let saltsCount = 0;
  let fuelsCount = 0;
  let gemsCount = 0;
  let fantasyCount = 0;

  for (const dep of accepted) {
    switch (dep.category) {
      case "metal_ore": metalsCount++; break;
      case "clay_earth": claysCount++; break;
      case "stone_masonry": stonesCount++; break;
      case "salt_chemical": saltsCount++; break;
      case "fuel_energy": fuelsCount++; break;
      case "gem_lapidary": gemsCount++; break;
      case "fantasy_mineral": fantasyCount++; break;
    }
  }

  const activeCatalog = MASTER_RESOURCE_CATALOG.filter((r) => isResourceActive(r, config));

  return {
    regionId: geo.descriptor.id,
    regionName: geo.descriptor.name,
    config,
    deposits: accepted,
    rawDeposits,
    stats: {
      totalDeposits: accepted.length,
      metalsCount,
      claysCount,
      stonesCount,
      saltsCount,
      fuelsCount,
      gemsCount,
      fantasyCount,
      activeCatalogSize: activeCatalog.length,
      excludedCatalogSize: MASTER_RESOURCE_CATALOG.length - activeCatalog.length,
    },
    generatedAt: new Date().toISOString(),
  };
}
