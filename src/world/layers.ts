import type { GeneratedRegion, VerificationReport } from "./types";
import type { ResourceLayerResult } from "./resources";
import type { BioLayerResult } from "./bio/bio-types";
import type { HumanLayerResult } from "./human/human-types";
import type { PopulationLayerResult } from "./population/population-types";
import { ERA_META } from "./population/population-types";
import type { RouteLayerResult } from "./routes";
import type { CadastreLayerResult } from "./cadastre/cadastre-types";

// ---------------------------------------------------------------------------
// WORLD LAYER REGISTRY
//
// The world is a stack of frozen layers, each built on the ones beneath and
// never modifying them. This registry is the single description the UI uses
// so that the Regions list, the Layers panel and the Stats window all track
// every layer the same way — adding a future layer means adding one entry.
//
//   L1 Geography   — Tier 1 (planet) + Tier 2 (region detail)   [frozen]
//   L2 Geological  — Metals, earths, fuels, fantasy ores        [frozen]
//   L3 Biosphere   — Flora & fauna humans depend on             [frozen]
//   L4 Settlements — Nomadic camps → metropolises               [frozen]
//   L5 Population  — Time-dependent demographics                [frozen]
//   L6 Routes      — Terrain-aware roads & trade network        [frozen]
//   L7 Cadastre    — Village cottage roofs & parcels
// ---------------------------------------------------------------------------

export type WorldLayerId = "geo" | "resource" | "bio" | "human" | "population" | "routes" | "cadastre";

export interface WorldLayerDef {
  id: WorldLayerId;
  index: number;
  label: string;
  short: string;
  glyph: string;
  color: string;
  /** Layer that must exist in a region before this one can be generated. */
  dependsOn: WorldLayerId | null;
  description: string;
}

export const WORLD_LAYERS: WorldLayerDef[] = [
  {
    id: "geo",
    index: 1,
    label: "Geography",
    short: "L1 Geo",
    glyph: "🗺️",
    color: "#2dd4bf",
    dependsOn: null,
    description: "Coastlines, relief, rivers, lakes and biomes. Tier 1 planet + Tier 2 regional detail. Frozen.",
  },
  {
    id: "resource",
    index: 2,
    label: "Geological Resources",
    short: "L2 Res",
    glyph: "⛏️",
    color: "#eab308",
    dependsOn: "geo",
    description: "Metals, clays, building stone, fuels, gems, salts and fantasy minerals rooted in regional geology. Fully filterable.",
  },
  {
    id: "bio",
    index: 3,
    label: "Flora & Fauna",
    short: "L3 Bio",
    glyph: "🌿",
    color: "#a3e635",
    dependsOn: "geo",
    description: "Crops, livestock, game, fisheries, timber and forage humans depend on (FAO EcoCrop). Built on L1.",
  },
  {
    id: "human",
    index: 4,
    label: "Habitable Zones",
    short: "L4 Sites",
    glyph: "🏘️",
    color: "#f97316",
    dependsOn: "bio",
    description: "Habitable zones — camping grounds, village, town, city and metropolis sites marked by structure and resources. No population: that is Layer 5.",
  },
  {
    id: "population",
    index: 5,
    label: "Population",
    short: "L5 Pop",
    glyph: "👥",
    color: "#38bdf8",
    dependsOn: "human",
    description: "Time-dependent actual populations per habitable zone, produced per zone from all layers beneath. Eras 1B → 8B; scrubbable and re-runnable.",
  },
  {
    id: "routes",
    index: 6,
    label: "Roads & Trade Routes",
    short: "L6 Roads",
    glyph: "🛤️",
    color: "#f59e0b",
    dependsOn: "human",
    description: "Terrain-aware royal highways, regional market roads, mountain pass tracks and coastal shipping lanes connecting settlements.",
  },
  {
    id: "cadastre",
    index: 7,
    label: "Cadastre & Roofs",
    short: "L7 Roofs",
    glyph: "🏛️",
    color: "#c084fc",
    dependsOn: "human",
    description: "Street network, parcel boundaries, cottage roofs and top-down architectural footprints. Zoomable satellite view.",
  },
];

export const LAYER_BY_ID: Record<WorldLayerId, WorldLayerDef> = Object.fromEntries(
  WORLD_LAYERS.map((l) => [l.id, l])
) as Record<WorldLayerId, WorldLayerDef>;

/** Everything the UI knows about one region, across all layers. */
export interface RegionLayerState {
  geo: GeneratedRegion | null;
  resource?: import("./resources").ResourceLayerResult | null;
  bio: BioLayerResult | null;
  human: HumanLayerResult | null;
  population: PopulationLayerResult | null;
  routes?: RouteLayerResult | null;
  cadastre?: CadastreLayerResult | null;
}

export interface LayerStatus {
  id: WorldLayerId;
  present: boolean;
  /** Primary count shown in badges (features / populations / settlements / buildings / deposits). */
  count: number | string;
  verify: VerificationReport | null;
  /** True when the layer beneath exists but this one does not. */
  available: boolean;
}

export function layerStatuses(state: RegionLayerState): LayerStatus[] {
  const present = {
    geo: !!state.geo,
    resource: !!state.resource,
    bio: !!state.bio,
    human: !!state.human,
    population: !!state.population,
    routes: !!state.routes,
    cadastre: !!state.cadastre,
  };
  return WORLD_LAYERS.map((l) => {
    const dep = l.dependsOn ? present[l.dependsOn] : true;
    const isPresent = present[l.id];
    const count =
      l.id === "geo"
        ? state.geo?.features.length ?? 0
        : l.id === "resource"
        ? state.resource?.deposits.length ?? 0
        : l.id === "bio"
        ? state.bio?.populations.length ?? 0
        : l.id === "human"
        ? state.human?.settlements.length ?? 0
        : l.id === "population"
        ? state.population ? state.population.model.size : 0
        : l.id === "routes"
        ? state.routes ? state.routes.routes.length : 0
        : l.id === "cadastre"
        ? state.cadastre ? state.cadastre.stats.totalBuildings : 0
        : 0;
    const verify =
      l.id === "geo"
        ? state.geo?.verificationAfter ?? null
        : l.id === "bio"
        ? state.bio?.verifyAfter ?? null
        : l.id === "human"
        ? state.human?.verifyAfter ?? null
        : l.id === "population"
        ? state.population?.verifyAfter ?? null
        : l.id === "routes"
        ? state.routes?.verifyAfter ?? null
        : l.id === "cadastre"
        ? state.cadastre && state.cadastre.cadastres.size > 0
          ? state.cadastre.cadastres.values().next().value?.verificationAfter ?? null
          : null
        : null;
    return { id: l.id, present: isPresent, count, verify, available: dep && !isPresent };
  });
}

/** World-wide totals for the Stats window. */
export interface WorldLayerTotals {
  id: WorldLayerId;
  regions: number;
  count: number;
  allPassing: boolean;
  extra: { k: string; v: string }[];
}

export function worldTotals(
  regions: Map<string, GeneratedRegion>,
  bios: Map<string, BioLayerResult>,
  humans: Map<string, HumanLayerResult>,
  pops: Map<string, PopulationLayerResult>,
  cadastres?: Map<string, CadastreLayerResult>,
  resources?: Map<string, ResourceLayerResult>,
  routes?: Map<string, RouteLayerResult>
): WorldLayerTotals[] {
  const geoFeatures = [...regions.values()].reduce((s, r) => s + r.features.length, 0);
  const resourceDeposits = resources ? [...resources.values()].reduce((s, res) => s + res.deposits.length, 0) : 0;
  const metalsCount = resources ? [...resources.values()].reduce((s, res) => s + res.stats.metalsCount, 0) : 0;
  const fuelsCount = resources ? [...resources.values()].reduce((s, res) => s + res.stats.fuelsCount, 0) : 0;
  const fantasyCount = resources ? [...resources.values()].reduce((s, res) => s + res.stats.fantasyCount, 0) : 0;

  const bioPops = [...bios.values()].reduce((s, b) => s + b.populations.length, 0);
  const bioSpecies = new Set<string>();
  for (const b of bios.values()) for (const p of b.populations) bioSpecies.add(p.speciesId);
  const settlements = [...humans.values()].reduce((s, h) => s + h.settlements.length, 0);
  const capacity = [...humans.values()].reduce((s, h) => s + h.stats.totalCapacity, 0);
  const cities = [...humans.values()].reduce((s, h) => s + h.stats.byTier.city + h.stats.byTier.metropolis, 0);
  const capitals = [...humans.values()].filter((h) => h.settlements.some((s) => s.type === "capital_city")).length;
  const occupancy = [...pops.values()].reduce((s, p) => s + p.report.finalOccupancy, 0);
  const popZones = [...pops.values()].reduce((s, p) => s + p.report.zonesModelled, 0);

  const routesCount = routes ? [...routes.values()].reduce((s, rt) => s + rt.routes.length, 0) : 0;
  const routesKm = routes ? [...routes.values()].reduce((s, rt) => s + rt.stats.totalKm, 0) : 0;
  const highwaysKm = routes ? [...routes.values()].reduce((s, rt) => s + rt.stats.highwaysKm, 0) : 0;
  const bridgesTotal = routes ? [...routes.values()].reduce((s, rt) => s + rt.stats.bridgesCount, 0) : 0;

  const cadCount = cadastres ? [...cadastres.values()].reduce((s, c) => s + c.stats.totalBuildings, 0) : 0;
  const cadKm = cadastres ? [...cadastres.values()].reduce((s, c) => s + c.stats.totalStreetsKm, 0) : 0;

  return [
    {
      id: "geo",
      regions: regions.size,
      count: geoFeatures,
      allPassing: [...regions.values()].every((r) => r.verificationAfter.passedAll),
      extra: [],
    },
    {
      id: "resource",
      regions: resources ? resources.size : 0,
      count: resourceDeposits,
      allPassing: true,
      extra: [
        { k: "Metal Ores", v: `${metalsCount.toLocaleString()} lodes` },
        { k: "Fuels / Energy", v: fuelsCount > 0 ? `${fuelsCount.toLocaleString()} deposits` : "None (world filter)" },
        { k: "Mythic / Fantasy", v: fantasyCount > 0 ? `${fantasyCount.toLocaleString()} veins` : "Excluded (pure natural)" },
      ],
    },
    {
      id: "bio",
      regions: bios.size,
      count: bioPops,
      allPassing: [...bios.values()].every((b) => b.verifyAfter.passedAll),
      extra: [{ k: "Species in play", v: String(bioSpecies.size) }],
    },
    {
      id: "human",
      regions: humans.size,
      count: settlements,
      allPassing: [...humans.values()].every((h) => h.verifyAfter.passedAll),
      extra: [
        { k: "Capacity (structural)", v: capacity.toLocaleString() },
        { k: "City & metropolis sites", v: String(cities) },
        { k: "Capital sites", v: String(capitals) },
        { k: "Population", v: occupancy > 0 ? `${occupancy.toLocaleString()} people live across ${popZones.toLocaleString()} zones` : "Layer 5 (time-dependent, re-runnable)" },
      ],
    },
    {
      id: "population",
      regions: pops.size,
      count: popZones,
      allPassing: [...pops.values()].every((p) => p.verifyAfter.passedAll),
      extra: [
        { k: "Actual population", v: `${occupancy.toLocaleString()} people` },
        { k: "Eras modelled", v: pops.size > 0 ? ERA_META[pops.values().next().value!.config.era].label : "—" },
      ],
    },
    {
      id: "routes",
      regions: routes ? routes.size : 0,
      count: routesCount,
      allPassing: routes ? [...routes.values()].every((rt) => rt.verifyAfter.passedAll) : true,
      extra: [
        { k: "Total Road Network", v: routesKm > 0 ? `${routesKm.toLocaleString()} km mapped` : "Not generated" },
        { k: "Royal Highways", v: highwaysKm > 0 ? `${highwaysKm.toLocaleString()} km paved` : "—" },
        { k: "River Crossings", v: bridgesTotal > 0 ? `${bridgesTotal.toLocaleString()} bridges/fords` : "—" },
      ],
    },
    {
      id: "cadastre",
      regions: cadastres ? cadastres.size : 0,
      count: cadCount,
      allPassing: cadastres ? [...cadastres.values()].every((c) => c.stats.allPassing) : true,
      extra: [
        { k: "Total Roof Footprints", v: cadCount > 0 ? `${cadCount.toLocaleString()} buildings` : "JIT on-demand (zooming in surveys instantly)" },
        { k: "Street Network", v: cadKm > 0 ? `${cadKm.toFixed(1)} km mapped` : "Generates on deep zoom" },
        { k: "Roof Architectural Types", v: "Gable, Hip, Conical, Spire (Thatch, Slate, Tile, Timber)" },
      ],
    },
  ];
}

/** Comprehensive structured export for the Data Tab */
export interface WorldMasterLedger {
  meta: {
    exportDate: string;
    activeRegionsCount: number;
    totalLandmasses: number;
  };
  totals: WorldLayerTotals[];
  regionsSummary: {
    id: string;
    name: string;
    sizeClass: string;
    areaKm2: number;
    hasGeo: boolean;
    hasResource: boolean;
    hasBio: boolean;
    hasHuman: boolean;
    hasPop: boolean;
    hasRoutes: boolean;
    hasCadastre: boolean;
    resourceDeposits?: number;
    population?: number;
    settlementsCount?: number;
    routesCount?: number;
    routesKm?: number;
    cadastreBuildings?: number;
    featuresCount?: number;
  }[];
}

export function buildMasterLedger(
  regions: Map<string, GeneratedRegion>,
  bios: Map<string, BioLayerResult>,
  humans: Map<string, HumanLayerResult>,
  pops: Map<string, PopulationLayerResult>,
  totalLandmasses: number,
  cadastres?: Map<string, CadastreLayerResult>,
  resources?: Map<string, ResourceLayerResult>,
  routes?: Map<string, RouteLayerResult>
): WorldMasterLedger {
  const totals = worldTotals(regions, bios, humans, pops, cadastres, resources, routes);
  const regionsSummary = [...regions.values()].map((r) => {
    const res = resources?.get(r.descriptor.id);
    const pop = pops.get(r.descriptor.id);
    const human = humans.get(r.descriptor.id);
    const rt = routes?.get(r.descriptor.id);
    const cad = cadastres?.get(r.descriptor.id);
    return {
      id: r.descriptor.id,
      name: r.descriptor.name,
      sizeClass: r.sizeClass,
      areaKm2: r.descriptor.areaKm2,
      hasGeo: true,
      hasResource: !!res,
      hasBio: bios.has(r.descriptor.id),
      hasHuman: humans.has(r.descriptor.id),
      hasPop: pops.has(r.descriptor.id),
      hasRoutes: !!rt,
      hasCadastre: !!cad,
      resourceDeposits: res?.deposits.length,
      population: pop?.report.finalOccupancy,
      settlementsCount: human?.settlements.length,
      routesCount: rt?.routes.length,
      routesKm: rt?.stats.totalKm,
      cadastreBuildings: cad?.stats.totalBuildings,
      featuresCount: r.features.length,
    };
  });
  return {
    meta: {
      exportDate: new Date().toISOString(),
      activeRegionsCount: regions.size,
      totalLandmasses,
    },
    totals,
    regionsSummary,
  };
}
