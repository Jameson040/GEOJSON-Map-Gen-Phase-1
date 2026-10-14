import type { GenProgress, Pt, VerificationReport } from "../types";

// ---------------------------------------------------------------------------
// LAYER 4 — HABITABLE ZONES (settlement SITES, not settlements)
//
// This layer answers one question: can humans live here? It marks camping
// grounds, village sites, city sites and metropolis candidates with their
// quality and available evidence. It deliberately carries NO people and NO
// population. Population is time-dependent and belongs to Layer 5, generated
// per zone against all three layers beneath.
//
//   Generation → creative, drops candidate sites anywhere.
//   Finetune   → drops / relocates / adds against frozen L1 + L2.
//   Verifier   → asserts the rules hold before vs after.
// ---------------------------------------------------------------------------

export type SettlementTier =
  | "nomadic"
  | "hamlet"
  | "village"
  | "town"
  | "city"
  | "metropolis";

export type SettlementType =
  | "hunter_camp" | "pastoral_camp" | "caravan_camp" | "seasonal_fishing_camp"
  | "farmstead" | "fishing_hamlet" | "logging_camp" | "mining_camp" | "oasis_hamlet" | "herding_hamlet"
  | "farming_village" | "fishing_village" | "river_village" | "mountain_village" | "forest_village"
  | "oasis_village" | "island_village" | "monastery"
  | "market_town" | "river_town" | "port_town" | "mining_town" | "hill_fort" | "caravanserai" | "spa_town"
  | "trade_city" | "port_city" | "river_city" | "fortress_city" | "temple_city" | "capital_city"
  | "metropolis" | "port_metropolis";

export type SiteNeed =
  | "coast" | "river" | "freshwater" | "farmland" | "pasture" | "forest"
  | "fish" | "mountain" | "desert" | "oasis" | "flat" | "highland" | "island" | "minerals";

/** Whether this site is used now, was used before, or is only a future option. */
export type HabitationState = "lived_now" | "ancient_pulse" | "potential";

export type HumanEra = "early_no_rivers" | "pastoral_rivers" | "classic_towns_cities";

export interface SettlementDef {
  type: SettlementType;
  name: string;
  tier: SettlementTier;
  glyph: string;
  /** Structural capacity band of the site (not an occupied headcount). */
  popCap: [number, number];
  needs: SiteNeed[];
  prefers: SiteNeed[];
  forbidBiomes?: string[];
  waterKm: number;
  foodRoles: string[];
  supplyKm: number;
  spacingKm: number;
  description: string;
}

/** One marked habitable zone. Structurally stable; population lives elsewhere. */
export interface Settlement {
  id: string;
  layer: "human";
  type: SettlementType;
  tier: SettlementTier;
  name: string;
  glyph: string;
  point: Pt;
  /** Structural capacity of the site (never an occupied headcount). */
  popCap: number;
  /** 0..1 physical carrying score of this exact spot. */
  capacity: number;
  habitation: HabitationState;
  compartmentId: number;
  /** Food species (bio populations) reachable from the site. */
  resourceRoles: string[];
  /** Name of the river/lake/coast it sits on, if any. */
  waterSource?: string;
  siteTraits: SiteNeed[];
  origin: string;
  lodZoom: number;
}

/** Structural release notes when a zone capacity changes between generations. */
export interface SettlementDiff {
  id: string;
  type: string;
  beforeCap?: number;
  afterCap?: number;
  note: string;
}

export interface HumanConfig {
  density: number;
  urbanisation: number;
  customSeed?: string;
}

export interface HumanFinetuneReport {
  rawCount: number;
  keptAsIs: number;
  relocated: number;
  resized: number;
  dropped: number;
  added: number;
  finalCount: number;
  droppedByRule: Record<string, number>;
  demotions: number;
  elapsedMs: number;
}

export interface HumanLogEntry {
  action: "keep" | "relocate" | "resize" | "drop" | "add";
  rule: string;
  text: string;
}

export interface HumanStats {
  zones: number;
  byTier: Record<SettlementTier, number>;
  byType: Record<string, number>;
  /** Top-scoring site of the region. */
  bestSite: { name: string; type: string; capacity: number } | null;
  totalCapacity: number;
  areaCoverage: number;
  /** Habitation evidence mix. */
  byHabitation: Record<HabitationState, number>;
}

export interface HumanLayerResult {
  regionId: string;
  regionName: string;
  config: HumanConfig;
  seedUsed: string;
  settlements: Settlement[];
  rawSettlements: Settlement[];
  diffs: SettlementDiff[];
  report: HumanFinetuneReport;
  log: HumanLogEntry[];
  verifyBefore: VerificationReport;
  verifyAfter: VerificationReport;
  stats: HumanStats;
  generatedAt: number;
}

export type HumanProgressFn = (p: GenProgress) => void;
