import type { FeatureType, LandSizeClass, RegionDescriptor, RegionDetailLevel } from "./types";

// ---------------------------------------------------------------------------
// LAND-SIZE COMPARTMENTS
//
// A 3 km² islet and a 40 million km² continent cannot share one rulebook.
// Every landmass is classified into a size compartment, and that compartment
// fixes the prerequisites of everything Tier 2 is allowed to build on it:
// which feature families may exist, how big they may be (in real kilometres),
// how many of them fit, how deep the drainage hierarchy may go, and the
// spacing/snapping tolerances used by the Finetune Stage and the Verifier.
//
// Within a class, quantities are interpolated by the landmass's logarithmic
// position between the class bounds, so a landmass never jumps abruptly at a
// class boundary.
// ---------------------------------------------------------------------------

export type Range2 = [number, number];

export interface SizeProfile {
  id: LandSizeClass;
  label: string;
  short: string;
  color: string;
  minKm2: number;
  maxKm2: number;
  example: string;
  description: string;

  /** Feature budget: area × perKm2, clamped. Multiplied by the detail level. */
  budget: { perKm2: number; min: number; max: number };
  /** Base land-mask raster resolution (cells along the long axis). */
  maskResolution: number;
  /** Side length of intra-region processing blocks. */
  compartmentKm: number;

  coast: { crenulationKm: number; fjordKm: number; fjordChance: number };

  relief: {
    ranges: Range2;
    rangeWidthKm: Range2;
    rangeLengthFrac: Range2;
    baseElevation: number;
    maxElevation: number;
    plateaus: Range2;
    plateauRadiusKm: Range2;
    peakShare: number;
    maxPeaks: number;
    inselbergShare: number;
    peakSpacingKm: number;
    /** No fold belts? Build a radial central massif / volcanic edifice instead. */
    centralMassif: boolean;
  };

  /** Maximum volcano count by tectonic setting, and arc geometry tolerances. */
  volcano: {
    hotspot: number;
    subduction: number;
    collision: number;
    passive: number;
    spacingKm: number;
    arcOffsetKm: number;
  };

  hydro: {
    maxStrahler: number;
    trunks: Range2;
    trunkSpacingKm: number;
    tributaryReachKm: Range2;
    meanderKm: number;
    lakes: Range2;
    lakeRadiusKm: Range2;
    riverShare: number;
    minRiverKm: Record<number, number>;
    snapKm: number;
    corridorKm: number;
    headClearanceKm: number;
    coastReachKm: number;
    lakeCoastBufferKm: number;
    /** Finetune lake discipline: realistic count cap, max radius, spacing, and max land area share. */
    finetuneMaxLakes: number;
    finetuneMaxLakeRadiusKm: number;
    finetuneLakeSpacingKm: number;
    finetuneMaxLakeShare: number;
    /** Finetune survivor cap at "standard" detail. */
    maxRivers: number;
  };

  biome: { count: Range2; radiusKm: Range2 };
  glacierCapKm: Range2;

  /** Verifier: feature families that must be present / must be absent. */
  requires: FeatureType[];
  forbids: FeatureType[];
}

export const SIZE_CLASS_ORDER: LandSizeClass[] = [
  "islet",
  "small_island",
  "large_island",
  "subcontinent",
  "continent",
  "supercontinent",
];

export const SIZE_PROFILES: Record<LandSizeClass, SizeProfile> = {
  islet: {
    id: "islet",
    label: "Islet",
    short: "Islet",
    color: "#38bdf8",
    minKm2: 0,
    maxKm2: 500,
    example: "Skerries, cays, volcanic stacks (≈1–500 km²)",
    description:
      "No fold belts or plateaus. A single volcanic or erosional high point, one or two short streams at most, and a couple of biome patches.",
    budget: { perKm2: 0.6, min: 14, max: 300 },
    maskResolution: 110,
    compartmentKm: 4,
    coast: { crenulationKm: 0.35, fjordKm: 1.2, fjordChance: 0.04 },
    relief: {
      ranges: [0, 0],
      rangeWidthKm: [0, 0],
      rangeLengthFrac: [0, 0],
      baseElevation: 120,
      maxElevation: 950,
      plateaus: [0, 0],
      plateauRadiusKm: [0, 0],
      peakShare: 0.18,
      maxPeaks: 8,
      inselbergShare: 0,
      peakSpacingKm: 0.9,
      centralMassif: true,
    },
    volcano: { hotspot: 1, subduction: 1, collision: 0, passive: 0, spacingKm: 2.5, arcOffsetKm: 4 },
    hydro: {
      maxStrahler: 2,
      trunks: [1, 3],
      trunkSpacingKm: 5,
      tributaryReachKm: [0.4, 2],
      meanderKm: 0.15,
      lakes: [0, 1],
      lakeRadiusKm: [0.08, 0.5],
      riverShare: 0.4,
      minRiverKm: { 1: 0.5, 2: 0.8, 3: 1, 4: 1, 5: 1 },
      snapKm: 0.25,
      corridorKm: 0.35,
      headClearanceKm: 0.35,
      coastReachKm: 2,
      lakeCoastBufferKm: 0.2,
      finetuneMaxLakes: 1,
      finetuneMaxLakeRadiusKm: 0.2,
      finetuneLakeSpacingKm: 1.5,
      finetuneMaxLakeShare: 0.004,
      maxRivers: 12,
    },
    biome: { count: [1, 2], radiusKm: [1.5, 10] },
    glacierCapKm: [0.2, 0.8],
    requires: ["coastline"],
    forbids: ["mountain_range", "plateau"],
  },

  small_island: {
    id: "small_island",
    label: "Small Island",
    short: "S-Island",
    color: "#2dd4bf",
    minKm2: 500,
    maxKm2: 20_000,
    example: "Mallorca, Hawaiʻi Big Island, Jamaica (≈500–20,000 km²)",
    description:
      "A central massif or at most one short ridge, streams up to Strahler order 3, a handful of small lakes.",
    budget: { perKm2: 0.14, min: 160, max: 2600 },
    maskResolution: 180,
    compartmentKm: 18,
    coast: { crenulationKm: 1.6, fjordKm: 7, fjordChance: 0.05 },
    relief: {
      ranges: [0, 1],
      rangeWidthKm: [8, 28],
      rangeLengthFrac: [0.25, 0.45],
      baseElevation: 700,
      maxElevation: 3400,
      plateaus: [0, 1],
      plateauRadiusKm: [4, 16],
      peakShare: 0.14,
      maxPeaks: 320,
      inselbergShare: 0.02,
      peakSpacingKm: 2.2,
      centralMassif: true,
    },
    volcano: { hotspot: 4, subduction: 3, collision: 1, passive: 0, spacingKm: 10, arcOffsetKm: 14 },
    hydro: {
      maxStrahler: 3,
      trunks: [2, 16],
      trunkSpacingKm: 14,
      tributaryReachKm: [2.5, 12],
      meanderKm: 1.2,
      lakes: [0, 6],
      lakeRadiusKm: [0.3, 4],
      riverShare: 0.42,
      minRiverKm: { 1: 1.5, 2: 3, 3: 6, 4: 6, 5: 6 },
      snapKm: 1,
      corridorKm: 1.5,
      headClearanceKm: 1.5,
      coastReachKm: 8,
      lakeCoastBufferKm: 0.8,
      finetuneMaxLakes: 3,
      finetuneMaxLakeRadiusKm: 1.8,
      finetuneLakeSpacingKm: 12,
      finetuneMaxLakeShare: 0.0045,
      maxRivers: 180,
    },
    biome: { count: [2, 8], radiusKm: [8, 50] },
    glacierCapKm: [0.8, 3],
    requires: ["coastline", "mountain", "river"],
    forbids: [],
  },

  large_island: {
    id: "large_island",
    label: "Large Island",
    short: "L-Island",
    color: "#34d399",
    minKm2: 20_000,
    maxKm2: 400_000,
    example: "Great Britain, Honshu, New Zealand South Island (≈20k–400k km²)",
    description:
      "One or two real ranges, streams up to order 4, regional lakes and several biomes.",
    budget: { perKm2: 0.035, min: 1600, max: 9500 },
    maskResolution: 260,
    compartmentKm: 70,
    coast: { crenulationKm: 7, fjordKm: 35, fjordChance: 0.05 },
    relief: {
      ranges: [1, 2],
      rangeWidthKm: [28, 100],
      rangeLengthFrac: [0.25, 0.45],
      baseElevation: 1500,
      maxElevation: 5400,
      plateaus: [0, 2],
      plateauRadiusKm: [20, 80],
      peakShare: 0.12,
      maxPeaks: 1600,
      inselbergShare: 0.03,
      peakSpacingKm: 4.5,
      centralMassif: false,
    },
    volcano: { hotspot: 8, subduction: 7, collision: 2, passive: 0, spacingKm: 28, arcOffsetKm: 40 },
    hydro: {
      maxStrahler: 4,
      trunks: [4, 32],
      trunkSpacingKm: 40,
      tributaryReachKm: [10, 60],
      meanderKm: 5,
      lakes: [1, 24],
      lakeRadiusKm: [1.2, 22],
      riverShare: 0.42,
      minRiverKm: { 1: 4, 2: 7, 3: 13, 4: 24, 5: 24 },
      snapKm: 3,
      corridorKm: 4.5,
      headClearanceKm: 4.5,
      coastReachKm: 26,
      lakeCoastBufferKm: 2.5,
      finetuneMaxLakes: 6,
      finetuneMaxLakeRadiusKm: 7.5,
      finetuneLakeSpacingKm: 45,
      finetuneMaxLakeShare: 0.005,
      maxRivers: 600,
    },
    biome: { count: [4, 22], radiusKm: [35, 200] },
    glacierCapKm: [3, 12],
    requires: ["coastline", "mountain_range", "mountain", "river"],
    forbids: [],
  },

  subcontinent: {
    id: "subcontinent",
    label: "Subcontinent",
    short: "Subcont.",
    color: "#a3e635",
    minKm2: 400_000,
    maxKm2: 4_000_000,
    example: "Madagascar, Greenland, Borneo (≈400k–4M km²)",
    description:
      "Several fold belts and plateaus, full order-5 drainage, large rift or glacial lakes.",
    budget: { perKm2: 0.0065, min: 5200, max: 22000 },
    maskResolution: 320,
    compartmentKm: 220,
    coast: { crenulationKm: 22, fjordKm: 90, fjordChance: 0.05 },
    relief: {
      ranges: [1, 4],
      rangeWidthKm: [65, 240],
      rangeLengthFrac: [0.22, 0.42],
      baseElevation: 2400,
      maxElevation: 7800,
      plateaus: [0, 3],
      plateauRadiusKm: [90, 380],
      peakShare: 0.11,
      maxPeaks: 5200,
      inselbergShare: 0.03,
      peakSpacingKm: 9,
      centralMassif: false,
    },
    volcano: { hotspot: 14, subduction: 16, collision: 3, passive: 0, spacingKm: 60, arcOffsetKm: 90 },
    hydro: {
      maxStrahler: 5,
      trunks: [6, 50],
      trunkSpacingKm: 130,
      tributaryReachKm: [30, 170],
      meanderKm: 28,
      lakes: [4, 80],
      lakeRadiusKm: [4, 85],
      riverShare: 0.42,
      minRiverKm: { 1: 9, 2: 14, 3: 22, 4: 38, 5: 65 },
      snapKm: 7,
      corridorKm: 11,
      headClearanceKm: 10,
      coastReachKm: 60,
      lakeCoastBufferKm: 7,
      finetuneMaxLakes: 10,
      finetuneMaxLakeRadiusKm: 18,
      finetuneLakeSpacingKm: 110,
      finetuneMaxLakeShare: 0.0055,
      maxRivers: 1000,
    },
    biome: { count: [8, 90], radiusKm: [140, 650] },
    glacierCapKm: [8, 35],
    requires: ["coastline", "mountain_range", "mountain", "river"],
    forbids: [],
  },

  continent: {
    id: "continent",
    label: "Continent",
    short: "Cont.",
    color: "#fbbf24",
    minKm2: 4_000_000,
    maxKm2: 25_000_000,
    example: "Australia, Antarctica, South America (≈4M–25M km²)",
    description:
      "Continental cordilleras, broad plateaus, continent-scale trunk rivers and Caspian-class lakes.",
    budget: { perKm2: 0.0024, min: 12000, max: 42000 },
    maskResolution: 380,
    compartmentKm: 450,
    coast: { crenulationKm: 45, fjordKm: 160, fjordChance: 0.05 },
    relief: {
      ranges: [2, 6],
      rangeWidthKm: [120, 420],
      rangeLengthFrac: [0.22, 0.42],
      baseElevation: 3300,
      maxElevation: 9000,
      plateaus: [1, 5],
      plateauRadiusKm: [300, 900],
      peakShare: 0.11,
      maxPeaks: 8000,
      inselbergShare: 0.03,
      peakSpacingKm: 14,
      centralMassif: false,
    },
    volcano: { hotspot: 18, subduction: 22, collision: 4, passive: 0, spacingKm: 85, arcOffsetKm: 115 },
    hydro: {
      maxStrahler: 5,
      trunks: [8, 80],
      trunkSpacingKm: 220,
      tributaryReachKm: [55, 260],
      meanderKm: 55,
      lakes: [6, 160],
      lakeRadiusKm: [10, 160],
      riverShare: 0.42,
      minRiverKm: { 1: 18, 2: 18, 3: 28, 4: 45, 5: 85 },
      snapKm: 10,
      corridorKm: 15,
      headClearanceKm: 14,
      coastReachKm: 85,
      lakeCoastBufferKm: 12,
      finetuneMaxLakes: 15,
      finetuneMaxLakeRadiusKm: 36,
      finetuneLakeSpacingKm: 210,
      finetuneMaxLakeShare: 0.006,
      maxRivers: 1400,
    },
    biome: { count: [10, 180], radiusKm: [350, 1200] },
    glacierCapKm: [15, 55],
    requires: ["coastline", "mountain_range", "mountain", "river"],
    forbids: [],
  },

  supercontinent: {
    id: "supercontinent",
    label: "Supercontinent",
    short: "Super",
    color: "#fb7185",
    minKm2: 25_000_000,
    maxKm2: Infinity,
    example: "Afro-Eurasia, Pangaea-class landmasses (>25M km²)",
    description:
      "Multiple sutured cratons: the most fold belts, the widest plateaus and the densest drainage.",
    budget: { perKm2: 0.0012, min: 30000, max: 50000 },
    maskResolution: 420,
    compartmentKm: 650,
    coast: { crenulationKm: 55, fjordKm: 180, fjordChance: 0.05 },
    relief: {
      ranges: [3, 7],
      rangeWidthKm: [140, 460],
      rangeLengthFrac: [0.2, 0.4],
      baseElevation: 3500,
      maxElevation: 9200,
      plateaus: [2, 6],
      plateauRadiusKm: [350, 1000],
      peakShare: 0.11,
      maxPeaks: 9000,
      inselbergShare: 0.03,
      peakSpacingKm: 16,
      centralMassif: false,
    },
    volcano: { hotspot: 20, subduction: 26, collision: 5, passive: 0, spacingKm: 95, arcOffsetKm: 125 },
    hydro: {
      maxStrahler: 5,
      trunks: [20, 90],
      trunkSpacingKm: 240,
      tributaryReachKm: [60, 290],
      meanderKm: 60,
      lakes: [10, 190],
      lakeRadiusKm: [12, 180],
      riverShare: 0.42,
      minRiverKm: { 1: 20, 2: 20, 3: 30, 4: 50, 5: 95 },
      snapKm: 11,
      corridorKm: 16,
      headClearanceKm: 15,
      coastReachKm: 95,
      lakeCoastBufferKm: 14,
      finetuneMaxLakes: 20,
      finetuneMaxLakeRadiusKm: 46,
      finetuneLakeSpacingKm: 260,
      finetuneMaxLakeShare: 0.006,
      maxRivers: 1700,
    },
    biome: { count: [16, 200], radiusKm: [420, 1450] },
    glacierCapKm: [18, 60],
    requires: ["coastline", "mountain_range", "mountain", "river"],
    forbids: [],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function classifyLandArea(areaKm2: number): LandSizeClass {
  for (const id of SIZE_CLASS_ORDER) {
    const p = SIZE_PROFILES[id];
    if (areaKm2 < p.maxKm2) return id;
  }
  return "supercontinent";
}

export function profileFor(cls: LandSizeClass): SizeProfile {
  return SIZE_PROFILES[cls];
}

/** Logarithmic position (0..1) of an area inside its class bounds. */
export function positionInClass(areaKm2: number, p: SizeProfile): number {
  const lo = Math.max(0.5, p.minKm2);
  const hi = Number.isFinite(p.maxKm2) ? p.maxKm2 : 80_000_000;
  const t = (Math.log(Math.max(lo, areaKm2)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
  return Math.max(0, Math.min(1, t));
}

export function lerpRange(r: Range2, t: number): number {
  return r[0] + (r[1] - r[0]) * t;
}

export function budgetFor(areaKm2: number, p: SizeProfile): number {
  return Math.round(Math.max(p.budget.min, Math.min(p.budget.max, areaKm2 * p.budget.perKm2)));
}

export const DETAIL_MULTIPLIER: Record<RegionDetailLevel, number> = {
  sketch: 0.25,
  standard: 1,
  high: 2.2,
  ultra: 4.2,
};

export const MASK_RES_FACTOR: Record<RegionDetailLevel, number> = {
  sketch: 0.8,
  standard: 1,
  high: 1.18,
  ultra: 1.35,
};

/** Finer detail tolerates tighter spacing between summits / channels. */
export const DETAIL_SPACING_FACTOR: Record<RegionDetailLevel, number> = {
  sketch: 1.6,
  standard: 1.25,
  high: 1,
  ultra: 0.8,
};

export const DETAIL_RIVER_CAP_FACTOR: Record<RegionDetailLevel, number> = {
  sketch: 0.46,
  standard: 1,
  high: 1.7,
  ultra: 2.7,
};

export type TectonicSetting = "hotspot" | "subduction" | "collision" | "passive";

/**
 * One shared definition, used by generation, the Finetune Stage and the
 * Verifier so all three agree on what the landmass is tectonically.
 */
export function tectonicSettingOf(d: RegionDescriptor, hasRanges: boolean): TectonicSetting {
  if (d.hotspot) return "hotspot";
  if (d.convergentEdges.some((e) => e.type === "subduction")) return "subduction";
  // Tier-1 islands are all volcanic arcs or hotspot edifices
  if (d.kind === "island" && d.volcanicIsland) return "subduction";
  const maxConv = d.convergentEdges.reduce((m, e) => Math.max(m, e.strength), 0);
  if (maxConv > 0.55 && hasRanges) return "collision";
  return "passive";
}

export function volcanoCapFor(p: SizeProfile, setting: TectonicSetting): number {
  return p.volcano[setting];
}

export function formatKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString()} km`;
}

export function formatArea(km2: number): string {
  if (km2 >= 1e6) return `${(km2 / 1e6).toFixed(2)}M km²`;
  if (km2 >= 1e3) return `${(km2 / 1e3).toFixed(1)}k km²`;
  if (km2 >= 10) return `${Math.round(km2)} km²`;
  return `${km2.toFixed(1)} km²`;
}
