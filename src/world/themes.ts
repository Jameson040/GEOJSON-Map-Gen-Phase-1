import type { FeatureType, MapThemeId } from "./types";

export interface ThemeColors {
  id: MapThemeId;
  name: string;
  short: string;
  ocean: string;
  oceanDeep: string;
  sea: string;
  trench: string;
  iceCap: string;
  plateBoundary: string;
  graticule: string;
  graticuleLabel: string;
  land: string;
  landStroke: string;
  island: string;
  islandStroke: string;
  coastline: string;
  coastlineStroke: string;
  range: string;
  rangeStroke: string;
  plateau: string;
  peak: string;
  peakSnow: string;
  peakLabel: string;
  volcano: string;
  volcanoGlow: string;
  river: Record<number, string>;
  lake: string;
  lakeStroke: string;
  desert: string;
  forest: string;
  savanna: string;
  grassland: string;
  tundra: string;
  glacier: string;
  wetland: string;
  select: string;
  hover: string;
  hudText: string;
  /** Enables the hand-drawn fantasy cartography renderer (Great Gidding aesthetic) */
  isFantasyInk?: boolean;
}

export const MAP_THEMES: Record<MapThemeId, ThemeColors> = {
  gidding: {
    id: "gidding",
    name: "The Isles of Gidding",
    short: "Gidding",
    isFantasyInk: true,
    ocean: "#2b4856",
    oceanDeep: "#1f3744",
    sea: "#253f4c",
    trench: "#15262f",
    iceCap: "#dbe8ec",
    plateBoundary: "rgba(100, 140, 160, 0.28)",
    graticule: "rgba(200, 230, 245, 0.08)",
    graticuleLabel: "rgba(200, 230, 245, 0.35)",
    land: "#8fa860", // authentic warm olive parchment green
    landStroke: "#1a282d", // crisp dark hand-inking
    island: "#98b16a",
    islandStroke: "#1a282d",
    coastline: "#8fa860",
    coastlineStroke: "#1a282d",
    range: "#758762",
    rangeStroke: "#18241d",
    plateau: "rgba(142, 155, 110, 0.5)",
    peak: "#262b20",
    peakSnow: "#ede8db",
    peakLabel: "#1b241e",
    volcano: "#ba4222",
    volcanoGlow: "#dd5f38",
    river: {
      1: "#577d8a",
      2: "#4c717e",
      3: "#3f636f",
      4: "#2f505b",
      5: "#1e3740",
    },
    lake: "#567c87",
    lakeStroke: "#1a282d",
    desert: "rgba(198, 178, 115, 0.65)",
    forest: "rgba(65, 95, 45, 0.6)",
    savanna: "rgba(165, 158, 95, 0.5)",
    grassland: "rgba(130, 155, 88, 0.5)",
    tundra: "rgba(145, 158, 142, 0.6)",
    glacier: "rgba(230, 240, 242, 0.88)",
    wetland: "rgba(78, 116, 102, 0.6)",
    select: "#ffd43f",
    hover: "#ffffff",
    hudText: "#e2edf2",
  },
  atlas: {
    id: "atlas",
    name: "Physical Atlas",
    short: "Atlas",
    ocean: "#123c60",
    oceanDeep: "#0b2c4a",
    sea: "#17496f",
    trench: "#061c31",
    iceCap: "#e9f4fc",
    plateBoundary: "rgba(255,150,90,0.35)",
    graticule: "rgba(255,255,255,0.11)",
    graticuleLabel: "rgba(255,255,255,0.45)",
    land: "#9ab97f",
    landStroke: "#63824c",
    island: "#a9c58f",
    islandStroke: "#6d8c55",
    coastline: "#9ab97f",
    coastlineStroke: "#4e6a3a",
    range: "rgba(150,133,110,0.6)",
    rangeStroke: "#6d6050",
    plateau: "rgba(178,163,128,0.5)",
    peak: "#4a4238",
    peakSnow: "#ffffff",
    peakLabel: "#241f18",
    volcano: "#d2470f",
    volcanoGlow: "#ff8a3d",
    river: { 1: "#79bdf7", 2: "#55a4e8", 3: "#2f86cf", 4: "#1a6ab0", 5: "#0e5090" },
    lake: "#3179b8",
    lakeStroke: "#1d5688",
    desert: "rgba(228,201,132,0.72)",
    forest: "rgba(52,110,58,0.6)",
    savanna: "rgba(196,180,102,0.6)",
    grassland: "rgba(157,182,110,0.6)",
    tundra: "rgba(168,178,164,0.62)",
    glacier: "rgba(236,247,255,0.88)",
    wetland: "rgba(90,140,120,0.6)",
    select: "#ffd83d",
    hover: "#ffffff",
    hudText: "#e8f2ff",
  },
  topo: {
    id: "topo",
    name: "Topographic",
    short: "Topo",
    ocean: "#0a192f",
    oceanDeep: "#050d1c",
    sea: "#123457",
    trench: "#02060f",
    iceCap: "#f2fbff",
    plateBoundary: "rgba(255,120,80,0.4)",
    graticule: "rgba(120,170,230,0.14)",
    graticuleLabel: "rgba(150,195,245,0.5)",
    land: "#88b06a",
    landStroke: "#4f6c3b",
    island: "#96bd74",
    islandStroke: "#5c7a45",
    coastline: "#88b06a",
    coastlineStroke: "#3f5730",
    range: "rgba(191,140,88,0.72)",
    rangeStroke: "#8a5c31",
    plateau: "rgba(204,176,120,0.6)",
    peak: "#fdfdfd",
    peakSnow: "#ffffff",
    peakLabel: "#ffffff",
    volcano: "#e63946",
    volcanoGlow: "#ff6b74",
    river: { 1: "#8fd0ff", 2: "#62b1f2", 3: "#3a91e0", 4: "#1f72c2", 5: "#0f559e" },
    lake: "#1f6fbf",
    lakeStroke: "#0f4a85",
    desert: "rgba(233,190,118,0.7)",
    forest: "rgba(36,108,72,0.68)",
    savanna: "rgba(205,183,96,0.62)",
    grassland: "rgba(148,187,104,0.62)",
    tundra: "rgba(176,190,186,0.65)",
    glacier: "rgba(244,252,255,0.92)",
    wetland: "rgba(64,130,118,0.62)",
    select: "#00e5ff",
    hover: "#f2faff",
    hudText: "#d9ecff",
  },
  antique: {
    id: "antique",
    name: "Age of Discovery",
    short: "Antique",
    ocean: "#cdb896",
    oceanDeep: "#bfa884",
    sea: "#d3c1a2",
    trench: "#a9906c",
    iceCap: "#f3efe2",
    plateBoundary: "rgba(120,80,50,0.3)",
    graticule: "rgba(95,72,48,0.22)",
    graticuleLabel: "rgba(80,58,38,0.65)",
    land: "#e9dfc0",
    landStroke: "#6b5236",
    island: "#efe6cc",
    islandStroke: "#6b5236",
    coastline: "#e9dfc0",
    coastlineStroke: "#5a4429",
    range: "rgba(163,138,106,0.5)",
    rangeStroke: "#4f3c25",
    plateau: "rgba(198,178,141,0.45)",
    peak: "#3c2c1c",
    peakSnow: "#fbf7ec",
    peakLabel: "#2a1d11",
    volcano: "#8d3016",
    volcanoGlow: "#c1552f",
    river: { 1: "#7d97ac", 2: "#627e97", 3: "#4a6781", 4: "#33506a", 5: "#203b52" },
    lake: "#7994ab",
    lakeStroke: "#45627c",
    desert: "rgba(220,198,152,0.55)",
    forest: "rgba(129,143,105,0.48)",
    savanna: "rgba(200,183,134,0.5)",
    grassland: "rgba(178,182,132,0.5)",
    tundra: "rgba(198,196,182,0.5)",
    glacier: "rgba(247,245,235,0.85)",
    wetland: "rgba(140,155,130,0.5)",
    select: "#a83318",
    hover: "#20160c",
    hudText: "#3a2a17",
  },
  satellite: {
    id: "satellite",
    name: "Orbital Satellite",
    short: "Satellite",
    ocean: "#050b16",
    oceanDeep: "#01030a",
    sea: "#0a1628",
    trench: "#000206",
    iceCap: "#dff1ff",
    plateBoundary: "rgba(255,90,50,0.35)",
    graticule: "rgba(0,220,255,0.08)",
    graticuleLabel: "rgba(0,220,255,0.38)",
    land: "#213c28",
    landStroke: "#2f5a3c",
    island: "#28492f",
    islandStroke: "#37694a",
    coastline: "#213c28",
    coastlineStroke: "#3d7a52",
    range: "rgba(66,56,47,0.8)",
    rangeStroke: "#5b4c3d",
    plateau: "rgba(84,73,55,0.7)",
    peak: "#e8e8e8",
    peakSnow: "#ffffff",
    peakLabel: "#ffffff",
    volcano: "#ff3b19",
    volcanoGlow: "#ff7a45",
    river: { 1: "#3ec7ff", 2: "#16a9ef", 3: "#0287d1", 4: "#016aa8", 5: "#015482" },
    lake: "#0c9ada",
    lakeStroke: "#0272a8",
    desert: "rgba(133,104,59,0.68)",
    forest: "rgba(20,106,53,0.72)",
    savanna: "rgba(140,124,58,0.66)",
    grassland: "rgba(86,126,56,0.66)",
    tundra: "rgba(104,116,112,0.7)",
    glacier: "rgba(222,242,255,0.9)",
    wetland: "rgba(30,96,88,0.7)",
    select: "#2dd4ff",
    hover: "#f5fbff",
    hudText: "#cfe9ff",
  },
};

export const FEATURE_LABELS: Record<FeatureType, string> = {
  continent: "Continent",
  island: "Island",
  sea: "Ocean Basin",
  trench: "Oceanic Trench",
  ice_cap: "Polar Ice Cap",
  plate_boundary: "Plate Boundary",
  coastline: "Detailed Coastline",
  mountain_range: "Mountain Range",
  mountain: "Summit",
  volcano: "Volcano",
  plateau: "Plateau",
  canyon: "Canyon",
  river: "River",
  lake: "Lake",
  wetland: "Wetland",
  glacier: "Glacier",
  desert: "Desert",
  forest: "Forest",
  tundra: "Tundra",
  savanna: "Savanna",
  grassland: "Grassland",
  reef: "Reef",
};

export function biomeColor(t: FeatureType, th: ThemeColors): string {
  switch (t) {
    case "desert":
      return th.desert;
    case "forest":
      return th.forest;
    case "savanna":
      return th.savanna;
    case "grassland":
      return th.grassland;
    case "tundra":
      return th.tundra;
    case "glacier":
      return th.glacier;
    case "wetland":
      return th.wetland;
    default:
      return th.forest;
  }
}

export const BIOME_TYPES: FeatureType[] = [
  "desert",
  "forest",
  "savanna",
  "grassland",
  "tundra",
  "glacier",
  "wetland",
];
