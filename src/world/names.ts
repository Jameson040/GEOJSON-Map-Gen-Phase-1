import type { RNG } from "./rng";
import { choice } from "./rng";

const ROOTS = [
  "Aethel", "Alba", "Amara", "Andor", "Arctis", "Arden", "Astra", "Aura", "Boreas", "Calad",
  "Caspi", "Celest", "Cerro", "Cimmer", "Coron", "Cresta", "Danu", "Drakon", "Eldar", "Elys",
  "Eos", "Ereb", "Fjord", "Gaea", "Gond", "Hadri", "Hesper", "Hyper", "Iliad", "Illyr",
  "Indus", "Ionia", "Jura", "Kala", "Karak", "Kelvin", "Khor", "Kolyma", "Krona", "Lacor",
  "Lapis", "Lemur", "Levant", "Lorn", "Lyra", "Magna", "Maris", "Mithr", "Mont", "Morr",
  "Nadir", "Nebul", "Nereus", "Nival", "Nord", "Nyx", "Ocean", "Olym", "Onyx", "Oread",
  "Oros", "Pangea", "Pelag", "Phobos", "Pindus", "Plata", "Polar", "Pontus", "Rift", "Rodin",
  "Rupes", "Sahel", "Sarmat", "Scandi", "Serac", "Serra", "Silv", "Sirius", "Sol", "Strata",
  "Sunda", "Taiga", "Taran", "Tauri", "Tellus", "Tethys", "Thule", "Titan", "Torngat", "Typhon",
  "Ultima", "Ursa", "Vald", "Vesper", "Vindhy", "Volga", "Vulcan", "Xanadu", "Ymir", "Zephyr"
];

const SUFFIXES = [
  "a", "ae", "an", "ar", "ard", "as", "ea", "el", "en", "er",
  "ia", "ic", "in", "ion", "is", "ith", "ius", "on", "or", "os",
  "um", "un", "ur", "us", "ya", "yn", "yr"
];

const RIVER_TERMS = ["River", "Fork", "Tributary", "Run", "Creek", "Brook", "Wash", "Torrent", "Flume"];
const PEAK_PREFIXES = ["Mount", "Peak", "Pinnacle", "Spire", "Needle", "Dome", "Summit", "Tor"];
const RANGE_TERMS = ["Cordillera", "Massif", "Range", "Mountains", "Ridge", "Highlands", "Alps", "Escarpment"];
const VOLCANO_TERMS = ["Caldera", "Volcano", "Crater", "Vents", "Stratovolcano", "Shield", "Cone"];
const LAKE_TERMS = ["Lake", "Loch", "Tarn", "Basin", "Lagoon", "Depression", "Mirror"];
const DESERT_TERMS = ["Desert", "Wastes", "Expanse", "Dunes", "Playa", "Salt Flats", "Erg"];
const FOREST_TERMS = ["Canopy", "Woodland", "Forest", "Taiga", "Jungle", "Timberland", "Boreal"];
const GLACIER_TERMS = ["Glacier", "Ice Sheet", "Ice Shelf", "Neve", "Icefield", "Firn"];
const SEA_TERMS = ["Sea", "Ocean", "Abyss", "Gulf", "Bay", "Sound", "Strait"];
const ISLAND_TERMS = ["Isle", "Island", "Atoll", "Cay", "Archipelago", "Reef", "Skerry"];

export function makeStem(rng: RNG): string {
  const root = choice(rng, ROOTS);
  const suf = choice(rng, SUFFIXES);
  return `${root}${suf}`;
}

export function nameFeature(rng: RNG, kind: string, rank = 1): string {
  const stem = makeStem(rng);
  switch (kind) {
    case "continent": {
      const prefixes = ["Terra", "Continent of", "Greater", "Upper", "Lower", "Austro-", "Boreo-"];
      if (rank <= 2) return `${stem}ia`;
      if (rank <= 4) return `${choice(rng, prefixes)} ${stem}`;
      return `${stem}land`;
    }
    case "island": {
      const term = choice(rng, ISLAND_TERMS);
      return `${stem} ${term}`;
    }
    case "mountain_range": {
      const term = choice(rng, RANGE_TERMS);
      return `${stem} ${term}`;
    }
    case "mountain": {
      if (rank === 1) return `Mount ${stem}`;
      const prefix = choice(rng, PEAK_PREFIXES);
      return `${prefix} ${stem}`;
    }
    case "volcano": {
      const term = choice(rng, VOLCANO_TERMS);
      return `${stem} ${term}`;
    }
    case "river": {
      if (rank >= 4) return `Great ${stem} River`;
      if (rank === 3) return `${stem} River`;
      const term = choice(rng, RIVER_TERMS);
      return `${stem} ${term}`;
    }
    case "lake": {
      const term = choice(rng, LAKE_TERMS);
      return `${term} ${stem}`;
    }
    case "sea": {
      const term = choice(rng, SEA_TERMS);
      return `${term} of ${stem}`;
    }
    case "glacier": {
      const term = choice(rng, GLACIER_TERMS);
      return `${stem} ${term}`;
    }
    case "desert": {
      const term = choice(rng, DESERT_TERMS);
      return `${stem} ${term}`;
    }
    case "forest": {
      const term = choice(rng, FOREST_TERMS);
      return `${stem} ${term}`;
    }
    case "tundra":
      return `${stem} Tundra`;
    case "savanna":
      return `${stem} Savanna`;
    default:
      return stem;
  }
}
