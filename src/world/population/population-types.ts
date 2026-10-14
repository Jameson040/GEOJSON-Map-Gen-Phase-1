import type { GenProgress, VerificationReport } from "../types";

// ---------------------------------------------------------------------------
// LAYER 4 — POPULATION (time-dependent, per habitable zone)
//
// The first layer that answers "how many people actually live here, and did,
// and will". Generated PER ZONE (cascading, like Tier 2 was per-continent):
// feeding on every layer beneath — L1 geography, L2 biosphere, and the L3
// habitable zone its numbers are attached to. Population is a STRUCTURE the
// user can re-run, wipe, or adjust without touching anything underneath, and
// its epochs map onto real settlement functions (early foragers, pastoral
// villages, classic towns, classic cities, mature metropolises).
// ---------------------------------------------------------------------------

export type PopulationPhase = "founding" | "growth" | "steady" | "decline" | "abandoned";

export interface PopulationSegment {
  phase: PopulationPhase;
  startYear: number;
  endYear: number;
  growthRatePerYr: number;
  peakPopulation: number;
  endPopulation: number;
}

/**
 * Backcast = how far back from `year` this occupancy reaches. ForwardCast =
 * how many years it runs beyond it (a model, not a promise). Population
 * values are junctions; history per phase interpolates between them so the
 * whole curve is derived from structure, never stored sample-by-sample.
 */
export interface ZonePopulation {
  zoneId: string;
  layer: "population";
  occupancy: number;
  densityPerKm2: number;
  hardCap: number;
  usagePercent: number;
  confidence: 0 | 1 | 2; // 0 modelled only · 1 extrapolated signal · 2 observed
  foodShortage: boolean;
  waterSecure: boolean;
  yearProduced: number;
  backcastYears: number;
  forwardCastYears: number;
  phases: PopulationSegment[];
  /** Which source supplied which function (for explainability). */
  drivers: Record<string, number>;
}

export interface PopulationConfig {
  era:
    | "early_no_rivers"        // deep past — no town/city sites used
    | "pastoral_rivers"        // pre-industrial: hamlets, villages, towns
    | "classic_towns_cities"   // villages → towns, a few cities
    | "mature_metropolitan"    // present day: the full urban stack
    | "current"                // contemporary occupational mix
    | "postIndustrial";        // recovering, downsizing after stress
  year: number;
  targetScale: number; // 0.1–4 — world-warming analogue (1B → 8B projection)
  customSeed?: string;
}

export interface PopulationFinetuneReport {
  zonesModelled: number;
  rawOccupancy: number;
  movedToBiosphere: number;
  downgraded: number;
  upgraded: number;
  revived: number;
  finalOccupancy: number;
  foodShortageZones: number;
  droppedByRule: Record<string, number>;
  elapsedMs: number;
}

export interface PopulationLayerResult {
  regionId: string;
  regionName: string;
  config: PopulationConfig;
  seedUsed: string;
  model: Map<string, ZonePopulation>;
  rawModel: Map<string, ZonePopulation>;
  report: PopulationFinetuneReport;
  verifyBefore: VerificationReport;
  verifyAfter: VerificationReport;
  generatedAt: number;
}

export type PopulationProgressFn = (p: GenProgress) => void;

export const ERA_META: Record<PopulationConfig["era"], { label: string; maxTierRank: number; nomadicFactor: number; hamletFactor: number; villageFactor: number; townFactor: number; cityFactor: number; metropolisFactor: number; description: string }> = {
  early_no_rivers: {
    label: "Early Foragers (no rivers used)",
    maxTierRank: 0,
    nomadicFactor: 1,
    hamletFactor: 0.1,
    villageFactor: 0,
    townFactor: 0,
    cityFactor: 0,
    metropolisFactor: 0,
    description: "Deep past: foragers use camps and grounds. No town, city or metropolis site is used, regardless of how good the land is — the same world, an earlier occupancy.",
  },
  pastoral_rivers: {
    label: "Pastoral River Era",
    maxTierRank: 3,
    nomadicFactor: 0.6,
    hamletFactor: 0.6,
    villageFactor: 0.8,
    townFactor: 0.25,
    cityFactor: 0.05,
    metropolisFactor: 0,
    description: "Pre-industrial: lowland hamlets, river villages, a few market towns. Classical metropolis zones remain unused.",
  },
  classic_towns_cities: {
    label: "Classic Towns & Cities",
    maxTierRank: 4,
    nomadicFactor: 0.35,
    hamletFactor: 0.75,
    villageFactor: 1,
    townFactor: 0.75,
    cityFactor: 0.35,
    metropolisFactor: 0.05,
    description: "Towns grow, a few cities, metropolis still overbuilt.",
  },
  mature_metropolitan: {
    label: "Mature Metropolitan",
    maxTierRank: 5,
    nomadicFactor: 0.2,
    hamletFactor: 0.55,
    villageFactor: 0.85,
    townFactor: 1,
    cityFactor: 1,
    metropolisFactor: 0.9,
    description: "The full modern urban stack is occupied.",
  },
  current: {
    label: "Contemporary",
    maxTierRank: 5,
    nomadicFactor: 0.25,
    hamletFactor: 0.65,
    villageFactor: 0.9,
    townFactor: 1,
    cityFactor: 1,
    metropolisFactor: 1,
    description: "Default present mix — most zones used to their share.",
  },
  postIndustrial: {
    label: "Post-Industrial Recovery",
    maxTierRank: 4,
    nomadicFactor: 0.4,
    hamletFactor: 0.55,
    villageFactor: 0.7,
    townFactor: 0.6,
    cityFactor: 0.4,
    metropolisFactor: 0.15,
    description: "After stress: urban occupancy retreats, some cities abandoned to ruins, nomadism returns.",
  },
};
