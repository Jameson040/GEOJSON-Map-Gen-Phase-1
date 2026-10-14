import type { FeatureType, Pt } from "../types";

// ---------------------------------------------------------------------------
// MASTER RESOURCE DOMAINS & GEOLOGICAL ORIGIN
//
// Defines categories for natural earths, metals, stones, salts, fuels, gems,
// and the fantasy add-on (mithril, adamantine, orichalcum, ley-crystals).
// Includes full support for user toggles (e.g. absent coal/oil/gas).
// ---------------------------------------------------------------------------

export type ResourceCategory =
  | "metal_ore"
  | "clay_earth"
  | "stone_masonry"
  | "salt_chemical"
  | "fuel_energy"
  | "gem_lapidary"
  | "fantasy_mineral";

export type ResourceDomain = "natural" | "fossil" | "fantasy";

export type ResourceRarity = "abundant" | "common" | "uncommon" | "rare" | "mythic";

export type GeologicalOrigin =
  | "hydrothermal_vein"
  | "plutonic_intrusive"
  | "alluvial_placer"
  | "sedimentary_basin"
  | "weathered_floodplain"
  | "evaporite_lacustrine"
  | "volcanic_fumarole"
  | "metamorphic_belt"
  | "biogenic_bog"
  | "meteoritic_impact"
  | "leyline_fracture";

export interface GeologicalSpawnRules {
  /** Geographic map features where this deposit can form */
  featureTypes?: FeatureType[];
  minElevationM?: number;
  maxElevationM?: number;
  /** Restrict to specific biome classifications */
  biomes?: string[];
  /** Requires proximity to an active or dormant volcano */
  volcanicOnly?: boolean;
  /** Requires proximity to fresh water rivers within this many km */
  riverProximityKm?: number;
  /** Requires proximity to lakes within this many km */
  lakeProximityKm?: number;
  /** Requires coastal shoreline within this many km */
  coastProximityKm?: number;
  /** Requires proximity to fault/rift valley tectonics */
  faultZoneOnly?: boolean;
  /** Requires water-logged wetland/peat/bog terrain */
  wetlandOnly?: boolean;
  /** Requires arid drylands (desert/shrubland/savanna) */
  aridOnly?: boolean;
}

export interface ResourceDef {
  id: string;
  name: string;
  mineralOrCommonName: string;
  category: ResourceCategory;
  domain: ResourceDomain;
  rarity: ResourceRarity;
  origin: GeologicalOrigin;
  glyph: string;
  color: string;
  description: string;
  /** Economic and technical roles this resource satisfies in settlement production */
  humanUses: string[];
  /** Natural scientific or fantasy geological rules */
  geologicalRules: GeologicalSpawnRules;
  /** Default enabled state in standard fantasy world setup */
  defaultEnabled: boolean;
  /** If true, this is a fossil fuel (Coal, Lignite, Petroleum, Natural Gas) */
  isFossilFuel?: boolean;
  /** If true, this is a fantasy/mythic add-on (Mithril, Adamantine, Ley-crystals) */
  isFantasy?: boolean;
}

export type ResourcePresetId =
  | "pure_fantasy"
  | "historical_medieval"
  | "bronze_iron_age"
  | "steampunk_industrial"
  | "custom";

export interface ResourceFilterConfig {
  preset: ResourcePresetId;
  /** Master switch: enable/disable mythic fantasy minerals (Mithril, Ley-crystals, etc.) */
  includeFantasy: boolean;
  /** Master switch: enable/disable all fossil fuels (Coal, Lignite, Crude Oil, Natural Gas) */
  includeFossilFuels: boolean;
  /** Specific fuel toggles for fine-grained world crafting */
  includeCoal: boolean;
  includePetroleum: boolean;
  includeNaturalGas: boolean;
  /** Granular set of specifically excluded resource IDs */
  excludedResourceIds: string[];
  /** Mineral deposit abundance scale factor (0.5 sparse .. 2.0 rich) */
  abundanceMultiplier: number;
  customSeed?: string;
}

export interface ResourceDepositNode {
  id: string;
  resourceId: string;
  name: string;
  glyph: string;
  category: ResourceCategory;
  domain: ResourceDomain;
  point: Pt;
  abundance: 1 | 2 | 3; // 1 = minor outcrop, 2 = rich lode, 3 = mother lode
  radiusUnits: number;
  yieldEstimate: string;
  geologicalContext: string;
  compartmentId: number;
}

export interface ResourceLayerResult {
  regionId: string;
  regionName: string;
  config: ResourceFilterConfig;
  deposits: ResourceDepositNode[];
  rawDeposits: ResourceDepositNode[];
  stats: {
    totalDeposits: number;
    metalsCount: number;
    claysCount: number;
    stonesCount: number;
    saltsCount: number;
    fuelsCount: number;
    gemsCount: number;
    fantasyCount: number;
    activeCatalogSize: number;
    excludedCatalogSize: number;
  };
  generatedAt: string;
}
