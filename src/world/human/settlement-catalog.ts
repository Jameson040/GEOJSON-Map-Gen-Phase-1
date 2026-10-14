import type { SettlementDef, SettlementTier, SettlementType } from "./human-types";

// ---------------------------------------------------------------------------
// HABITABLE-SITE CATALOG — every kind of place humans might live, from a
// hunter's seasonal ground to a port-metropolis candidate. Capacities are
// STRUCTURAL site bands, not occupied headcounts: population is Layer 5's job.
// Bands follow the conventional hierarchy (hamlet < 500, village 500–5k,
// town 5k–50k, city 50k–1M, metropolis 1M+).
// ---------------------------------------------------------------------------

const D = (
  type: SettlementType,
  name: string,
  tier: SettlementTier,
  glyph: string,
  popCap: [number, number],
  needs: SettlementDef["needs"],
  prefers: SettlementDef["prefers"],
  waterKm: number,
  foodRoles: string[],
  supplyKm: number,
  spacingKm: number,
  description: string,
  forbidBiomes?: string[]
): SettlementDef => ({ type, name, tier, glyph, popCap, needs, prefers, forbidBiomes, waterKm, foodRoles, supplyKm, spacingKm, description });

export const SETTLEMENT_CATALOG: SettlementDef[] = [
  // ---- NOMADIC / SEASONAL --------------------------------------------------
  D("hunter_camp", "Hunter-Gatherer Camp", "nomadic", "⛺", [20, 120], [], ["forest", "river"], 40, ["game"], 60, 20,
    "Seasonal ground used while following game and wild foods."),
  D("pastoral_camp", "Pastoral Nomad Camp", "nomadic", "⛺", [40, 300], ["pasture"], ["freshwater"], 60, ["dairy", "meat"], 90, 22,
    "Grazing ground for herders moving flocks."),
  D("caravan_camp", "Caravan Camp", "nomadic", "🐪", [30, 200], ["desert"], ["oasis"], 120, ["transport"], 160, 45,
    "Transit ground between desert wells.", ["glacier", "wetland"]),
  D("seasonal_fishing_camp", "Seasonal Fishing Camp", "nomadic", "🎣", [20, 150], ["coast"], ["fish"], 20, ["fishery"], 40, 16,
    "Shore ground occupied during the fish runs."),

  // ---- HAMLET ----------------------------------------------------------------
  D("farmstead", "Farmstead Site", "hamlet", "🏡", [50, 400], ["farmland", "flat"], ["river"], 12, ["staple"], 25, 5,
    "Arable margin where a few families could farm.", ["desert", "glacier", "tundra"]),
  D("fishing_hamlet", "Fishing Hamlet Site", "hamlet", "🛶", [60, 450], ["coast"], ["fish"], 15, ["fishery"], 30, 6,
    "Sheltered beach able to ground small boats."),
  D("logging_camp", "Logging Camp Site", "hamlet", "🪓", [40, 300], ["forest"], ["river"], 20, ["timber"], 30, 8,
    "Forest tract workable by timber crews.", ["desert", "glacier"]),
  D("mining_camp", "Mining Camp Site", "hamlet", "⛏️", [60, 500], ["mountain"], ["minerals"], 25, [], 60, 10,
    "Ore-bearing ground high in the ranges; food is carried in."),
  D("oasis_hamlet", "Oasis Hamlet Site", "hamlet", "🌴", [80, 450], ["desert", "oasis"], [], 6, ["staple", "fruit"], 15, 18,
    "Water point in the desert with room for date groves."),
  D("herding_hamlet", "Herding Hamlet Site", "hamlet", "🐑", [50, 400], ["pasture"], ["freshwater"], 25, ["dairy", "meat"], 40, 8,
    "Good grazing with shelter for permanent folds.", ["desert", "glacier"]),

  // ---- VILLAGE ---------------------------------------------------------------
  D("farming_village", "Farming Village Site", "village", "🏘️", [500, 3000], ["farmland", "flat"], ["river"], 10, ["staple", "vegetable"], 30, 8,
    "Land for fields, orchards and a green.", ["desert", "glacier", "tundra"]),
  D("fishing_village", "Fishing Village Site", "village", "⚓", [500, 3500], ["coast"], ["fish"], 12, ["fishery"], 40, 10,
    "Harbour shore with room for nets and smokehouses."),
  D("river_village", "River Village Site", "village", "🏘️", [600, 4000], ["river", "farmland"], [], 4, ["staple"], 30, 8,
    "A stretch of navigable river with floodplain farms.", ["desert", "glacier"]),
  D("mountain_village", "Mountain Village Site", "village", "🏔️", [300, 2000], ["mountain"], ["freshwater"], 15, ["dairy", "staple"], 40, 10,
    "High valley for terraces and herds."),
  D("forest_village", "Forest Village Site", "village", "🌲", [400, 2500], ["forest"], ["river"], 15, ["timber", "game"], 35, 10,
    "Woods suited to clearings, hunting and charcoal.", ["desert", "glacier"]),
  D("oasis_village", "Oasis Village Site", "village", "🏜️", [600, 4000], ["desert", "oasis"], [], 6, ["staple", "fruit"], 20, 25,
    "Spring-fed ground that could hold a mud-brick town."),
  D("island_village", "Island Village Site", "village", "🏝️", [300, 2500], ["island", "coast"], ["fish"], 15, ["fishery"], 30, 10,
    "Small-island shore near good water."),
  D("monastery", "Monastery Site", "village", "⛪", [50, 600], ["highland"], ["forest"], 20, [], 60, 30,
    "Secluded elevated ground for a religious house."),

  // ---- TOWN ------------------------------------------------------------------
  D("market_town", "Market Town Site", "town", "🏛️", [5000, 30000], ["farmland", "flat"], ["river"], 10, ["staple", "protein", "vegetable"], 60, 20,
    "Crossing of village trade routes.", ["desert", "glacier", "tundra"]),
  D("river_town", "River Town Site", "town", "🌉", [6000, 40000], ["river", "farmland"], [], 3, ["staple", "protein"], 60, 20,
    "Bridge or ford point on a major river.", ["desert", "glacier"]),
  D("port_town", "Port Town Site", "town", "⚓", [6000, 45000], ["coast"], ["fish", "farmland"], 10, ["fishery", "staple"], 70, 24,
    "Sheltered anchorage with room for shipwrights."),
  D("mining_town", "Mining Town Site", "town", "⛏️", [5000, 25000], ["mountain"], ["river", "minerals"], 15, ["staple"], 90, 24,
    "Ore district with smelting ground; grain hauled from lowlands."),
  D("hill_fort", "Hill Fort Site", "town", "🏰", [2000, 15000], ["highland"], ["farmland"], 15, ["staple"], 60, 22,
    "Defensible high ground commanding a valley."),
  D("caravanserai", "Caravanserai Site", "town", "🕌", [3000, 20000], ["desert", "oasis"], [], 8, ["staple", "transport"], 60, 50,
    "Watered way-point on a desert route."),
  D("spa_town", "Spa & Pilgrim Town Site", "town", "♨️", [3000, 20000], ["mountain"], ["forest"], 15, ["staple"], 70, 35,
    "Warm-spring ground that would draw travellers."),

  // ---- CITY ------------------------------------------------------------------
  D("trade_city", "Trade City Site", "city", "🏙️", [50000, 400000], ["farmland", "flat"], ["river", "coast"], 10, ["staple", "protein", "vegetable", "fiber"], 120, 55,
    "Crossroads with fertile hinterland for craft and trade.", ["desert", "glacier", "tundra"]),
  D("port_city", "Port City Site", "city", "🚢", [60000, 600000], ["coast"], ["farmland", "river"], 10, ["fishery", "staple", "protein"], 130, 60,
    "Deep anchorage with farmland behind it."),
  D("river_city", "River City Site", "city", "🏙️", [60000, 500000], ["river", "farmland"], [], 3, ["staple", "protein", "vegetable"], 120, 55,
    "Great-river floodplain for a major settlement.", ["desert", "glacier"]),
  D("fortress_city", "Fortress City Site", "city", "🏯", [40000, 250000], ["highland"], ["river"], 12, ["staple", "protein"], 120, 65,
    "High defensible ground for a walled city."),
  D("temple_city", "Temple City Site", "city", "🛕", [40000, 300000], ["farmland"], ["river", "highland"], 12, ["staple", "protein"], 120, 70,
    "Ceremonial plain surrounded by rich fields.", ["desert", "glacier", "tundra"]),
  D("capital_city", "Capital City Site", "city", "👑", [150000, 900000], ["farmland", "flat"], ["river", "coast"], 8, ["staple", "protein", "vegetable", "fiber", "timber"], 160, 100,
    "The strongest seat of rule in the region.", ["desert", "glacier", "tundra"]),

  // ---- METROPOLIS ------------------------------------------------------------
  D("metropolis", "Metropolis Site", "metropolis", "🌆", [1000000, 6000000], ["farmland", "flat", "river"], ["coast"], 6, ["staple", "protein", "vegetable", "fiber", "timber"], 220, 160,
    "The region's premier inland basin for a megacity.", ["desert", "glacier", "tundra"]),
  D("port_metropolis", "Port Metropolis Site", "metropolis", "🌃", [1200000, 8000000], ["coast", "farmland"], ["river"], 8, ["fishery", "staple", "protein", "vegetable", "fiber"], 240, 160,
    "The region's premier harbour for a megacity."),
];

export const SETTLEMENT_BY_TYPE: Map<SettlementType, SettlementDef> = new Map(SETTLEMENT_CATALOG.map((d) => [d.type, d]));

export const TIER_ORDER: SettlementTier[] = ["nomadic", "hamlet", "village", "town", "city", "metropolis"];
export const TIER_RANK: Record<SettlementTier, number> = { nomadic: 0, hamlet: 1, village: 2, town: 3, city: 4, metropolis: 5 };

export const TIER_LABELS: Record<SettlementTier, string> = {
  nomadic: "Nomadic Ground",
  hamlet: "Hamlet Site",
  village: "Village Site",
  town: "Town Site",
  city: "City Site",
  metropolis: "Metropolis Site",
};

export const TIER_COLORS: Record<SettlementTier, string> = {
  nomadic: "#d4d4d8",
  hamlet: "#fde68a",
  village: "#fbbf24",
  town: "#f97316",
  city: "#ef4444",
  metropolis: "#c026d3",
};

export const TIER_DENSITY_PER_MKM2: Record<SettlementTier, number> = {
  nomadic: 8,
  hamlet: 60,
  village: 40,
  town: 12,
  city: 2.2,
  metropolis: 0.35,
};

export const TIER_CAPS: Record<SettlementTier, number> = {
  nomadic: 60,
  hamlet: 600,
  village: 450,
  town: 120,
  city: 24,
  metropolis: 4,
};
