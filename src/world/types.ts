export type FeatureType =
  // --- Tier 1 (macro / planetary) ---
  | "continent"
  | "island"
  | "sea"
  | "trench"
  | "ice_cap"
  | "plate_boundary"
  // --- Tier 2 (regional detail) ---
  | "coastline"
  | "mountain_range"
  | "mountain"
  | "volcano"
  | "plateau"
  | "canyon"
  | "river"
  | "lake"
  | "wetland"
  | "glacier"
  | "desert"
  | "forest"
  | "tundra"
  | "savanna"
  | "grassland"
  | "reef";

export type ResolutionKind =
  | "merge"
  | "displace"
  | "erode"
  | "cross"
  | "contain"
  | "orogeny"
  | "rainshadow"
  | "volcanism"
  | "drainage"
  | "rift"
  | "glaciation"
  | "inherit"
  | "reshape";

export interface ConflictRecord {
  kind: ResolutionKind;
  description: string;
  tier: 1 | 2;
  regionId?: string;
  relatedFeatureId?: string;
  relatedFeatureName?: string;
}

export type Pt = [number, number];

/** Land-size compartment: decides every Tier-2 prerequisite. */
export type LandSizeClass =
  | "islet"
  | "small_island"
  | "large_island"
  | "subcontinent"
  | "continent"
  | "supercontinent";

/** One intra-region processing block (Tier-2 distributes work block by block). */
export interface RegionCompartment {
  id: number;
  bbox: BBox;
  landKm2: number;
  landShare: number;
  featureCount: number;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface FeatureProperties {
  id: string;
  name: string;
  featureType: FeatureType;
  tier: 1 | 2;
  /** Parent region (continent/island) this detail feature belongs to. */
  regionId?: string;
  regionName?: string;
  /** World-layer tag added by the full-world bundle export (e.g. "L1 Geography"). */
  layer?: string;

  // Relief
  elevation?: number;
  prominence?: number;
  depth?: number;
  reliefM?: number;

  // Hydrology
  strahlerOrder?: number;
  lengthKm?: number;
  dischargeM3s?: number;
  basinAreaKm2?: number;
  mouthType?: "ocean_delta" | "lake_inflow" | "confluence" | "endorheic_sink";
  drainsToId?: string;
  drainsToName?: string;

  // Area metrics
  areaKm2?: number;

  // Climate
  climateZone?: string;
  annualRainfallMm?: number;
  meanTempC?: number;
  windward?: boolean;

  // Geology
  geologicalOrigin?: string;
  plateId?: number;
  isActiveVolcano?: boolean;
  volcanoType?: "stratovolcano" | "shield" | "caldera" | "fissure";

  resolutions?: ConflictRecord[];
}

export interface MapFeature {
  id: string;
  geometry: {
    type: "Point" | "LineString" | "Polygon" | "MultiPolygon";
    coordinates: any;
  };
  properties: FeatureProperties;
  bbox: BBox;
  /** Minimum camera zoom at which this feature becomes visible. */
  lodMinZoom: number;
}

// ---------------------------------------------------------------------------
// Tectonics (Tier 1 -> Tier 2 inheritance payload)
// ---------------------------------------------------------------------------

export interface TectonicPlate {
  id: number;
  name: string;
  center: Pt;
  driftAngle: number;
  driftSpeed: number;
  oceanic: boolean;
}

export interface ConvergentEdge {
  /** Direction (radians) from the region toward the colliding plate. */
  angle: number;
  /** 0..1 collision intensity — drives peak elevation & belt width. */
  strength: number;
  withPlateId: number;
  withPlateName: string;
  type: "collision" | "subduction";
}

// ---------------------------------------------------------------------------
// Region descriptor — the handoff contract between Tier 1 and Tier 2
// ---------------------------------------------------------------------------

export interface RegionDescriptor {
  id: string;
  name: string;
  kind: "continent" | "island";
  /** Exterior ring in planetary coordinates, straight from Tier 1. */
  outline: Pt[];
  bbox: BBox;
  centroid: Pt;
  lon: number;
  lat: number;
  areaKm2: number;
  areaUnits: number;
  climateZone: string;
  spansEquator: boolean;
  touchesPole: boolean;
  plateId: number;
  plateName: string;
  convergentEdges: ConvergentEdge[];
  hotspot: boolean;
  /** True for Tier-1 islands built by arc or hotspot volcanism. */
  volcanicIsland: boolean;
  /** Land-size compartment this landmass belongs to. */
  sizeClass: LandSizeClass;
  /** √area — the characteristic length of the landmass in km. */
  linearScaleKm: number;
  adjacentSeas: string[];
  /** Deterministic child seed derived from planet seed + region id. */
  regionSeed: string;
  /** Suggested detail feature budget based on land area. */
  detailBudget: number;
}

// ---------------------------------------------------------------------------
// Generation configs & progress
// ---------------------------------------------------------------------------

export interface PlanetConfig {
  seed: string;
  continentCount: number;
  oceanLevel: number;
  tectonicActivity: number;
  islandDensity: number;
  polarIceExtent: number;
}

export type RegionDetailLevel = "sketch" | "standard" | "high" | "ultra";

export interface RegionConfig {
  detailLevel: RegionDetailLevel;
  riverDensity: number;
  reliefIntensity: number;
  moisture: number;
  glaciation: number;
  /** Optional override seed for regenerating this specific continent/island only. */
  customSeed?: string;
}

export interface GenProgress {
  stage: number;
  totalStages: number;
  stageName: string;
  percent: number;
  featuresCount: number;
  elapsedMs: number;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface PlanetStats {
  seed: string;
  macroFeatures: number;
  continents: number;
  islands: number;
  seas: number;
  trenches: number;
  plates: number;
  landCoveragePercent: number;
  totalLandAreaKm2: number;
  largestContinent: { name: string; areaKm2: number };
  sizeClassCounts: Record<LandSizeClass, number>;
  generationTimeMs: number;
}

export type ShapeArchetype = "wedge" | "cordillera" | "lobed" | "shield" | "arc_sliver" | "block_island";

export interface ShapeLandmassRecord {
  id: string;
  name: string;
  kind: "continent" | "island";
  archetype: ShapeArchetype | "none";
  status: "reshaped" | "softened" | "kept_raw" | "sutured" | "accreted";
  intensity: number;
  attempts: number;
  aspectBefore: number;
  aspectAfter: number;
  solidityBefore: number;
  solidityAfter: number;
  verticesBefore: number;
  verticesAfter: number;
  peninsulas: number;
  gulfs: number;
  centroidShiftKm: number;
  areaChangePct: number;
  note?: string;
}

export interface ShapeFinetuneReport {
  elapsedMs: number;
  processed: number;
  reshaped: number;
  softened: number;
  keptRaw: number;
  sutured: number;
  accreted: number;
  /** Raw map X chosen as the new ocean-only antimeridian. */
  seamX: number;
  /** Longitude rotation applied to every planetary feature. */
  longitudeRotationDeg: number;
  records: ShapeLandmassRecord[];
}

export interface PlanetMacro {
  config: PlanetConfig;
  features: MapFeature[];
  regions: RegionDescriptor[];
  plates: TectonicPlate[];
  stats: PlanetStats;
  log: ConflictRecord[];
  /** Pre-finetune (raw Tier-1) features, kept for Raw vs Finetuned comparison. */
  rawFeatures?: MapFeature[];
  /** Tier-1 shape finetune ledger. */
  shape?: ShapeFinetuneReport;
}

export interface RegionStats {
  regionId: string;
  regionName: string;
  totalFeatures: number;
  mountainRanges: number;
  peaks: number;
  volcanoes: number;
  rivers: number;
  riverSegments: number;
  totalRiverLengthKm: number;
  lakes: number;
  glaciers: number;
  biomes: number;
  highestPeak: { name: string; elevation: number };
  longestRiver: { name: string; lengthKm: number };
  largestLake: { name: string; areaKm2: number };
  meanElevationM: number;
  generationTimeMs: number;
  approxMemoryKb: number;
}

export interface FinetuneReport {
  rawFeatureCount: number;
  finalFeatureCount: number;
  elapsedMs: number;
  // Volcano cleanup
  volcanoesRaw: number;
  volcanoesKept: number;
  volcanoesDroppedCraton: number;
  volcanoesDroppedWaterOrCrowd: number;
  // River cleanup & topological repair
  riversRaw: number;
  riversKept: number;
  riversSnappedConfluence: number;
  riversClippedCoast: number;
  riversClippedLake: number;
  riversDroppedBraidOrCrowd: number;
  riversDroppedStub: number;
  // Peak & lake cleanup
  peaksRaw: number;
  peaksKept: number;
  peaksDroppedWaterOrCrowd: number;
  lakesRaw: number;
  lakesKept: number;
  lakesRescaled: number;
  lakesDroppedOverlapOrCoast: number;
  // Biome cleanup
  biomesRaw: number;
  biomesKept: number;
  biomesDroppedInvalid: number;
}

export interface VerificationCheck {
  id: string;
  category: "presence" | "placement" | "hydrology" | "tectonics" | "climate" | "scale";
  title: string;
  rule: string;
  passed: boolean;
  checkedCount: number;
  violationCount: number;
  details: string;
  sampleViolations: string[];
}

export interface VerificationReport {
  targetName: string;
  tier: 1 | 2;
  passedAll: boolean;
  totalChecks: number;
  passedChecks: number;
  totalViolations: number;
  elapsedMs: number;
  checks: VerificationCheck[];
}

export interface GeneratedRegion {
  descriptor: RegionDescriptor;
  config: RegionConfig;
  /** The effective seed used to generate this region's Tier-2 details. */
  seed: string;
  sizeClass: LandSizeClass;
  /** Intra-region processing blocks with per-block land area & feature counts. */
  compartments: RegionCompartment[];
  features: MapFeature[];
  /** Unmodified pre-finetune features so the user can toggle & compare Raw vs Finetuned. */
  rawFeatures: MapFeature[];
  stats: RegionStats;
  finetune: FinetuneReport;
  verificationBefore: VerificationReport;
  verificationAfter: VerificationReport;
  log: ConflictRecord[];
  generatedAt: number;
}

export type MapThemeId = "gidding" | "atlas" | "topo" | "antique" | "satellite";

// ---------------------------------------------------------------------------
// Workspace tabs
// ---------------------------------------------------------------------------

export interface WorkspaceTab {
  id: string;
  kind: "planet" | "region";
  title: string;
  regionId?: string;
}
