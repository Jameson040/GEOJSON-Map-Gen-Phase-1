import type { GeneratedRegion, MapFeature, PlanetMacro } from "./types";
import { xToLon, yToLat, PLANET_WIDTH, PLANET_HEIGHT } from "./constants";

/**
 * Serialise features to real GeoJSON. Internal coordinates are planetary grid
 * units; on export we project them to true lon/lat degrees so the output drops
 * straight into QGIS / Mapbox / geopandas.
 */
function projectCoords(c: any): any {
  if (typeof c[0] === "number") return [xToLon(c[0]), yToLat(c[1])];
  return c.map(projectCoords);
}

function toGeoJSONFeature(f: MapFeature, project: boolean) {
  return {
    type: "Feature",
    id: f.id,
    bbox: project
      ? [xToLon(f.bbox.minX), yToLat(f.bbox.maxY), xToLon(f.bbox.maxX), yToLat(f.bbox.minY)]
      : [f.bbox.minX, f.bbox.minY, f.bbox.maxX, f.bbox.maxY],
    geometry: {
      type: f.geometry.type,
      coordinates: project ? projectCoords(f.geometry.coordinates) : f.geometry.coordinates,
    },
    properties: f.properties,
  };
}

export function exportMacroGeoJSON(macro: PlanetMacro, project = true): string {
  return JSON.stringify(
    {
      type: "FeatureCollection",
      metadata: {
        generator: "Terra Ex Nihilo — Cascading Planet Synthesiser",
        tier: 1,
        scope: "planetary macro architecture",
        seed: macro.config.seed,
        crs: project ? "EPSG:4326 (equirectangular)" : `grid ${PLANET_WIDTH}×${PLANET_HEIGHT}`,
        stats: macro.stats,
        regions: macro.regions.map((r) => ({
          id: r.id,
          name: r.name,
          kind: r.kind,
          lon: +r.lon.toFixed(3),
          lat: +r.lat.toFixed(3),
          areaKm2: r.areaKm2,
          climateZone: r.climateZone,
          plate: r.plateName,
          regionSeed: r.regionSeed,
          detailBudget: r.detailBudget,
        })),
      },
      features: macro.features.map((f) => toGeoJSONFeature(f, project)),
    },
    null,
    2
  );
}

export function exportRegionGeoJSON(region: GeneratedRegion, project = true): string {
  const d = region.descriptor;
  return JSON.stringify(
    {
      type: "FeatureCollection",
      metadata: {
        generator: "Terra Ex Nihilo — Cascading Planet Synthesiser",
        tier: 2,
        scope: `regional detail for ${d.name}`,
        parentRegion: {
          id: d.id,
          name: d.name,
          kind: d.kind,
          lon: +d.lon.toFixed(3),
          lat: +d.lat.toFixed(3),
          areaKm2: d.areaKm2,
          climateZone: d.climateZone,
          plate: d.plateName,
          convergentEdges: d.convergentEdges,
        },
        regionSeed: d.regionSeed,
        detailLevel: region.config.detailLevel,
        crs: project ? "EPSG:4326 (equirectangular)" : `grid ${PLANET_WIDTH}×${PLANET_HEIGHT}`,
        stats: region.stats,
      },
      features: region.features.map((f) => toGeoJSONFeature(f, project)),
    },
    null,
    2
  );
}

export function downloadText(filename: string, content: string, mime = "application/geo+json") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
