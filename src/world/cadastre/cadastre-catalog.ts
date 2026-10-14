import type { SettlementTier } from "../human/human-types";
import type { BuildingFunction, RoofMaterial, RoofType, StreetSurface } from "./cadastre-types";

// ---------------------------------------------------------------------------
// CADASTRE CATALOG & ARCHITECTURAL STYLES
//
// Defines scale footprints, dimensions, stories, roof pitches, and sun-shaded
// palettes for fantasy micro-urbanism down to individual village houses.
// ---------------------------------------------------------------------------

export interface TierCadastreProfile {
  radiusM: number;
  buildingCount: [number, number];
  primaryStreetWidthM: number;
  secondaryStreetWidthM: number;
  alleyWidthM: number;
  streetSurface: StreetSurface;
  buildingMix: { type: BuildingFunction; weight: number }[];
}

export const TIER_CADASTRE_PROFILES: Record<SettlementTier, TierCadastreProfile> = {
  nomadic: {
    radiusM: 55,
    buildingCount: [6, 12],
    primaryStreetWidthM: 4.5,
    secondaryStreetWidthM: 3.0,
    alleyWidthM: 2.0,
    streetSurface: "dirt",
    buildingMix: [
      { type: "cottage", weight: 4 },
      { type: "hovel", weight: 3 },
      { type: "barn", weight: 2 },
      { type: "market_stall", weight: 3 },
    ],
  },
  hamlet: {
    radiusM: 95,
    buildingCount: [16, 28],
    primaryStreetWidthM: 5.5,
    secondaryStreetWidthM: 3.5,
    alleyWidthM: 2.5,
    streetSurface: "dirt",
    buildingMix: [
      { type: "cottage", weight: 10 },
      { type: "hovel", weight: 4 },
      { type: "farmhouse", weight: 5 },
      { type: "barn", weight: 4 },
      { type: "cattle_shed", weight: 3 },
      { type: "inn", weight: 1 },
      { type: "chapel", weight: 1 },
      { type: "blacksmith", weight: 1 },
      { type: "storehouse", weight: 2 },
    ],
  },
  village: {
    radiusM: 175,
    buildingCount: [40, 75],
    primaryStreetWidthM: 7.0,
    secondaryStreetWidthM: 4.5,
    alleyWidthM: 3.0,
    streetSurface: "gravel",
    buildingMix: [
      { type: "cottage", weight: 20 },
      { type: "hovel", weight: 8 },
      { type: "farmhouse", weight: 10 },
      { type: "manor", weight: 2 },
      { type: "barn", weight: 7 },
      { type: "cattle_shed", weight: 5 },
      { type: "inn", weight: 2 },
      { type: "tavern", weight: 2 },
      { type: "blacksmith", weight: 2 },
      { type: "temple", weight: 1 },
      { type: "chapel", weight: 1 },
      { type: "watermill", weight: 1 },
      { type: "windmill", weight: 1 },
      { type: "storehouse", weight: 4 },
      { type: "market_stall", weight: 6 },
    ],
  },
  town: {
    radiusM: 290,
    buildingCount: [95, 170],
    primaryStreetWidthM: 9.0,
    secondaryStreetWidthM: 5.5,
    alleyWidthM: 3.5,
    streetSurface: "cobblestone",
    buildingMix: [
      { type: "cottage", weight: 30 },
      { type: "hovel", weight: 15 },
      { type: "farmhouse", weight: 6 },
      { type: "manor", weight: 6 },
      { type: "inn", weight: 4 },
      { type: "tavern", weight: 4 },
      { type: "barn", weight: 4 },
      { type: "cattle_shed", weight: 4 },
      { type: "blacksmith", weight: 4 },
      { type: "temple", weight: 2 },
      { type: "chapel", weight: 1 },
      { type: "townhall", weight: 1 },
      { type: "tower", weight: 2 },
      { type: "storehouse", weight: 12 },
      { type: "market_stall", weight: 16 },
    ],
  },
  city: {
    radiusM: 460,
    buildingCount: [200, 340],
    primaryStreetWidthM: 11.0,
    secondaryStreetWidthM: 6.5,
    alleyWidthM: 3.8,
    streetSurface: "paved_stone",
    buildingMix: [
      { type: "cottage", weight: 55 },
      { type: "hovel", weight: 25 },
      { type: "manor", weight: 16 },
      { type: "inn", weight: 6 },
      { type: "tavern", weight: 8 },
      { type: "blacksmith", weight: 8 },
      { type: "temple", weight: 3 },
      { type: "cathedral", weight: 1 },
      { type: "townhall", weight: 1 },
      { type: "keep", weight: 1 },
      { type: "tower", weight: 6 },
      { type: "storehouse", weight: 25 },
      { type: "market_stall", weight: 30 },
      { type: "cattle_shed", weight: 4 },
      { type: "farmhouse", weight: 4 },
    ],
  },
  metropolis: {
    radiusM: 680,
    buildingCount: [380, 600],
    primaryStreetWidthM: 14.0,
    secondaryStreetWidthM: 7.5,
    alleyWidthM: 4.0,
    streetSurface: "paved_stone",
    buildingMix: [
      { type: "cottage", weight: 85 },
      { type: "hovel", weight: 45 },
      { type: "manor", weight: 32 },
      { type: "inn", weight: 12 },
      { type: "tavern", weight: 14 },
      { type: "blacksmith", weight: 14 },
      { type: "temple", weight: 6 },
      { type: "cathedral", weight: 2 },
      { type: "townhall", weight: 2 },
      { type: "keep", weight: 2 },
      { type: "tower", weight: 12 },
      { type: "storehouse", weight: 50 },
      { type: "market_stall", weight: 50 },
      { type: "cattle_shed", weight: 6 },
      { type: "farmhouse", weight: 6 },
    ],
  },
};

export interface BuildingDimensionProfile {
  lengthRangeM: [number, number];
  widthRangeM: [number, number];
  heightRangeM: [number, number];
  stories: number;
  roofType: RoofType;
  defaultPitchDeg: number;
}

export const BUILDING_DIMENSIONS: Record<BuildingFunction, BuildingDimensionProfile> = {
  cottage: {
    lengthRangeM: [8, 13],
    widthRangeM: [5.5, 8],
    heightRangeM: [4.5, 6.0],
    stories: 1,
    roofType: "gable",
    defaultPitchDeg: 45,
  },
  farmhouse: {
    lengthRangeM: [12, 17],
    widthRangeM: [7, 10],
    heightRangeM: [6.0, 7.5],
    stories: 2,
    roofType: "gable",
    defaultPitchDeg: 45,
  },
  manor: {
    lengthRangeM: [18, 26],
    widthRangeM: [10, 15],
    heightRangeM: [8.0, 11.0],
    stories: 3,
    roofType: "hip",
    defaultPitchDeg: 48,
  },
  barn: {
    lengthRangeM: [14, 22],
    widthRangeM: [8, 12],
    heightRangeM: [6.5, 8.5],
    stories: 1,
    roofType: "gable",
    defaultPitchDeg: 50,
  },
  blacksmith: {
    lengthRangeM: [9, 13],
    widthRangeM: [6.5, 9],
    heightRangeM: [4.5, 5.5],
    stories: 1,
    roofType: "gable",
    defaultPitchDeg: 42,
  },
  tavern: {
    lengthRangeM: [14, 19],
    widthRangeM: [9, 12],
    heightRangeM: [7.0, 9.0],
    stories: 2,
    roofType: "gable",
    defaultPitchDeg: 45,
  },
  watermill: {
    lengthRangeM: [12, 16],
    widthRangeM: [8, 11],
    heightRangeM: [6.5, 8.5],
    stories: 2,
    roofType: "gable",
    defaultPitchDeg: 45,
  },
  windmill: {
    lengthRangeM: [8, 11],
    widthRangeM: [8, 11],
    heightRangeM: [11.0, 15.0],
    stories: 3,
    roofType: "tower_conical",
    defaultPitchDeg: 55,
  },
  chapel: {
    lengthRangeM: [16, 24],
    widthRangeM: [9, 13],
    heightRangeM: [9.0, 13.0],
    stories: 2,
    roofType: "gable",
    defaultPitchDeg: 52,
  },
  cathedral: {
    lengthRangeM: [34, 52],
    widthRangeM: [18, 26],
    heightRangeM: [18.0, 26.0],
    stories: 4,
    roofType: "gable",
    defaultPitchDeg: 58,
  },
  townhall: {
    lengthRangeM: [20, 30],
    widthRangeM: [12, 17],
    heightRangeM: [10.0, 14.0],
    stories: 3,
    roofType: "hip",
    defaultPitchDeg: 50,
  },
  keep: {
    lengthRangeM: [24, 34],
    widthRangeM: [22, 30],
    heightRangeM: [18.0, 26.0],
    stories: 4,
    roofType: "hip",
    defaultPitchDeg: 35,
  },
  tower: {
    lengthRangeM: [7, 10],
    widthRangeM: [7, 10],
    heightRangeM: [13.0, 19.0],
    stories: 4,
    roofType: "tower_conical",
    defaultPitchDeg: 62,
  },
  storehouse: {
    lengthRangeM: [14, 22],
    widthRangeM: [8, 12],
    heightRangeM: [5.5, 7.5],
    stories: 2,
    roofType: "gable",
    defaultPitchDeg: 42,
  },
  market_stall: {
    lengthRangeM: [4, 6],
    widthRangeM: [3, 4.5],
    heightRangeM: [2.8, 3.5],
    stories: 1,
    roofType: "gable",
    defaultPitchDeg: 30,
  },
  well: {
    lengthRangeM: [3.5, 4.5],
    widthRangeM: [3.5, 4.5],
    heightRangeM: [2.2, 3.2],
    stories: 1,
    roofType: "thatched_round",
    defaultPitchDeg: 28,
  },
  inn: {
    lengthRangeM: [20, 28],
    widthRangeM: [12, 17],
    heightRangeM: [8.0, 11.0],
    stories: 2,
    roofType: "hip",
    defaultPitchDeg: 46,
  },
  temple: {
    lengthRangeM: [24, 36],
    widthRangeM: [13, 19],
    heightRangeM: [12.0, 17.0],
    stories: 3,
    roofType: "gable",
    defaultPitchDeg: 54,
  },
  cattle_shed: {
    lengthRangeM: [14, 22],
    widthRangeM: [7, 10],
    heightRangeM: [4.5, 6.0],
    stories: 1,
    roofType: "gable",
    defaultPitchDeg: 40,
  },
  hovel: {
    lengthRangeM: [6, 9],
    widthRangeM: [4.5, 6.5],
    heightRangeM: [3.5, 4.5],
    stories: 1,
    roofType: "gable",
    defaultPitchDeg: 42,
  },
};

/** Roof Material Color Palette with Directional Shading (NW Sun Vector) */
export interface RoofMaterialPalette {
  material: RoofMaterial;
  baseHex: string;
  sunlitHex: string;   // NW facing slope
  shadedHex: string;   // SE facing slope
  ridgeHex: string;    // Ridge line highlight
  shadowRgba: string;  // Ground cast shadow
  description: string;
}

export const ROOF_MATERIAL_PALETTES: Record<RoofMaterial, RoofMaterialPalette> = {
  thatch: {
    material: "thatch",
    baseHex: "#b89047",
    sunlitHex: "#dbb266",
    shadedHex: "#8f6c31",
    ridgeHex: "#f0cb7d",
    shadowRgba: "rgba(35, 26, 12, 0.42)",
    description: "Golden straw & reed thatch",
  },
  slate: {
    material: "slate",
    baseHex: "#374151",
    sunlitHex: "#546275",
    shadedHex: "#222933",
    ridgeHex: "#708199",
    shadowRgba: "rgba(18, 22, 28, 0.46)",
    description: "Quarried dark blue-grey alpine slate",
  },
  terracotta: {
    material: "terracotta",
    baseHex: "#b4532a",
    sunlitHex: "#d96f43",
    shadedHex: "#8a3c1c",
    ridgeHex: "#f28557",
    shadowRgba: "rgba(38, 16, 8, 0.44)",
    description: "Fired red clay barrel tiles",
  },
  cedar_shingle: {
    material: "cedar_shingle",
    baseHex: "#785338",
    sunlitHex: "#996d4b",
    shadedHex: "#543722",
    ridgeHex: "#b8855e",
    shadowRgba: "rgba(28, 18, 11, 0.43)",
    description: "Weathered split-cedar wood shakes",
  },
  copper_verdigris: {
    material: "copper_verdigris",
    baseHex: "#357a6e",
    sunlitHex: "#4ea393",
    shadedHex: "#24524a",
    ridgeHex: "#68c4b2",
    shadowRgba: "rgba(12, 28, 25, 0.48)",
    description: "Patinated green oxidized copper",
  },
  timber: {
    material: "timber",
    baseHex: "#524032",
    sunlitHex: "#6e5744",
    shadedHex: "#38291d",
    ridgeHex: "#8a6e57",
    shadowRgba: "rgba(20, 15, 10, 0.45)",
    description: "Rough-hewn dark spruce timber planks",
  },
};

/** Selects appropriate roof material given settlement archetype, tier, and local biome */
export function resolveRoofMaterial(
  biomeType: string,
  tier: SettlementTier,
  building: BuildingFunction
): RoofMaterial {
  if (building === "cathedral" || building === "townhall") {
    return tier === "metropolis" || tier === "city" ? "copper_verdigris" : "slate";
  }
  if (building === "keep" || building === "tower" || building === "temple") {
    return "slate";
  }
  if (building === "manor") {
    return tier === "metropolis" || tier === "city" ? "slate" : "terracotta";
  }
  if (building === "hovel") {
    return "thatch";
  }
  if (building === "cattle_shed") {
    return "timber";
  }
  if (building === "well") {
    return "slate";
  }

  const b = biomeType.toLowerCase();
  if (b.includes("tundra") || b.includes("taiga") || b.includes("boreal") || b.includes("alpine") || b.includes("ice")) {
    return "slate";
  }
  if (b.includes("desert") || b.includes("savanna") || b.includes("shrubland") || b.includes("mediterranean")) {
    return "terracotta";
  }
  if (b.includes("forest") || b.includes("woodland") || b.includes("jungle")) {
    return tier === "town" || tier === "city" ? "terracotta" : "cedar_shingle";
  }
  if (b.includes("grassland") || b.includes("plains") || b.includes("steppe") || b.includes("marsh")) {
    return tier === "town" || tier === "city" ? "slate" : "thatch";
  }

  return tier === "town" || tier === "city" || tier === "metropolis" ? "slate" : "thatch";
}
