// ---------------------------------------------------------------------------
// Shared planetary constants & coordinate conversions.
//
// The planet lives in one single equirectangular coordinate space:
//    X: 0 .. PLANET_WIDTH   ->  longitude -180° .. +180°
//    Y: 0 .. PLANET_HEIGHT  ->  latitude   +90° ..  -90°
//
// BOTH tiers (macro planet & regional detail) use this same space, so a river
// generated inside a continent tab has the exact same lon/lat as it would on
// the planetary map. Only the *camera* changes between tiers, never the datum.
// ---------------------------------------------------------------------------

export const PLANET_WIDTH = 7200;
export const PLANET_HEIGHT = 3600;

/** Equatorial circumference in km (Earth-like). */
export const PLANET_CIRCUMFERENCE_KM = 40075;

/** How many kilometres one planetary coordinate unit represents. */
export const KM_PER_UNIT = PLANET_CIRCUMFERENCE_KM / PLANET_WIDTH; // ≈ 5.566 km

export const unitsToKm = (u: number) => u * KM_PER_UNIT;
export const kmToUnits = (km: number) => km / KM_PER_UNIT;

/** Square planetary units -> square kilometres. */
export const areaUnitsToKm2 = (a: number) => a * KM_PER_UNIT * KM_PER_UNIT;

/** Wrap an X coordinate onto the planet's periodic longitude interval. */
export const wrapWorldX = (x: number) => ((x % PLANET_WIDTH) + PLANET_WIDTH) % PLANET_WIDTH;

/** Shortest signed X displacement on the cylindrical world. */
export const circularDeltaX = (from: number, to: number) => {
  let d = wrapWorldX(to) - wrapWorldX(from);
  if (d > PLANET_WIDTH / 2) d -= PLANET_WIDTH;
  if (d < -PLANET_WIDTH / 2) d += PLANET_WIDTH;
  return d;
};

/** The 2D map seam is arbitrary; longitude always wraps around the globe. */
export const xToLon = (x: number) => (wrapWorldX(x) / PLANET_WIDTH) * 360 - 180;
export const yToLat = (y: number) => 90 - (y / PLANET_HEIGHT) * 180;
export const lonToX = (lon: number) => ((lon + 180) / 360) * PLANET_WIDTH;
export const latToY = (lat: number) => ((90 - lat) / 180) * PLANET_HEIGHT;

export function formatLatLon(x: number, y: number): string {
  const lon = xToLon(x);
  const lat = yToLat(y);
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(1)}°${ns}, ${Math.abs(lon).toFixed(1)}°${ew}`;
}

/** Normalised latitude band 0 (north pole) .. 1 (south pole). */
export const latBand = (y: number) => Math.max(0, Math.min(1, y / PLANET_HEIGHT));

/** Absolute distance from the equator, 0 (equator) .. 1 (pole). */
export const equatorDistance = (y: number) => Math.abs(latBand(y) - 0.5) * 2;

export type ClimateZone = "polar" | "subpolar" | "temperate" | "subtropical" | "tropical";

export function climateZoneAt(y: number): ClimateZone {
  const d = equatorDistance(y);
  if (d > 0.82) return "polar";
  if (d > 0.62) return "subpolar";
  if (d > 0.4) return "temperate";
  if (d > 0.2) return "subtropical";
  return "tropical";
}

/**
 * Prevailing surface wind direction (radians) from the Hadley/Ferrel/Polar
 * cell model. Used by Tier-2 to decide which flank of a mountain belt gets
 * rain and which becomes a rain-shadow desert.
 *   Tropics  : easterlies  (wind blows toward -X)
 *   Mid-lat  : westerlies  (wind blows toward +X)
 *   Polar    : easterlies  (wind blows toward -X)
 */
export function prevailingWindAngle(y: number): number {
  const d = equatorDistance(y);
  if (d < 0.3) return Math.PI; // trade easterlies
  if (d < 0.7) return 0; // westerlies
  return Math.PI; // polar easterlies
}

export function prevailingWindName(y: number): string {
  const d = equatorDistance(y);
  if (d < 0.3) return "Trade Easterlies";
  if (d < 0.7) return "Mid-latitude Westerlies";
  return "Polar Easterlies";
}

/** Baseline annual rainfall (mm) purely from latitude, before orography. */
export function baseRainfall(y: number): number {
  const d = equatorDistance(y);
  // ITCZ peak at equator, subtropical dry belt ~25°, mid-lat storm track ~50°
  const itcz = 2600 * Math.exp(-Math.pow(d / 0.17, 2));
  const dry = -900 * Math.exp(-Math.pow((d - 0.28) / 0.13, 2));
  const stormTrack = 900 * Math.exp(-Math.pow((d - 0.55) / 0.18, 2));
  const polarDesert = -500 * Math.exp(-Math.pow((d - 1.0) / 0.2, 2));
  return Math.max(30, 900 + itcz + dry + stormTrack + polarDesert);
}

/** Baseline mean temperature (°C) from latitude and elevation. */
export function baseTemperature(y: number, elevationM = 0): number {
  const d = equatorDistance(y);
  const seaLevel = 29 - 62 * Math.pow(d, 1.35);
  return seaLevel - (elevationM / 1000) * 6.5; // environmental lapse rate
}
