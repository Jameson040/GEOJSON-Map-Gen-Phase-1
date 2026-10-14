import type { Pt, VerificationReport } from "../types";
import type { SettlementTier, SettlementType } from "../human/human-types";

// ---------------------------------------------------------------------------
// LAYER 5 — CADASTRE & ROOFS (Micro-Urbanism for Google Earth Fantasy Lite)
//
// Generates street networks, land parcels, building footprints, and pitched
// roofs down to cottage scale (1:1000m down to 1:10m).
// 
// Scale reference:
//   1 planet unit = 5,560 meters (KM_PER_UNIT = 5.56 km).
//   1 meter = 1 / 5560 = ~0.00018 units.
//   Cottage: 10m x 7m => ~0.0018 x 0.0012 units.
// ---------------------------------------------------------------------------

export const METERS_PER_UNIT = 5560;
export const UNITS_PER_METER = 1 / METERS_PER_UNIT;

export function metersToUnits(m: number): number {
  return m * UNITS_PER_METER;
}

export function unitsToMeters(u: number): number {
  return u * METERS_PER_UNIT;
}

export type RoofType =
  | "gable"           // Two planar slopes meeting at a central ridge
  | "hip"             // Slopes on all four sides
  | "mansard"         // Double-pitched French style (mansard attic)
  | "thatched_round"  // Conical roundhouse roof
  | "tower_conical"   // Steep conical spire for keep/towers
  | "flat";           // Flat roof with parapet (arid/desert)

export type RoofMaterial =
  | "thatch"          // Golden wheat/rye straw — villages, hamlets
  | "slate"           // Dark charcoal/blue slate tiles — alpine, highland, towns
  | "terracotta"      // Warm burnt orange/red clay tiles — temperate, Mediterranean
  | "cedar_shingle"   // Weathered cedar/pine shingles — forest settlements
  | "copper_verdigris"// Patinated teal copper — cathedrals, palaces, town halls
  | "timber";         // Rough-hewn dark timber planks — northern forts, outposts

export type BuildingFunction =
  | "cottage"
  | "hovel"
  | "farmhouse"
  | "manor"
  | "barn"
  | "cattle_shed"
  | "blacksmith"
  | "tavern"
  | "inn"
  | "watermill"
  | "windmill"
  | "chapel"
  | "temple"
  | "cathedral"
  | "townhall"
  | "keep"
  | "tower"
  | "storehouse"
  | "market_stall"
  | "well";

export type StreetKind =
  | "spine"       // Central thoroughfare / high street
  | "arterial"    // Major road connecting to gates or hinterlands
  | "lane"        // Secondary residential or artisan alley
  | "waterfront"  // Quayside or canal promenade
  | "plaza";      // Market square / village green perimeter

export type StreetSurface =
  | "cobblestone"
  | "dirt"
  | "paved_stone"
  | "gravel";

export type ParcelUse =
  | "residential"
  | "artisan"
  | "civic"
  | "religious"
  | "agricultural"
  | "plaza"
  | "mansion_estate"
  | "poor_quarter"
  | "cattle_ranch"
  | "farm_field"
  | "temple_precinct"
  | "inn_courtyard"
  | "quayside"
  | "strip_croft";

/** Settlement structural morphology archetype */
export type SettlementMorphology =
  | "walled_concentric"   // Fortified city/town with curtain walls, bastions, gates (Watabou-style)
  | "linear_ribbon"       // Roadside hamlet/village with deep agricultural strip crofts (Runions-style)
  | "waterfront_port"     // Quayside, wooden piers, storehouses conforming to water (Chen-style)
  | "crossroads_market";  // Open market green at multi-road junction

/** Socio-economic establishment identity (S. John Ross / Eigengrau model) */
export interface EstablishmentInfo {
  id: string;
  name: string;
  trade: string;
  proprietor: string;
  socialClass: "patrician" | "artisan" | "yeoman" | "laborer" | "clergy";
  specialty?: string;
  buildingId?: string;
}

/** Defensive curtain wall tower / bastion */
export interface DefensiveTower {
  id: string;
  center: Pt;
  radiusM: number;
  heightM: number;
  isGateTower?: boolean;
}

/** Defensive fortified portal / gatehouse where road pierces curtain wall */
export interface DefensiveGatehouse {
  id: string;
  center: Pt;
  roadAngleRad: number;
  widthM: number;
  depthM: number;
  towers: DefensiveTower[];
}

/** Fortified defensive wall circuit (Watabou enceinte) */
export interface DefensiveEnceinte {
  curtainWalls: Pt[][];          // Polylines of curtain wall battlements
  wallThicknessM: number;
  towers: DefensiveTower[];
  gates: DefensiveGatehouse[];
  hasMoat?: boolean;
}

/** Wooden pier / jetty extending into water */
export interface WaterfrontPier {
  id: string;
  start: Pt;
  end: Pt;
  widthM: number;
  lengthM: number;
}

/** Waterfront quayside and harbor extensions */
export interface WaterfrontFeature {
  quayStreetId: string;
  waterEdgePolyline: Pt[];
  piers: WaterfrontPier[];
  quaysideWidthM: number;
}

/** One facet (slope) of a roof, shaded by sun angle for satellite depth */
export interface RoofFacet {
  polygon: Pt[];                  // Closed polygon in world coordinates
  normal: [number, number, number]; // [nx, ny, nz] surface normal
  pitchDegrees: number;           // Angle from horizontal (e.g. 45°)
  sunExposure: number;            // 0.0 (shadow) .. 1.0 (sunlit)
  color: string;                  // Shaded hex/rgba color for rendering
}

/** Top-down footprint and 3D roof definition of an individual building */
export interface BuildingFootprint {
  id: string;
  buildingType: BuildingFunction;
  center: Pt;                     // World coordinates [x, y]
  footprint: Pt[];                // Closed polygon of exterior walls in world units
  shadowPolygon: Pt[];            // Ground shadow cast polygon (SE azimuth, 45° altitude)
  widthM: number;                 // Width in meters
  lengthM: number;                // Length in meters
  heightM: number;                // Height to ridge in meters
  stories: number;                // 1 .. 4
  ridgeLine: [Pt, Pt];            // Start and end of ridge crest in world coordinates
  roofType: RoofType;
  roofMaterial: RoofMaterial;
  facets: RoofFacet[];            // Slopes with directional illumination
  chimneys: Pt[];                 // Positions of chimneys in world coordinates
  orientationRad: number;         // Angle of main axis in radians
  establishment?: EstablishmentInfo; // Socio-economic identity
}

/** Street segment polyline */
export interface StreetSegment {
  id: string;
  kind: StreetKind;
  surface: StreetSurface;
  widthM: number;                 // Width in meters
  points: Pt[];                   // World coordinates polyline
}

/** Property boundary / parcel enclosing one or more buildings */
export interface Parcel {
  id: string;
  boundary: Pt[];                 // Closed polygon in world coordinates
  landUse: ParcelUse;
  streetId?: string;
  buildingIds: string[];
  areaM2: number;
  fences?: Pt[][];                // Boundary fences (post & rail or dry stone)
  furrows?: [Pt, Pt][];           // Farm crop furrow lines
  cropType?: "wheat" | "barley" | "vegetables" | "pasture" | "fallow";
  fillColor?: string;             // Custom parcel grass/soil tint
}

/** Complete micro-urban cadastral plan of a single settlement */
export interface SettlementCadastre {
  settlementId: string;
  settlementName: string;
  tier: SettlementTier;
  type: SettlementType;
  morphology: SettlementMorphology;
  center: Pt;                     // Settlement hub in world coordinates
  radiusUnits: number;            // Radius in world coordinates
  radiusM: number;                // Radius in meters
  streets: StreetSegment[];
  parcels: Parcel[];
  buildings: BuildingFootprint[];
  civicWell?: { center: Pt; radiusM: number };
  civicPond?: { center: Pt; radiusM: number; polygon: Pt[] };
  marketSquare?: Pt[];
  defense?: DefensiveEnceinte;
  waterfront?: WaterfrontFeature;
  establishments: EstablishmentInfo[];
  rawBuildingCount: number;       // Pre-finetune count for GAN metrics
  stats: CadastreStats;
  verificationBefore: VerificationReport;
  verificationAfter: VerificationReport;
  generatedAt: string;
}

export interface CadastreStats {
  totalBuildings: number;
  residentialBuildings: number;
  totalRoofAreaM2: number;
  totalStreetLengthM: number;
  parcelCount: number;
  predominantRoof: RoofMaterial;
  averagePitch: number;
  generationMs: number;
  finetuneMs: number;
}

export interface CadastreConfig {
  buildingDensity?: number;       // 0.5 (sparse) .. 2.0 (dense)
  roofPitchMultiplier?: number;   // 0.7 (flatter) .. 1.4 (steeper)
  customSeed?: string;
  forceMorphology?: SettlementMorphology;
  enableDefensiveWalls?: boolean;
}

/** Region-wide cadastral collection */
export interface CadastreLayerResult {
  regionId: string;
  cadastres: Map<string, SettlementCadastre>;
  stats: {
    settlementsCount: number;
    totalBuildings: number;
    totalStreetsKm: number;
    totalRoofAreaKm2: number;
    allPassing: boolean;
  };
}
