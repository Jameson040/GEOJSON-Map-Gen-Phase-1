import type { RNG } from "../rng";
import type { RouteType } from "./route-types";

// ---------------------------------------------------------------------------
// LORE NAME GENERATOR FOR ROADS, HIGHWAYS, TRAILS & SEA LANES
// ---------------------------------------------------------------------------

const HIGHWAY_PATTERNS = [
  "The King's Highway",
  "The Imperial High Road",
  "The Crown Way",
  "The Great North Road",
  "The Royal Causeway",
  "The High Merchant Way",
  "The Sovereign Post Road",
  "The Sunken Way",
  "The Golden Corridor",
];

const ARTERIAL_SUFFIXES = [
  "Turnpike",
  "Post Road",
  "Highway",
  "Artery",
  "Wagonway",
  "Valley Road",
  "Market Way",
  "Reach",
];

const BYWAY_SUFFIXES = [
  "Track",
  "Trail",
  "Byway",
  "Lane",
  "Trace",
  "Path",
  "Drove",
  "Packhorse Way",
];

const PASS_PATTERNS = [
  "Pass Trail",
  "Notch Track",
  "Defile Road",
  "Gap Causeway",
  "Saddle Byway",
  "High Crest Way",
];

const SEA_PATTERNS = [
  "Shipping Lane",
  "Merchant Channel",
  "Coastal Reach",
  "Deepwater Passage",
  "Fairway",
  "Trader's Run",
  "Maritime Reach",
];

export function nameRoute(
  rng: RNG,
  type: RouteType,
  startName: string,
  endName: string,
  goods?: string[]
): string {
  // Strip common suffixes for cleaner compound names
  const cleanStart = startName.replace(/\s+(Site|Abbey|Keep|Camp|Ground|Flats)$/, "");
  const cleanEnd = endName.replace(/\s+(Site|Abbey|Keep|Camp|Ground|Flats)$/, "");

  if (type === "sea_lane") {
    const roll = rng();
    if (roll < 0.6) {
      const pat = SEA_PATTERNS[Math.floor(rng() * SEA_PATTERNS.length)];
      return `${cleanStart}–${cleanEnd} ${pat}`;
    }
    return `The ${cleanStart} Shipping Reach`;
  }

  if (type === "mountain_pass") {
    const pat = PASS_PATTERNS[Math.floor(rng() * PASS_PATTERNS.length)];
    return `${cleanStart} ${pat}`;
  }

  if (type === "highway") {
    const roll = rng();
    if (roll < 0.45) {
      return HIGHWAY_PATTERNS[Math.floor(rng() * HIGHWAY_PATTERNS.length)];
    }
    if (goods && goods.length > 0 && roll < 0.7) {
      const g = goods[0].charAt(0).toUpperCase() + goods[0].slice(1);
      return `The Great ${g} Highway`;
    }
    return `The ${cleanStart}–${cleanEnd} Royal Highway`;
  }

  if (type === "arterial") {
    const suf = ARTERIAL_SUFFIXES[Math.floor(rng() * ARTERIAL_SUFFIXES.length)];
    const roll = rng();
    if (roll < 0.55) {
      return `${cleanStart}–${cleanEnd} ${suf}`;
    }
    return `Old ${cleanStart} ${suf}`;
  }

  // byway
  const suf = BYWAY_SUFFIXES[Math.floor(rng() * BYWAY_SUFFIXES.length)];
  if (goods && goods.length > 0 && rng() < 0.4) {
    const g = goods[0].charAt(0).toUpperCase() + goods[0].slice(1);
    return `${g} ${suf}`;
  }
  return `${cleanStart} ${suf}`;
}
