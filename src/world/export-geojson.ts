import type { GeneratedRegion, MapFeature, PlanetMacro, Pt } from "./types";
import type { ResourceLayerResult } from "./resources/resource-types";
import type { BioLayerResult } from "./bio/bio-types";
import type { HumanLayerResult } from "./human/human-types";
import type { PopulationLayerResult } from "./population/population-types";
import type { RouteLayerResult } from "./routes/route-types";
import type { CadastreLayerResult } from "./cadastre/cadastre-types";
import { xToLon, yToLat, unitsToKm, PLANET_WIDTH, PLANET_HEIGHT } from "./constants";
import { bboxOfCoords } from "./geom";

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

// ---------------------------------------------------------------------------
// FULL WORLD BUNDLE EXPORT — every generated layer of one region as a single
// GeoJSON FeatureCollection. Each feature carries `properties.layer` so the
// collection can be split, filtered or styled per layer in any GIS. The
// geography half is the exact same serialisation as exportRegionGeoJSON.
// ---------------------------------------------------------------------------

export interface WorldExportOptions {
  resource?: ResourceLayerResult | null;
  bio?: BioLayerResult | null;
  human?: HumanLayerResult | null;
  population?: PopulationLayerResult | null;
  routes?: RouteLayerResult | null;
  cadastre?: CadastreLayerResult | null;
  /** Include individual roof footprints (L7). True by default, subject to maxRoofFeatures. */
  includeRoofs?: boolean;
  /** Roofs are skipped above this count to keep the file manageable (default 25,000). */
  maxRoofFeatures?: number;
}

/** Minimal typed GeoJSON feature builder used by the non-geography layers. */
function pointFeature(id: string, p: Pt, properties: Record<string, unknown>, project: boolean) {
  return {
    type: "Feature",
    id,
    bbox: [project ? xToLon(p[0]) : p[0], project ? yToLat(p[1]) : p[1], project ? xToLon(p[0]) : p[0], project ? yToLat(p[1]) : p[1]],
    geometry: { type: "Point", coordinates: project ? projectCoords(p) : p },
    properties,
  };
}

function lineFeature(id: string, points: Pt[], properties: Record<string, unknown>, project: boolean) {
  const b = bboxOfCoords(points);
  return {
    type: "Feature",
    id,
    bbox: project
      ? [xToLon(b.minX), yToLat(b.maxY), xToLon(b.maxX), yToLat(b.minY)]
      : [b.minX, b.minY, b.maxX, b.maxY],
    geometry: { type: "LineString", coordinates: project ? projectCoords(points) : points },
    properties,
  };
}

function polygonFeature(id: string, ring: Pt[], properties: Record<string, unknown>, project: boolean) {
  // GeoJSON polygon rings must be closed; cadastre geometry stores open rings internally.
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = first && last && (first[0] !== last[0] || first[1] !== last[1]) ? [...ring, first] : ring;
  const b = bboxOfCoords(closed);
  return {
    type: "Feature",
    id,
    bbox: project
      ? [xToLon(b.minX), yToLat(b.maxY), xToLon(b.maxX), yToLat(b.minY)]
      : [b.minX, b.minY, b.maxX, b.maxY],
    geometry: { type: "Polygon", coordinates: [project ? projectCoords(closed) : closed] },
    properties,
  };
}

export function exportRegionWorldGeoJSON(
  region: GeneratedRegion,
  options: WorldExportOptions,
  project = true
): string {
  const d = region.descriptor;
  const features: any[] = [];
  const layerCounts: { layer: string; features: number }[] = [];
  const push = (layer: string, ...fs: any[]) => {
    if (!fs.length) return;
    layerCounts.push({ layer, features: fs.length });
    features.push(...fs);
  };

  // ---- L1 Geography (identical serialisation to exportRegionGeoJSON) ----
  push("L1 Geography", ...region.features.map((f) => {
    const feature = toGeoJSONFeature(f, project);
    feature.properties = { ...f.properties, layer: "L1 Geography" };
    return feature;
  }));

  // ---- L2 Geological Resources ----
  if (options.resource) {
    push("L2 Geological Resources", ...options.resource.deposits.map((dep) =>
      pointFeature(dep.id, dep.point, {
        layer: "L2 Geological Resources",
        id: dep.id,
        name: dep.name,
        resourceId: dep.resourceId,
        category: dep.category,
        domain: dep.domain,
        abundance: dep.abundance,
        radiusKm: +unitsToKm(dep.radiusUnits).toFixed(2),
        yieldEstimate: dep.yieldEstimate,
        geologicalContext: dep.geologicalContext,
      }, project)
    ));
  }

  // ---- L3 Biosphere ----
  if (options.bio) {
    push("L3 Biosphere", ...options.bio.populations.map((p) =>
      pointFeature(p.id, p.point, {
        layer: "L3 Biosphere",
        id: p.id,
        name: p.name,
        speciesId: p.speciesId,
        kind: p.kind,
        category: p.category,
        roles: p.roles,
        abundance: p.abundance,
        spreadKm: +unitsToKm(p.radiusUnits).toFixed(2),
        origin: p.origin,
      }, project)
    ));
  }

  // ---- L4 Habitable Zones (+ L5 occupancy joined onto each zone) ----
  if (options.human) {
    const pop = options.population?.model;
    push("L4 Habitable Zones", ...options.human.settlements.map((s) => {
      const zonePop = pop?.get(s.id);
      return pointFeature(s.id, s.point, {
        layer: "L4 Habitable Zones",
        id: s.id,
        name: s.name,
        type: s.type,
        tier: s.tier,
        structuralCapacity: s.popCap,
        siteCapacity: +s.capacity.toFixed(3),
        habitation: s.habitation,
        resourceRoles: s.resourceRoles,
        siteTraits: s.siteTraits,
        waterSource: s.waterSource,
        ...(zonePop
          ? {
              population: zonePop.occupancy,
              populationDensityPerKm2: Math.round(zonePop.densityPerKm2),
              populationPhaseCount: zonePop.phases.length,
              foodShortage: zonePop.foodShortage,
              waterSecure: zonePop.waterSecure,
              yearProduced: zonePop.yearProduced,
            }
          : {}),
      }, project);
    }));
  }

  // ---- L6 Roads & Trade Routes ----
  if (options.routes) {
    push("L6 Roads & Trade Routes", ...options.routes.routes.map((r) =>
      lineFeature(r.id, r.points, {
        layer: "L6 Roads & Trade Routes",
        id: r.id,
        name: r.name,
        type: r.type,
        start: `${r.startSettlementName} (${r.startSettlementId})`,
        end: `${r.endSettlementName} (${r.endSettlementId})`,
        lengthKm: +r.lengthKm.toFixed(1),
        sinuosity: +r.sinuosity.toFixed(2),
        paved: r.paved,
        bridgesCount: r.bridgesCount,
        mountainPassesCount: r.mountainPassesCount,
        tradeGoods: r.tradeGoods,
      }, project)
    ));
  }

  // ---- L7 Cadastre: streets, parcels, roofs ----
  let roofsSkipped = false;
  if (options.cadastre && options.cadastre.cadastres.size > 0) {
    const streetFeatures: any[] = [];
    const parcelFeatures: any[] = [];
    const roofFeatures: any[] = [];
    const includeRoofs = options.includeRoofs !== false;
    const maxRoofs = options.maxRoofFeatures ?? 25_000;
    const totalBuildings = options.cadastre.stats.totalBuildings;
    const roofsAllowed = includeRoofs && totalBuildings <= maxRoofs;
    roofsSkipped = includeRoofs && !roofsAllowed;
    for (const cad of options.cadastre.cadastres.values()) {
      for (const street of cad.streets) {
        streetFeatures.push(lineFeature(`${cad.settlementId}:${street.id}`, street.points, {
          layer: "L7 Cadastre · Streets",
          settlementId: cad.settlementId,
          settlementName: cad.settlementName,
          kind: street.kind,
          surface: street.surface,
          widthM: street.widthM,
        }, project));
      }
      for (const parcel of cad.parcels) {
        parcelFeatures.push(polygonFeature(`${cad.settlementId}:${parcel.id}`, parcel.boundary, {
          layer: "L7 Cadastre · Parcels",
          settlementId: cad.settlementId,
          settlementName: cad.settlementName,
          landUse: parcel.landUse,
          areaM2: Math.round(parcel.areaM2),
        }, project));
      }
      if (roofsAllowed) {
        for (const b of cad.buildings) {
          roofFeatures.push(polygonFeature(`${cad.settlementId}:${b.id}`, b.footprint, {
            layer: "L7 Cadastre · Roofs",
            settlementId: cad.settlementId,
            settlementName: cad.settlementName,
            buildingType: b.buildingType,
            roofType: b.roofType,
            roofMaterial: b.roofMaterial,
            stories: b.stories,
            heightM: +b.heightM.toFixed(1),
          }, project));
        }
      }
    }
    push("L7 Cadastre · Streets", ...streetFeatures);
    push("L7 Cadastre · Parcels", ...parcelFeatures);
    push("L7 Cadastre · Roofs", ...roofFeatures);
  }

  return JSON.stringify(
    {
      type: "FeatureCollection",
      metadata: {
        generator: "Terra Ex Nihilo — Cascading Planet Synthesiser",
        scope: `full world bundle for ${d.name}`,
        parentRegion: {
          id: d.id,
          name: d.name,
          kind: d.kind,
          lon: +d.lon.toFixed(3),
          lat: +d.lat.toFixed(3),
          areaKm2: d.areaKm2,
          climateZone: d.climateZone,
        },
        regionSeed: region.seed,
        detailLevel: region.config.detailLevel,
        crs: project ? "EPSG:4326 (equirectangular)" : `grid ${PLANET_WIDTH}×${PLANET_HEIGHT}`,
        layers: layerCounts,
        stats: region.stats,
        resourceStats: options.resource?.stats,
        bioStats: options.bio?.stats,
        humanStats: options.human?.stats,
        populationReport: options.population?.report,
        routeStats: options.routes?.stats,
        cadastreStats: options.cadastre?.stats,
        ...(roofsSkipped
          ? { note: `Roof footprints skipped: ${options.cadastre?.stats.totalBuildings.toLocaleString()} buildings exceed the export cap (pass a higher maxRoofFeatures).` }
          : {}),
      },
      features,
    },
    null,
    2
  );
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
