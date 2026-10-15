import type { BBox, GenProgress, Pt, RegionCompartment, VerificationReport } from "../types";

// ---------------------------------------------------------------------------
// LAYER 3 — FLORA & FAUNA (Biosphere)
//
// This layer sits ON TOP of the frozen geographic layer. It only READS the
// GeneratedRegion (coastline, biomes, rivers, lakes, ranges, compartments,
// climate fields) and produces its own, fully separate feature set. Nothing
// in the geographic layer is ever mutated by this module.
//
// Doctrine (same as every layer):
//   Generation  -> creative, unconstrained scatter of species populations.
//   Finetune    -> rule-based: drop / relocate / add to resolve contradictions
//                  against the geography (climate envelopes, habitat domains,
//                  water & forage dependencies, density, food security).
//   Verifier    -> asserts the rules hold, before vs after.
// ---------------------------------------------------------------------------

export type SpeciesKind = "crop" | "livestock" | "wild" | "flora";

export type SpeciesCategory =
  | "cereal"
  | "root"
  | "legume"
  | "vegetable"
  | "fruit"
  | "oil"
  | "sugar"
  | "beverage"
  | "fiber"
  | "spice"
  | "nut"
  | "meat_dairy"
  | "poultry"
  | "draft"
  | "camelid"
  | "apiary"
  | "game"
  | "fish_fresh"
  | "fish_marine"
  | "shellfish"
  | "timber"
  | "forage"
  | "reed";

export type HumanRole =
  | "staple"
  | "protein"
  | "vegetable"
  | "fruit"
  | "oil"
  | "sugar"
  | "beverage"
  | "fiber"
  | "spice"
  | "dairy"
  | "meat"
  | "draft"
  | "transport"
  | "wool"
  | "honey"
  | "pollination"
  | "fishery"
  | "game"
  | "timber"
  | "forage";

export type HabitatDomain = "land" | "freshwater" | "marine" | "coastal";

/**
 * One species the human layer depends on. Climate envelope fields follow the
 * FAO EcoCrop schema (TMIN/TMAX -> tMin/tMax as tolerable mean-season °C,
 * RMIN/RMAX -> rMin/rMax annual mm, ALTMX -> elevMaxM), simplified to annual
 * means for this simulation. Source: FAO EcoCrop database (EcoCrop_DB.csv,
 * github.com/OpenCLIM/ecocrop) for plants; FAO/FAOSTAT husbandry & fisheries
 * ranges for animals. Values tweaked for the planet's climate model.
 */
export interface SpeciesDef {
  id: string;
  name: string;
  sci: string;
  glyph: string;
  kind: SpeciesKind;
  category: SpeciesCategory;
  roles: HumanRole[];
  tMin: number;
  tMax: number;
  rMin: number;
  rMax: number;
  elevMaxM?: number;
  /** Requires highland terrain (inside mountain_range/plateau), e.g. llama. */
  highland?: boolean;
  habitat: HabitatDomain;
  /** Allowed geographic biome featureTypes. Undefined = any non-glacier land. */
  biomes?: string[];
  /** Must be within this many km of a river or lake (riparian species). */
  waterKm?: number;
  /** Crop may ignore rMin when freshwater lies within ~25 km (irrigation). */
  irrigable?: boolean;
  /** Grazer: needs forage/grassland/savanna within reach. */
  needsForage?: boolean;
  /** Display patch radius range in km. */
  spreadKm: [number, number];
  staple?: boolean;
}

export interface BioFeature {
  id: string;
  layer: "bio";
  speciesId: string;
  name: string;
  glyph: string;
  kind: SpeciesKind;
  category: SpeciesCategory;
  roles: HumanRole[];
  point: Pt;
  radiusUnits: number;
  /** 1 = sparse, 2 = common, 3 = abundant */
  abundance: 1 | 2 | 3;
  compartmentId: number;
  irrigated?: boolean;
  origin: string;
  /** Minimum zoom at which this population is drawn. */
  lodZoom: number;
}

export interface BioConfig {
  /** 0.5 .. 2 — overall population density. */
  richness: number;
  /** 0.5 .. 1.5 — share of wild fauna/flora vs domesticated. */
  wildShare: number;
  customSeed?: string;
}

export interface BioFinetuneReport {
  rawCount: number;
  keptAsIs: number;
  relocated: number;
  dropped: number;
  added: number;
  finalCount: number;
  droppedByRule: Record<string, number>;
  addedForRoles: string[];
  speciesPresent: number;
  elapsedMs: number;
}

export interface BioLogEntry {
  action: "keep" | "relocate" | "drop" | "add";
  rule: string;
  text: string;
}

export interface BioStats {
  populations: number;
  species: number;
  byKind: Record<SpeciesKind, number>;
  roleCoverage: Record<string, boolean>;
  staples: string[];
  proteins: string[];
  irrigatedFarms: number;
  wildPopulations: number;
}

export interface BioLayerResult {
  regionId: string;
  regionName: string;
  config: BioConfig;
  seedUsed: string;
  populations: BioFeature[];
  rawPopulations: BioFeature[];
  report: BioFinetuneReport;
  log: BioLogEntry[];
  verifyBefore: VerificationReport;
  verifyAfter: VerificationReport;
  stats: BioStats;
  generatedAt: number;
}

/** Minimal environment sample taken from the frozen geographic layer. */
export interface EnvSample {
  tempC: number;
  rainMm: number;
  onLand: boolean;
  biome: string | null;
  inRange: boolean;
  rangeElevM: number;
  inPlateau: boolean;
  coastKm: number;
  freshKm: number;
  oceanKm: number;
}

export interface BioRenderable {
  x: number;
  y: number;
  radiusUnits: number;
  color: string;
  glyph: string;
  lodZoom: number;
  abundance: number;
  feature: BioFeature;
}

export type BioProgressFn = (p: GenProgress) => void;

export interface CompartmentRef {
  compartments: RegionCompartment[];
  bbox: BBox;
}
