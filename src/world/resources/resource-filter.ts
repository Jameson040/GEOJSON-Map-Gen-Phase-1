import type {
  ResourceCategory,
  ResourceDef,
  ResourceFilterConfig,
  ResourcePresetId,
} from "./resource-types";
import { MASTER_RESOURCE_CATALOG } from "./resource-catalog";

// ---------------------------------------------------------------------------
// RESOURCE FILTER & TOGGLE ENGINE
//
// Enables worldbuilders to toggle any resource on or off:
// If a world lacks Coal, Petroleum, or Natural Gas, the generator and map
// adjust accordingly, ensuring the world still exists cleanly without them.
// Supports High Fantasy, Historical Realism, and Custom user selections.
// ---------------------------------------------------------------------------

export const DEFAULT_RESOURCE_CONFIG: ResourceFilterConfig = {
  preset: "pure_fantasy",
  includeFantasy: true,
  includeFossilFuels: false, // Default fantasy world has no coal/oil/gas (clean pre-industrial)
  includeCoal: false,
  includePetroleum: false,
  includeNaturalGas: false,
  excludedResourceIds: ["coal-bituminous", "coal-lignite", "petroleum-seep", "natural-gas"],
  abundanceMultiplier: 1.0,
};

export const RESOURCE_PRESETS: Record<
  ResourcePresetId,
  { label: string; description: string; config: Partial<ResourceFilterConfig> }
> = {
  pure_fantasy: {
    label: "Mythic Fantasy (Default)",
    description: "Rich natural earths, metals, and fantasy minerals (Mithril, Ley-crystals). Zero fossil fuels.",
    config: {
      preset: "pure_fantasy",
      includeFantasy: true,
      includeFossilFuels: false,
      includeCoal: false,
      includePetroleum: false,
      includeNaturalGas: false,
      excludedResourceIds: ["coal-bituminous", "coal-lignite", "petroleum-seep", "natural-gas"],
    },
  },
  historical_medieval: {
    label: "Historical Medieval",
    description: "Authentic Earth minerals (iron, copper, tin, clays, salts, peat). No fantasy ores, no modern fossil fuels.",
    config: {
      preset: "historical_medieval",
      includeFantasy: false,
      includeFossilFuels: false,
      includeCoal: false,
      includePetroleum: false,
      includeNaturalGas: false,
      excludedResourceIds: [
        "mithril",
        "adamantine",
        "orichalcum",
        "cold-iron",
        "dragonglass",
        "ley-crystals",
        "moonstone-mythic",
        "coal-bituminous",
        "coal-lignite",
        "petroleum-seep",
        "natural-gas",
      ],
    },
  },
  bronze_iron_age: {
    label: "Bronze & Early Iron Age",
    description: "Classic antiquity: copper, tin, gold, clays, building stone, and salt. No coal, oil, or late industrial minerals.",
    config: {
      preset: "bronze_iron_age",
      includeFantasy: false,
      includeFossilFuels: false,
      includeCoal: false,
      includePetroleum: false,
      includeNaturalGas: false,
      excludedResourceIds: [
        "nickel",
        "coal-bituminous",
        "coal-lignite",
        "petroleum-seep",
        "natural-gas",
        "mithril",
        "adamantine",
        "orichalcum",
        "cold-iron",
        "dragonglass",
        "ley-crystals",
        "moonstone-mythic",
      ],
    },
  },
  steampunk_industrial: {
    label: "Industrial / Steampunk Fantasy",
    description: "Steam-era fantasy: coal seams, petroleum seeps, and iron alongside mithril and ley-crystals.",
    config: {
      preset: "steampunk_industrial",
      includeFantasy: true,
      includeFossilFuels: true,
      includeCoal: true,
      includePetroleum: true,
      includeNaturalGas: true,
      excludedResourceIds: [],
    },
  },
  custom: {
    label: "Custom World Builder",
    description: "Individually toggle any metal, clay, stone, fuel, or fantasy mineral to match your world's lore.",
    config: {
      preset: "custom",
    },
  },
};

/**
 * Determines whether a specific resource is permitted to spawn given the active world filter config.
 */
export function isResourceActive(resource: ResourceDef, config: ResourceFilterConfig): boolean {
  // 1. Explicit exclusion list check
  if (config.excludedResourceIds.includes(resource.id)) {
    return false;
  }

  // 2. Fantasy mineral master toggle
  if (resource.isFantasy && !config.includeFantasy) {
    return false;
  }

  // 3. Fossil fuel master toggle
  if (resource.isFossilFuel) {
    if (!config.includeFossilFuels) return false;
    if (resource.id.startsWith("coal") && !config.includeCoal) return false;
    if (resource.id.includes("petroleum") && !config.includePetroleum) return false;
    if (resource.id.includes("natural-gas") && !config.includeNaturalGas) return false;
  }

  return true;
}

/**
 * Returns all active resources that can spawn under the specified configuration.
 */
export function getActiveResources(config: ResourceFilterConfig): ResourceDef[] {
  return MASTER_RESOURCE_CATALOG.filter((r) => isResourceActive(r, config));
}

/**
 * Applies a preset configuration, returning a new normalized filter config.
 */
export function applyPreset(presetId: ResourcePresetId, current: ResourceFilterConfig): ResourceFilterConfig {
  const preset = RESOURCE_PRESETS[presetId];
  if (!preset) return current;
  return {
    ...current,
    ...preset.config,
    preset: presetId,
    abundanceMultiplier: current.abundanceMultiplier,
  };
}

/**
 * Toggles a single resource on or off in custom mode.
 */
export function toggleResource(config: ResourceFilterConfig, resourceId: string, enabled: boolean): ResourceFilterConfig {
  const nextExclusions = new Set(config.excludedResourceIds);
  if (enabled) {
    nextExclusions.delete(resourceId);
  } else {
    nextExclusions.add(resourceId);
  }

  // Update specific fuel flags if toggling fuels
  const next = {
    ...config,
    preset: "custom" as ResourcePresetId,
    excludedResourceIds: Array.from(nextExclusions),
  };

  if (resourceId.startsWith("coal") && !enabled) {
    const allCoalExcluded = ["coal-bituminous", "coal-lignite"].every((id) => nextExclusions.has(id));
    if (allCoalExcluded) next.includeCoal = false;
  } else if (resourceId.startsWith("coal") && enabled) {
    next.includeCoal = true;
    next.includeFossilFuels = true;
  }

  if (resourceId === "petroleum-seep") {
    next.includePetroleum = enabled;
    if (enabled) next.includeFossilFuels = true;
  }
  if (resourceId === "natural-gas") {
    next.includeNaturalGas = enabled;
    if (enabled) next.includeFossilFuels = true;
  }

  return next;
}

/**
 * Toggles an entire category on or off.
 */
export function toggleCategory(
  config: ResourceFilterConfig,
  category: ResourceCategory,
  enabled: boolean
): ResourceFilterConfig {
  const categoryResources = MASTER_RESOURCE_CATALOG.filter((r) => r.category === category);
  const nextExclusions = new Set(config.excludedResourceIds);

  for (const r of categoryResources) {
    if (enabled) {
      nextExclusions.delete(r.id);
    } else {
      nextExclusions.add(r.id);
    }
  }

  const next: ResourceFilterConfig = {
    ...config,
    preset: "custom",
    excludedResourceIds: Array.from(nextExclusions),
  };

  if (category === "fantasy_mineral") {
    next.includeFantasy = enabled;
  }
  if (category === "fuel_energy") {
    next.includeFossilFuels = enabled;
    next.includeCoal = enabled;
    next.includePetroleum = enabled;
    next.includeNaturalGas = enabled;
  }

  return next;
}
